import crypto from 'crypto';
import { setCorsHeaders } from './_lib/auth.js';
import { inspectPaperworkWithGemini } from './_lib/geminiInspector.js';

/**
 * Cache access token across warm lambda invocations
 */
let cachedToken = null;
let tokenExpiresAt = 0;
const folderCache = new Map();

/**
 * Extracts Google Service Account credentials from environment variables
 */
function getGoogleCredentials() {
  let clientEmail = null;
  let privateKey = null;
  let folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;
  let impersonateUser = process.env.GOOGLE_DRIVE_IMPERSONATE_USER || process.env.GOOGLE_WORKSPACE_USER || null;

  // Option 1: Direct JSON string in GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.client_email && parsed.private_key) {
        clientEmail = parsed.client_email;
        privateKey = parsed.private_key.replace(/\\n/g, '\n');
        if (!folderId) folderId = parsed.folder_id || null;
        if (!impersonateUser) impersonateUser = parsed.impersonate_user || null;
      }
    } catch (e) {
      console.warn('[Google Drive Auth] Failed to parse service account JSON:', e.message);
    }
  }

  // Option 2: Individual env vars
  if (!clientEmail || !privateKey) {
    clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
    privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_DRIVE_PRIVATE_KEY;
  }

  if (clientEmail && privateKey) {
    privateKey = privateKey.replace(/\\n/g, '\n');
    return { clientEmail, privateKey, folderId, impersonateUser };
  }

  return null;
}

/**
 * Generates an OAuth2 JWT assertion for Google APIs (RS256)
 * Supports optional user impersonation (domain-wide delegation) if configured.
 */
function createGoogleJwtAssertion(clientEmail, privateKey, impersonateUser = null) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive https://www.googleapis.com/auth/drive.file',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

  // If user delegation configured, set sub
  if (impersonateUser) {
    claimSet.sub = impersonateUser;
  }

  const encodeBase64Url = (obj) =>
    Buffer.from(JSON.stringify(obj))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');

  const unsignedToken = `${encodeBase64Url(header)}.${encodeBase64Url(claimSet)}`;

  const sign = crypto.createSign('RSA-SHA256');
  sign.update(unsignedToken);
  sign.end();
  const signature = sign
    .sign(privateKey, 'base64')
    .replace(/=/g, '')
    .replace(/\+/g, '-')
    .replace(/\//g, '_');

  return `${unsignedToken}.${signature}`;
}

/**
 * Obtains an OAuth2 Access Token using JWT bearer grant
 */
async function getGoogleAccessToken(creds, signal) {
  const now = Date.now();
  if (cachedToken && tokenExpiresAt > now + 60000) {
    return cachedToken;
  }

  // Try with impersonateUser first if set, fallback to direct service account if unauthorized
  let assertion = createGoogleJwtAssertion(creds.clientEmail, creds.privateKey, creds.impersonateUser);
  let body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  let res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

  if (!res.ok && creds.impersonateUser) {
    // If impersonation failed (e.g. domain delegation not configured in admin.google.com), retry as pure service account
    console.warn('[Google Drive Auth] Impersonation failed, retrying without sub claim...');
    assertion = createGoogleJwtAssertion(creds.clientEmail, creds.privateKey, null);
    body = new URLSearchParams({
      grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
      assertion,
    });
    res = await fetch('https://oauth2.googleapis.com/token', {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: body.toString(),
      signal,
    });
  }

  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`Google OAuth Token Error (${res.status}): ${errText}`);
  }

  const data = await res.json();
  cachedToken = data.access_token;
  tokenExpiresAt = now + (data.expires_in || 3600) * 1000;
  return cachedToken;
}

/**
 * Finds or creates a Google Drive folder by name inside a parent folder
 * Passing supportsAllDrives=true and includeItemsFromAllDrives=true for Shared Drives.
 */
async function findOrCreateFolder(folderName, parentFolderId, accessToken, signal) {
  if (!parentFolderId) return null;

  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and '${parentFolderId}' in parents and trashed = false`;

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`,
    {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal,
    }
  );

  if (searchRes.ok) {
    const data = await searchRes.json();
    if (data.files && data.files.length > 0) {
      return data.files[0].id;
    }
  }

  // Create subfolder inside parent
  const meta = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: [parentFolderId],
  };

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id&supportsAllDrives=true', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify(meta),
    signal,
  });

  if (!createRes.ok) {
    const errText = await createRes.text();
    console.warn(`[Google Drive] Subfolder creation notice: ${errText}`);
    return parentFolderId;
  }

  const created = await createRes.json();
  return created.id || parentFolderId;
}

/**
 * Cached version of findOrCreateFolder to avoid redundant API queries
 */
async function findOrCreateFolderCached(folderName, parentFolderId, accessToken, signal) {
  if (!parentFolderId) return null;
  const cacheKey = `${parentFolderId}::${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }
  const folderId = await findOrCreateFolder(folderName, parentFolderId, accessToken, signal);
  if (folderId) {
    folderCache.set(cacheKey, folderId);
  }
  return folderId;
}

/**
 * Resolves structured folder hierarchy:
 * Wholesale RMA Records
 *   └── [YYYY-MM]
 *       └── [RMA_NUMBER]
 *           ├── 01_Damaged_Items/
 *           └── 02_Official_Paperwork/
 */
async function resolveRmaHierarchy({ rootFolderId, rmaNumber, category, accessToken, signal }) {
  const now = new Date();
  const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;

  let currentParentId = rootFolderId;

  // 1. Root folder: "Wholesale RMA Records"
  if (!currentParentId) {
    try {
      const searchRes = await fetch(
        `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and name = 'Wholesale RMA Records' and trashed = false")}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal }
      );
      if (searchRes.ok) {
        const sData = await searchRes.json();
        if (sData.files && sData.files.length > 0) {
          currentParentId = sData.files[0].id;
        }
      }
    } catch (e) {
      console.warn('[Google Drive] Root search notice:', e.message);
    }
  }

  if (currentParentId) {
    try {
      const infoRes = await fetch(
        `https://www.googleapis.com/drive/v3/files/${currentParentId}?fields=id,name&supportsAllDrives=true`,
        { headers: { Authorization: `Bearer ${accessToken}` }, signal }
      );
      if (infoRes.ok) {
        const info = await infoRes.json();
        if (info.name !== 'Wholesale RMA Records') {
          const subRoot = await findOrCreateFolderCached('Wholesale RMA Records', currentParentId, accessToken, signal);
          if (subRoot) currentParentId = subRoot;
        }
      }
    } catch (e) {
      console.warn('[Google Drive] Root verification notice:', e.message);
    }
  }

  // 2. Monthly: [YYYY-MM]
  const monthFolderId = await findOrCreateFolderCached(yearMonth, currentParentId, accessToken, signal);
  if (monthFolderId) {
    currentParentId = monthFolderId;
  }

  // 3. RMA Number: [RMA_NUMBER]
  const cleanRma = (rmaNumber && rmaNumber !== 'GENERAL') ? String(rmaNumber).trim() : 'General_Intake';
  const rmaFolderId = await findOrCreateFolderCached(cleanRma, currentParentId, accessToken, signal);
  if (rmaFolderId) {
    currentParentId = rmaFolderId;
  }

  // 4. Subfolder: 01_Damaged_Items or 02_Official_Paperwork
  const isPaperwork = category === 'official_paperwork' || category === 'paperwork';
  const subFolderName = isPaperwork ? '02_Official_Paperwork' : '01_Damaged_Items';
  const targetSubfolderId = await findOrCreateFolderCached(subFolderName, currentParentId, accessToken, signal);

  const rmaFolderUrl = rmaFolderId
    ? `https://drive.google.com/drive/folders/${rmaFolderId}`
    : (currentParentId ? `https://drive.google.com/drive/folders/${currentParentId}` : null);

  return {
    targetFolderId: targetSubfolderId || currentParentId,
    rmaFolderId: rmaFolderId || currentParentId,
    rmaFolderUrl
  };
}

/**
 * Serverless Upload Handler:
 * Uploads compressed WebP proof photo directly to Google Workspace Drive
 * with automatic Supabase Storage fallback.
 */
export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  // Handle DELETE request to remove stored proof photos from Google Drive
  if (req.method === 'DELETE') {
    const creds = getGoogleCredentials();
    if (!creds) {
      return res.status(200).json({ success: false, message: 'Google Drive credentials not configured' });
    }

    try {
      // 1. Robust body & query parsing (handling strings, objects, query params)
      let parsedBody = req.body;
      if (typeof parsedBody === 'string') {
        try { parsedBody = JSON.parse(parsedBody); } catch (e) {}
      }

      const rawUrlsOrIds = [];
      if (req.query?.fileId) rawUrlsOrIds.push(req.query.fileId);
      if (req.query?.fileUrl) rawUrlsOrIds.push(req.query.fileUrl);
      if (req.query?.folderId) rawUrlsOrIds.push(req.query.folderId);
      if (req.query?.folderUrl) rawUrlsOrIds.push(req.query.folderUrl);
      if (parsedBody?.fileId) rawUrlsOrIds.push(parsedBody.fileId);
      if (parsedBody?.fileUrl) rawUrlsOrIds.push(parsedBody.fileUrl);
      if (parsedBody?.folderId) rawUrlsOrIds.push(parsedBody.folderId);
      if (parsedBody?.folderUrl) rawUrlsOrIds.push(parsedBody.folderUrl);
      if (Array.isArray(parsedBody?.fileIds)) rawUrlsOrIds.push(...parsedBody.fileIds);
      if (Array.isArray(parsedBody?.fileUrls)) rawUrlsOrIds.push(...parsedBody.fileUrls);
      if (Array.isArray(parsedBody?.folderIds)) rawUrlsOrIds.push(...parsedBody.folderIds);
      if (Array.isArray(parsedBody?.folderUrls)) rawUrlsOrIds.push(...parsedBody.folderUrls);
      if (Array.isArray(parsedBody?.urls)) rawUrlsOrIds.push(...parsedBody.urls);

      if (rawUrlsOrIds.length === 0) {
        return res.status(400).json({ success: false, error: 'Missing fileId, fileUrl, folderId, or fileUrls for deletion' });
      }

      const accessToken = await getGoogleAccessToken(creds);
      const deletedIds = [];
      const failed = [];

      for (const item of rawUrlsOrIds) {
        if (!item) continue;
        let fileId = null;

        // Support strings or objects with url/id/fileId/folderId
        let cleanItem = '';
        if (typeof item === 'string') {
          cleanItem = item.trim();
        } else if (typeof item === 'object') {
          cleanItem = String(item.fileId || item.folderId || item.id || item.fileUrl || item.url || '').trim();
        }

        if (!cleanItem) continue;

        // Try extracting Google Drive File/Folder ID from URL
        const idMatch = cleanItem.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                        cleanItem.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
                        cleanItem.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                        cleanItem.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        
        if (idMatch && idMatch[1]) {
          fileId = idMatch[1].split(/[?&=/]/)[0];
        } else if (/^[a-zA-Z0-9_-]{15,65}$/.test(cleanItem)) {
          // Direct fileId or folderId passed
          fileId = cleanItem;
        } else {
          // Attempt filename search in Google Drive as fallback
          const filename = cleanItem.split('/').pop()?.split('?')[0];
          if (filename && filename.length > 5) {
            try {
              const searchQ = `name = '${filename}' and trashed = false`;
              const sRes = await fetch(
                `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(searchQ)}&fields=files(id,name)&pageSize=5&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`,
                { headers: { Authorization: `Bearer ${accessToken}` } }
              );
              if (sRes.ok) {
                const sJson = await sRes.json();
                if (sJson.files && sJson.files.length > 0) {
                  fileId = sJson.files[0].id;
                }
              }
            } catch (searchErr) {
              console.warn('[Google Drive File Search Notice]:', searchErr.message);
            }
          }
        }

        if (!fileId) {
          failed.push({ item, reason: 'Could not extract or locate Google Drive File ID' });
          continue;
        }

        try {
          // Attempt 1: Permanent delete (supported if service account has Manager/Organizer role)
          const delRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
            {
              method: 'DELETE',
              headers: { Authorization: `Bearer ${accessToken}` },
            }
          );

          if (delRes.status === 204 || delRes.ok || delRes.status === 404) {
            console.log(`[Google Drive] Asset permanently deleted or already removed: ${fileId}`);
            deletedIds.push(fileId);
            continue;
          }

          const delErrText = await delRes.text();
          console.warn(`[Google Drive Permanent Delete Notice for ${fileId}]: ${delErrText}. Attempting fallback to move file/folder to trash...`);

          // Attempt 2: Move file or folder to trash (supported for Content Managers and Managers in Shared Drives)
          const trashRes = await fetch(
            `https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`,
            {
              method: 'PATCH',
              headers: {
                Authorization: `Bearer ${accessToken}`,
                'Content-Type': 'application/json',
              },
              body: JSON.stringify({ trashed: true }),
            }
          );

          if (trashRes.ok || trashRes.status === 200 || trashRes.status === 404) {
            console.log(`[Google Drive] Asset successfully moved to trash: ${fileId}`);
            deletedIds.push(fileId);
            continue;
          }

          const trashErrText = await trashRes.text();
          console.warn(`[Google Drive Trash Fallback Notice for ${fileId}]: ${trashErrText}`);
          failed.push({
            fileId,
            error: delErrText,
            trashError: trashErrText,
            hint: 'Ensure Google Service Account has "Content Manager" or "Manager" role in the Google Shared Drive members settings.'
          });
        } catch (itemErr) {
          console.warn(`[Google Drive Delete Error for ${fileId}]:`, itemErr.message);
          failed.push({ fileId, error: itemErr.message });
        }
      }

      return res.status(200).json({
        success: deletedIds.length > 0 || failed.length === 0,
        deletedCount: deletedIds.length,
        deletedIds,
        failed
      });
    } catch (delErr) {
      console.warn('[Google Drive Delete Global Exception]:', delErr.message);
      return res.status(200).json({ success: false, error: delErr.message });
    }
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // 1. Handle Gemini Flash Paperwork Inspection
  if (req.query?.action === 'inspect-paperwork' || req.body?.action === 'inspect-paperwork' || req.url?.includes('inspect-paperwork')) {
    try {
      const { fileData, imageUrl, mimeType } = req.body || {};
      const result = await inspectPaperworkWithGemini({
        fileData: fileData || req.body?.image || req.body?.photo,
        imageUrl: imageUrl || req.body?.url,
        mimeType: mimeType || 'image/jpeg'
      });
      return res.status(200).json(result);
    } catch (err) {
      console.error('[Gemini Paperwork Inspection Error]:', err);
      return res.status(500).json({
        is_valid_document: false,
        confidence: 0,
        error: err.message,
        rejection_reason: `AI inspection error: ${err.message}`
      });
    }
  }

  // 2. Check if Google Drive credentials exist
  const creds = getGoogleCredentials();
  if (!creds) {
    return res.status(200).json({
      success: false,
      fallback: 'supabase',
      message: 'Google Drive credentials not configured. Please use Supabase Storage fallback.',
    });
  }

  // 3. Parse body: expect base64 fileData, rmaNumber, and category ('damaged_items' | 'official_paperwork')
  const {
    fileData,
    fileName,
    mimeType = 'image/webp',
    rmaNumber = 'GENERAL',
    category = 'damaged_items'
  } = req.body || {};

  if (!fileData) {
    return res.status(400).json({
      success: false,
      error: 'MISSING_FILE_DATA',
      message: 'Base64 fileData is required for photo upload.',
    });
  }

  // Clean base64 prefix if present (e.g. data:image/webp;base64,...)
  const pureBase64 = fileData.includes(',') ? fileData.split(',')[1] : fileData;
  const buffer = Buffer.from(pureBase64, 'base64');

  // Hard timeout guard: 7500ms to stay safely under Vercel Hobby 10-second limit
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 7500);

  try {
    const accessToken = await getGoogleAccessToken(creds, controller.signal);

    // 4. Resolve target folder in Google Drive with clean hierarchical structure:
    // Wholesale RMA Records / [YYYY-MM] / [RMA_NUMBER] / [01_Damaged_Items | 02_Official_Paperwork]
    const {
      targetFolderId,
      rmaFolderId,
      rmaFolderUrl
    } = await resolveRmaHierarchy({
      rootFolderId: creds.folderId,
      rmaNumber,
      category,
      accessToken,
      signal: controller.signal
    });

    if (!targetFolderId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_TARGET_FOLDER',
        message: 'Google Drive requires a valid root folder or shared drive to store files without quota limits.'
      });
    }

    // 5. Construct Multipart Upload to Drive v3 with supportsAllDrives=true
    const safeName = fileName || `RMA_${rmaNumber}_${category}_${Date.now()}.webp`;
    const boundary = `----RmaPhotoBoundary${Date.now()}`;

    const metadataPart = JSON.stringify({
      name: safeName,
      parents: targetFolderId ? [targetFolderId] : undefined,
      description: `Wholesale RMA ${category} for ${rmaNumber} - Uploaded ${new Date().toISOString()}`,
    });

    const bodyParts = [
      `--${boundary}\r\nContent-Type: application/json; charset=UTF-8\r\n\r\n${metadataPart}\r\n`,
      `--${boundary}\r\nContent-Type: ${mimeType}\r\nContent-Transfer-Encoding: base64\r\n\r\n${buffer.toString('base64')}\r\n`,
      `--${boundary}--\r\n`,
    ];

    const multipartBody = bodyParts.join('');

    const uploadRes = await fetch(
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&supportsAllDrives=true&fields=id,name,webViewLink',
      {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': `multipart/related; boundary=${boundary}`,
        },
        body: multipartBody,
        signal: controller.signal,
      }
    );

    if (!uploadRes.ok) {
      const errText = await uploadRes.text();
      console.error('[Google Drive Upload Error]:', errText);
      return res.status(200).json({
        success: false,
        fallback: 'supabase',
        error: `Google Drive upload failed: ${errText}`,
      });
    }

    const file = await uploadRes.json();
    const fileId = file.id;

    // 5. Grant public read permission so the photo can be rendered directly in web portals & emails
    try {
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions?supportsAllDrives=true`, {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${accessToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          role: 'reader',
          type: 'anyone',
        }),
        signal: controller.signal,
      });
    } catch (permErr) {
      console.warn('[Google Drive Permission Notice]:', permErr.message);
    }

    // Direct Google CDN image preview link (no interstitials, embeds smoothly in <img src>)
    const directCdnUrl = `https://lh3.googleusercontent.com/d/${fileId}`;
    const webViewLink = file.webViewLink || `https://drive.google.com/file/d/${fileId}/view?usp=sharing`;

    clearTimeout(timeoutId);

    return res.status(200).json({
      success: true,
      provider: 'google_drive',
      fileId,
      url: directCdnUrl,
      previewUrl: directCdnUrl,
      webViewLink,
      rmaFolderUrl,
      rmaFolderId,
      category,
      fileName: safeName,
      sizeBytes: buffer.length,
    });
  } catch (err) {
    clearTimeout(timeoutId);
    console.warn('[Photo Upload Fallback Notice]:', err.message);

    // Gracefully instruct client to fall back to Supabase Storage
    return res.status(200).json({
      success: false,
      fallback: 'supabase',
      message: err.name === 'AbortError' ? 'Google Drive upload timed out (>7.5s)' : err.message,
    });
  }
}

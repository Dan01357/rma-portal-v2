import crypto from 'crypto';
import { setCorsHeaders } from './_lib/auth.js';

/**
 * Cache access token across warm lambda invocations
 */
let cachedToken = null;
let tokenExpiresAt = 0;

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
 * Serverless Upload Handler:
 * Uploads compressed WebP proof photo directly to Google Workspace Drive
 * with automatic Supabase Storage fallback.
 */
export default async function handler(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return res.status(405).json({ success: false, error: 'METHOD_NOT_ALLOWED' });
  }

  // 1. Check if Google Drive credentials exist
  const creds = getGoogleCredentials();
  if (!creds) {
    return res.status(200).json({
      success: false,
      fallback: 'supabase',
      message: 'Google Drive credentials not configured. Please use Supabase Storage fallback.',
    });
  }

  // 2. Parse body: expect base64 fileData
  const { fileData, fileName, mimeType = 'image/webp', rmaNumber = 'GENERAL' } = req.body || {};

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

    // 3. Resolve target folder in Google Drive
    // If GOOGLE_DRIVE_FOLDER_ID is provided, organize into monthly subfolder inside it, or upload directly to it
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    let targetFolderId = creds.folderId;

    // If folderId is not specified, attempt to auto-discover "Wholesale RMA Photos" or current monthly folder across all accessible shared drives
    if (!targetFolderId) {
      try {
        const searchShared = await fetch(
          `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent("mimeType = 'application/vnd.google-apps.folder' and (name = 'Wholesale RMA Photos' or name = '" + yearMonth + "') and trashed = false")}&fields=files(id,name)&pageSize=1&supportsAllDrives=true&includeItemsFromAllDrives=true&corpora=allDrives`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal
          }
        );
        if (searchShared.ok) {
          const sData = await searchShared.json();
          if (sData.files && sData.files.length > 0) {
            targetFolderId = sData.files[0].id;
          }
        }
      } catch (sErr) {
        console.warn('[Google Drive] Auto-discovery notice:', sErr.message);
      }
    }

    if (targetFolderId) {
      try {
        // Check if target folder is already named after the current month
        const infoRes = await fetch(
          `https://www.googleapis.com/drive/v3/files/${targetFolderId}?fields=id,name&supportsAllDrives=true`,
          {
            headers: { Authorization: `Bearer ${accessToken}` },
            signal: controller.signal
          }
        );
        let isAlreadyMonthly = false;
        if (infoRes.ok) {
          const info = await infoRes.json();
          if (info.name === yearMonth || info.name.includes(yearMonth)) {
            isAlreadyMonthly = true;
          }
        }

        if (!isAlreadyMonthly) {
          const subfolderId = await findOrCreateFolder(yearMonth, targetFolderId, accessToken, controller.signal);
          if (subfolderId) targetFolderId = subfolderId;
        }
      } catch (fErr) {
        console.warn('[Google Drive] Monthly subfolder check notice, uploading to target folder:', fErr.message);
      }
    }

    if (!targetFolderId) {
      return res.status(400).json({
        success: false,
        error: 'MISSING_TARGET_FOLDER',
        message: 'Google Drive Service Account requires GOOGLE_DRIVE_FOLDER_ID or a shared folder ("Wholesale RMA Photos") to store files without quota limits.'
      });
    }

    // 4. Construct Multipart Upload to Drive v3 with supportsAllDrives=true
    const safeName = fileName || `RMA_${rmaNumber}_${Date.now()}.webp`;
    const boundary = `----RmaPhotoBoundary${Date.now()}`;

    const metadataPart = JSON.stringify({
      name: safeName,
      parents: targetFolderId ? [targetFolderId] : undefined,
      description: `Wholesale RMA Proof Photo for ${rmaNumber} - Uploaded ${now.toISOString()}`,
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

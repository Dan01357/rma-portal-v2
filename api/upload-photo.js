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
  // Option 1: Direct JSON string in GOOGLE_SERVICE_ACCOUNT_KEY or GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON
  const jsonStr = process.env.GOOGLE_SERVICE_ACCOUNT_KEY || process.env.GOOGLE_DRIVE_SERVICE_ACCOUNT_JSON;
  if (jsonStr) {
    try {
      const parsed = JSON.parse(jsonStr);
      if (parsed.client_email && parsed.private_key) {
        return {
          clientEmail: parsed.client_email,
          privateKey: parsed.private_key.replace(/\\n/g, '\n'),
          folderId: process.env.GOOGLE_DRIVE_FOLDER_ID || parsed.folder_id || null,
        };
      }
    } catch (e) {
      console.warn('[Google Drive Auth] Failed to parse service account JSON:', e.message);
    }
  }

  // Option 2: Individual env vars
  const clientEmail = process.env.GOOGLE_SERVICE_ACCOUNT_EMAIL || process.env.GOOGLE_DRIVE_CLIENT_EMAIL;
  let privateKey = process.env.GOOGLE_SERVICE_ACCOUNT_PRIVATE_KEY || process.env.GOOGLE_DRIVE_PRIVATE_KEY;
  const folderId = process.env.GOOGLE_DRIVE_FOLDER_ID || null;

  if (clientEmail && privateKey) {
    // Clean formatted private key
    privateKey = privateKey.replace(/\\n/g, '\n');
    return { clientEmail, privateKey, folderId };
  }

  return null;
}

/**
 * Generates an OAuth2 JWT assertion for Google APIs (RS256)
 */
function createGoogleJwtAssertion(clientEmail, privateKey) {
  const header = {
    alg: 'RS256',
    typ: 'JWT',
  };

  const now = Math.floor(Date.now() / 1000);
  const claimSet = {
    iss: clientEmail,
    scope: 'https://www.googleapis.com/auth/drive.file https://www.googleapis.com/auth/drive',
    aud: 'https://oauth2.googleapis.com/token',
    exp: now + 3600,
    iat: now,
  };

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

  const assertion = createGoogleJwtAssertion(creds.clientEmail, creds.privateKey);
  const body = new URLSearchParams({
    grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer',
    assertion,
  });

  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: body.toString(),
    signal,
  });

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
 */
async function findOrCreateFolder(folderName, parentFolderId, accessToken, signal) {
  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${folderName}' and trashed = false`;
  if (parentFolderId) {
    query += ` and '${parentFolderId}' in parents`;
  }

  const searchRes = await fetch(
    `https://www.googleapis.com/drive/v3/files?q=${encodeURIComponent(query)}&fields=files(id,name)&pageSize=1`,
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

  // Create folder
  const meta = {
    name: folderName,
    mimeType: 'application/vnd.google-apps.folder',
    parents: parentFolderId ? [parentFolderId] : undefined,
  };

  const createRes = await fetch('https://www.googleapis.com/drive/v3/files?fields=id', {
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
    console.warn(`[Google Drive] Folder creation notice: ${errText}`);
    return parentFolderId || null;
  }

  const created = await createRes.json();
  return created.id;
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

    // 3. Resolve folder hierarchy: "Wholesale RMA Photos" / "YYYY-MM"
    const now = new Date();
    const yearMonth = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}`;
    
    let rootFolderId = creds.folderId;
    if (!rootFolderId) {
      rootFolderId = await findOrCreateFolder('Wholesale RMA Photos', null, accessToken, controller.signal);
    }
    const targetFolderId = await findOrCreateFolder(yearMonth, rootFolderId, accessToken, controller.signal);

    // 4. Construct Multipart Upload to Drive v3
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
      'https://www.googleapis.com/upload/drive/v3/files?uploadType=multipart&fields=id,name,webViewLink',
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
      await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}/permissions`, {
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

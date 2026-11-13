import crypto from 'crypto';
import { setCorsHeaders } from './_lib/auth.js';
import { inspectPaperworkWithGemini, inspectDriverLicenseWithGemini } from './_lib/geminiInspector.js';

/**
 * Cache access token across warm lambda invocations
 */
let cachedToken = null;
let tokenExpiresAt = 0;
let cachedDriveId = null;
const folderCache = new Map();

/**
 * Discovers and caches the Shared Drive (Team Drive) ID for Wholesale RMA Photos
 */
async function getSharedDriveId(creds, accessToken, signal) {
  if (cachedDriveId) return cachedDriveId;
  if (creds?.folderId && String(creds.folderId).startsWith('0A')) {
    cachedDriveId = creds.folderId;
    return cachedDriveId;
  }
  try {
    const drivesRes = await fetch('https://www.googleapis.com/drive/v3/drives?pageSize=10', {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal
    });
    if (drivesRes.ok) {
      const dData = await drivesRes.json();
      const matched = (dData.drives || []).find(d =>
        /wholesale\s*rma/i.test(d.name || '') || d.name === 'Wholesale RMA Photos' || d.name === 'Wholesale RMA Reports'
      );
      if (matched) {
        cachedDriveId = matched.id;
        return cachedDriveId;
      }
      if (dData.drives && dData.drives.length > 0) {
        cachedDriveId = dData.drives[0].id;
        return cachedDriveId;
      }
    }
  } catch (e) {
    console.warn('[Google Drive] Shared Drives discovery notice:', e.message);
  }
  return creds?.folderId || null;
}

/**
 * Searches Google Drive files and folders robustly across Shared Drives and My Drive.
 * Avoids unsupported 'corpora=allDrives' query errors on service accounts.
 */
async function searchFiles(query, { accessToken, driveId = null, pageSize = 50, signal = null }) {
  // Strategy 1: Search directly in Shared Drive if driveId is known
  if (driveId) {
    try {
      const params = new URLSearchParams({
        q: query,
        corpora: 'drive',
        driveId: driveId,
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
        pageSize: String(pageSize),
        fields: 'files(id, name, mimeType, parents, trashed)'
      });
      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
        signal
      });
      if (res.ok) {
        const data = await res.json();
        if (data.files && Array.isArray(data.files) && data.files.length > 0) {
          return data.files;
        }
      }
    } catch (e) {
      console.warn('[Google Drive Shared Drive Search Notice]:', e.message);
    }
  }

  // Strategy 2: Search with supportsAllDrives=true and includeItemsFromAllDrives=true
  try {
    const params = new URLSearchParams({
      q: query,
      supportsAllDrives: 'true',
      includeItemsFromAllDrives: 'true',
      pageSize: String(pageSize),
      fields: 'files(id, name, mimeType, parents, trashed)'
    });
    const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params.toString()}`, {
      headers: { Authorization: `Bearer ${accessToken}` },
      signal
    });
    if (res.ok) {
      const data = await res.json();
      if (data.files && Array.isArray(data.files)) {
        return data.files;
      }
    }
  } catch (e) {
    console.warn('[Google Drive General Search Notice]:', e.message);
  }

  return [];
}

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
async function findOrCreateFolder(folderName, parentFolderId, accessToken, signal, driveId = null) {
  const safeName = (folderName || 'General').trim();
  const escapedName = safeName.replace(/'/g, "\\'");

  let query = `mimeType = 'application/vnd.google-apps.folder' and name = '${escapedName}' and trashed = false`;
  if (parentFolderId) {
    query += ` and '${parentFolderId}' in parents`;
  }

  const existingFiles = await searchFiles(query, { accessToken, driveId, pageSize: 1, signal });
  if (existingFiles.length > 0) {
    return existingFiles[0].id;
  }

  // Create subfolder inside parent with supportsAllDrives=true
  const meta = {
    name: safeName,
    mimeType: 'application/vnd.google-apps.folder',
    ...(parentFolderId ? { parents: [parentFolderId] } : {}),
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
    console.warn(`[Google Drive] Folder creation notice for "${safeName}": ${errText}`);
    return parentFolderId;
  }

  const created = await createRes.json();
  return created.id || parentFolderId;
}

/**
 * Cached version of findOrCreateFolder to avoid redundant API queries
 */
async function findOrCreateFolderCached(folderName, parentFolderId, accessToken, signal, driveId = null) {
  if (!parentFolderId) return null;
  const cacheKey = `${parentFolderId}::${folderName}`;
  if (folderCache.has(cacheKey)) {
    return folderCache.get(cacheKey);
  }
  const folderId = await findOrCreateFolder(folderName, parentFolderId, accessToken, signal, driveId);
  if (folderId) {
    folderCache.set(cacheKey, folderId);
  }
  return folderId;
}

/**
 * Robust JSON body parser for Vercel Serverless Functions
 * Handles pre-parsed req.body objects, raw JSON strings, and unparsed stream bodies on DELETE / POST.
 */
async function parseRequestBody(req) {
  if (req.body && typeof req.body === 'object') return req.body;
  if (typeof req.body === 'string' && req.body.trim()) {
    try { return JSON.parse(req.body); } catch (e) { return {}; }
  }
  return new Promise((resolve) => {
    let raw = '';
    req.on('data', chunk => { raw += chunk; });
    req.on('end', () => {
      if (!raw || !raw.trim()) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        resolve({});
      }
    });
    req.on('error', () => resolve({}));
  });
}

/**
 * Resolves structured folder hierarchy under Root Shared Drive:
 * 1. RMA Proof Items: Root -> RMA-Reports-Item -> [RMA_NUMBER] -> uploaded files
 * 2. RMA Official Paperwork: Root -> RMA-Reports-SI/DR/PO -> [RMA_NUMBER] -> uploaded files
 * 3. Product Catalog: Root -> Products -> [SKU] [Product Name] -> uploaded files
 */
async function resolveTargetFolder({
  rootFolderId,
  rmaNumber,
  category,
  sku = null,
  productName = null,
  targetFolderId: preResolvedFolderId = null,
  accessToken,
  signal
}) {
  if (preResolvedFolderId) {
    return {
      targetFolderId: preResolvedFolderId,
      rmaFolderId: preResolvedFolderId,
      rmaFolderUrl: `https://drive.google.com/drive/folders/${preResolvedFolderId}`
    };
  }

  let rootId = rootFolderId;
  if (!rootId) {
    rootId = await getSharedDriveId({ folderId: rootFolderId }, accessToken, signal);
  }

  const isProduct = category === 'product' || category === 'products' || category === 'catalog' || Boolean(sku && !rmaNumber);
  const isPaperwork = category === 'official_paperwork' || category === 'paperwork' || category === 'invoice' || category === 'si_dr_po' || category === 'si' || category === 'dr' || category === 'po';

  if (isProduct) {
    // Hierarchy: Root -> Products -> [SKU] [Name]
    const productsRootId = await findOrCreateFolderCached('Products', rootId, accessToken, signal, rootId);
    const cleanSku = (sku || 'SKU').trim();
    const cleanName = (productName || '').trim();
    const folderName = cleanName ? `${cleanSku} ${cleanName}`.replace(/[\\/:*?"<>|]/g, '-').trim() : cleanSku;
    const prodFolderId = await findOrCreateFolderCached(folderName, productsRootId, accessToken, signal, rootId);
    return {
      targetFolderId: prodFolderId || productsRootId,
      rmaFolderId: prodFolderId || productsRootId,
      rmaFolderUrl: prodFolderId ? `https://drive.google.com/drive/folders/${prodFolderId}` : null
    };
  }

  const cleanRma = (rmaNumber && rmaNumber !== 'GENERAL') ? String(rmaNumber).trim() : 'General_Intake';

  if (isPaperwork) {
    // Hierarchy: Root -> RMA-Reports-SI/DR/PO -> [RMA_NUMBER]
    const siDrPoRootId = await findOrCreateFolderCached('RMA-Reports-SI/DR/PO', rootId, accessToken, signal, rootId);
    const rmaFolderId = await findOrCreateFolderCached(cleanRma, siDrPoRootId, accessToken, signal, rootId);
    return {
      targetFolderId: rmaFolderId || siDrPoRootId,
      rmaFolderId: rmaFolderId || siDrPoRootId,
      rmaFolderUrl: rmaFolderId ? `https://drive.google.com/drive/folders/${rmaFolderId}` : null
    };
  }

  // Default: RMA Damage Proof Items -> Root -> RMA-Reports-Item -> [RMA_NUMBER]
  const itemRootId = await findOrCreateFolderCached('RMA-Reports-Item', rootId, accessToken, signal, rootId);
  const rmaFolderId = await findOrCreateFolderCached(cleanRma, itemRootId, accessToken, signal, rootId);
  return {
    targetFolderId: rmaFolderId || itemRootId,
    rmaFolderId: rmaFolderId || itemRootId,
    rmaFolderUrl: rmaFolderId ? `https://drive.google.com/drive/folders/${rmaFolderId}` : null
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

  // Robust body parsing across Vercel / Node runtime
  const parsedBody = await parseRequestBody(req);

  const isDeleteAction = req.method === 'DELETE' || 
    req.query?.action === 'delete' || 
    parsedBody?.action === 'delete' ||
    req.url?.includes('action=delete');

  // Handle DELETE / Deletion request to remove stored proof photos and folders from Google Drive
  if (isDeleteAction) {
    const creds = getGoogleCredentials();
    if (!creds) {
      return res.status(200).json({ success: false, message: 'Google Drive credentials not configured' });
    }

    try {
      const accessToken = await getGoogleAccessToken(creds);
      const driveId = await getSharedDriveId(creds, accessToken);

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

      // Collect RMA numbers or SKUs for folder-level cleanup
      const rmaNumbers = [];
      if (req.query?.rmaNumber) rmaNumbers.push(req.query.rmaNumber);
      if (parsedBody?.rmaNumber) rmaNumbers.push(parsedBody.rmaNumber);
      if (Array.isArray(parsedBody?.rmaNumbers)) rmaNumbers.push(...parsedBody.rmaNumbers);

      const skus = [];
      if (req.query?.sku) skus.push(req.query.sku);
      if (parsedBody?.sku) skus.push(parsedBody.sku);
      if (Array.isArray(parsedBody?.skus)) skus.push(...parsedBody.skus);

      const fileIdsToDelete = new Set();
      const folderIdsToDelete = new Map(); // id -> name
      const deletedIds = [];
      const failed = [];
      const SYSTEM_PROTECTED_FOLDERS = new Set([
        'Wholesale RMA Reports',
        'Wholesale RMA Photos',
        'RMA-Reports-Item',
        'RMA-Reports-SI/DR/PO',
        'Products'
      ]);

      // 1. If RMA numbers provided, locate their specific folders AND all files inside them
      for (const rma of [...new Set(rmaNumbers.filter(Boolean))]) {
        try {
          const cleanRma = String(rma).replace(/'/g, "\\'").trim();
          const q = `mimeType = 'application/vnd.google-apps.folder' and name = '${cleanRma}' and trashed = false`;
          const foundFolders = await searchFiles(q, { accessToken, driveId, pageSize: 20 });
          for (const f of foundFolders) {
            if (f.id && f.id !== driveId && f.id !== creds.folderId && !SYSTEM_PROTECTED_FOLDERS.has(f.name)) {
              // Find ALL files inside this RMA folder
              const childrenQ = `'${f.id}' in parents and trashed = false`;
              const children = await searchFiles(childrenQ, { accessToken, driveId, pageSize: 100 });
              for (const child of children) {
                if (child.id) fileIdsToDelete.add(child.id);
              }
              folderIdsToDelete.set(f.id, f.name);
            }
          }
        } catch (e) {
          console.warn(`[Google Drive RMA Folder Search Notice for ${rma}]:`, e.message);
        }
      }

      // 2. If SKUs provided, locate their specific product folders AND all files inside them
      for (const skuItem of [...new Set(skus.filter(Boolean))]) {
        try {
          const cleanSku = String(skuItem).replace(/'/g, "\\'").trim();
          if (cleanSku.length >= 2) {
            const q = `mimeType = 'application/vnd.google-apps.folder' and name contains '${cleanSku}' and trashed = false`;
            const foundFolders = await searchFiles(q, { accessToken, driveId, pageSize: 20 });
            for (const f of foundFolders) {
              if (f.id && f.id !== driveId && f.id !== creds.folderId && !SYSTEM_PROTECTED_FOLDERS.has(f.name)) {
                const childrenQ = `'${f.id}' in parents and trashed = false`;
                const children = await searchFiles(childrenQ, { accessToken, driveId, pageSize: 100 });
                for (const child of children) {
                  if (child.id) fileIdsToDelete.add(child.id);
                }
                folderIdsToDelete.set(f.id, f.name);
              }
            }
          }
        } catch (e) {
          console.warn(`[Google Drive SKU Folder Search Notice for ${skuItem}]:`, e.message);
        }
      }

      // 3. Process explicit file/folder IDs & URLs passed from caller
      for (const item of rawUrlsOrIds) {
        if (!item) continue;
        let cleanItem = '';
        if (typeof item === 'string') cleanItem = item.trim();
        else if (typeof item === 'object') {
          cleanItem = String(item.fileId || item.folderId || item.id || item.fileUrl || item.url || '').trim();
        }
        if (!cleanItem) continue;

        let extractedId = null;
        const idMatch = cleanItem.match(/\/d\/([a-zA-Z0-9_-]+)/) || 
                        cleanItem.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
                        cleanItem.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
                        cleanItem.match(/\/file\/d\/([a-zA-Z0-9_-]+)/);
        
        if (idMatch && idMatch[1]) {
          extractedId = idMatch[1].split(/[?&=/]/)[0];
        } else if (/^[a-zA-Z0-9_-]{15,65}$/.test(cleanItem)) {
          extractedId = cleanItem;
        }

        if (extractedId) {
          if (cleanItem.includes('/folders/') || folderIdsToDelete.has(extractedId)) {
            folderIdsToDelete.set(extractedId, folderIdsToDelete.get(extractedId) || 'Folder');
            // If it's a folder, also harvest child files inside it
            try {
              const children = await searchFiles(`'${extractedId}' in parents and trashed = false`, { accessToken, driveId, pageSize: 100 });
              for (const child of children) {
                if (child.id) fileIdsToDelete.add(child.id);
              }
            } catch (cErr) {}
          } else {
            fileIdsToDelete.add(extractedId);
          }
        }
      }

      if (fileIdsToDelete.size === 0 && folderIdsToDelete.size === 0) {
        return res.status(200).json({ success: true, count: 0, message: 'No assets found to delete.' });
      }

      // 4. Delete/Trash all individual files
      for (const fileId of fileIdsToDelete) {
        if (!fileId || fileId === driveId || fileId === creds.folderId) continue;
        try {
          // Attempt 1: Permanent delete
          const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (delRes.status === 204 || delRes.ok || delRes.status === 404) {
            deletedIds.push(fileId);
            continue;
          }

          // Attempt 2: Trash
          const trashRes = await fetch(`https://www.googleapis.com/drive/v3/files/${fileId}?supportsAllDrives=true`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ trashed: true }),
          });

          if (trashRes.ok || trashRes.status === 200 || trashRes.status === 404) {
            deletedIds.push(fileId);
            continue;
          }

          const trashErrText = await trashRes.text();
          failed.push({ fileId, error: trashErrText });
        } catch (fileErr) {
          failed.push({ fileId, error: fileErr.message });
        }
      }

      // 5. Delete/Trash/Rename folders
      for (const [folderId, folderName] of folderIdsToDelete.entries()) {
        if (!folderId || folderId === driveId || folderId === creds.folderId || SYSTEM_PROTECTED_FOLDERS.has(folderName)) continue;
        try {
          // Attempt 1: Permanent delete
          const delRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true`, {
            method: 'DELETE',
            headers: { Authorization: `Bearer ${accessToken}` },
          });

          if (delRes.status === 204 || delRes.ok || delRes.status === 404) {
            deletedIds.push(folderId);
            continue;
          }

          // Attempt 2: Trash
          const trashRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ trashed: true }),
          });

          if (trashRes.ok || trashRes.status === 200 || trashRes.status === 404) {
            deletedIds.push(folderId);
            continue;
          }

          // Attempt 3: Rename to [Deleted] if 403 on Shared Drive
          const renameRes = await fetch(`https://www.googleapis.com/drive/v3/files/${folderId}?supportsAllDrives=true`, {
            method: 'PATCH',
            headers: {
              Authorization: `Bearer ${accessToken}`,
              'Content-Type': 'application/json',
            },
            body: JSON.stringify({ name: `[Deleted] ${folderName || folderId}` }),
          });

          if (renameRes.ok || renameRes.status === 200) {
            deletedIds.push(folderId);
          } else {
            const renameErr = await renameRes.text();
            failed.push({ folderId, error: renameErr });
          }
        } catch (folderErr) {
          failed.push({ folderId, error: folderErr.message });
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
  if (req.query?.action === 'inspect-paperwork' || parsedBody?.action === 'inspect-paperwork' || req.url?.includes('inspect-paperwork')) {
    try {
      const { fileData, imageUrl, mimeType } = parsedBody || {};
      const result = await inspectPaperworkWithGemini({
        fileData: fileData || parsedBody?.image || parsedBody?.photo,
        imageUrl: imageUrl || parsedBody?.url,
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

  // 1b. Handle Gemini Flash Driver License OCR
  if (req.query?.action === 'inspect-license' || parsedBody?.action === 'inspect-license') {
    try {
      const { fileData, imageUrl, mimeType } = parsedBody || {};
      const result = await inspectDriverLicenseWithGemini({
        fileData: fileData || parsedBody?.image || parsedBody?.photo,
        imageUrl: imageUrl || parsedBody?.url,
        mimeType: mimeType || 'image/jpeg'
      });
      return res.status(200).json(result);
    } catch (err) {
      return res.status(200).json({
        is_valid_license: false,
        driver_name: null,
        license_number: null,
        rejection_reason: `License OCR notice: ${err.message}`
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

  // 3. Parse body: expect base64 fileData, rmaNumber, category, sku, productName
  const {
    fileData,
    fileName,
    mimeType = 'image/webp',
    rmaNumber = 'GENERAL',
    category = 'damaged_items',
    sku = null,
    code = null,
    productName = null,
    name = null,
    rmaType = 'customer_inbound',
    customerName = null,
    storeBranch = null,
    supplierName = null,
    targetFolderId: clientTargetFolderId = null
  } = parsedBody || {};

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

  // Hard timeout guard: 25s for resilient Google Drive upload
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), 25000);

  try {
    const accessToken = await getGoogleAccessToken(creds, controller.signal);

    // 4. Resolve target folder in Google Drive:
    // Root -> RMA-Reports-Item/[RMA] OR RMA-Reports-SI/DR/PO/[RMA] OR Products/[SKU Name]
    const resolvedFolder = await resolveTargetFolder({
      rootFolderId: creds.folderId,
      rmaNumber,
      category,
      sku: sku || code,
      productName: productName || name,
      targetFolderId: clientTargetFolderId,
      accessToken,
      signal: controller.signal
    });

    const targetFolderId = resolvedFolder?.targetFolderId;
    const rmaFolderId = resolvedFolder?.rmaFolderId;
    const rmaFolderUrl = resolvedFolder?.rmaFolderUrl;

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

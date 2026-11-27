import { supabase } from '../supabaseClient';
import { INITIAL_PRODUCTS } from '../data/mockData';
import { notificationService } from './notificationService';
import { purchaseOrdersApi } from './purchaseOrdersApi';
import { authService } from './authService';
import { 
  mapReasonToConditionGrade, 
  isUnlabeledBarcode, 
  isTrashedRecord, 
  isArchivedRecord,
  isTestRecord,
  getTrashDaysRemaining,
  sumManifestQuantity,
  summarizeBatchSuppliers,
  isMixedSuppliersSummary,
  extractDistinctSuppliersFromItems
} from '../utils/rmaHelpers';
import { isPlaceholderSupplier } from '../utils/followUpWorkflow';
import { supplierDirectoryService } from './supplierDirectoryService';

// Serialize Trash / Archive / Restore / Hard-Delete DB read-modify-write operations in FIFO order
// so rapid consecutive clicks (e.g., Archive -> Restore) never overwrite newer state on Postgres.
const _lifecycleQueue = { promise: Promise.resolve() };
function enqueueLifecycleOp(task) {
  const next = _lifecycleQueue.promise.then(task, task);
  _lifecycleQueue.promise = next.catch(() => {});
  return next;
}

/**
 * Safe test mode resolution:
 * Accessible to authorized staff (Super Admin, Admin, Inventory Staff)
 * OR an invited reporter operating inside a verified Test Mode Sandbox link (`gateSession.is_test === true`).
 * Regular live public reporters are ALWAYS Live.
 */
function isSuperAdminTestModeActive() {
  if (typeof window === 'undefined') return false;
  try {
    const rawGate = localStorage.getItem('rma_portal_gate_session');
    if (rawGate) {
      const parsedGate = JSON.parse(rawGate);
      if (parsedGate?.is_test === true) {
        const notExpired = !parsedGate.expires_at || new Date(parsedGate.expires_at) > new Date();
        if (notExpired) return true;
      }
    }
    const user = authService.getCurrentUser();
    if (!user || !['super_admin', 'admin', 'inventory_staff'].includes(user.role)) {
      return false;
    }
    return localStorage.getItem('rma_portal_test_mode') === 'true';
  } catch (e) {
    return false;
  }
}

// Cross-tab broadcast channel for instant multi-device / multi-tab reactivity
const syncChannel = typeof window !== 'undefined' && window.BroadcastChannel 
  ? new BroadcastChannel('rma_portal_sync_bus') 
  : null;

/**
 * UNIFIED CATALOG & RMA REPORTING SERVICE
 */
export const catalogService = {
  /**
   * Broadcast real-time change to all listeners and open tabs
   */
  notifyChange(type = 'data-updated', payload = {}) {
    if (this._productLookupCache) {
      if (payload?.barcode) {
        this._productLookupCache.delete(String(payload.barcode).trim());
      } else {
        this._productLookupCache.clear();
      }
    }
    if (typeof window !== 'undefined') {
      window.dispatchEvent(new CustomEvent('rma-data-changed', { detail: { type, payload } }));
      try {
        syncChannel?.postMessage({ type, payload, timestamp: Date.now() });
      } catch (e) {
        // BroadcastChannel notice
      }
    }
  },

  /**
   * Subscribe to real-time events across windows / tabs
   */
  onDataChange(callback) {
    if (typeof window === 'undefined') return () => {};

    const handleCustom = (e) => callback(e.detail);
    const handleBroadcast = (e) => callback(e.data);

    window.addEventListener('rma-data-changed', handleCustom);
    syncChannel?.addEventListener('message', handleBroadcast);

    return () => {
      window.removeEventListener('rma-data-changed', handleCustom);
      syncChannel?.removeEventListener('message', handleBroadcast);
    };
  },

  /**
   * Test connection to Supabase database
   */
  async testSupabase() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('id, barcode, name')
        .limit(5);

      if (error) {
        return { connected: false, error: error.message };
      }
      return { connected: true, rowsFound: data ? data.length : 0 };
    } catch (err) {
      return { connected: false, error: err.message };
    }
  },

  /**
   * Client-side image compression (Aggressive Free-Tier Optimization):
   * Resizes large photos (like 48MP phone captures) to max 1280px and converts to WebP at quality 0.7.
   * Shrinks 4MB-10MB mobile uploads down to ~80KB-180KB (>95% reduction),
   * preventing Vercel 10s serverless timeouts and conserving storage.
   */
  async compressImage(file, maxDimension = 1280, quality = 0.7) {
    if (!file || !file.type?.startsWith('image/')) return file;
    if (file.type === 'image/svg+xml') return file;

    return new Promise((resolve) => {
      try {
        const img = new Image();
        const url = URL.createObjectURL(file);
        img.onload = () => {
          URL.revokeObjectURL(url);
          let { width, height } = img;
          if (width > maxDimension || height > maxDimension) {
            if (width > height) {
              height = Math.round((height * maxDimension) / width);
              width = maxDimension;
            } else {
              width = Math.round((width * maxDimension) / height);
              height = maxDimension;
            }
          }
          const canvas = document.createElement('canvas');
          canvas.width = width;
          canvas.height = height;
          const ctx = canvas.getContext('2d');
          ctx.drawImage(img, 0, 0, width, height);

          // Attempt WebP encoding first (supported on all modern browsers)
          const exportMime = 'image/webp';
          canvas.toBlob(
            (blob) => {
              if (blob) {
                const cleanBaseName = file.name ? file.name.replace(/\.[^.]+$/, '') : 'rma_photo';
                const compressedFile = new File([blob], `${cleanBaseName}.webp`, {
                  type: 'image/webp',
                  lastModified: Date.now()
                });
                resolve(compressedFile);
              } else {
                // Fallback to JPEG if browser canvas fails WebP export
                canvas.toBlob(
                  (fallbackBlob) => {
                    if (fallbackBlob) {
                      const cleanBaseName = file.name ? file.name.replace(/\.[^.]+$/, '') : 'rma_photo';
                      resolve(new File([fallbackBlob], `${cleanBaseName}.jpg`, {
                        type: 'image/jpeg',
                        lastModified: Date.now()
                      }));
                    } else {
                      resolve(file);
                    }
                  },
                  'image/jpeg',
                  quality
                );
              }
            },
            exportMime,
            quality
          );
        };
        img.onerror = () => {
          URL.revokeObjectURL(url);
          resolve(file);
        };
        img.src = url;
      } catch (err) {
        resolve(file);
      }
    });
  },

  /**
   * Smart Hybrid Photo Upload:
   * 1. Aggressively compresses photo to WebP (max 1280px, quality 0.7, ~80-180KB).
   * 2. Primary: Uploads to Company Google Workspace Drive (/api/upload-photo) in dedicated folder.
   * 3. Fallback: If Google Drive credentials are not yet set or offline, uploads to Supabase Storage ('rma-photos').
   * 4. Tertiary Fallback: Offline Base64 Data URL so user never loses their submission.
   */
  async uploadPhoto(file, rmaNumber = 'GENERAL', category = 'damaged_items', extraMeta = {}) {
    const details = await this.uploadPhotoWithDetails(file, rmaNumber, category, extraMeta);
    return details?.url || details;
  },

  /**
   * Upload photo and return full details including Google Drive folder URLs
   */
  async uploadPhotoWithDetails(file, rmaNumber = 'GENERAL', category = 'damaged_items', extraMeta = {}) {
    if (!file) return null;
    try {
      // 1. Client-Side Aggressive WebP Compression
      const compressed = await this.compressImage(file, 1280, 0.7);
      const base64Data = await this.fileToBase64(compressed);

      // 2. Primary: Attempt Google Workspace Drive upload via serverless integration
      try {
        const gdriveRes = await fetch('/api/upload-photo', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            fileData: base64Data,
            fileName: compressed.name || `RMA_${rmaNumber}_${category}_${Date.now()}.webp`,
            mimeType: compressed.type || 'image/webp',
            rmaNumber,
            category,
            targetFolderId: extraMeta.targetFolderId || null,
            sku: extraMeta.sku || extraMeta.code || null,
            productName: extraMeta.name || extraMeta.productName || null,
            rmaType: extraMeta.rmaType || extraMeta.rma_type || 'customer_inbound',
            customerName: extraMeta.customerName || extraMeta.storeBranch || extraMeta.store_branch || null,
            storeBranch: extraMeta.storeBranch || extraMeta.store_branch || null,
            supplierName: extraMeta.supplierName || extraMeta.supplier_name || null
          })
        });

        if (gdriveRes.ok) {
          const gdriveJson = await gdriveRes.json();
          if (gdriveJson.success && (gdriveJson.url || gdriveJson.previewUrl)) {
            return {
              url: gdriveJson.url || gdriveJson.previewUrl,
              previewUrl: gdriveJson.previewUrl || gdriveJson.url,
              rmaFolderUrl: gdriveJson.rmaFolderUrl || null,
              rmaFolderId: gdriveJson.rmaFolderId || null,
              fileId: gdriveJson.fileId || null,
              provider: 'google_drive'
            };
          }
        }
      } catch (gdriveErr) {
        console.warn('Google Drive photo upload notice (falling back to Supabase):', gdriveErr.message);
      }

      // 3. Secondary Fallback: Supabase Storage ('rma-photos' bucket)
      const cleanName = compressed.name ? compressed.name.replace(/[^a-zA-Z0-9._-]/g, '_') : 'photo.webp';
      const folderPrefix = category === 'official_paperwork' ? 'paperwork' : 'reports';
      const filePath = `${folderPrefix}/${Date.now()}-${Math.floor(Math.random() * 1000)}_${cleanName}`;
      
      const { data, error } = await supabase.storage
        .from('rma-photos')
        .upload(filePath, compressed, {
          cacheControl: '3600',
          upsert: true,
          contentType: compressed.type || 'image/webp'
        });

      if (!error) {
        const { data: publicUrlData } = supabase.storage
          .from('rma-photos')
          .getPublicUrl(filePath);

        if (publicUrlData?.publicUrl) {
          return {
            url: publicUrlData.publicUrl,
            previewUrl: publicUrlData.publicUrl,
            provider: 'supabase'
          };
        }
      }

      // 4. Tertiary Fallback: Base64 Data URL
      return {
        url: base64Data,
        previewUrl: base64Data,
        provider: 'local_base64'
      };
    } catch (err) {
      console.warn('Photo upload exception (falling back to data URL):', err.message);
      const b64 = await this.fileToBase64(file);
      return {
        url: b64,
        previewUrl: b64,
        provider: 'local_base64'
      };
    }
  },

  /**
   * Inspect paperwork photo using Google Gemini Flash OCR service
   * Returns verification flag, document type, DR number, store branch, etc.
   */
  async inspectPaperwork(fileOrBase64, signal) {
    let base64Data = '';
    let mimeType = 'image/jpeg';

    if (typeof fileOrBase64 === 'string') {
      base64Data = fileOrBase64;
      if (fileOrBase64.startsWith('data:image/')) {
        mimeType = fileOrBase64.substring(5, fileOrBase64.indexOf(';'));
      }
    } else if (fileOrBase64 instanceof File || fileOrBase64 instanceof Blob) {
      mimeType = fileOrBase64.type || 'image/jpeg';
      base64Data = await this.fileToBase64(fileOrBase64);
    } else {
      throw new Error('Invalid file or image provided for paperwork inspection.');
    }

    const res = await fetch('/api/v1/ai/inspect-paperwork', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        fileData: base64Data,
        mimeType
      }),
      signal
    });

    if (!res.ok) {
      const errText = await res.text();
      try {
        return JSON.parse(errText);
      } catch (e) {
        throw new Error(`Paperwork inspection error (${res.status}): ${errText}`);
      }
    }

    return await res.json();
  },

  /**
   * Shared image normalization and OCR dispatch helper for /api/upload-photo?action=...
   */
  async _postImageToUploadAction(actionName, fileOrBase64, errorPrefix, signal) {
    let base64Data = '';
    let mimeType = 'image/jpeg';

    if (typeof fileOrBase64 === 'string') {
      base64Data = fileOrBase64;
      if (fileOrBase64.startsWith('data:image/')) {
        mimeType = fileOrBase64.substring(5, fileOrBase64.indexOf(';'));
      }
    } else if (fileOrBase64 instanceof File || fileOrBase64 instanceof Blob) {
      const compressed = await this.compressImage(fileOrBase64, 1280, 0.8);
      mimeType = compressed.type || fileOrBase64.type || 'image/jpeg';
      base64Data = await this.fileToBase64(compressed);
    } else {
      throw new Error(`Invalid image provided for ${errorPrefix}.`);
    }

    const res = await fetch(`/api/upload-photo?action=${encodeURIComponent(actionName)}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        action: actionName,
        fileData: base64Data,
        mimeType
      }),
      signal
    });

    if (!res.ok) {
      const errText = await res.text();
      try {
        return JSON.parse(errText);
      } catch {
        throw new Error(`${errorPrefix} error (${res.status}): ${errText}`);
      }
    }

    return await res.json();
  },

  /**
   * Inspect Driver's License / ID photo using Gemini Flash OCR via /api/upload-photo?action=inspect-license
   */
  async inspectDriverLicense(fileOrBase64, signal) {
    return this._postImageToUploadAction('inspect-license', fileOrBase64, 'License OCR', signal);
  },

  /**
   * Inspect delivery truck plate photo using Gemini Flash OCR via /api/upload-photo?action=inspect-plate
   */
  async inspectTruckPlate(fileOrBase64, signal) {
    return this._postImageToUploadAction('inspect-plate', fileOrBase64, 'Truck Plate OCR', signal);
  },

  fileToBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(reader.result);
      reader.onerror = error => reject(error);
      reader.readAsDataURL(file);
    });
  },

  /**
   * Permanently deletes a stored proof image from Google Workspace Drive or Supabase Storage
   */
  async deleteStoredImage(imageUrl) {
    if (!imageUrl || typeof imageUrl !== 'string') return;
    try {
      // 1. Google Drive deletion (via serverless API endpoint)
      const isGdrive = imageUrl.includes('drive.google.com') || 
                       imageUrl.includes('googleusercontent.com') ||
                       imageUrl.startsWith('RMA_') ||
                       imageUrl.endsWith('.webp');

      if (isGdrive) {
        const res = await fetch(`/api/upload-photo?fileUrl=${encodeURIComponent(imageUrl)}`, {
          method: 'DELETE',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ fileUrl: imageUrl })
        }).catch(e => {
          console.warn('[Google Drive Delete Network Notice]:', e.message);
          return null;
        });

        if (res && res.ok) {
          console.log('[Google Drive] Image deletion confirmed for:', imageUrl);
        }
        return;
      }

      // 2. Supabase Storage deletion ('rma-photos' bucket)
      if (imageUrl.includes('/rma-photos/')) {
        const parts = imageUrl.split('/rma-photos/');
        if (parts[1]) {
          const storagePath = decodeURIComponent(parts[1].split('?')[0]);
          await supabase.storage.from('rma-photos').remove([storagePath]);
          console.log('[Supabase Storage] Image deleted:', storagePath);
        }
      }
    } catch (err) {
      console.warn('Delete stored image exception:', err.message);
    }
  },

  /**
   * Delete multiple stored image URLs and Google Drive folders in batch
   * Supports cleaning up specific file URLs, folder IDs, RMA folders, and Product SKU folders
   */
  async deleteStoredImages(imageUrls, folderIds = [], folderUrls = [], extra = {}) {
    const cleanList = (Array.isArray(imageUrls)
      ? imageUrls.map(u => (typeof u === 'object' && u) ? (u.url || u.previewUrl || u.fileUrl || u.id) : u).filter(u => u && typeof u === 'string')
      : []).filter(u => !u.includes('images.unsplash.com'));
    const cleanFolders = Array.isArray(folderIds) ? folderIds.filter(f => f && typeof f === 'string') : (folderIds ? [folderIds] : []);
    const cleanFolderUrls = Array.isArray(folderUrls) ? folderUrls.filter(u => u && typeof u === 'string') : (folderUrls ? [folderUrls] : []);
    const rmaNumbers = Array.isArray(extra?.rmaNumbers) ? extra.rmaNumbers.filter(Boolean) : (extra?.rmaNumber ? [extra.rmaNumber] : []);
    const skus = Array.isArray(extra?.skus) ? extra.skus.filter(Boolean) : (extra?.sku ? [extra.sku] : []);

    if (cleanList.length === 0 && cleanFolders.length === 0 && cleanFolderUrls.length === 0 && rmaNumbers.length === 0 && skus.length === 0) return;

    // Separate Google Drive vs Supabase Storage
    const gdriveUrls = [];
    const supabasePaths = [];

    cleanList.forEach(url => {
      if (url.includes('/rma-photos/')) {
        const parts = url.split('/rma-photos/');
        if (parts[1]) {
          supabasePaths.push(decodeURIComponent(parts[1].split('?')[0]));
        }
      } else {
        gdriveUrls.push(url);
      }
    });

    const tasks = [];

    // Batch delete Supabase images in 1 call
    if (supabasePaths.length > 0) {
      tasks.push(
        supabase.storage.from('rma-photos').remove(supabasePaths).catch(e => {
          console.warn('[Supabase Batch Delete Notice]:', e.message);
        })
      );
    }

    // Batch delete Google Drive photos & folders via /api/upload-photo (support POST & DELETE)
    if (gdriveUrls.length > 0 || cleanFolders.length > 0 || cleanFolderUrls.length > 0 || rmaNumbers.length > 0 || skus.length > 0) {
      tasks.push(
        fetch('/api/upload-photo?action=delete', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            action: 'delete',
            fileUrls: gdriveUrls,
            folderIds: cleanFolders,
            folderUrls: cleanFolderUrls,
            rmaNumbers,
            skus
          })
        }).then(async res => {
          if (res.ok) {
            const data = await res.json().catch(() => null);
            console.log('[Google Drive Asset Delete Result]:', data);
            if (data?.failed && data.failed.length > 0) {
              console.warn('[Google Drive Delete Incomplete Notice]:', data.failed);
            }
          } else {
            const errText = await res.text().catch(() => '');
            console.warn('[Google Drive Batch Delete Server Error]:', res.status, errText);
          }
        }).catch(e => {
          console.warn('[Google Drive Batch Delete Notice]:', e.message);
        })
      );
    }

    await Promise.allSettled(tasks);
  },

  /**
   * Fast Barcode / SKU Lookup:
   * PRIORITY 1: Secure Serverless Proxy (/api/v1/products/lookup)
   *             Works across ANY mobile phone, dock scanner, or incognito browser without requiring client credentials.
   * PRIORITY 2: Direct Supabase Database Fallback (if serverless API is offline or unreachable)
   * PRIORITY 3: Wholesale Verified Catalog Fallback (Group 1 & 2 Products)
   * Returns null if uncatalogued, prompting the user with the unregistered barcode workflow.
   */
  _productLookupCache: new Map(),

  _isPlaceholderSupplier(val) {
    const s = String(val || '').trim().toLowerCase();
    return !s || s === 'pending assignment' || s === 'pending' || s === 'unassigned' || s === 'warehouse' || s === 'n/a';
  },

  _pickRealSupplier(...candidates) {
    for (const cand of candidates) {
      const s = String(cand || '').trim();
      if (s && !this._isPlaceholderSupplier(s)) {
        return s;
      }
    }
    return 'Pending Assignment';
  },

  _normalizeCatalogProduct(raw, sourceLabel, fallbackBarcode = null, options = {}) {
    if (!raw) return null;
    const isMock = options.isMock === true;
    const barcodeVal = String(raw.barcode || fallbackBarcode || '').trim();
    const rawSku = String(raw.code || raw.sku || '').trim();
    const cleanSku = (rawSku && rawSku !== barcodeVal && rawSku !== fallbackBarcode) ? rawSku : null;
    const rawBrand = raw.brandName || raw.brand_name || raw.brand || '';
    const pcsMatch = String(rawBrand).match(/\[Pcs\/Cs:(\d+)\]/);
    const cleanBrand = String(rawBrand).replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim() || null;
    const rawPcs = raw.pieces_per_case ?? raw.piecesPerCase ?? (pcsMatch ? parseInt(pcsMatch[1], 10) : null);
    const numPcs = Number(rawPcs);
    const parsedPcs = Number.isFinite(numPcs) && numPcs > 0 ? numPcs : null;
    const supplierVal = String(
      raw.supplierName || raw.supplier_name || raw.supplier || options.defaultSupplier || 'Pending Assignment'
    ).trim() || 'Pending Assignment';
    const unitVal = String(raw.unitName || raw.unit_name || 'pc').trim() || 'pc';
    const netPrice = isMock ? Number(raw.unit_price || 0) : Number(raw.price || raw.unit_price || 0);
    const priceWithVatVal = isMock
      ? Number(raw.unit_price || 0) * 1.12
      : Number(raw.priceWithVat || raw.price_with_vat || raw.price || 0);

    return {
      id: raw.id,
      barcode: barcodeVal || cleanSku || null,
      code: cleanSku,
      sku: cleanSku,
      name: raw.name || '',
      price: netPrice,
      price_with_vat: priceWithVatVal,
      priceWithVat: priceWithVatVal,
      supplier_name: supplierVal,
      supplierName: supplierVal,
      supplier: supplierVal,
      brand_name: cleanBrand,
      brandName: cleanBrand,
      unit_name: unitVal,
      unitName: unitVal,
      pieces_per_case: parsedPcs,
      piecesPerCase: parsedPcs,
      hasSerialNumbers: Boolean(raw.hasSerialNumbers || raw.has_serial_numbers || raw.requires_serial),
      imageUrl: raw.imageUrl || raw.image_url || null,
      ae_name: raw.ae_name || null,
      ae_email: raw.ae_email || null,
      company: options.company !== undefined ? options.company : (raw.company || null),
      isVerified: options.forceVerified ? true : (raw.isVerified !== false && raw.is_verified !== false),
      source: sourceLabel
    };
  },

  async findProduct(barcodeOrQuery) {
    const clean = String(barcodeOrQuery || '').trim();
    if (!clean || /^(RMA-|MANIFEST|NO-?LABEL-)/i.test(clean)) return null;

    // Fast-path: return cached lookup instantly if available
    if (this._productLookupCache && this._productLookupCache.has(clean)) {
      return this._productLookupCache.get(clean);
    }

    // 1. SECURE SERVERLESS PROXY LOOKUP (PRIORITY #1: /api/v1/products/lookup)
    // Server securely holds the Laravel Cloud API credentials and queries Supabase + erply_products
    try {
      const res = await fetch(`/api/v1/products/lookup?barcode=${encodeURIComponent(clean)}`, {
        headers: { 'Accept': 'application/json' }
      });
      if (res && res.ok) {
        const json = await res.json();
        if (json.success && json.found && json.product) {
          const p = json.product;
          const sourceLabel = json.source === 'database'
            ? 'Supabase Database (Yours)'
            : (json.source === 'erply_api' ? 'ERPLY POS/ERP Catalog (Live API)' : 'Wholesale Master Catalog');
          const matchedProd = this._normalizeCatalogProduct(p, sourceLabel, clean);
          if (this._productLookupCache) {
            this._productLookupCache.set(clean, matchedProd);
            if (matchedProd.barcode) this._productLookupCache.set(String(matchedProd.barcode).trim(), matchedProd);
          }
          return matchedProd;
        }
      }
    } catch (apiErr) {
      console.warn('Server lookup proxy unavailable (falling back to client DB):', apiErr.message);
    }

    // 2. Direct Coworker Live Catalog Fallback via purchaseOrdersApi (erply_products)
    try {
      const liveProduct = await purchaseOrdersApi.findProductByBarcode(clean);
      if (liveProduct) {
        const normalizedLive = this._normalizeCatalogProduct(liveProduct, 'ERPLY POS/ERP Catalog (Live API)', clean, { forceVerified: true });
        // Cache into Supabase products table asynchronously so subsequent searches are instant
        try {
          supabase.from('products').upsert([{
            barcode: normalizedLive.barcode || clean,
            code: normalizedLive.code,
            name: normalizedLive.name,
            supplier_name: normalizedLive.supplier_name,
            price: normalizedLive.price,
            price_with_vat: normalizedLive.price_with_vat,
            brand_name: normalizedLive.brand_name,
            unit_name: normalizedLive.unit_name,
            is_verified: true,
            updated_at: new Date().toISOString()
          }], { onConflict: 'barcode' }).then(() => {}).catch(() => {});
        } catch (cErr) {}

        return normalizedLive;
      }
    } catch (poErr) {
      console.warn('purchaseOrdersApi lookup fallback notice:', poErr?.message || poErr);
    }

    // 3. Direct Supabase Fallback (if serverless API endpoint was offline or in local client dev)
    try {
      let supaItem = null;
      const { data: byBarcode, error: errBarcode } = await supabase
        .from('products')
        .select('*')
        .eq('barcode', clean)
        .limit(1);

      if (!errBarcode && byBarcode && byBarcode.length > 0) {
        if (!byBarcode[0].name?.startsWith('[DELETED]')) {
          supaItem = byBarcode[0];
        }
      }

      if (!supaItem) {
        const { data: byCode, error: errCode } = await supabase
          .from('products')
          .select('*')
          .ilike('code', clean)
          .limit(1);

        if (!errCode && byCode && byCode.length > 0) {
          if (!byCode[0].name?.startsWith('[DELETED]')) {
            supaItem = byCode[0];
          }
        }
      }

      if (supaItem) {
        return this._normalizeCatalogProduct(supaItem, 'Supabase Database (Yours)', clean);
      }
    } catch (e) {
      console.warn('Supabase lookup exception:', e.message);
    }

    // 4. Wholesale Verified Catalog Fallback (Group 1 & 2 Products)
    const mockItem = INITIAL_PRODUCTS.find(p => 
      p.barcode === clean || 
      (p.sku && p.sku.toLowerCase() === clean.toLowerCase())
    );
    if (mockItem) {
      const isBonitaOrPingcon = (
        (mockItem.brand && mockItem.brand.toLowerCase().includes('bonita')) ||
        (mockItem.group && mockItem.group.toLowerCase().includes('pingcon'))
      );
      return this._normalizeCatalogProduct(mockItem, 'Wholesale Verified Catalog', clean, {
        isMock: true,
        defaultSupplier: 'Savemore',
        company: isBonitaOrPingcon ? 'Pingcon / Bonita' : 'A2Z2GO / Keysys',
        forceVerified: true
      });
    }

    return null;
  },

  /**
   * COMPREHENSIVE MULTI-PRODUCT SEARCH:
   * Searches BOTH:
   * 1. Secure Serverless Proxy Search (/api/v1/products/lookup?search=...)
   * 2. purchaseOrdersApi.searchProducts fallback if server proxy returns empty
   * 3. Supabase 'products' table fallback
   * 4. Enterprise Wholesale Catalog fallback
   * Returns ALL matching products up to limit.
   */
  async searchAllProducts(query, limit = 50) {
    const clean = String(query || '').trim();
    if (!clean) return [];

    const results = [];
    const seenKeys = new Set();
    const cleanLower = clean.toLowerCase();
    let proxyCount = 0;

    // 1. Secure Serverless Multi-Catalog Search (/api/v1/products/lookup?search=...)
    try {
      const res = await fetch(`/api/v1/products/lookup?search=${encodeURIComponent(clean)}&limit=${limit}`);
      if (res && res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.products)) {
          proxyCount = json.products.length;
          for (const item of json.products) {
            const key = String(item.barcode || item.code || item.id).trim().toLowerCase();
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              results.push(this._normalizeCatalogProduct(item, item.source || 'Server Catalog API'));
            }
          }
        }
      }
    } catch (apiErr) {
      console.warn('Server search proxy notice:', apiErr.message);
    }

    // 2. Client-side purchaseOrdersApi fallback when server proxy returns empty or is unavailable
    if (proxyCount === 0) {
      try {
        const erplyItems = await purchaseOrdersApi.searchProducts(clean, limit);
        if (Array.isArray(erplyItems)) {
          for (const item of erplyItems) {
            const key = String(item.barcode || item.code || item.id).trim().toLowerCase();
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              results.push(this._normalizeCatalogProduct(item, item.source || 'erply_api', null, { forceVerified: true }));
            }
          }
        }
      } catch (poErr) {
        console.warn('purchaseOrdersApi search fallback notice:', poErr?.message || poErr);
      }
    }

    // 3. Client-side Supabase products table fallback
    try {
      const { data: supaItems, error } = await supabase
        .from('products')
        .select('*')
        .or(`name.ilike.%${clean}%,barcode.ilike.%${clean}%,code.ilike.%${clean}%`)
        .order('is_verified', { ascending: false })
        .limit(limit);

      if (!error && supaItems && Array.isArray(supaItems)) {
        for (const item of supaItems) {
          if (item.name?.startsWith('[DELETED]') || item.barcode?.startsWith('__CONFIG_')) continue;
          const key = String(item.barcode || item.code || item.id).trim().toLowerCase();
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            results.push(this._normalizeCatalogProduct(item, 'Supabase Database (Custom)'));
          }
        }
      }
    } catch (e) {
      console.warn('Supabase product search warning:', e);
    }

    // 4. Wholesale Verified Catalog Fallback (INITIAL_PRODUCTS)
    for (const mock of INITIAL_PRODUCTS) {
      const matchText = `${mock.name} ${mock.brand || ''} ${mock.category || ''} ${mock.sku || ''} ${mock.barcode || ''}`.toLowerCase();
      if (matchText.includes(cleanLower)) {
        const key = String(mock.barcode || mock.sku || mock.id).trim().toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          results.push(this._normalizeCatalogProduct(mock, 'Wholesale Verified Catalog', null, {
            isMock: true,
            defaultSupplier: 'Savemore',
            forceVerified: true
          }));
        }
      }
    }

    return results;
  },

  /**
   * FETCH ALL VERIFIED SAVED PRODUCTS FROM SUPABASE DATABASE
   */
  async getSavedProducts() {
    try {
      const { data, error } = await supabase
        .from('products')
        .select('*')
        .eq('is_verified', true)
        .not('name', 'like', '[DELETED]%')
        .order('updated_at', { ascending: false });

      if (error) {
        console.warn('Error fetching saved products from Supabase:', error.message);
        return [];
      }
      return (data || []).map(p => {
        const brand = p.brand_name || '';
        const pcsMatch = brand.match(/\[Pcs\/Cs:(\d+)\]/i);
        const pieces = pcsMatch ? parseInt(pcsMatch[1], 10) : (p.pieces_per_case || null);
        const cleanBrand = brand.replace(/\[Pcs\/Cs:\d+\]/gi, '').trim() || null;
        return {
          ...p,
          pieces_per_case: pieces,
          piecesPerCase: pieces,
          brand_name: cleanBrand
        };
      });
    } catch (e) {
      console.warn('Saved products fetch exception:', e);
      return [];
    }
  },

  async getProducts() {
    return this.getSavedProducts();
  },

  /**
   * Check if an SKU / Item Code already exists in products database (Deduplication removed: 1 SKU can have multiple barcodes)
   */
  async checkSkuUnique(code, excludeId = null, excludeBarcode = null) {
    return { isUnique: true };
  },

  /**
   * Check if a Product Name already exists in products database (Deduplication removed)
   */
  async checkNameUnique(name, excludeId = null, excludeBarcode = null) {
    return { isUnique: true };
  },

  /**
   * ADMIN ACTION: Add a brand new product to the saved catalog
   */
  async createProduct({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, pieces_per_case, piecesPerCase, imageUrl, aeName, aeEmail, company }) {
    const cleanBarcode = String(barcode || '').trim();
    if (!cleanBarcode) throw new Error('Product Barcode is required.');
    if (!name || !name.trim()) throw new Error('Product Name is required.');

    const resolvedPcs = (pieces_per_case !== undefined && pieces_per_case !== null) ? pieces_per_case : piecesPerCase;
    let resolvedBrand = brandName ? brandName.trim() : null;
    if (resolvedPcs && Number(resolvedPcs) > 0) {
      resolvedBrand = resolvedBrand ? `${resolvedBrand} [Pcs/Cs:${resolvedPcs}]` : `[Pcs/Cs:${resolvedPcs}]`;
    }

    const newProd = {
      barcode: cleanBarcode,
      code: code ? code.trim() : null,
      name: name.trim(),
      supplier_name: supplierName ? supplierName.trim() : 'Pending Assignment',
      price: Number(price || 0),
      price_with_vat: Number(priceWithVat || price || 0),
      brand_name: resolvedBrand,
      unit_name: unitName ? unitName.trim() : 'pc',
      image_url: imageUrl ? imageUrl.trim() : null,
      ae_name: aeName ? aeName.trim() : null,
      ae_email: aeEmail ? aeEmail.trim() : null,
      company: company ? company.trim() : null,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    let savedData = null;
    let saveError = null;

    const { data, error } = await supabase
      .from('products')
      .upsert([newProd], { onConflict: 'barcode' })
      .select()
      .single();

    if (!error && data) {
      savedData = data;
    } else {
      saveError = error;
      // If error mentions unknown column, strip and retry
      const errMsg = String(error?.message || '');
      const colMatch = errMsg.match(/Could not find the '([^']+)' column/i) || errMsg.match(/column products\.([a-zA-Z0-9_]+) does not exist/i);
      if (colMatch && colMatch[1] && colMatch[1] in newProd) {
        delete newProd[colMatch[1]];
        const retry = await supabase.from('products').upsert([newProd], { onConflict: 'barcode' }).select().single();
        if (!retry.error) {
          savedData = retry.data;
          saveError = null;
        }
      }
    }

    if (saveError || !savedData) {
      throw new Error(`Failed to save product: ${saveError?.message || 'Database insert failed'}`);
    }

    const enrichedProduct = {
      ...savedData,
      pieces_per_case: resolvedPcs ? Number(resolvedPcs) : null,
      piecesPerCase: resolvedPcs ? Number(resolvedPcs) : null
    };

    this.notifyChange('product-created', { barcode: cleanBarcode, product: enrichedProduct });
    return { success: true, product: enrichedProduct };
  },

  /**
   * ADMIN ACTION: Edit an existing product record
   */
  async updateProduct(id, { barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, pieces_per_case, piecesPerCase, imageUrl, aeName, aeEmail, company }) {
    if (!id && !barcode) throw new Error('Product identifier required for update.');

    const resolvedPcs = (pieces_per_case !== undefined && pieces_per_case !== null) ? pieces_per_case : piecesPerCase;
    let resolvedBrand = brandName !== undefined ? (brandName ? brandName.trim() : null) : undefined;
    if (resolvedPcs !== undefined) {
      if (resolvedPcs && Number(resolvedPcs) > 0) {
        resolvedBrand = (resolvedBrand || '').replace(/\[Pcs\/Cs:\d+\]/gi, '').trim();
        resolvedBrand = resolvedBrand ? `${resolvedBrand} [Pcs/Cs:${resolvedPcs}]` : `[Pcs/Cs:${resolvedPcs}]`;
      } else if (resolvedBrand) {
        resolvedBrand = resolvedBrand.replace(/\[Pcs\/Cs:\d+\]/gi, '').trim() || null;
      }
    }

    const updates = {
      name: name ? name.trim() : undefined,
      code: code !== undefined ? (code ? code.trim() : null) : undefined,
      supplier_name: supplierName ? supplierName.trim() : undefined,
      price: price !== undefined ? Number(price || 0) : undefined,
      price_with_vat: priceWithVat !== undefined ? Number(priceWithVat || price || 0) : undefined,
      brand_name: resolvedBrand,
      unit_name: unitName ? unitName.trim() : undefined,
      image_url: imageUrl !== undefined ? (imageUrl ? imageUrl.trim() : null) : undefined,
      ae_name: aeName !== undefined ? (aeName ? aeName.trim() : null) : undefined,
      ae_email: aeEmail !== undefined ? (aeEmail ? aeEmail.trim() : null) : undefined,
      company: company !== undefined ? (company ? company.trim() : null) : undefined,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    // Remove undefined values
    Object.keys(updates).forEach(key => updates[key] === undefined && delete updates[key]);

    const isNumericId = id !== undefined && id !== null && (typeof id === 'number' || (/^\d+$/.test(String(id).trim()) && !String(id).startsWith('prod_')));
    const cleanBarcode = String(barcode || '').trim();

    let query = supabase.from('products').update(updates);
    if (isNumericId) {
      query = query.eq('id', Number(id));
    } else if (cleanBarcode) {
      query = query.eq('barcode', cleanBarcode);
    } else {
      throw new Error('Valid numeric product ID or barcode required for update.');
    }

    let { data, error } = await query.select();

    if (error) {
      const errMsg = String(error?.message || '');
      const colMatch = errMsg.match(/Could not find the '([^']+)' column/i) || errMsg.match(/column products\.([a-zA-Z0-9_]+) does not exist/i);
      if (colMatch && colMatch[1] && colMatch[1] in updates) {
        delete updates[colMatch[1]];
        let retryQuery = supabase.from('products').update(updates);
        if (isNumericId) retryQuery = retryQuery.eq('id', Number(id));
        else if (cleanBarcode) retryQuery = retryQuery.eq('barcode', cleanBarcode);
        const retryRes = await retryQuery.select();
        data = retryRes.data;
        error = retryRes.error;
      }
    }

    if (error) throw new Error(`Failed to update product: ${error.message}`);

    // If update returned 0 rows because product wasn't in table yet, upsert via createProduct
    if ((!data || data.length === 0) && cleanBarcode) {
      return await this.createProduct({
        barcode: cleanBarcode,
        code,
        name,
        supplierName,
        price,
        priceWithVat,
        brandName: resolvedBrand,
        unitName,
        pieces_per_case: resolvedPcs,
        imageUrl,
        aeName,
        aeEmail,
        company
      });
    }

    const updatedProd = data?.[0] ? {
      ...data[0],
      pieces_per_case: resolvedPcs ? Number(resolvedPcs) : null,
      piecesPerCase: resolvedPcs ? Number(resolvedPcs) : null
    } : null;

    this.notifyChange('product-updated', { id, barcode, updates });
    return { success: true, product: updatedProd };
  },

  /**
   * ADMIN ACTION: Permanently delete a product record from database
   */
  async deleteProduct(idOrProduct, fallbackBarcode) {
    let id = null;
    let barcode = null;
    let name = '';
    let imageToDelete = null;

    if (typeof idOrProduct === 'object' && idOrProduct !== null) {
      id = idOrProduct.id || null;
      barcode = idOrProduct.barcode || null;
      name = idOrProduct.name || '';
      imageToDelete = idOrProduct.image_url || idOrProduct.imageUrl || null;
    } else {
      id = idOrProduct || null;
      barcode = fallbackBarcode || null;
    }

    // If numeric or string passed without object
    if (!id && !barcode && idOrProduct) {
      barcode = String(idOrProduct);
    }

    if (!id && !barcode) {
      console.warn('Delete called without id or barcode:', idOrProduct);
      return { success: true };
    }

    // Retrieve image if not passed in
    if (!imageToDelete && (id || barcode)) {
      try {
        let q = supabase.from('products').select('image_url').limit(1);
        if (id) q = q.eq('id', id);
        else q = q.eq('barcode', barcode);
        const { data: found } = await q;
        if (found && found[0]?.image_url) imageToDelete = found[0].image_url;
      } catch (e) {}
    }

    let deleteError = null;

    if (id) {
      const { error } = await supabase.from('products').delete().eq('id', id);
      if (error) deleteError = error;
    }
    if (barcode) {
      const { error } = await supabase.from('products').delete().eq('barcode', barcode);
      if (error && !deleteError) deleteError = error;
    }

    if (deleteError) {
      console.error('Hard delete error from Supabase:', deleteError);
      throw new Error(`Database error deleting product: ${deleteError.message}`);
    }

    // Clean up stored image from Google Drive / Supabase
    const prodCode = (typeof idOrProduct === 'object' ? (idOrProduct?.code || idOrProduct?.sku) : null);
    const prodBarcode = barcode || (typeof idOrProduct === 'object' ? idOrProduct?.barcode : null);
    const prodName = name || (typeof idOrProduct === 'object' ? idOrProduct?.name : '');
    const skusToDelete = [prodCode, prodBarcode, prodName, `${prodCode || ''} ${prodName || ''}`.trim()].filter(Boolean);

    if (imageToDelete) {
      await this.deleteStoredImages([imageToDelete], [], [], { skus: skusToDelete });
    } else if (skusToDelete.length > 0) {
      await this.deleteStoredImages([], [], [], { skus: skusToDelete });
    }

    this.notifyChange('product-deleted', { id, barcode, name });
    return { success: true, id, barcode };
  },

  /**
   * ADMIN ACTION: Permanently delete multiple products from catalog in bulk
   */
  async deleteMultipleProducts(productsList) {
    if (!Array.isArray(productsList) || productsList.length === 0) return { success: true, count: 0 };
    
    const ids = productsList.map(p => p.id).filter(id => id !== undefined && id !== null);
    const barcodes = productsList.map(p => p.barcode).filter(Boolean);

    let deleteError = null;
    if (ids.length > 0) {
      const { error } = await supabase.from('products').delete().in('id', ids);
      if (error) deleteError = error;
    }
    if (barcodes.length > 0) {
      const { error } = await supabase.from('products').delete().in('barcode', barcodes);
      if (error && !deleteError) deleteError = error;
    }

    if (deleteError) {
      console.error('Error in deleteMultipleProducts:', deleteError);
      throw new Error(`Database error deleting products: ${deleteError.message}`);
    }

    // Clean up stored images from Google Drive / Supabase in parallel
    const allImages = productsList
      .map(p => p.image_url || p.imageUrl)
      .filter(Boolean);
    const allSkus = productsList
      .flatMap(p => [p.code, p.sku, p.barcode, p.name, `${p.code || p.sku || ''} ${p.name || ''}`.trim()])
      .filter(Boolean);

    if (allImages.length > 0 || allSkus.length > 0) {
      await this.deleteStoredImages(allImages, [], [], { skus: [...new Set(allSkus)] });
    }

    this.notifyChange('products-bulk-deleted', { count: productsList.length });
    return { success: true, count: productsList.length };
  },

  /**
   * GENERATE UNIQUE RMA NUMBER INSTANTLY WITH COMPLETE SEQUENCE ISOLATION
   * - Live Mode: "RMA-[YEAR]-[4-DIGIT-ASCENDING]-[4-CHAR-ALPHANUMERIC]" (e.g. RMA-2026-0001-6TYH)
   * - Test Mode: "RMA-TEST-[YEAR]-[4-DIGIT-ASCENDING]-[4-CHAR-ALPHANUMERIC]" (e.g. RMA-TEST-2026-0001-A9YB)
   * 
   * Guarantees:
   * 1. Test mode RMA IDs never consume numbers from live ascending sequence.
   * 2. Live mode and test mode never share or collide on RMA IDs.
   */
  generateRMANumber(existingOrHint = null, isTestMode = false) {
    const currentYear = new Date().getFullYear();
    const isTest = Boolean(isTestMode === true || isTestMode === 'true');
    let maxSeq = 0;

    const isTestRecord = (r) => {
      if (!r || typeof r !== 'object') return false;
      const num = String(r.rma_number || r.rmaNumber || r.id || '');
      return Boolean(
        r.is_test === true ||
        r.ai_document_metadata?.is_test === true ||
        (r.notes && typeof r.notes === 'string' && r.notes.includes('[TEST_MODE]')) ||
        num.includes('TEST')
      );
    };

    // 1. If an array of reports was passed, find the highest existing sequence number strictly within current mode
    if (Array.isArray(existingOrHint)) {
      existingOrHint.forEach(r => {
        const itemIsTest = isTestRecord(r);
        if (isTest !== itemIsTest) return; // Strict mode isolation: ignore cross-mode reports!

        const num = r.rma_number || r.rmaNumber || r.id || '';
        const match = isTest
          ? (String(num).match(/RMA-TEST-\d{4}-(\d+)-/i) || String(num).match(/RMA-\d{4}-T(\d+)-/i) || String(num).match(/RMA-\d{4}-(\d+)-/i))
          : String(num).match(/^RMA-\d{4}-(\d+)-/i);

        if (match && match[1]) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed) && parsed > maxSeq) {
            maxSeq = parsed;
          }
        }
      });
      if (maxSeq === 0 && existingOrHint.length > 0) {
        const modeCount = existingOrHint.filter(r => isTestRecord(r) === isTest).length;
        if (modeCount > 0) maxSeq = modeCount;
      }
    } else if (typeof existingOrHint === 'number' && existingOrHint > 0) {
      maxSeq = existingOrHint - 1;
    }

    // 2. Fallback to localStorage cache if existing array was not supplied or empty
    if (maxSeq === 0) {
      try {
        const rawReports = localStorage.getItem('cached_recent_reports') || localStorage.getItem('rma_reports_cache');
        if (rawReports) {
          const parsed = JSON.parse(rawReports);
          if (Array.isArray(parsed)) {
            parsed.forEach(r => {
              const itemIsTest = isTestRecord(r);
              if (isTest !== itemIsTest) return;

              const num = r.rma_number || r.rmaNumber || '';
              const match = isTest
                ? (String(num).match(/RMA-TEST-\d{4}-(\d+)-/i) || String(num).match(/RMA-\d{4}-T(\d+)-/i) || String(num).match(/RMA-\d{4}-(\d+)-/i))
                : String(num).match(/^RMA-\d{4}-(\d+)-/i);

              if (match && match[1]) {
                const p = parseInt(match[1], 10);
                if (!isNaN(p) && p > maxSeq) maxSeq = p;
              }
            });
          }
        }
      } catch {}
    }

    // 3. Isolated persistent local counters (Test Mode counter vs Live Mode counter)
    const storageKey = isTest ? `rma_last_test_seq_${currentYear}` : `rma_last_live_seq_${currentYear}`;
    try {
      const stored = parseInt(localStorage.getItem(storageKey) || '0', 10);
      if (!isNaN(stored) && stored > maxSeq) {
        maxSeq = stored;
      }
    } catch {}

    const nextSeq = maxSeq + 1;
    try {
      localStorage.setItem(storageKey, String(nextSeq));
    } catch {}

    const seqStr = String(nextSeq).padStart(4, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return isTest
      ? `RMA-TEST-${currentYear}-${seqStr}-${rand}`
      : `RMA-${currentYear}-${seqStr}-${rand}`;
  },

  /**
   * SUBMIT RMA RETURN REPORT (Supports Single Returns and Multi-Item Batch Manifests)
   * - Photo is optional per line item in manifest mode
   * - Reporter Name & Contact are REQUIRED
   * - Accurate GPS ONLY: Filters out inaccurate desktop IP geolocation (> 150m accuracy is left blank)
   */
  async submitReport({ 
    rmaNumber: explicitRmaNumber = null,
    rma_type = 'customer_inbound',
    rmaType = null,
    barcode, 
    name = null,
    productName = null,
    product, 
    quantity = 1, 
    reporterName,
    reporterContact,
    reason = 'Damaged Box / Crushed Packaging',
    explanation = '',
    photos = [],
    paperwork_photos = [],
    si_number = null,
    dr_number = null,
    po_number = null,
    invoice_dr_number = null,
    store_branch = null,
    expiry_date = null,
    batch_lot_number = null,
    supplier_name = null,
    supplier = null,
    ai_document_metadata = null,
    google_drive_folder_url = null,
    google_drive_folder_id = null,
    gps = null,
    items = [],
    pieces_per_case = null,
    piecesPerCase = null,
    total_items = null,
    total_quantity = null,
    is_parent = false,
    parent_rma_id = null,
    condition_grade = null,
    notes = null,
    customRecipients = null
  }) {
    const hasItems = Array.isArray(items) && items.length > 0;
    const isBatch = hasItems && items.length > 1;
    let cleanBarcode = String(barcode || (hasItems ? (isBatch ? (explicitRmaNumber || 'MANIFEST') : (items[0]?.barcode || 'MANIFEST')) : '')).trim();
    if (!cleanBarcode && !hasItems) throw new Error('A barcode is required to report a return.');

    // Aggregate photos from manifest items if provided
    let allPhotos = Array.isArray(photos) ? [...photos] : (photos ? [photos] : []);
    if (hasItems) {
      items.forEach(it => {
        if (Array.isArray(it.photos)) {
          it.photos.forEach(p => { if (p && !allPhotos.includes(p)) allPhotos.push(p); });
        } else if (it.photos && !allPhotos.includes(it.photos)) {
          allPhotos.push(it.photos);
        }
      });
    }

    if (!reporterName || !reporterName.trim()) {
      throw new Error('Your name is required.');
    }
    if (!reporterContact || !reporterContact.trim()) {
      throw new Error('Your contact info (phone number or email) is required.');
    }

    let rmaNumber = explicitRmaNumber;
    if (!rmaNumber) {
      const isTestSubmission = Boolean(
        notes?.includes('[TEST_MODE]') ||
        ai_document_metadata?.is_test ||
        ai_document_metadata?.test_mode
      );
      rmaNumber = this.generateRMANumber(null, isTestSubmission);
    }

    // Auto-resolve product from database if not passed in (skip synthetic MANIFEST / RMA- / NO-LABEL- keys)
    let resolvedProduct = product;
    const isSyntheticKey = isBatch || is_parent || /^(RMA-|MANIFEST|NO-?LABEL-)/i.test(cleanBarcode);
    if (!isSyntheticKey && (!resolvedProduct || !resolvedProduct.name || resolvedProduct.name.startsWith('Unidentified Item'))) {
      try {
        const found = await this.findProduct(cleanBarcode);
        if (found) {
          resolvedProduct = found;
        }
      } catch (e) {
        console.warn('Could not auto-resolve product during submitReport:', e);
      }
    }

    const isKnown = Boolean(
      resolvedProduct && 
      resolvedProduct.isVerified !== false && 
      resolvedProduct.is_verified !== false &&
      !resolvedProduct.name?.startsWith('Unidentified Item')
    );

    const calculatedTotalItems = total_items || (hasItems ? items.length : 1);
    const calculatedTotalQuantity = total_quantity || (hasItems
      ? sumManifestQuantity(items, quantity)
      : (Number(quantity) || 1));

    const userProvidedName = (name || productName || '').trim();
    const effectiveName = isBatch
      ? `Batch Return Manifest (${items.length} items)`
      : (userProvidedName || (isKnown ? resolvedProduct.name : (resolvedProduct?.name && !resolvedProduct.name.startsWith('Unidentified Item') ? resolvedProduct.name : (cleanBarcode ? `Unidentified Item (${cleanBarcode})` : 'General Return Item'))));

    // Ensure manifest barcode is strictly rmaNumber or a dedicated manifest identifier, never a child item's barcode
    const isUnlabeled = isUnlabeledBarcode(cleanBarcode) || Boolean(ai_document_metadata?.is_unlabeled);
    const finalBarcode = isBatch
      ? (cleanBarcode && cleanBarcode !== 'MANIFEST' && !items.some(it => String(it.barcode).trim() === cleanBarcode) ? cleanBarcode : rmaNumber)
      : cleanBarcode;

    // Filter GPS: Only save if accuracy is <= 150 meters
    const isAccurateGps = gps && gps.latitude && gps.accuracy && Number(gps.accuracy) <= 150;

    const effectiveRmaType = (rma_type === 'supplier_outbound' || (typeof rmaType !== 'undefined' && rmaType === 'supplier_outbound')) ? 'supplier_outbound' : 'customer_inbound';
    const effectiveGrade = condition_grade || mapReasonToConditionGrade(reason || (hasItems && items[0]?.reason));

    const singleFallbackSupplier = this._pickRealSupplier(
      isMixedSuppliersSummary(supplier_name) ? null : supplier_name,
      isMixedSuppliersSummary(supplier) ? null : supplier,
      resolvedProduct?.supplier_name,
      resolvedProduct?.supplierName,
      resolvedProduct?.supplier,
      hasItems ? items[0]?.supplier_name : null,
      hasItems ? items[0]?.supplierName : null
    );
    const resolvedSupplierName = isBatch
      ? summarizeBatchSuppliers(items, singleFallbackSupplier)
      : singleFallbackSupplier;

    const nowIso = new Date().toISOString();
    const existingFollowUpMeta = (ai_document_metadata?.follow_up && typeof ai_document_metadata.follow_up === 'object')
      ? { ...ai_document_metadata.follow_up }
      : {};
    let customerFollowUpDefault = true;
    try {
      customerFollowUpDefault = notificationService.getDailyFollowUpConfig()?.customerFollowUpDefaultEnabled !== false;
    } catch {}

    const shouldStartFollowUp =
      existingFollowUpMeta.enabled !== false &&
      (effectiveRmaType === 'supplier_outbound' || customerFollowUpDefault || existingFollowUpMeta.enabled === true);

    if (shouldStartFollowUp) {
      existingFollowUpMeta.enabled = true;
      if (!existingFollowUpMeta.started_at) {
        existingFollowUpMeta.started_at = nowIso;
      }
      // Auto-populate known Supplier Directory emails when available so daily cron can send right away
      if (!existingFollowUpMeta.supplier_email_to) {
        try {
          const itemSuppliers = hasItems ? extractDistinctSuppliersFromItems(items) : [];
          const candidateSups = itemSuppliers.length > 0
            ? itemSuppliers
            : (!isPlaceholderSupplier(resolvedSupplierName) && !isMixedSuppliersSummary(resolvedSupplierName) ? [resolvedSupplierName] : []);
          const dirToSet = new Set();
          const dirCcSet = new Set();
          candidateSups.forEach((sup) => {
            const match = supplierDirectoryService.findBySupplierName(sup);
            if (match?.email_to) {
              String(match.email_to).split(/[,;\s]+/).forEach((e) => { if (e.includes('@')) dirToSet.add(e.trim().toLowerCase()); });
            }
            if (match?.email_cc) {
              String(match.email_cc).split(/[,;\s]+/).forEach((e) => { if (e.includes('@')) dirCcSet.add(e.trim().toLowerCase()); });
            }
          });
          if (dirToSet.size > 0) {
            existingFollowUpMeta.supplier_email_to = Array.from(dirToSet).join(', ');
          }
          if (dirCcSet.size > 0) {
            existingFollowUpMeta.supplier_email_cc = Array.from(dirCcSet).filter((e) => !dirToSet.has(e)).join(', ');
          }
        } catch {}
      }
    } else if (existingFollowUpMeta.enabled === undefined) {
      existingFollowUpMeta.enabled = false;
      existingFollowUpMeta.manually_disabled = true;
    }

    const mergedMetadata = {
      ...(ai_document_metadata || {}),
      ...(isUnlabeled ? { is_unlabeled: true, provisional_barcode: finalBarcode } : {}),
      ...(isAccurateGps && (gps?.address || gps?.addressParts)
        ? {
            gps_address: {
              formatted: String(gps.address || gps.addressParts?.formatted || '').trim(),
              ...(gps.addressParts || {}),
              lines: Array.isArray(gps.addressLines) ? gps.addressLines : (gps.addressParts?.lines || [])
            }
          }
        : {}),
      follow_up: existingFollowUpMeta
    };

    const reportRow = {
      rma_number: rmaNumber,
      rma_type: effectiveRmaType,
      barcode: finalBarcode,
      code: isBatch ? null : (isKnown ? ((resolvedProduct.code && resolvedProduct.code !== finalBarcode) ? resolvedProduct.code : (resolvedProduct.sku && resolvedProduct.sku !== finalBarcode ? resolvedProduct.sku : null)) : (hasItems && items[0]?.code ? items[0].code : null)),
      name: effectiveName,
      quantity: calculatedTotalQuantity,
      supplier_name: resolvedSupplierName,
      price: hasItems 
        ? items.reduce((acc, it) => acc + ((Number(it.price) || 0) * (Number(it.quantity) || 1)), 0)
        : (isKnown ? Number(resolvedProduct.price || 0) : 0),
      price_with_vat: hasItems
        ? items.reduce((acc, it) => acc + ((Number(it.price_with_vat || it.price) || 0) * (Number(it.quantity) || 1)), 0)
        : (isKnown ? Number(resolvedProduct.price_with_vat || resolvedProduct.priceWithVat || resolvedProduct.price || 0) : 0),
      unit_name: hasItems
        ? (items.every(it => (it.unit_name || it.unit) === (items[0].unit_name || items[0].unit)) ? (items[0].unit_name || items[0].unit || 'pc') : 'mixed')
        : (isKnown ? (resolvedProduct.unit_name || resolvedProduct.unitName || 'pc') : (resolvedProduct?.unit_name || 'pc')),
      status: 'pending',
      reason: reason || (hasItems && items.length > 1 ? `Multi-Item Defect (${items.length} items)` : 'Damaged Box / Crushed Packaging'),
      explanation: explanation || null,
      photos: allPhotos,
      paperwork_photos: Array.isArray(paperwork_photos) ? paperwork_photos : (paperwork_photos ? [paperwork_photos] : []),
      si_number: si_number ? String(si_number).trim() : null,
      dr_number: dr_number ? String(dr_number).trim() : null,
      po_number: po_number ? String(po_number).trim() : null,
      invoice_dr_number: invoice_dr_number || si_number || dr_number || po_number || null,
      store_branch: store_branch || null,
      expiry_date: expiry_date || null,
      batch_lot_number: batch_lot_number ? String(batch_lot_number).trim() : null,
      ai_document_metadata: Object.keys(mergedMetadata).length > 0 ? mergedMetadata : null,
      google_drive_folder_url: google_drive_folder_url || null,
      google_drive_folder_id: google_drive_folder_id || null,
      gps_latitude: isAccurateGps ? Number(gps.latitude) : null,
      gps_longitude: isAccurateGps ? Number(gps.longitude) : null,
      gps_accuracy: isAccurateGps ? Number(gps.accuracy) : null,
      gps_timestamp: isAccurateGps ? new Date().toISOString() : null,
      reporter_name: reporterName.trim(),
      reporter_contact: reporterContact.trim(),
      reported_by: `${reporterName.trim()} (${reporterContact.trim()})`,
      ae_name: isKnown ? (resolvedProduct.ae_name || resolvedProduct.aeName || null) : null,
      ae_email: isKnown ? (resolvedProduct.ae_email || resolvedProduct.aeEmail || null) : null,
      company: isKnown ? (resolvedProduct.company || null) : null,
      condition_grade: effectiveGrade,
      disposition: 'Pending',
      warehouse_location: null,
      inspected_by: null,
      inspected_at: null,
      audit_trail: [],
      // Multi-Item Manifest Fields
      is_parent: isBatch ? true : Boolean(is_parent),
      parent_rma_id: parent_rma_id || null,
      items: hasItems ? items : [],
      total_items: calculatedTotalItems,
      total_quantity: calculatedTotalQuantity
    };

    // 1. Insert into rma_reports with graceful fallback if columns not yet migrated
    let insertedReport = null;
    let { data: insertedData, error: reportError } = await supabase
      .from('rma_reports')
      .insert([reportRow])
      .select()
      .single();

    if (reportError) {
      console.warn('Initial insert of rma_reports failed, attempting smart retry:', reportError.message);
      const fallbackRow = { ...reportRow };
      const errMsg = String(reportError.message || '');
      const colMatch = errMsg.match(/Could not find the '([^']+)' column/i) || errMsg.match(/column rma_reports\.([a-zA-Z0-9_]+) does not exist/i);
      if (colMatch && colMatch[1] && colMatch[1] in fallbackRow) {
        delete fallbackRow[colMatch[1]];
      }
      if (errMsg.includes('paperwork_photos')) delete fallbackRow.paperwork_photos;
      if (errMsg.includes('invoice_dr_number')) delete fallbackRow.invoice_dr_number;
      if (errMsg.includes('si_number')) delete fallbackRow.si_number;
      if (errMsg.includes('dr_number')) delete fallbackRow.dr_number;
      if (errMsg.includes('po_number')) delete fallbackRow.po_number;
      if (errMsg.includes('store_branch')) delete fallbackRow.store_branch;
      if (errMsg.includes('expiry_date')) delete fallbackRow.expiry_date;
      if (errMsg.includes('batch_lot_number')) delete fallbackRow.batch_lot_number;
      if (errMsg.includes('ai_document_metadata')) delete fallbackRow.ai_document_metadata;
      if (errMsg.includes('google_drive_folder')) {
        delete fallbackRow.google_drive_folder_url;
        delete fallbackRow.google_drive_folder_id;
      }
      if (errMsg.includes('rma_type')) delete fallbackRow.rma_type;

      // Only delete manifest columns if DB explicitly rejected THEM
      if (errMsg.includes('items') && !errMsg.includes('rma_items')) delete fallbackRow.items;
      if (errMsg.includes('is_parent')) delete fallbackRow.is_parent;
      if (errMsg.includes('parent_rma_id')) delete fallbackRow.parent_rma_id;
      if (errMsg.includes('total_items')) delete fallbackRow.total_items;
      if (errMsg.includes('total_quantity')) delete fallbackRow.total_quantity;
      if (errMsg.includes('gps_address')) delete fallbackRow.gps_address;

      const retry = await supabase.from('rma_reports').insert([fallbackRow]).select().single();
      if (!retry.error) {
        insertedReport = retry.data;
      } else {
        const retryErrMsg = String(retry.error.message || '');
        const retryColMatch = retryErrMsg.match(/Could not find the '([^']+)' column/i) || retryErrMsg.match(/column rma_reports\.([a-zA-Z0-9_]+) does not exist/i);
        if (retryColMatch && retryColMatch[1] && retryColMatch[1] in fallbackRow) {
          delete fallbackRow[retryColMatch[1]];
          const retry2 = await supabase.from('rma_reports').insert([fallbackRow]).select().single();
          if (!retry2.error) {
            insertedReport = retry2.data;
          } else {
            throw new Error(`Database error saving return report: ${retry2.error.message}`);
          }
        } else {
          throw new Error(`Database error saving return report: ${retry.error.message}`);
        }
      }
    } else {
      insertedReport = insertedData;
    }

    const finalReport = {
      ...(insertedReport || reportRow),
      items: hasItems ? items : (insertedReport?.items || [reportRow]),
      total_items: calculatedTotalItems,
      total_quantity: calculatedTotalQuantity,
      store_branch: store_branch || insertedReport?.store_branch
    };

    // 1.1 If this is a multi-item batch return, only insert child rows into rma_items and child rma_reports if isBatch && items.length > 1
    // Single-item returns are already recorded as finalReport itself; inserting child rows for single-items creates duplicate records.
    if (finalReport?.id && isBatch && items.length > 1) {
      const childFallbackSupplier = isMixedSuppliersSummary(reportRow.supplier_name) ? null : reportRow.supplier_name;
      try {
        const rmaItemRows = items.map(it => ({
          rma_report_id: finalReport.id,
          rma_number: rmaNumber,
          barcode: String(it.barcode || '').trim(),
          sku: it.code || it.sku || null,
          name: it.name || it.productName || `Item (${it.barcode})`,
          quantity: Number(it.quantity) || 1,
          unit_name: it.unit_name || it.unit || 'pc',
          price: Number(it.price || 0),
          price_with_vat: Number(it.price_with_vat || it.priceWithVat || it.price || 0),
          supplier_name: this._pickRealSupplier(it.supplier_name, it.supplierName, it.supplier, childFallbackSupplier),
          reason: it.reason || 'Damaged Box / Crushed Packaging',
          explanation: it.explanation || null,
          expiry_date: it.expiry_date || null,
          photos: Array.isArray(it.photos) ? it.photos : (it.photos ? [it.photos] : [])
        }));
        await supabase.from('rma_items').insert(rmaItemRows);
      } catch (e) {
        console.warn('Notice inserting into rma_items (pending table creation):', e?.message || e);
      }

      try {
        const childReportRows = items.map(it => ({
          rma_number: rmaNumber,
          parent_rma_id: finalReport.id,
          is_parent: false,
          rma_type: reportRow.rma_type,
          barcode: String(it.barcode || '').trim(),
          code: it.code || it.sku || null,
          name: it.name || it.productName || `Item (${it.barcode})`,
          quantity: Number(it.quantity) || 1,
          unit_name: it.unit_name || it.unit || 'pc',
          supplier_name: this._pickRealSupplier(it.supplier_name, it.supplierName, it.supplier, childFallbackSupplier),
          price: Number(it.price || 0),
          price_with_vat: Number(it.price_with_vat || it.priceWithVat || it.price || 0),
          status: reportRow.status,
          reason: it.reason || 'Damaged Box / Crushed Packaging',
          explanation: it.explanation || null,
          photos: Array.isArray(it.photos) ? it.photos : (it.photos ? [it.photos] : []),
          paperwork_photos: reportRow.paperwork_photos,
          si_number: reportRow.si_number,
          dr_number: reportRow.dr_number,
          po_number: reportRow.po_number,
          invoice_dr_number: reportRow.invoice_dr_number,
          store_branch: reportRow.store_branch,
          expiry_date: it.expiry_date || null,
          google_drive_folder_url: reportRow.google_drive_folder_url,
          google_drive_folder_id: reportRow.google_drive_folder_id,
          reporter_name: reportRow.reporter_name,
          reporter_contact: reportRow.reporter_contact,
          reported_by: reportRow.reported_by,
          condition_grade: reportRow.condition_grade,
          disposition: reportRow.disposition
        }));
        await supabase.from('rma_reports').insert(childReportRows);
      } catch (e) {
        console.warn('Notice inserting child rma_reports:', e?.message || e);
      }
    }

    // 2. Dispatch automated notification email RIGHT AWAY for every reported RMA!
    // Rule:
    // - Test Mode is strictly accessible ONLY if user is logged in as Super Admin or ticket/invite is an explicit Sandbox record.
    // - For all anonymous public reporters or non-super-admins on Live links, submissions are ALWAYS Live.
    const isTestActive = Boolean(
      isSuperAdminTestModeActive() ||
      (rmaNumber && /^RMA-TEST-/i.test(String(rmaNumber))) ||
      String(notes || '').includes('[TEST_MODE]') ||
      reportRow?.ai_document_metadata?.is_test === true ||
      reportRow?.ai_document_metadata?.test_mode === true
    );
    notificationService.sendRMANotification(finalReport, isTestActive, {
      customRecipients: customRecipients || null
    }).catch(err => {
      console.warn('Background RMA report notification notice:', err.message);
    });

    // 3. Catalog database synchronization (asynchronous non-blocking to ensure instant submission):
    if (isKnown) {
      // Auto-upsert into Supabase products table so the catalog retains the item and allows admin to assign an AE
      supabase
        .from('products')
        .upsert([
          {
            barcode: cleanBarcode,
            code: (resolvedProduct.code && resolvedProduct.code !== cleanBarcode) ? resolvedProduct.code : (resolvedProduct.sku && resolvedProduct.sku !== cleanBarcode ? resolvedProduct.sku : null),
            name: resolvedProduct.name,
            supplier_name: resolvedProduct.supplier_name || resolvedProduct.supplierName || 'Pending Assignment',
            price: Number(resolvedProduct.price || 0),
            price_with_vat: Number(resolvedProduct.price_with_vat || resolvedProduct.priceWithVat || resolvedProduct.price || 0),
            brand_name: resolvedProduct.brand_name || resolvedProduct.brandName || null,
            unit_name: resolvedProduct.unit_name || resolvedProduct.unitName || 'pc',
            image_url: resolvedProduct.image_url || resolvedProduct.imageUrl || null,
            ae_name: resolvedProduct.ae_name || resolvedProduct.aeName || null,
            ae_email: resolvedProduct.ae_email || resolvedProduct.aeEmail || null,
            company: resolvedProduct.company || null,
            is_verified: true,
            updated_at: new Date().toISOString()
          }
        ], { onConflict: 'barcode' })
        .then(() => {})
        .catch(err => {
          console.warn('Catalog auto-sync notice:', err?.message || err);
        });
    }
    // Note: If item is uncatalogued, we DO NOT insert into products database.
    // Uncatalogued returns remain strictly within rma_reports until an admin manually assigns an SKU.

    // Trigger instant real-time notification
    this.notifyChange('report-submitted', { report: finalReport });

    return {
      success: true,
      rmaNumber,
      isKnown,
      status: reportRow.status,
      report: finalReport
    };
  },

  /**
   * Reclassify RMA Type between 'customer_inbound' and 'supplier_outbound'
   */
  async updateRMAType(id, rma_type, disposition = null, status = null) {
    const cleanType = rma_type === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
    const cleanId = String(id).trim();
    const isNum = /^\d+$/.test(cleanId);

    const updates = { rma_type: cleanType };
    if (disposition) {
      updates.disposition = disposition;
    }
    if (status) {
      updates.status = status;
    }

    // 1. Direct UPDATE without a preflight SELECT — avoids hanging when many requests are in-flight.
    //    We already know the id or rma_number from the caller; the items-array cascade is handled
    //    post-hoc from the returned row to keep the critical path fast.
    let query = supabase.from('rma_reports').update(updates);
    if (isNum) {
      query = query.eq('id', parseInt(cleanId, 10));
    } else {
      query = query.eq('rma_number', cleanId);
    }

    const updatePromise = query.select().single();
    const timeoutPromise = new Promise((_, reject) =>
      setTimeout(() => reject(new Error('updateRMAType timed out after 20 s')), 20000)
    );

    const { data, error } = await Promise.race([updatePromise, timeoutPromise]);
    if (error) {
      console.error('Failed to update rma_type:', error);
      throw error;
    }

    const recordId = data?.id || (isNum ? parseInt(cleanId, 10) : null);
    const rmaNum = data?.rma_number || (!isNum ? cleanId : null);

    // Post-hoc: cascade rma_type into the JSON `items` array if present
    if (data && Array.isArray(data.items) && data.items.length > 0) {
      try {
        const itemsUpdate = {
          items: data.items.map(it => ({
            ...it,
            rma_type: cleanType,
            disposition: disposition || it.disposition || 'Pending'
          }))
        };
        const itemsCascade = supabase.from('rma_reports').update(itemsUpdate).eq('id', data.id).select().single();
        const itemsTimeout = new Promise((_, reject) => setTimeout(() => reject(new Error('items cascade timeout')), 5000));
        const { data: updatedRow } = await Promise.race([itemsCascade, itemsTimeout]).catch(() => ({ data: null }));
        if (updatedRow) Object.assign(data, updatedRow);
      } catch {}
    }

    // 2. Cascade update to all child records in rma_reports sharing parent_rma_id or rma_number
    try {
      const childUpdates = { rma_type: cleanType };
      if (disposition) childUpdates.disposition = disposition;

      const cascadeOps = [];
      if (recordId) {
        cascadeOps.push(supabase.from('rma_reports').update(childUpdates).eq('parent_rma_id', recordId));
      }
      if (rmaNum) {
        cascadeOps.push(supabase.from('rma_reports').update(childUpdates).eq('rma_number', rmaNum).neq('id', data.id));
      }
      if (cascadeOps.length) {
        await Promise.race([
          Promise.allSettled(cascadeOps),
          new Promise((_, reject) => setTimeout(() => reject(new Error('child cascade timeout')), 5000))
        ]).catch(() => {});
      }
    } catch (e) {
      console.warn('Notice cascading rma_type to child rma_reports:', e?.message);
    }

    // 3. rma_items table stores line-item product metadata only (no disposition column in schema);
    // disposition updates are persisted on parent and child rma_reports rows above.

    this.notifyChange('report-updated', { report: data });
    return data;
  },

  /**
   * SUPER ADMIN SILENT RESTITUTION:
   * Recreates or edits an RMA record to match a deleted ticket, with optional
   * conversion from Test Mode to Live Mode, with a 100% guarantee that NO
   * email notifications are triggered.
   */
  async reconstructRMARecord(id, payload = {}, actorName = 'Super Admin') {
    if (!id && !payload?.rma_number) throw new Error('ID or RMA Number required for reconstruction.');

    const cleanId = (id && /^\d+$/.test(String(id))) ? Number(id) : null;
    const rmaLookup = !cleanId ? String(id || payload.rma_number).trim() : null;

    // Fetch existing record first
    let query = supabase.from('rma_reports').select('*');
    if (cleanId) query = query.eq('id', cleanId);
    else query = query.eq('rma_number', rmaLookup);

    const { data: existing, error: fetchErr } = await query.maybeSingle();
    if (fetchErr) throw fetchErr;

    const existingMeta = (existing?.ai_document_metadata && typeof existing.ai_document_metadata === 'object')
      ? existing.ai_document_metadata
      : {};

    const updatedMeta = { ...existingMeta };
    let updatedNotes = payload.notes !== undefined ? String(payload.notes) : (existing?.notes || '');

    // Operational mode toggle: Promote from Test Mode to Live Mode or vice versa
    let finalIsTest = existing?.is_test;
    if (payload.is_test !== undefined) {
      if (payload.is_test === false || payload.is_test === 'false') {
        finalIsTest = false;
        delete updatedMeta.is_test;
        updatedNotes = updatedNotes.replace(/\[TEST_MODE\]/gi, '').trim();
      } else {
        finalIsTest = true;
        updatedMeta.is_test = true;
        if (!updatedNotes.includes('[TEST_MODE]')) {
          updatedNotes = `[TEST_MODE] ${updatedNotes}`.trim();
        }
      }
    }

    const updates = {};
    if (payload.rma_number) updates.rma_number = String(payload.rma_number).trim();
    if (payload.created_at) updates.created_at = new Date(payload.created_at).toISOString();
    if (payload.si_number !== undefined) updates.si_number = payload.si_number ? String(payload.si_number).trim() : null;
    if (payload.dr_number !== undefined) updates.dr_number = payload.dr_number ? String(payload.dr_number).trim() : null;
    if (payload.po_number !== undefined) updates.po_number = payload.po_number ? String(payload.po_number).trim() : null;
    if (payload.invoice_dr_number !== undefined) updates.invoice_dr_number = payload.invoice_dr_number ? String(payload.invoice_dr_number).trim() : null;
    if (payload.store_branch !== undefined) updates.store_branch = payload.store_branch ? String(payload.store_branch).trim() : null;
    if (payload.supplier_name !== undefined) updates.supplier_name = payload.supplier_name ? String(payload.supplier_name).trim() : null;
    if (payload.name !== undefined) updates.name = String(payload.name).trim();
    if (payload.barcode !== undefined) updates.barcode = String(payload.barcode).trim();
    if (payload.code !== undefined || payload.sku !== undefined) updates.code = String(payload.code || payload.sku || '').trim() || null;
    if (payload.quantity !== undefined) updates.quantity = Number(payload.quantity) || 1;
    if (payload.unit_name !== undefined) updates.unit_name = String(payload.unit_name).trim() || 'pc';
    if (payload.price !== undefined) updates.price = parseFloat(payload.price) || 0;
    if (payload.price_with_vat !== undefined) updates.price_with_vat = parseFloat(payload.price_with_vat) || 0;
    if (payload.warehouse_location !== undefined) updates.warehouse_location = String(payload.warehouse_location).trim();
    if (payload.batch_lot_number !== undefined) updates.batch_lot_number = payload.batch_lot_number ? String(payload.batch_lot_number).trim() : null;
    if (payload.expiry_date !== undefined) updates.expiry_date = payload.expiry_date || null;
    if (payload.disposition !== undefined) updates.disposition = String(payload.disposition).trim();
    if (payload.status !== undefined) updates.status = String(payload.status).trim();
    if (payload.condition_grade !== undefined) updates.condition_grade = String(payload.condition_grade).trim();
    if (payload.reason !== undefined) updates.reason = String(payload.reason).trim();
    if (payload.rma_type !== undefined) updates.rma_type = String(payload.rma_type).trim();

    // Mode is preserved inside ai_document_metadata and notes (rma_reports table has no direct is_test column)
    updates.ai_document_metadata = updatedMeta;
    updates.notes = updatedNotes;

    const existingAudit = Array.isArray(existing?.audit_trail) ? existing.audit_trail : [];
    updates.audit_trail = [
      ...existingAudit,
      {
        timestamp: new Date().toISOString(),
        stage: 'ADMIN_SILENT_RESTITUTION',
        actor: actorName,
        note: `Record reconstructed / edited silently by ${actorName}${payload.is_test === false ? ' (Promoted to Live Production)' : ''}`
      }
    ];

    let updateQuery = supabase.from('rma_reports').update(updates);
    if (cleanId) updateQuery = updateQuery.eq('id', cleanId);
    else updateQuery = updateQuery.eq('rma_number', existing?.rma_number || rmaLookup);

    let { data: updatedData, error: updateErr } = await updateQuery.select().single();
    if (updateErr) {
      console.warn('Initial update failed in reconstructRMARecord, applying fallback:', updateErr.message);
      const fallback = { ...updates };
      delete fallback.is_test;
      const colMatch = updateErr.message.match(/Could not find the '([^']+)' column/i) || updateErr.message.match(/column rma_reports\.([a-zA-Z0-9_]+) does not exist/i);
      if (colMatch && colMatch[1]) delete fallback[colMatch[1]];
      let retryQuery = supabase.from('rma_reports').update(fallback);
      if (cleanId) retryQuery = retryQuery.eq('id', cleanId);
      else retryQuery = retryQuery.eq('rma_number', existing?.rma_number || rmaLookup);
      const { data: retryData, error: retryErr } = await retryQuery.select().single();
      if (retryErr) throw retryErr;
      updatedData = retryData;
    }

    // Cascade to split children or items if rma_number or supplier changed
    if (updates.rma_number && existing?.id) {
      try {
        await supabase.from('rma_reports').update({ rma_number: updates.rma_number }).eq('parent_rma_id', existing.id);
      } catch (cascadeErr) {
        console.warn('Notice cascading reconstructed rma_number:', cascadeErr?.message);
      }
    }

    this.notifyChange('report-updated', { report: updatedData });
    return updatedData;
  },

  /**
   * Broadcasts real-time triage events over rma_portal_sync_bus when an item is triaged
   * as 'Restock to Inventory' or 'Scrap / Dispose' so coworker tabs update live without refresh.
   */
  broadcastTriageEvent({ report, disposition, status }) {
    this.notifyChange('triage-queue-updated', {
      reportId: report?.id,
      rmaNumber: report?.rma_number,
      disposition: disposition || report?.disposition,
      status: status || report?.status,
      report
    });
  },

  /**
   * 1-Click Coworker Queue Action (Mark as Stocked in WMS -> 'restocked' | Mark Re-ordered from Supplier -> 'scrapped')
   */
  async confirmCoworkerQueueAction({ item, targetStatus, warehouseLocation = null, actorName = 'Warehouse Staff' }) {
    if (!item || !targetStatus) throw new Error('Item and targetStatus are required.');
    const cleanStatus = String(targetStatus).toLowerCase().trim() === 'scrapped' ? 'scrapped' : 'restocked';
    const cleanActor = String(actorName || 'Warehouse Staff').trim();

    let stage = 'SUPPLIER_REORDER';
    let workflowResolution = 'reordered';
    let auditNote = `Supplier Re-order PO confirmed by ${cleanActor}`;
    if (cleanStatus === 'restocked') {
      stage = 'ERP_RESTOCK';
      workflowResolution = 'restocked';
      auditNote = `ERP Restock confirmed by ${cleanActor}`;
    } else {
      const notes = String(item?.notes || '');
      const isExplicitNoReorder = item?.needs_reorder === false || item?.ai_document_metadata?.needs_reorder === false || notes.includes('[REORDER: NO]');
      if (isExplicitNoReorder) {
        stage = 'SCRAP_DISPOSAL';
        workflowResolution = 'scrapped_no_reorder';
        auditNote = `Scrap written off by ${cleanActor}`;
      }
    }

    const auditEntry = {
      timestamp: new Date().toISOString(),
      stage,
      actor: cleanActor,
      status: 'resolved',
      workflow_resolution: workflowResolution,
      warehouse_location: warehouseLocation || item.warehouse_location || undefined,
      note: auditNote
    };

    const targetId = item.parent_rma_id || item.id;
    const targetRma = item.rma_number;

    // Fetch existing row from Supabase
    let fetchQuery = supabase.from('rma_reports').select('*');
    if (targetId && /^\d+$/.test(String(targetId))) {
      fetchQuery = fetchQuery.eq('id', Number(targetId));
    } else if (targetRma) {
      fetchQuery = fetchQuery.eq('rma_number', targetRma);
    }

    const { data: rows, error: fetchErr } = await fetchQuery;
    if (fetchErr) throw fetchErr;
    const primaryRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : item;

    const currentAudit = Array.isArray(primaryRow?.audit_trail) ? [...primaryRow.audit_trail] : [];
    currentAudit.push(auditEntry);

    const updatedMeta = {
      ...((primaryRow?.ai_document_metadata && typeof primaryRow.ai_document_metadata === 'object') ? primaryRow.ai_document_metadata : {}),
      workflow_resolution: workflowResolution,
      resolved_at: new Date().toISOString(),
      resolved_by: cleanActor
    };

    const updates = {
      status: 'resolved', // STRICT DB CONSTRAINT: Always use valid DB check constraint enum 'resolved'
      audit_trail: currentAudit,
      ai_document_metadata: updatedMeta
    };
    if (warehouseLocation) {
      updates.warehouse_location = String(warehouseLocation).trim().toUpperCase();
    }

    // If primaryRow is a batch manifest, also update matching child items in primaryRow.items
    let parsedItems = [];
    if (Array.isArray(primaryRow?.items) && primaryRow.items.length > 0) {
      parsedItems = [...primaryRow.items];
    } else if (typeof primaryRow?.items === 'string' && primaryRow.items.trim()) {
      try {
        const p = JSON.parse(primaryRow.items);
        if (Array.isArray(p)) parsedItems = p;
      } catch (e) {}
    }

    if (parsedItems.length > 0) {
      const targetBarcode = item.is_unpacked_manifest_item && item.barcode ? String(item.barcode).trim() : null;
      parsedItems = parsedItems.map(child => {
        const cBarcode = String(child.barcode || '').trim();
        const cDisp = String(child.disposition || '').toLowerCase();
        const matchesSpecific = targetBarcode && cBarcode === targetBarcode;
        const matchesDisp = !targetBarcode && (
          (cleanStatus === 'restocked' && cDisp.includes('restock')) ||
          (cleanStatus === 'scrapped' && (cDisp.includes('scrap') || cDisp.includes('dispose')))
        );
        if (matchesSpecific || matchesDisp) {
          return {
            ...child,
            status: 'resolved',
            workflow_resolution: workflowResolution,
            warehouse_location: warehouseLocation ? String(warehouseLocation).trim().toUpperCase() : child.warehouse_location
          };
        }
        return child;
      });
      updates.items = parsedItems;

      // Recompute parent manifest status
      const allResolved = parsedItems.every(c => c.status === 'resolved' || ['restocked', 'scrapped', 'closed', 'resolved'].includes(String(c.status || '').toLowerCase()));
      if (allResolved) {
        updates.status = 'resolved';
      } else if (targetBarcode) {
        updates.status = 'under_inspection';
      }
    }

    let updateQuery = supabase.from('rma_reports').update(updates);
    if (primaryRow?.id && /^\d+$/.test(String(primaryRow.id))) {
      updateQuery = updateQuery.eq('id', Number(primaryRow.id));
    } else if (targetRma) {
      updateQuery = updateQuery.eq('rma_number', targetRma);
    }

    const { data: updatedData, error: updateErr } = await updateQuery.select('*');
    if (updateErr) throw updateErr;
    const updatedReport = Array.isArray(updatedData) && updatedData.length > 0
      ? updatedData[0]
      : { ...primaryRow, ...updates };

    // Broadcast real-time event across all open tabs via rma_portal_sync_bus
    this.notifyChange('coworker-queue-updated', {
      reportId: updatedReport.id,
      rmaNumber: updatedReport.rma_number,
      status: 'resolved',
      workflow_resolution: workflowResolution,
      report: updatedReport
    });

    return updatedReport;
  },

  /**
   * Fully reset an RMA report (timeline, disposition outcome, 10-day countdown & child items) back to Pending
   */
  async resetReportToPending(id, rmaNumber, actorName = 'Admin') {
    if (!id && !rmaNumber) return false;
    const cleanActor = String(actorName || 'Admin').trim();
    const isNumericId = id !== undefined && id !== null && /^\d+$/.test(String(id));

    let fetchQuery = supabase.from('rma_reports').select('*');
    if (isNumericId) fetchQuery = fetchQuery.eq('id', Number(id));
    else fetchQuery = fetchQuery.eq('rma_number', rmaNumber);

    const { data: rows, error: fetchErr } = await fetchQuery;
    if (fetchErr) throw fetchErr;
    const primaryRow = Array.isArray(rows) && rows.length > 0 ? rows[0] : null;
    if (!primaryRow) throw new Error('Report not found');

    const nowIso = new Date().toISOString();
    const isTestRow = Boolean(
      primaryRow?.ai_document_metadata?.is_test ||
      primaryRow?.ai_document_metadata?.test_mode ||
      /^RMA-TEST-/i.test(primaryRow?.rma_number || '') ||
      String(primaryRow?.notes || '').includes('[TEST_MODE]')
    );

    const currentAudit = Array.isArray(primaryRow?.audit_trail) ? [...primaryRow.audit_trail] : [];
    currentAudit.push({
      timestamp: nowIso,
      action: 'TIMELINE_RESET_TO_PENDING',
      stage: 'RESET_TO_PENDING',
      actor: cleanActor,
      status: 'pending',
      note: `Full 4-step workflow timeline, 10-day countdown & disposition outcome reset to Pending by ${cleanActor}`
    });

    const currentMeta = (primaryRow?.ai_document_metadata && typeof primaryRow.ai_document_metadata === 'object')
      ? { ...primaryRow.ai_document_metadata }
      : {};
    delete currentMeta.workflow_resolution;
    delete currentMeta.resolved_at;
    delete currentMeta.resolved_by;
    delete currentMeta.simple_rtv_disposition;
    delete currentMeta.simple_rtv_label;
    delete currentMeta.simple_rtv_updated_at;
    delete currentMeta.simple_rtv_updated_by;
    delete currentMeta.needs_reorder;
    delete currentMeta.credit_memo_no;
    delete currentMeta.credit_memo_date;

    const prevPickup = (currentMeta.supplier_pickup && typeof currentMeta.supplier_pickup === 'object')
      ? currentMeta.supplier_pickup
      : null;
    if (prevPickup) {
      const cleanedPickup = {};
      if (prevPickup.supplier_name) cleanedPickup.supplier_name = prevPickup.supplier_name;
      if (prevPickup.customer_name) cleanedPickup.customer_name = prevPickup.customer_name;
      if (prevPickup.supplier_email_to) cleanedPickup.supplier_email_to = prevPickup.supplier_email_to;
      if (prevPickup.supplier_email_cc) cleanedPickup.supplier_email_cc = prevPickup.supplier_email_cc;
      if (isTestRow || prevPickup.is_test) cleanedPickup.is_test = true;
      if (Object.keys(cleanedPickup).length > 0) {
        currentMeta.supplier_pickup = cleanedPickup;
      } else {
        delete currentMeta.supplier_pickup;
      }
    }

    const prevFollowUp = (currentMeta.follow_up && typeof currentMeta.follow_up === 'object')
      ? { ...currentMeta.follow_up }
      : {};
    const resetFollowUp = {};
    if (prevFollowUp.enabled !== undefined) resetFollowUp.enabled = prevFollowUp.enabled;
    if (prevFollowUp.customer_enabled !== undefined) resetFollowUp.customer_enabled = prevFollowUp.customer_enabled;
    if (prevFollowUp.supplier_email_to) resetFollowUp.supplier_email_to = prevFollowUp.supplier_email_to;
    if (prevFollowUp.supplier_email_cc) resetFollowUp.supplier_email_cc = prevFollowUp.supplier_email_cc;
    resetFollowUp.started_at = nowIso;
    resetFollowUp.reset_at = nowIso;
    resetFollowUp.sent_count = 0;
    currentMeta.follow_up = resetFollowUp;

    if (isTestRow) {
      currentMeta.is_test = true;
      currentMeta.test_mode = true;
    }

    const rawNotes = String(primaryRow.notes || '');
    let cleanedNotes = rawNotes
      .replace(/\[(?:RTV|BUF):\s*[^\]]+\]/gi, '')
      .replace(/\n{2,}/g, '\n')
      .trim();
    if (isTestRow && !cleanedNotes.includes('[TEST_MODE]')) {
      cleanedNotes = cleanedNotes ? `[TEST_MODE] ${cleanedNotes}` : '[TEST_MODE] Sandbox Return';
    }

    const updates = {
      status: 'pending',
      disposition: 'Pending',
      warehouse_location: 'Receiving / Quarantine Area',
      notes: cleanedNotes || null,
      audit_trail: currentAudit,
      ai_document_metadata: currentMeta
    };

    // If batch manifest, reset all resolved child items as well
    if (Array.isArray(primaryRow.items) && primaryRow.items.length > 0) {
      updates.items = primaryRow.items.map(child => {
        const cleanChild = { ...child, status: 'pending', disposition: 'Pending' };
        delete cleanChild.workflow_resolution;
        delete cleanChild.simple_rtv_disposition;
        delete cleanChild.simple_rtv_label;
        delete cleanChild.needs_reorder;
        delete cleanChild.supplier_pickup;
        return cleanChild;
      });
    }

    let uq = supabase.from('rma_reports').update(updates);
    if (isNumericId) uq = uq.eq('id', Number(primaryRow.id));
    else uq = uq.eq('rma_number', primaryRow.rma_number);

    let { data: updatedData, error: updateErr } = await uq.select('*');
    if (updateErr && String(updateErr.message || '').includes('rma_reports_status_check')) {
      const retryUpdates = { ...updates, status: 'under_inspection' };
      let rq = supabase.from('rma_reports').update(retryUpdates);
      if (isNumericId) rq = rq.eq('id', Number(primaryRow.id));
      else rq = rq.eq('rma_number', primaryRow.rma_number);
      const retryRes = await rq.select('*');
      updatedData = retryRes.data;
      updateErr = retryRes.error;
    }
    if (updateErr) throw updateErr;

    const finalReport = Array.isArray(updatedData) && updatedData.length > 0 ? updatedData[0] : { ...primaryRow, ...updates };

    // Also reset separate child rma_reports rows linked via parent_rma_id
    if (primaryRow.id) {
      try {
        await supabase
          .from('rma_reports')
          .update({
            status: 'pending',
            disposition: 'Pending',
            warehouse_location: 'Receiving / Quarantine Area'
          })
          .eq('parent_rma_id', primaryRow.id);
      } catch {}
    }

    this.notifyChange('report-updated', { report: finalReport });
    this.notifyChange('coworker-queue-updated', {
      reportId: finalReport.id,
      rmaNumber: finalReport.rma_number,
      status: finalReport.status || 'pending',
      report: finalReport
    });

    return finalReport;
  },

  /**
   * Fetch all unmapped items (Awaiting SKU) across active standalone reports and batch manifest child items
   */
  async getPendingBarcodes() {
    try {
      // 1. Fetch active (non-deleted) RMA reports (regardless of whether status is pending, received_at_dock, etc.)
      const { data: activeReports, error: rError } = await supabase
        .from('rma_reports')
        .select('id, rma_number, parent_rma_id, barcode, code, name, supplier_name, price, price_with_vat, unit_name, status, created_at, is_parent, items, photos, ai_document_metadata')
        .not('status', 'eq', 'deleted')
        .order('created_at', { ascending: false });

      if (rError) {
        console.warn('Error fetching active reports for pending cross-check:', rError.message);
      }

      // 2. Fetch products table to check if a barcode has already been mapped to a valid SKU
      const { data: allProds, error: pError } = await supabase
        .from('products')
        .select('id, barcode, code, name, supplier_name, price, price_with_vat, unit_name, is_verified, created_at')
        .not('name', 'like', '[DELETED]%')
        .order('created_at', { ascending: false });

      if (pError) {
        console.warn('Error fetching products for SKU check:', pError.message);
      }

      const isValidSku = (codeVal, barcodeVal) => {
        const c = String(codeVal || '').trim();
        const b = String(barcodeVal || '').trim();
        if (!c || c === '—') return false;
        const lower = c.toLowerCase();
        if (
          lower === 'awaiting sku' ||
          lower === 'unassigned' ||
          lower.includes('awaiting') ||
          lower.includes('unidentified')
        ) {
          return false;
        }
        if (b && c === b) return false;
        return true;
      };

      const verifiedSkuByBarcode = new Map();
      (allProds || []).forEach(p => {
        const b = String(p.barcode || '').trim();
        if (b && p.is_verified !== false && isValidSku(p.code, b)) {
          verifiedSkuByBarcode.set(b, String(p.code).trim());
        }
      });

      const reports = (activeReports || []).filter(r => !isTrashedRecord(r) && !isArchivedRecord(r) && !isTestRecord(r));

      const isBatchReport = (r) => {
        if (!r) return false;
        if (r.is_parent === true) return true;
        const name = String(r.name || '').toLowerCase();
        if (name.startsWith('batch return manifest') || name.startsWith('batch rma')) return true;
        const b = String(r.barcode || '');
        if (b.startsWith('RMA-') || (r.rma_number && b === r.rma_number)) return true;
        if (Array.isArray(r.items) && r.items.length > 1) return true;
        return false;
      };

      // Identify child rma_reports rows that belong to an existing parent manifest container
      const isChildRowOfManifest = (r) => {
        if (!r || isBatchReport(r)) return false;
        // Standalone split tickets (-B, -C, -D, -E) are independent rows
        if (/-(?:B|C|D|E)$/i.test(String(r.rma_number || ''))) return false;
        const parent = reports.find(p => (
          p &&
          String(p.id) !== String(r.id) &&
          isBatchReport(p) &&
          (p.rma_number === r.rma_number || (r.parent_rma_id && String(p.id) === String(r.parent_rma_id)))
        ));
        return Boolean(parent);
      };

      const unmappedItems = [];

      reports.forEach(r => {
        if (!r) return;
        // Skip child rma_reports rows that belong to a parent manifest (we inspect the parent's items below)
        if (isChildRowOfManifest(r)) return;

        if (isBatchReport(r)) {
          // Inspect child items inside the items JSON array (or fallback child rows if items JSON is empty)
          const childList = (Array.isArray(r.items) && r.items.length > 0)
            ? r.items
            : reports.filter(c => (
                c &&
                String(c.id) !== String(r.id) &&
                !/-(?:B|C|D|E)$/i.test(String(c.rma_number || '')) &&
                (c.rma_number === r.rma_number || (c.parent_rma_id && String(c.parent_rma_id) === String(r.id)))
              ));

          childList.forEach((child, idx) => {
            if (!child) return;
            const childBarcode = String(child.barcode || '').trim();
            if (childBarcode.startsWith('RMA-')) return;
            const rawCode = child.code || child.sku || (childBarcode ? verifiedSkuByBarcode.get(childBarcode) : null) || null;
            if (!isValidSku(rawCode, childBarcode)) {
              unmappedItems.push({
                id: child.id || `${r.id}_item_${idx}`,
                report_id: r.id,
                rma_number: r.rma_number,
                barcode: childBarcode,
                code: null,
                name: child.name || child.productName || `Unidentified Item (${childBarcode || 'No Barcode'})`,
                supplier_name: child.supplier_name || r.supplier_name || 'Pending Assignment',
                price: Number(child.price || 0),
                price_with_vat: Number(child.price_with_vat || child.priceWithVat || child.price || 0),
                unit_name: child.unit_name || child.unit || 'pc',
                status: child.status || r.status || 'pending',
                photos: child.photos || r.photos || [],
                ai_document_metadata: child.ai_document_metadata || r.ai_document_metadata || {},
                is_verified: false,
                created_at: r.created_at
              });
            }
          });
        } else {
          // Standalone report (single-item report or split ticket)
          const barcodeStr = String(r.barcode || '').trim();
          if (barcodeStr.startsWith('RMA-')) return;
          const rawCode = r.code || r.sku || (barcodeStr ? verifiedSkuByBarcode.get(barcodeStr) : null) || null;
          if (!isValidSku(rawCode, barcodeStr)) {
            unmappedItems.push({
              id: r.id,
              report_id: r.id,
              rma_number: r.rma_number,
              barcode: barcodeStr,
              code: null,
              name: r.name || `Unidentified Item (${barcodeStr || 'No Barcode'})`,
              supplier_name: r.supplier_name || 'Pending Assignment',
              price: Number(r.price || 0),
              price_with_vat: Number(r.price_with_vat || r.price || 0),
              unit_name: r.unit_name || 'pc',
              status: r.status || 'pending',
              photos: r.photos || [],
              ai_document_metadata: r.ai_document_metadata || {},
              is_verified: false,
              created_at: r.created_at
            });
          }
        }
      });

      return unmappedItems;
    } catch (e) {
      console.warn('Error fetching pending barcodes:', e.message);
      return [];
    }
  },

  /**
   * ADMIN ACTION: Permanently dismiss or delete an unverified barcode from pending queue
   */
  async deletePendingBarcode(barcode, productId) {
    if (!barcode && !productId) return false;
    try {
      if (productId) {
        await supabase.from('products').delete().eq('id', productId);
      }
      if (barcode) {
        await supabase.from('products').delete().eq('barcode', barcode).eq('is_verified', false);
      }
      this.notifyChange('pending-barcode-deleted', { barcode, productId });
      return true;
    } catch (e) {
      console.warn('Failed to delete pending barcode:', e);
      return false;
    }
  },

  /**
   * ADMIN ACTION: Fill in details for an unknown barcode, including optional product reference image.
   */
  async updateBarcodeDetails({ barcode, code, name, supplierName, price, priceWithVat, brandName, unitName, pieces_per_case, piecesPerCase, imageUrl, aeName, aeEmail, company }) {
    const cleanBarcode = String(barcode || '').trim();
    if (!cleanBarcode) throw new Error('Barcode is required to update details.');

    const resolvedPcs = (pieces_per_case !== undefined ? pieces_per_case : piecesPerCase);
    let resolvedBrand = brandName ? brandName.trim() : null;
    if (resolvedPcs && Number(resolvedPcs) > 0) {
      resolvedBrand = resolvedBrand ? `${resolvedBrand} [Pcs/Cs:${resolvedPcs}]` : `[Pcs/Cs:${resolvedPcs}]`;
    }

    const updates = {
      code: code ? code.trim() : null,
      name: name ? name.trim() : 'Unknown Item',
      supplier_name: supplierName ? supplierName.trim() : 'Pending Assignment',
      price: Number(price || 0),
      price_with_vat: Number(priceWithVat || price || 0),
      brand_name: resolvedBrand,
      unit_name: unitName ? unitName.trim() : 'pc',
      image_url: imageUrl ? imageUrl.trim() : null,
      ae_name: aeName ? aeName.trim() : null,
      ae_email: aeEmail ? aeEmail.trim() : null,
      company: company ? company.trim() : null,
      is_verified: true,
      updated_at: new Date().toISOString()
    };

    // 1. Upsert or update product catalog
    try {
      const { error: prodErr } = await supabase
        .from('products')
        .upsert({
          barcode: cleanBarcode,
          ...updates
        }, { onConflict: 'barcode' });

      if (prodErr) {
        // Fallback to update if upsert had a constraint mismatch
        await supabase
          .from('products')
          .update(updates)
          .eq('barcode', cleanBarcode);
      }
    } catch (err) {
      console.warn('Product catalog update notice:', err.message);
    }

    // 2. Fetch all pending reports matching this barcode so we can dispatch the official RMA notification email
    let pendingReportsToNotify = [];
    try {
      const { data: matchedReports } = await supabase
        .from('rma_reports')
        .select('*')
        .eq('barcode', cleanBarcode)
        .or('status.eq.pending_admin_details,name.ilike.%unidentified%');
      if (matchedReports && matchedReports.length > 0) {
        pendingReportsToNotify = matchedReports;
      }
    } catch (e) {
      console.warn('Notice querying pending rma_reports:', e.message);
    }

    // 3. Update all pending RMA reports that referenced this barcode
    try {
      await supabase
        .from('rma_reports')
        .update({
          code: updates.code,
          name: updates.name,
          supplier_name: updates.supplier_name,
          price: updates.price,
          price_with_vat: updates.price_with_vat,
          unit_name: updates.unit_name,
          ae_name: updates.ae_name,
          ae_email: updates.ae_email,
          company: updates.company,
          status: 'pending'
        })
        .eq('barcode', cleanBarcode)
        .eq('status', 'pending_admin_details');
    } catch (e) {
      console.warn('Failed to backfill rma_reports:', e.message);
    }

    this.notifyChange('barcode-verified', { barcode: cleanBarcode, updates });

    // 4. Automated RMA Alert dispatch: alert AE & configured TO/CC recipients for the newly verified RMA report(s)
    if (pendingReportsToNotify.length > 0) {
      try {
        const isTestActive = isSuperAdminTestModeActive();
        for (const rep of pendingReportsToNotify) {
          const enrichedReport = {
            ...rep,
            code: updates.code,
            name: updates.name,
            supplier_name: updates.supplier_name,
            price: updates.price,
            price_with_vat: updates.price_with_vat,
            unit_name: updates.unit_name,
            ae_name: updates.ae_name,
            ae_email: updates.ae_email,
            company: updates.company,
            status: 'pending'
          };
          notificationService.sendRMANotification(enrichedReport, isTestActive).catch(err => {
            console.warn('Background RMA report notification notice on SKU assignment:', err.message);
          });
        }
      } catch (e) {
        console.warn('Failed to dispatch RMA alert email on barcode verification:', e);
      }
    }

    return { success: true };
  },

  /**
   * Get all RMA reports (excluding deleted ones)
   */
  async getRecentReports(limit = 500) {
    try {
      const { data, error } = await supabase
        .from('rma_reports')
        .select('*')
        .not('status', 'eq', 'deleted')
        .order('created_at', { ascending: false })
        .limit(limit);

      if (error) {
        console.warn('Error fetching reports from Supabase:', error.message);
        return [];
      }
      return data || [];
    } catch (e) {
      console.warn('Error fetching reports:', e.message);
      return [];
    }
  },

  /**
   * Delete an RMA report (with robust hard-delete, soft-delete fallback, and proof photo/paperwork/Google Drive folder cleanup)
   */
  async deleteReport(id, rmaNumber, explicitItemOrPhotos = null) {
    if (!id && !rmaNumber) return false;
    try {
      let barcodeToCheck = null;
      let photosToDelete = [];
      let foldersToDelete = [];
      let folderUrlsToDelete = [];

      // 1. Process explicit item object or array of photos if passed
      if (explicitItemOrPhotos) {
        if (Array.isArray(explicitItemOrPhotos)) {
          photosToDelete.push(...explicitItemOrPhotos);
        } else if (typeof explicitItemOrPhotos === 'object') {
          if (explicitItemOrPhotos.barcode) barcodeToCheck = explicitItemOrPhotos.barcode;
          if (explicitItemOrPhotos.google_drive_folder_id) foldersToDelete.push(explicitItemOrPhotos.google_drive_folder_id);
          if (explicitItemOrPhotos.google_drive_folder_url) folderUrlsToDelete.push(explicitItemOrPhotos.google_drive_folder_url);

          [
            explicitItemOrPhotos.photos,
            explicitItemOrPhotos.paperwork_photos,
            explicitItemOrPhotos.proof_photos,
            explicitItemOrPhotos.photo_url
          ].forEach(cand => {
            if (!cand) return;
            if (Array.isArray(cand)) photosToDelete.push(...cand);
            else if (typeof cand === 'string') {
              try {
                const parsed = JSON.parse(cand);
                if (Array.isArray(parsed)) photosToDelete.push(...parsed);
                else photosToDelete.push(cand);
              } catch {
                photosToDelete.push(cand);
              }
            }
          });
        }
      }

      // 2. Query Supabase for full record before deletion to guarantee all assets (photos, paperwork, gdrive folders) are retrieved
      // Strictly guard ID against Postgres bigint syntax errors.
      // Synthetic or unpacked line-item IDs (e.g. "228_item_1414314") must NOT be passed to .eq('id', id)
      const isNumericId = id !== undefined && id !== null && /^\d+$/.test(String(id));

      try {
        let findQ = supabase
          .from('rma_reports')
          .select('id, rma_number, barcode, name, photos, paperwork_photos, google_drive_folder_id, google_drive_folder_url')
          .limit(1);
        if (isNumericId) findQ = findQ.eq('id', id);
        else findQ = findQ.eq('rma_number', rmaNumber);
        const { data: found } = await findQ;
        if (found && found.length > 0) {
          const foundItem = found[0];
          if (!rmaNumber) rmaNumber = foundItem.rma_number || explicitItemOrPhotos?.rma_number;
          if (!barcodeToCheck && foundItem.barcode) barcodeToCheck = foundItem.barcode;
          if (foundItem.google_drive_folder_id) foldersToDelete.push(foundItem.google_drive_folder_id);
          if (foundItem.google_drive_folder_url) folderUrlsToDelete.push(foundItem.google_drive_folder_url);

          [
            foundItem.photos,
            foundItem.paperwork_photos,
            foundItem.proof_photos,
            foundItem.photo_url
          ].forEach(cand => {
            if (!cand) return;
            if (Array.isArray(cand)) photosToDelete.push(...cand);
            else if (typeof cand === 'string') {
              try {
                const parsed = JSON.parse(cand);
                if (Array.isArray(parsed)) photosToDelete.push(...parsed);
                else photosToDelete.push(cand);
              } catch {
                photosToDelete.push(cand);
              }
            }
          });
        }
      } catch (e) {
        console.warn('[Fetch Report Before Delete Notice]:', e.message);
      }

      // Critical Split Protection: If this report has split children referencing its id as parent_rma_id,
      // unlink them first so deleting this parent report NEVER cascades to delete the split children!
      if (isNumericId) {
        try {
          await supabase
            .from('rma_reports')
            .update({ parent_rma_id: null })
            .eq('parent_rma_id', id)
            .neq('rma_number', rmaNumber || '');
        } catch (unlinkErr) {
          console.warn('[Unlink Split Children Before Delete]:', unlinkErr.message);
        }
      }

      const deleteByExactRma = Boolean(rmaNumber && (!isNumericId || !explicitItemOrPhotos?.parent_rma_id));
      let query = supabase.from('rma_reports').delete();
      if (deleteByExactRma) {
        query = query.eq('rma_number', rmaNumber);
      } else if (isNumericId) {
        query = query.eq('id', id);
      } else {
        query = query.eq('rma_number', rmaNumber);
      }
      const { data, error } = await query.select();

      // If hard delete was blocked by missing RLS policy or affected 0 rows, fallback to soft delete
      if (error || !data || data.length === 0) {
        console.warn('Direct delete matched 0 rows or was blocked by RLS, executing status update fallback:', error?.message);
        let softQuery = supabase.from('rma_reports').update({
          status: 'deleted'
        });
        if (deleteByExactRma) softQuery = softQuery.eq('rma_number', rmaNumber);
        else if (isNumericId) softQuery = softQuery.eq('id', id);
        else softQuery = softQuery.eq('rma_number', rmaNumber);
        const { error: softErr } = await softQuery;
        if (softErr) {
          console.error('Soft delete error:', softErr);
          throw softErr;
        }
      }

      // Check if unverified product should be cleaned up
      if (barcodeToCheck) {
        try {
          const { data: otherReports } = await supabase
            .from('rma_reports')
            .select('id')
            .eq('barcode', barcodeToCheck)
            .not('status', 'eq', 'deleted');
          if (!otherReports || otherReports.length === 0) {
            // Delete orphan unverified product
            await supabase.from('products').delete().eq('barcode', barcodeToCheck).eq('is_verified', false);
          }
        } catch (e) {}
      }

      // Permanently delete associated proof photos, paperwork photos, and Google Drive folders
      const cleanPhotos = [...new Set(photosToDelete.filter(Boolean))];
      const cleanFolders = [...new Set(foldersToDelete.filter(Boolean))];
      const cleanFolderUrls = [...new Set(folderUrlsToDelete.filter(Boolean))];

      await this.deleteStoredImages(cleanPhotos, cleanFolders, cleanFolderUrls, { rmaNumber });

      this.notifyChange('report-deleted', { id, rmaNumber });
      return true;
    } catch (e) {
      console.error('Delete RMA report error:', e);
      throw e;
    }
  },

  /**
   * ADMIN ACTION: Permanently delete multiple RMA reports in bulk and cleanup photos & Google Drive folders
   */
  async deleteMultipleReports(reportsList) {
    if (!Array.isArray(reportsList) || reportsList.length === 0) return { success: true, count: 0 };
    
    const rawIds = reportsList.map(r => r.id).filter(id => id !== undefined && id !== null);
    // Strictly filter numeric IDs to prevent Postgres bigint errors on synthetic composite IDs
    const numericIds = rawIds.filter(id => /^\d+$/.test(String(id)));
    const rmaNumbers = reportsList.map(r => r.rma_number).filter(Boolean);

    // Extract all photos and folders across reports to delete from Google Drive / Supabase Storage
    const allPhotos = [];
    const allFolders = [];
    const allFolderUrls = [];

    const harvestReportAssets = (r) => {
      if (!r) return;
      if (r.google_drive_folder_id) allFolders.push(r.google_drive_folder_id);
      if (r.google_drive_folder_url) allFolderUrls.push(r.google_drive_folder_url);

      const candidates = [r.photos, r.paperwork_photos, r.proof_photos, r.photo_url, r.image_url, r.photo];
      candidates.forEach(cand => {
        if (!cand) return;
        if (Array.isArray(cand)) {
          allPhotos.push(...cand);
        } else if (typeof cand === 'string') {
          if (cand.startsWith('[') && cand.endsWith(']')) {
            try {
              const parsed = JSON.parse(cand);
              if (Array.isArray(parsed)) allPhotos.push(...parsed);
              else allPhotos.push(cand);
            } catch (e) {
              allPhotos.push(cand);
            }
          } else {
            allPhotos.push(cand);
          }
        }
      });
    };

    // First harvest from passed objects
    reportsList.forEach(harvestReportAssets);

    // Also query Supabase to ensure full paperwork_photos and google_drive_folder_id are harvested for all selected rows
    try {
      if (numericIds.length > 0) {
        const { data: dbRecords } = await supabase
          .from('rma_reports')
          .select('id, rma_number, barcode, name, photos, paperwork_photos, google_drive_folder_id, google_drive_folder_url')
          .in('id', numericIds);
        if (dbRecords && Array.isArray(dbRecords)) {
          dbRecords.forEach(harvestReportAssets);
        }
      }
    } catch (e) {
      console.warn('[Bulk Delete Fetch Notice]:', e.message);
    }

    try {
      let deleteError = null;
      if (numericIds.length > 0) {
        const { error } = await supabase.from('rma_reports').delete().in('id', numericIds);
        if (error) deleteError = error;
      }
      if (rmaNumbers.length > 0) {
        const { error } = await supabase.from('rma_reports').delete().in('rma_number', rmaNumbers);
        if (error && !deleteError) deleteError = error;
      }

      // Soft delete fallback if hard delete blocked by RLS
      if (deleteError) {
        console.warn('Hard delete blocked or failed, executing soft-delete fallback in bulk:', deleteError.message);
        if (numericIds.length > 0) {
          await supabase.from('rma_reports').update({ status: 'deleted' }).in('id', numericIds);
        }
        if (rmaNumbers.length > 0) {
          await supabase.from('rma_reports').update({ status: 'deleted' }).in('rma_number', rmaNumbers);
        }
      }

      // Delete all stored photos & Google Drive folders in parallel
      const cleanPhotos = [...new Set(allPhotos.filter(Boolean))];
      const cleanFolders = [...new Set(allFolders.filter(Boolean))];
      const cleanFolderUrls = [...new Set(allFolderUrls.filter(Boolean))];

      await this.deleteStoredImages(cleanPhotos, cleanFolders, cleanFolderUrls, { rmaNumbers });

      this.notifyChange('reports-bulk-deleted', { count: reportsList.length });
      return { success: true, count: reportsList.length };
    } catch (e) {
      console.error('Bulk delete RMA reports error:', e);
      throw e;
    }
  },

  /**
   * Get unique list of verified and recorded suppliers across catalog and returns
   */
  async getUniqueSuppliers() {
    const defaultSuppliers = [
      'Savemore',
      'Walter Mart',
      'SM Supermarket',
      'Puregold',
      'Robinsons Supermarket',
      'Mondelez',
      'Universal Robina Corporation (URC)',
      'Bonita',
      'Keysys',
      'A2Z2GO',
      'Pingcon Marketing'
    ];

    const supplierSet = new Set(defaultSuppliers);

    try {
      // 1. Fetch from Supabase products
      const { data: prodData } = await supabase
        .from('products')
        .select('supplier_name')
        .limit(200);

      if (prodData && Array.isArray(prodData)) {
        prodData.forEach(p => {
          if (p.supplier_name && p.supplier_name.trim() && p.supplier_name !== 'Pending Assignment') {
            supplierSet.add(p.supplier_name.trim());
          }
        });
      }

      // 2. Fetch from Supabase rma_reports
      const { data: reportData } = await supabase
        .from('rma_reports')
        .select('supplier_name')
        .limit(200);

      if (reportData && Array.isArray(reportData)) {
        reportData.forEach(r => {
          if (r.supplier_name && r.supplier_name.trim() && r.supplier_name !== 'Pending Assignment') {
            supplierSet.add(r.supplier_name.trim());
          }
        });
      }
    } catch (e) {
      console.warn('Notice loading unique suppliers:', e);
    }

    return Array.from(supplierSet).sort((a, b) => a.localeCompare(b));
  },

  /**
   * Shared lifecycle mutator for Trash / Archive / Restore.
   * Cascades atomically to manifest sibling rows sharing the exact same non-split rma_number
   * while leaving split children (e.g. -B, -C with distinct rma_number) untouched.
   */
  async _updateReportLifecycleState(id, rmaNumber, { buildMeta, auditAction, auditStage, auditNotes, eventName }) {
    return enqueueLifecycleOp(async () => {
      if (!id && !rmaNumber) return false;
      const cleanId = id && /^\d+$/.test(String(id)) ? parseInt(id, 10) : null;

      let seedRows = [];
      if (cleanId) {
        const { data } = await supabase
          .from('rma_reports')
          .select('id, rma_number, parent_rma_id, ai_document_metadata, audit_trail')
          .eq('id', cleanId)
          .limit(1);
        if (Array.isArray(data)) seedRows = data;
      }

      const resolvedRma = rmaNumber || seedRows[0]?.rma_number || null;
      const isManifestChildOnly = Boolean(seedRows[0]?.parent_rma_id && seedRows[0]?.rma_number === resolvedRma);
      let targetRows = seedRows;
      if (resolvedRma && !isManifestChildOnly) {
        const { data: siblingRows } = await supabase
          .from('rma_reports')
          .select('id, rma_number, parent_rma_id, ai_document_metadata, audit_trail')
          .eq('rma_number', resolvedRma)
          .limit(25);
        if (Array.isArray(siblingRows) && siblingRows.length > 0) {
          targetRows = siblingRows;
        }
      }

      const now = new Date();
      const nowIso = now.toISOString();
      const auditEntry = {
        timestamp: nowIso,
        action: auditAction,
        stage: auditStage,
        actor: auditNotes?.actor || 'Staff',
        notes: typeof auditNotes === 'string' ? auditNotes : auditNotes?.text || ''
      };

      for (const row of targetRows) {
        const updatedMeta = buildMeta(row.ai_document_metadata || {}, now, nowIso);
        const existingAudit = Array.isArray(row.audit_trail) ? row.audit_trail : [];
        const { error } = await supabase
          .from('rma_reports')
          .update({
            ai_document_metadata: updatedMeta,
            audit_trail: [...existingAudit, auditEntry]
          })
          .eq('id', row.id);
        if (error) throw error;
      }

      if (targetRows.length === 0 && resolvedRma) {
        const { error } = await supabase
          .from('rma_reports')
          .update({
            ai_document_metadata: buildMeta({}, now, nowIso),
            audit_trail: [auditEntry]
          })
          .eq('rma_number', resolvedRma);
        if (error) throw error;
      }

      this.notifyChange(eventName, { id: cleanId || targetRows[0]?.id, rmaNumber: resolvedRma });
      return true;
    });
  },

  /**
   * ENTERPRISE SOFT-DELETE: Move report to 30-Day Trash Bin (<100ms instant execution)
   */
  async moveReportToTrash(id, rmaNumber, actorName = 'Staff') {
    try {
      let scheduledPurge = '';
      return await this._updateReportLifecycleState(id, rmaNumber, {
        buildMeta: (existingMeta, now, nowIso) => {
          const purgeAfter = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
          scheduledPurge = purgeAfter;
          return {
            ...existingMeta,
            is_trashed: true,
            is_archived: false,
            trashed_at: nowIso,
            trashed_by: actorName,
            purge_after: purgeAfter
          };
        },
        auditAction: 'MOVED_TO_TRASH',
        auditStage: 'TRASH_BIN',
        auditNotes: {
          actor: actorName,
          text: `Moved to 30-day Trash Bin by ${actorName}. Auto-purge scheduled (${scheduledPurge || '30 days'})`
        },
        eventName: 'report-trashed'
      });
    } catch (e) {
      console.error('moveReportToTrash error:', e);
      throw e;
    }
  },

  /**
   * ENTERPRISE ARCHIVE: Store report in Archive Vault indefinitely
   */
  async archiveReport(id, rmaNumber, actorName = 'Staff') {
    try {
      return await this._updateReportLifecycleState(id, rmaNumber, {
        buildMeta: (existingMeta, _now, nowIso) => ({
          ...existingMeta,
          is_archived: true,
          is_trashed: false,
          archived_at: nowIso,
          archived_by: actorName
        }),
        auditAction: 'ARCHIVED',
        auditStage: 'ARCHIVE_VAULT',
        auditNotes: { actor: actorName, text: `Archived into Enterprise Vault by ${actorName}` },
        eventName: 'report-archived'
      });
    } catch (e) {
      console.error('archiveReport error:', e);
      throw e;
    }
  },

  /**
   * RESTORE REPORT: Return record from Trash or Archive back to active hub
   */
  async restoreReport(id, rmaNumber, actorName = 'Staff') {
    try {
      return await this._updateReportLifecycleState(id, rmaNumber, {
        buildMeta: (existingMeta) => {
          const updatedMeta = { ...existingMeta };
          delete updatedMeta.is_trashed;
          delete updatedMeta.trashed_at;
          delete updatedMeta.trashed_by;
          delete updatedMeta.purge_after;
          delete updatedMeta.is_archived;
          delete updatedMeta.archived_at;
          delete updatedMeta.archived_by;
          return updatedMeta;
        },
        auditAction: 'RESTORED',
        auditStage: 'ACTIVE_HUB',
        auditNotes: { actor: actorName, text: `Restored back to active hub by ${actorName}` },
        eventName: 'report-restored'
      });
    } catch (e) {
      console.error('restoreReport error:', e);
      throw e;
    }
  },

  /**
   * PERMANENT HARD-DELETE: Clean up from database and delete storage photos
   */
  async permanentlyDeleteReport(id, rmaNumber, item = null) {
    return enqueueLifecycleOp(() => this.deleteReport(id, rmaNumber, item));
  },

  /**
   * BULK MOVE TO TRASH
   */
  async moveMultipleReportsToTrash(reportsList, actorName = 'Staff') {
    if (!Array.isArray(reportsList) || reportsList.length === 0) return true;
    for (const r of reportsList) {
      try {
        await this.moveReportToTrash(r.id, r.rma_number, actorName);
      } catch (e) {
        console.warn(`Failed moving report ${r.rma_number} to trash:`, e);
      }
    }
    this.notifyChange('reports-bulk-trashed', { count: reportsList.length });
    return true;
  },

  /**
   * BULK ARCHIVE
   */
  async archiveMultipleReports(reportsList, actorName = 'Staff') {
    if (!Array.isArray(reportsList) || reportsList.length === 0) return true;
    for (const r of reportsList) {
      try {
        await this.archiveReport(r.id, r.rma_number, actorName);
      } catch (e) {
        console.warn(`Failed archiving report ${r.rma_number}:`, e);
      }
    }
    this.notifyChange('reports-bulk-archived', { count: reportsList.length });
    return true;
  },

  /**
   * AUTO-PURGE EXPIRED TRASH: Automatically hard-delete any trashed items past 30 days
   */
  async autoPurgeExpiredTrash(reportsList) {
    if (!Array.isArray(reportsList) || reportsList.length === 0) return;
    const expired = reportsList.filter(r => isTrashedRecord(r) && getTrashDaysRemaining(r) <= 0);
    if (expired.length === 0) return;

    console.info(`[Auto-Purge]: Found ${expired.length} expired trashed items past 30 days. Purging...`);
    for (const r of expired) {
      try {
        await this.permanentlyDeleteReport(r.id, r.rma_number, r);
      } catch (err) {
        console.warn(`[Auto-Purge Notice]: Failed to purge ${r.rma_number}:`, err);
      }
    }
  },

  async _resolveLatestRmaParentRow(report) {
    const cleanId = (report?.id && /^\d+$/.test(String(report.id))) ? Number(report.id) : null;
    const rmaNumber = report?.rma_number || report?.rmaNumber || null;
    if (!cleanId && !rmaNumber) {
      throw new Error('Missing RMA identifier to update.');
    }

    const fetchLatestParentRow = async () => {
      if (cleanId) {
        const { data } = await supabase.from('rma_reports').select('*').eq('id', cleanId).limit(1);
        if (Array.isArray(data) && data.length > 0) return data[0];
      }
      if (rmaNumber) {
        const { data } = await supabase
          .from('rma_reports')
          .select('*')
          .eq('rma_number', rmaNumber)
          .order('is_parent', { ascending: false })
          .order('id', { ascending: true })
          .limit(10);
        if (Array.isArray(data) && data.length > 0) {
          return (
            data.find((r) => !isTrashedRecord(r) && r.parent_rma_id == null && r.is_parent) ||
            data.find((r) => !isTrashedRecord(r) && r.parent_rma_id == null) ||
            data.find((r) => !isTrashedRecord(r)) ||
            data[0]
          );
        }
      }
      return null;
    };

    let existing = await fetchLatestParentRow();
    if (!existing && rmaNumber) {
      for (let attempt = 0; attempt < 6; attempt += 1) {
        await new Promise((r) => setTimeout(r, 450));
        existing = await fetchLatestParentRow();
        if (existing) break;
      }
    }
    if (!existing) {
      existing = report;
    }

    const resolvedId = (existing?.id && /^\d+$/.test(String(existing.id))) ? Number(existing.id) : cleanId;
    if (!resolvedId) {
      throw new Error(`RMA "${rmaNumber || ''}" is still syncing to the database. Please try again in a moment.`);
    }

    return { existing, resolvedId, rmaNumber };
  },

  /**
   * Saves Simple 4-Option Supplier RTV Choice & Pickup Verification Metadata
   * Handles supplier name assignment, disposition/status/bin auto-sync,
   * Drive folder sync, and automatic 'picked_up' tagging when A4 handover form is finalized.
   */
  async saveSimpleSupplierRtvDisposition(report, payload = {}) {
    const { existing, resolvedId, rmaNumber } = await this._resolveLatestRmaParentRow(report);

    const existingMeta = (existing?.ai_document_metadata && typeof existing.ai_document_metadata === 'object')
      ? { ...existing.ai_document_metadata }
      : {};
    const recordIsTest = Boolean(isTestRecord(existing) || isTestRecord(report));
    const nowIso = new Date().toISOString();

    const updatedMeta = {
      ...existingMeta,
      ...(payload.metadataPatch || {}),
      ...(recordIsTest ? { is_test: true, test_mode: true } : {})
    };
    if (payload.clearWorkflowResolution) {
      delete updatedMeta.workflow_resolution;
      delete updatedMeta.resolved_at;
      delete updatedMeta.resolved_by;
    }

    const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
      ? { ...existingMeta.follow_up }
      : {};
    const isPickupRecorded = payload.status === 'picked_up' || Boolean(payload.metadataPatch?.supplier_pickup?.picked_up_at);
    const effectiveSup = payload.supplier_name || existing?.supplier_name;

    if (isPickupRecorded) {
      updatedMeta.follow_up = {
        ...prevFollowUp,
        enabled: false,
        picked_up_at: payload.metadataPatch?.supplier_pickup?.picked_up_at || prevFollowUp.picked_up_at || nowIso,
        case_closed_at: prevFollowUp.case_closed_at || nowIso,
        case_status: 'picked_up_closed'
      };
    } else if (prevFollowUp.manually_disabled !== true && prevFollowUp.enabled !== false) {
      updatedMeta.follow_up = {
        ...prevFollowUp,
        enabled: true,
        started_at: prevFollowUp.started_at || nowIso
      };
    }

    let baseNotes = String(existing?.notes || '').replace(/\s*\[REORDER:[^\]]*\]/gi, '').trim();
    const preservedNotes = recordIsTest
      ? (baseNotes.includes('[TEST_MODE]')
          ? baseNotes
          : `${baseNotes ? `${baseNotes} ` : ''}[TEST_MODE] Sandbox Return`)
      : baseNotes;

    const updates = {
      disposition: payload.disposition ?? existing?.disposition,
      status: payload.status ?? existing?.status,
      warehouse_location: payload.warehouse_location ?? existing?.warehouse_location,
      inspected_by: payload.inspected_by || payload.actorName || existing?.inspected_by || 'Staff',
      inspected_at: nowIso,
      ai_document_metadata: updatedMeta,
      ...(preservedNotes !== undefined ? { notes: preservedNotes } : {})
    };

    if (payload.supplier_name && String(payload.supplier_name).trim()) {
      updates.supplier_name = String(payload.supplier_name).trim();
      if (updatedMeta.supplier_pickup && typeof updatedMeta.supplier_pickup === 'object') {
        updatedMeta.supplier_pickup = {
          ...updatedMeta.supplier_pickup,
          supplier_name: updates.supplier_name
        };
      }
    }
    if (payload.google_drive_folder_url) {
      updates.google_drive_folder_url = payload.google_drive_folder_url;
    }
    if (payload.google_drive_folder_id) {
      updates.google_drive_folder_id = payload.google_drive_folder_id;
    }

    // Append any newly uploaded pickup photos cleanly onto the report's photos array too
    if (Array.isArray(payload.appendPhotoUrls) && payload.appendPhotoUrls.length > 0) {
      const prevPhotos = Array.isArray(existing?.photos) ? existing.photos : [];
      updates.photos = [...new Set([...prevPhotos, ...payload.appendPhotoUrls.filter(Boolean)])];
    }

    const existingItemsArr = Array.isArray(existing?.items) ? existing.items : [];
    const existingItemSups = extractDistinctSuppliersFromItems(existingItemsArr);
    const hasMixedItemSuppliers = existingItemSups.length > 1;
    const allowCascadeSupplier = Boolean(updates.supplier_name) && (!hasMixedItemSuppliers || Boolean(payload.unifyMixedSuppliers));

    // Update manifest item array if batch manifest (never clobbering mixed suppliers unless explicitly unifying)
    if (existingItemsArr.length > 0) {
      updates.items = existingItemsArr.map(it => {
        const itemHasRealSup = !this._isPlaceholderSupplier(it?.supplier_name) && !isMixedSuppliersSummary(it?.supplier_name);
        const shouldSetSup = Boolean(updates.supplier_name) && !isMixedSuppliersSummary(updates.supplier_name) && (allowCascadeSupplier || !itemHasRealSup);
        return {
          ...it,
          ...(shouldSetSup ? { supplier_name: updates.supplier_name, supplier: updates.supplier_name } : {}),
          ...(payload.disposition ? { disposition: payload.disposition } : {}),
          ...(payload.status ? { status: payload.status } : {})
        };
      });
      if (hasMixedItemSuppliers && !payload.unifyMixedSuppliers) {
        updates.supplier_name = summarizeBatchSuppliers(updates.items, existing?.supplier_name);
      }
    }

    const existingAudit = Array.isArray(existing?.audit_trail) ? existing.audit_trail : [];
    updates.audit_trail = [
      ...existingAudit,
      {
        timestamp: nowIso,
        action: payload.auditAction || 'SUPPLIER_RTV_WORKFLOW_UPDATE',
        stage: String(updates.status || 'UNDER_INSPECTION').toUpperCase(),
        actor: payload.actorName || 'Staff',
        note: payload.auditNote || `Updated disposition to ${updates.disposition}`
      }
    ];

    let { data: savedRows, error: updateErr } = await supabase
      .from('rma_reports')
      .update(updates)
      .eq('id', resolvedId)
      .select();

    if (updateErr) {
      const fallback = { ...updates };
      const colMatch = updateErr.message.match(/Could not find the '([^']+)' column/i) ||
        updateErr.message.match(/column rma_reports\.([a-zA-Z0-9_]+) does not exist/i);
      if (colMatch && colMatch[1]) {
        delete fallback[colMatch[1]];
      }
      if (String(updateErr.message || '').includes('rma_reports_status_check')) {
        fallback.status = 'under_inspection';
      }
      delete fallback.google_drive_folder_id;
      const { data: retryRows, error: retryErr } = await supabase
        .from('rma_reports')
        .update(fallback)
        .eq('id', resolvedId)
        .select();
      if (retryErr) throw retryErr;
      savedRows = retryRows;
    }

    const savedRow = Array.isArray(savedRows) && savedRows.length > 0 ? savedRows[0] : null;

    try {
      const supForDir = updates.supplier_name || existing?.supplier_name;
      const toForDir = updatedMeta?.supplier_pickup?.supplier_email_to;
      const ccForDir = updatedMeta?.supplier_pickup?.supplier_email_cc;
      if (supForDir && (toForDir || ccForDir)) {
        supplierDirectoryService.upsertFromSubmission({
          supplier_name: supForDir,
          supplier_email_to: toForDir,
          supplier_email_cc: ccForDir
        }).catch(() => {});
      }
    } catch {}

    // Sync child rows only if this record is a multi-item parent manifest
    if (resolvedId && (existing?.is_parent === true || existingItemsArr.length > 0)) {
      try {
        await supabase.from('rma_reports').update({
          ...(allowCascadeSupplier && !isMixedSuppliersSummary(updates.supplier_name) ? { supplier_name: updates.supplier_name } : {}),
          disposition: updates.disposition,
          status: savedRow?.status || updates.status,
          warehouse_location: updates.warehouse_location
        }).eq('parent_rma_id', resolvedId);
      } catch {}
    }

    this.notifyChange('triage-updated', { id: resolvedId, rmaNumber, status: savedRow?.status || updates.status });
    return savedRow || { ...existing, ...updates, id: resolvedId };
  },

  /**
   * Persist Supplier Name, Email (TO/CC), and 10-Calendar-Day Auto Follow-Up toggle for any RMA.
   */
  async saveSupplierAndFollowUpSettings(report, payload = {}) {
    const { existing, resolvedId, rmaNumber } = await this._resolveLatestRmaParentRow(report);
    const existingMeta = (existing?.ai_document_metadata && typeof existing.ai_document_metadata === 'object')
      ? { ...existing.ai_document_metadata }
      : {};
    const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
      ? { ...existingMeta.follow_up }
      : {};
    const prevPickup = (existingMeta.supplier_pickup && typeof existingMeta.supplier_pickup === 'object')
      ? { ...existingMeta.supplier_pickup }
      : {};
    const recordIsTest = Boolean(isTestRecord(existing) || isTestRecord(report));
    const nowIso = new Date().toISOString();

    const cleanSupplier = String(payload.supplier_name || '').trim();
    const toEmailStr = String(payload.supplier_email_to ?? prevFollowUp.supplier_email_to ?? '').trim();
    const ccEmailStr = String(payload.supplier_email_cc ?? prevFollowUp.supplier_email_cc ?? '').trim();
    const followUpEnabled = payload.followUpEnabled !== undefined
      ? Boolean(payload.followUpEnabled)
      : (prevFollowUp.enabled ?? true);

    const nextFollowUp = {
      ...prevFollowUp,
      supplier_email_to: toEmailStr,
      supplier_email_cc: ccEmailStr,
      enabled: followUpEnabled,
      manually_disabled: !followUpEnabled,
      updated_at: nowIso
    };
    if (followUpEnabled && (!nextFollowUp.started_at || payload.resetTimer)) {
      nextFollowUp.started_at = nowIso;
    }
    if (payload.reopenCase) {
      delete nextFollowUp.case_closed_at;
      delete nextFollowUp.case_status;
      delete nextFollowUp.auto_disposed_at;
      delete nextFollowUp.close_reason;
    }

    const updatedMeta = {
      ...existingMeta,
      ...(recordIsTest ? { is_test: true, test_mode: true } : {}),
      supplier_pickup: {
        ...prevPickup,
        ...(cleanSupplier ? { supplier_name: cleanSupplier } : {}),
        supplier_email_to: toEmailStr,
        supplier_email_cc: ccEmailStr
      },
      follow_up: nextFollowUp
    };

    const existingAudit = Array.isArray(existing?.audit_trail) ? existing.audit_trail : [];
    const updates = {
      ...(cleanSupplier ? { supplier_name: cleanSupplier } : {}),
      ai_document_metadata: updatedMeta,
      audit_trail: [
        ...existingAudit,
        {
          timestamp: nowIso,
          action: 'SUPPLIER_FOLLOWUP_CONFIG_UPDATED',
          stage: String(existing?.status || 'FOLLOW_UP').toUpperCase(),
          actor: payload.actorName || 'Admin',
          note: `Supplier: ${cleanSupplier || existing?.supplier_name || 'Pending'} | Email TO: ${toEmailStr || 'None'} | Auto Follow-Up: ${followUpEnabled ? 'ON (10-Day SLA)' : 'OFF'}`
        }
      ]
    };

    const existingItemsArr = Array.isArray(existing?.items) ? existing.items : [];
    const hasMixedFollowUpSups = extractDistinctSuppliersFromItems(existingItemsArr).length > 1;
    const allowCascadeFollowUpSup = Boolean(cleanSupplier) && (!hasMixedFollowUpSups || Boolean(payload.unifyMixedSuppliers));

    if (cleanSupplier && existingItemsArr.length > 0) {
      updates.items = existingItemsArr.map((it) => {
        const itemHasRealSup = !this._isPlaceholderSupplier(it?.supplier_name) && !isMixedSuppliersSummary(it?.supplier_name);
        if (!allowCascadeFollowUpSup && itemHasRealSup) return it;
        return {
          ...it,
          supplier_name: cleanSupplier,
          supplier: cleanSupplier
        };
      });
      if (hasMixedFollowUpSups && !payload.unifyMixedSuppliers) {
        updates.supplier_name = summarizeBatchSuppliers(updates.items, cleanSupplier);
      }
    }

    let { data: savedRows, error: updateErr } = await supabase
      .from('rma_reports')
      .update(updates)
      .eq('id', resolvedId)
      .select();

    if (updateErr) {
      const fallback = { ...updates };
      if (String(updateErr.message || '').includes('updated_at')) delete fallback.updated_at;
      const retry = await supabase.from('rma_reports').update(fallback).eq('id', resolvedId).select();
      if (retry.error) throw retry.error;
      savedRows = retry.data;
    }

    if (allowCascadeFollowUpSup && !isMixedSuppliersSummary(cleanSupplier)) {
      try {
        await supabase.from('rma_reports').update({ supplier_name: cleanSupplier }).eq('parent_rma_id', resolvedId);
      } catch {}
    }

    const savedRow = Array.isArray(savedRows) && savedRows.length > 0 ? savedRows[0] : null;
    try {
      const supForDir = cleanSupplier || existing?.supplier_name;
      if (supForDir && (toEmailStr || ccEmailStr)) {
        supplierDirectoryService.upsertFromSubmission({
          supplier_name: supForDir,
          supplier_email_to: toEmailStr,
          supplier_email_cc: ccEmailStr
        }).catch(() => {});
      }
    } catch {}
    this.notifyChange('triage-updated', { id: resolvedId, rmaNumber, status: savedRow?.status || existing?.status });
    return savedRow || { ...existing, ...updates, id: resolvedId };
  },

  /**
   * Explicitly close the 4-Step Follow-Up workflow (Picked Up / Handover Completed or Manual Case Close)
   */
  async closeFollowUpCase(report, { reason = 'Picked Up — Case Closed', markPickedUp = true, actorName = 'Admin' } = {}) {
    const { existing, resolvedId, rmaNumber } = await this._resolveLatestRmaParentRow(report);
    const existingMeta = (existing?.ai_document_metadata && typeof existing.ai_document_metadata === 'object')
      ? { ...existing.ai_document_metadata }
      : {};
    const prevFollowUp = (existingMeta.follow_up && typeof existingMeta.follow_up === 'object')
      ? { ...existingMeta.follow_up }
      : {};
    const prevPickup = (existingMeta.supplier_pickup && typeof existingMeta.supplier_pickup === 'object')
      ? { ...existingMeta.supplier_pickup }
      : {};
    const recordIsTest = Boolean(isTestRecord(existing) || isTestRecord(report));
    const nowIso = new Date().toISOString();

    const pickedUpTimestamp = markPickedUp ? (prevPickup.picked_up_at || prevFollowUp.picked_up_at || nowIso) : prevFollowUp.picked_up_at;
    const updatedMeta = {
      ...existingMeta,
      ...(recordIsTest ? { is_test: true, test_mode: true } : {}),
      ...(markPickedUp ? {
        supplier_pickup: {
          ...prevPickup,
          picked_up_at: pickedUpTimestamp
        }
      } : {}),
      follow_up: {
        ...prevFollowUp,
        enabled: false,
        ...(pickedUpTimestamp ? { picked_up_at: pickedUpTimestamp } : {}),
        case_closed_at: nowIso,
        case_status: markPickedUp ? 'picked_up_closed' : 'manual_closed',
        close_reason: reason,
        closed_by: actorName
      }
    };

    const nextStatus = markPickedUp && existing?.rma_type === 'supplier_outbound' ? 'picked_up' : 'resolved';
    const existingAudit = Array.isArray(existing?.audit_trail) ? existing.audit_trail : [];
    const updates = {
      status: nextStatus,
      ai_document_metadata: updatedMeta,
      audit_trail: [
        ...existingAudit,
        {
          timestamp: nowIso,
          action: 'FOLLOWUP_CASE_CLOSED',
          stage: String(nextStatus).toUpperCase(),
          actor: actorName,
          note: reason
        }
      ]
    };

    let { data: savedRows, error: updateErr } = await supabase
      .from('rma_reports')
      .update(updates)
      .eq('id', resolvedId)
      .select();

    if (updateErr) {
      const fallback = { ...updates };
      if (String(updateErr.message || '').includes('rma_reports_status_check')) {
        fallback.status = 'resolved';
      }
      if (String(updateErr.message || '').includes('updated_at')) delete fallback.updated_at;
      const retry = await supabase.from('rma_reports').update(fallback).eq('id', resolvedId).select();
      if (retry.error) {
        if (String(retry.error.message || '').includes('rma_reports_status_check')) {
          fallback.status = 'under_inspection';
          const retry2 = await supabase.from('rma_reports').update(fallback).eq('id', resolvedId).select();
          if (retry2.error) throw retry2.error;
          savedRows = retry2.data;
        } else {
          throw retry.error;
        }
      } else {
        savedRows = retry.data;
      }
    }

    try {
      await supabase.from('rma_reports').update({ status: savedRows?.[0]?.status || nextStatus }).eq('parent_rma_id', resolvedId);
    } catch {}

    const savedRow = Array.isArray(savedRows) && savedRows.length > 0 ? savedRows[0] : null;
    this.notifyChange('triage-updated', { id: resolvedId, rmaNumber, status: savedRow?.status || nextStatus });
    return savedRow || { ...existing, ...updates, id: resolvedId };
  }
};


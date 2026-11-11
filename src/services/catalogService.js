import { supabase } from '../supabaseClient';
import { INITIAL_PRODUCTS } from '../data/mockData';
import { notificationService } from './notificationService';
import { purchaseOrdersApi } from './purchaseOrdersApi';
import { authService } from './authService';

/**
 * Safe test mode resolution:
 * Strictly restricted to Super Admin.
 * Anonymous reporters, store workers, and non-super-admins are ALWAYS Live.
 */
function isSuperAdminTestModeActive() {
  if (typeof window === 'undefined') return false;
  try {
    const user = authService.getCurrentUser();
    if (user?.role !== 'super_admin') {
      try {
        localStorage.setItem('rma_portal_test_mode', 'false');
      } catch (e) {}
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
    const cleanList = Array.isArray(imageUrls)
      ? imageUrls.map(u => (typeof u === 'object' && u) ? (u.url || u.previewUrl || u.fileUrl || u.id) : u).filter(u => u && typeof u === 'string')
      : [];
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

  async findProduct(barcodeOrQuery) {
    const clean = String(barcodeOrQuery || '').trim();
    if (!clean) return null;

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
          const rawBrand = p.brandName || p.brand_name || '';
          const pcsMatch = rawBrand.match(/\[Pcs\/Cs:(\d+)\]/);
          const cleanBrand = rawBrand.replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim() || null;
          const parsedPcs = p.pieces_per_case || p.piecesPerCase || (pcsMatch ? parseInt(pcsMatch[1], 10) : null);
          const matchedProd = {
            id: p.id,
            barcode: p.barcode || clean,
            code: (p.code && p.code !== (p.barcode || clean)) ? p.code : (p.sku && p.sku !== (p.barcode || clean) ? p.sku : null),
            name: p.name,
            price: Number(p.price || 0),
            priceWithVat: Number(p.priceWithVat || p.price_with_vat || p.price || 0),
            supplierName: p.supplierName || p.supplier_name || 'Pending Assignment',
            brandName: cleanBrand,
            unitName: p.unitName || p.unit_name || 'pc',
            pieces_per_case: parsedPcs,
            piecesPerCase: parsedPcs,
            hasSerialNumbers: Boolean(p.hasSerialNumbers || p.has_serial_numbers),
            imageUrl: p.imageUrl || p.image_url || null,
            ae_name: p.ae_name || null,
            ae_email: p.ae_email || null,
            company: p.company || null,
            isVerified: p.isVerified !== false && p.is_verified !== false,
            source: json.source === 'database' ? 'Supabase Database (Yours)' : (json.source === 'erply_api' ? 'ERPLY POS/ERP Catalog (Live API)' : 'Wholesale Master Catalog')
          };
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
        // Cache into Supabase products table asynchronously so subsequent searches are instant
        try {
          const liveSku = (liveProduct.code && liveProduct.code !== clean) ? liveProduct.code : (liveProduct.sku && liveProduct.sku !== clean ? liveProduct.sku : null);
          supabase.from('products').upsert([{
            barcode: liveProduct.barcode || clean,
            code: liveSku,
            name: liveProduct.name,
            supplier_name: liveProduct.supplier || liveProduct.supplier_name || 'Pending Assignment',
            price: Number(liveProduct.price || liveProduct.unit_price || 0),
            price_with_vat: Number(liveProduct.price_with_vat || liveProduct.priceWithVat || 0),
            brand_name: liveProduct.brand || liveProduct.brand_name || null,
            unit_name: liveProduct.unit_name || 'pc',
            is_verified: true,
            updated_at: new Date().toISOString()
          }], { onConflict: 'barcode' }).then(() => {}).catch(() => {});
        } catch (cErr) {}

        return {
          id: liveProduct.id,
          barcode: liveProduct.barcode || clean,
          code: (liveProduct.code && liveProduct.code !== clean) ? liveProduct.code : (liveProduct.sku && liveProduct.sku !== clean ? liveProduct.sku : null),
          name: liveProduct.name,
          price: Number(liveProduct.price || liveProduct.unit_price || 0),
          priceWithVat: Number(liveProduct.price_with_vat || liveProduct.priceWithVat || 0),
          supplierName: liveProduct.supplier || liveProduct.supplier_name || 'Pending Assignment',
          brandName: liveProduct.brand || liveProduct.brand_name || null,
          unitName: liveProduct.unit_name || 'pc',
          hasSerialNumbers: Boolean(liveProduct.requires_serial || liveProduct.has_serial_numbers),
          imageUrl: liveProduct.image_url || null,
          ae_name: liveProduct.ae_name || null,
          ae_email: liveProduct.ae_email || null,
          company: liveProduct.company || null,
          isVerified: true,
          source: 'ERPLY POS/ERP Catalog (Live API)'
        };
      }
    } catch (poErr) {
      console.warn('purchaseOrdersApi lookup fallback notice:', poErr?.message || poErr);
    }

    // 2. Direct Supabase Fallback (if serverless API endpoint was offline or in local client dev)
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
        const rawBrand = supaItem.brand_name || '';
        const pcsMatch = rawBrand.match(/\[Pcs\/Cs:(\d+)\]/);
        const cleanBrand = rawBrand.replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim() || null;
        const parsedPcs = supaItem.pieces_per_case || (pcsMatch ? parseInt(pcsMatch[1], 10) : null);
        return {
          id: supaItem.id,
          barcode: supaItem.barcode,
          code: (supaItem.code && supaItem.code !== supaItem.barcode) ? supaItem.code : (supaItem.sku && supaItem.sku !== supaItem.barcode ? supaItem.sku : null),
          name: supaItem.name,
          price: Number(supaItem.price || 0),
          priceWithVat: Number(supaItem.price_with_vat || supaItem.price || 0),
          supplierName: supaItem.supplier_name || 'Pending Assignment',
          brandName: cleanBrand,
          unitName: supaItem.unit_name || 'pc',
          pieces_per_case: parsedPcs,
          piecesPerCase: parsedPcs,
          hasSerialNumbers: supaItem.has_serial_numbers || false,
          imageUrl: supaItem.image_url || null,
          ae_name: supaItem.ae_name || null,
          ae_email: supaItem.ae_email || null,
          company: supaItem.company || null,
          isVerified: supaItem.is_verified !== false,
          source: 'Supabase Database (Yours)'
        };
      }
    } catch (e) {
      console.warn('Supabase lookup exception:', e.message);
    }

    // 3. Wholesale Verified Catalog Fallback (Group 1 & 2 Products)
    const mockItem = INITIAL_PRODUCTS.find(p => 
      p.barcode === clean || 
      (p.sku && p.sku.toLowerCase() === clean.toLowerCase())
    );
    if (mockItem) {
      const isBonitaOrPingcon = (
        (mockItem.brand && mockItem.brand.toLowerCase().includes('bonita')) ||
        (mockItem.group && mockItem.group.toLowerCase().includes('pingcon'))
      );
      return {
        id: mockItem.id,
        barcode: mockItem.barcode,
        code: (mockItem.sku && mockItem.sku !== mockItem.barcode) ? mockItem.sku : null,
        sku: (mockItem.sku && mockItem.sku !== mockItem.barcode) ? mockItem.sku : null,
        name: mockItem.name,
        price: Number(mockItem.unit_price || 0),
        priceWithVat: Number(mockItem.unit_price || 0) * 1.12,
        supplierName: mockItem.supplier || 'Savemore',
        brandName: mockItem.brand || null,
        unitName: 'pc',
        hasSerialNumbers: mockItem.requires_serial || false,
        imageUrl: mockItem.image_url || null,
        ae_name: null,
        ae_email: null,
        company: isBonitaOrPingcon ? 'Pingcon / Bonita' : 'A2Z2GO / Keysys',
        isVerified: true,
        source: 'Wholesale Verified Catalog'
      };
    }

    return null;
  },

  /**
   * COMPREHENSIVE MULTI-PRODUCT SEARCH:
   * Searches BOTH:
   * 1. Secure Serverless Proxy Search (/api/v1/products/lookup?search=...)
   * 2. Supabase 'products' table (Priority 2 Fallback)
   * 3. Enterprise Wholesale Catalog (Priority 3 Fallback)
   * Returns ALL matching products up to limit.
   */
  async searchAllProducts(query, limit = 50) {
    const clean = String(query || '').trim();
    if (!clean) return [];

    const results = [];
    const seenKeys = new Set();
    const cleanLower = clean.toLowerCase();

    // 1. Secure Serverless Multi-Catalog Search (/api/v1/products/lookup?search=...)
    try {
      const res = await fetch(`/api/v1/products/lookup?search=${encodeURIComponent(clean)}&limit=${limit}`);
      if (res && res.ok) {
        const json = await res.json();
        if (json.success && Array.isArray(json.products)) {
          for (const item of json.products) {
            const key = String(item.barcode || item.code || item.id).trim().toLowerCase();
            if (!seenKeys.has(key)) {
              seenKeys.add(key);
              const rawBrand = item.brandName || item.brand_name || '';
              const pcsMatch = rawBrand.match(/\[Pcs\/Cs:(\d+)\]/);
              const cleanBrand = rawBrand.replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim() || null;
              const parsedPcs = item.pieces_per_case || item.piecesPerCase || (pcsMatch ? parseInt(pcsMatch[1], 10) : null);
              results.push({
                id: item.id,
                barcode: item.barcode,
                code: (item.code && item.code !== item.barcode) ? item.code : (item.sku && item.sku !== item.barcode ? item.sku : null),
                name: item.name,
                price: Number(item.price || 0),
                priceWithVat: Number(item.priceWithVat || item.price_with_vat || item.price || 0),
                supplierName: item.supplierName || item.supplier_name || 'Pending Assignment',
                brandName: cleanBrand,
                unitName: item.unitName || item.unit_name || 'pc',
                pieces_per_case: parsedPcs,
                piecesPerCase: parsedPcs,
                hasSerialNumbers: Boolean(item.hasSerialNumbers || item.has_serial_numbers),
                imageUrl: item.imageUrl || item.image_url || null,
                isVerified: item.isVerified !== false && item.is_verified !== false,
                source: item.source || 'Server Catalog API'
              });
            }
          }
        }
      }
    } catch (apiErr) {
      console.warn('Server search proxy notice:', apiErr.message);
    }

    // 2. Client-side Supabase products table fallback
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
            const rawBrand = item.brand_name || '';
            const pcsMatch = rawBrand.match(/\[Pcs\/Cs:(\d+)\]/);
            const cleanBrand = rawBrand.replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim() || null;
            const parsedPcs = item.pieces_per_case || (pcsMatch ? parseInt(pcsMatch[1], 10) : null);
            results.push({
              id: item.id,
              barcode: item.barcode,
              code: (item.code && item.code !== item.barcode) ? item.code : (item.sku && item.sku !== item.barcode ? item.sku : null),
              name: item.name,
              price: Number(item.price || 0),
              priceWithVat: Number(item.price_with_vat || item.price || 0),
              supplierName: item.supplier_name || 'Pending Assignment',
              brandName: cleanBrand,
              unitName: item.unit_name || 'pc',
              pieces_per_case: parsedPcs,
              piecesPerCase: parsedPcs,
              hasSerialNumbers: item.has_serial_numbers || false,
              imageUrl: item.image_url || null,
              isVerified: item.is_verified !== false,
              source: 'Supabase Database (Custom)'
            });
          }
        }
      }
    } catch (e) {
      console.warn('Supabase product search warning:', e);
    }

    // 3. Wholesale Verified Catalog Fallback (INITIAL_PRODUCTS)
    for (const mock of INITIAL_PRODUCTS) {
      const matchText = `${mock.name} ${mock.brand || ''} ${mock.category || ''} ${mock.sku || ''} ${mock.barcode || ''}`.toLowerCase();
      if (matchText.includes(cleanLower)) {
        const key = String(mock.barcode || mock.sku || mock.id).trim().toLowerCase();
        if (!seenKeys.has(key)) {
          seenKeys.add(key);
          results.push({
            id: mock.id,
            barcode: mock.barcode,
            code: (mock.sku && mock.sku !== mock.barcode) ? mock.sku : null,
            sku: (mock.sku && mock.sku !== mock.barcode) ? mock.sku : null,
            name: mock.name,
            price: Number(mock.unit_price || 0),
            priceWithVat: Number(mock.unit_price || 0) * 1.12,
            supplierName: mock.supplier || 'Savemore',
            brandName: mock.brand || null,
            unitName: 'pc',
            hasSerialNumbers: mock.requires_serial || false,
            imageUrl: mock.image_url || null,
            isVerified: true,
            source: 'Wholesale Verified Catalog'
          });
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
   * GENERATE UNIQUE RMA NUMBER INSTANTLY
   * Standard Enterprise Format: "RMA-[YEAR]-[4-DIGIT-ASCENDING]-[4-CHAR-ALPHANUMERIC]"
   * Example: RMA-2026-0001-6TYH
   */
  generateRMANumber(existingOrHint = null) {
    const currentYear = new Date().getFullYear();
    let maxSeq = 0;

    // 1. If an array of reports was passed, find the highest existing sequence number
    if (Array.isArray(existingOrHint)) {
      existingOrHint.forEach(r => {
        const num = r.rma_number || r.rmaNumber || r.id || '';
        const match = String(num).match(/RMA-\d{4}-(\d+)-/i);
        if (match && match[1]) {
          const parsed = parseInt(match[1], 10);
          if (!isNaN(parsed) && parsed > maxSeq) {
            maxSeq = parsed;
          }
        }
      });
      if (maxSeq === 0 && existingOrHint.length > 0) {
        maxSeq = existingOrHint.length;
      }
    } else if (typeof existingOrHint === 'number' && existingOrHint > 0) {
      maxSeq = existingOrHint - 1;
    }

    // 2. Fallback to localStorage cache if existing array was not supplied
    if (maxSeq === 0) {
      try {
        const rawReports = localStorage.getItem('cached_recent_reports') || localStorage.getItem('rma_reports_cache');
        if (rawReports) {
          const parsed = JSON.parse(rawReports);
          if (Array.isArray(parsed)) {
            parsed.forEach(r => {
              const num = r.rma_number || r.rmaNumber || '';
              const match = String(num).match(/RMA-\d{4}-(\d+)-/i);
              if (match && match[1]) {
                const p = parseInt(match[1], 10);
                if (!isNaN(p) && p > maxSeq) maxSeq = p;
              }
            });
            if (maxSeq === 0) maxSeq = parsed.length;
          }
        }
      } catch {}
    }

    // 3. Increment persistent local counter
    try {
      const storageKey = `rma_last_seq_${currentYear}`;
      const stored = parseInt(localStorage.getItem(storageKey) || '0', 10);
      if (!isNaN(stored) && stored > maxSeq) {
        maxSeq = stored;
      }
    } catch {}

    const nextSeq = maxSeq + 1;
    try {
      localStorage.setItem(`rma_last_seq_${currentYear}`, String(nextSeq));
    } catch {}

    const seqStr = String(nextSeq).padStart(4, '0');
    const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let rand = '';
    for (let i = 0; i < 4; i++) {
      rand += chars.charAt(Math.floor(Math.random() * chars.length));
    }

    return `RMA-${currentYear}-${seqStr}-${rand}`;
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
    parent_rma_id = null
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
      // Format: "RMA-YYYY-XXXX-RAND" (e.g. RMA-2026-0001-A14R)
      // RMA + Current Year + Serial Number of this RMA - Random unique alphanumeric
      let nextSeq = 1;
      try {
        const { data: latestRows } = await supabase
          .from('rma_reports')
          .select('id, rma_number')
          .order('id', { ascending: false })
          .limit(10);

        let maxNum = 0;
        if (latestRows && latestRows.length > 0) {
          for (const row of latestRows) {
            if (row.id && !isNaN(Number(row.id))) {
              maxNum = Math.max(maxNum, Number(row.id));
            }
            if (row.rma_number) {
              const m = String(row.rma_number).match(/RMA-\d{4}-(\d+)-/i);
              if (m && m[1]) {
                maxNum = Math.max(maxNum, parseInt(m[1], 10));
              }
            }
          }
        }
        if (maxNum > 0) {
          nextSeq = maxNum + 1;
        } else {
          const { count } = await supabase.from('rma_reports').select('id', { count: 'exact', head: true });
          nextSeq = (count || 0) + 1;
        }
      } catch (e) {
        nextSeq = 1;
      }

      const currentYear = new Date().getFullYear();
      const seqStr = String(nextSeq).padStart(4, '0');
      const chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      let randomSuffix = '';
      for (let i = 0; i < 4; i++) {
        randomSuffix += chars.charAt(Math.floor(Math.random() * chars.length));
      }
      rmaNumber = `RMA-${currentYear}-${seqStr}-${randomSuffix}`;
    }

    // Auto-resolve product from database if not passed in or still pending client-side detection
    let resolvedProduct = product;
    if (!resolvedProduct || !resolvedProduct.name || resolvedProduct.name.startsWith('Unidentified Item')) {
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
      ? items.reduce((acc, it) => acc + (Number(it.quantity) || 1), 0)
      : (Number(quantity) || 1));

    const userProvidedName = (name || productName || '').trim();
    const effectiveName = isBatch
      ? `Batch Return Manifest (${items.length} items)`
      : (userProvidedName || (isKnown ? resolvedProduct.name : (resolvedProduct?.name && !resolvedProduct.name.startsWith('Unidentified Item') ? resolvedProduct.name : (cleanBarcode ? `Unidentified Item (${cleanBarcode})` : 'General Return Item'))));

    // Ensure manifest barcode is strictly rmaNumber or a dedicated manifest identifier, never a child item's barcode
    const finalBarcode = isBatch
      ? (cleanBarcode && cleanBarcode !== 'MANIFEST' && !items.some(it => String(it.barcode).trim() === cleanBarcode) ? cleanBarcode : rmaNumber)
      : cleanBarcode;

    // Filter GPS: Only save if accuracy is <= 150 meters
    const isAccurateGps = gps && gps.latitude && gps.accuracy && Number(gps.accuracy) <= 150;

    const effectiveRmaType = (rma_type === 'supplier_outbound' || rmaType === 'supplier_outbound') ? 'supplier_outbound' : 'customer_inbound';

    const reportRow = {
      rma_number: rmaNumber,
      rma_type: effectiveRmaType,
      barcode: finalBarcode,
      code: isBatch ? null : (isKnown ? ((resolvedProduct.code && resolvedProduct.code !== finalBarcode) ? resolvedProduct.code : (resolvedProduct.sku && resolvedProduct.sku !== finalBarcode ? resolvedProduct.sku : null)) : (hasItems && items[0]?.code ? items[0].code : null)),
      name: effectiveName,
      quantity: calculatedTotalQuantity,
      supplier_name: (supplier_name || supplier) ? String(supplier_name || supplier).trim() : (isKnown ? (resolvedProduct.supplier_name || resolvedProduct.supplierName || 'Pending Assignment') : (hasItems && items[0]?.supplier_name ? items[0].supplier_name : 'Pending Assignment')),
      price: hasItems 
        ? items.reduce((acc, it) => acc + ((Number(it.price) || 0) * (Number(it.quantity) || 1)), 0)
        : (isKnown ? Number(resolvedProduct.price || 0) : 0),
      price_with_vat: hasItems
        ? items.reduce((acc, it) => acc + ((Number(it.price_with_vat || it.price) || 0) * (Number(it.quantity) || 1)), 0)
        : (isKnown ? Number(resolvedProduct.price_with_vat || resolvedProduct.priceWithVat || resolvedProduct.price || 0) : 0),
      unit_name: hasItems
        ? (items.every(it => (it.unit_name || it.unit) === (items[0].unit_name || items[0].unit)) ? (items[0].unit_name || items[0].unit || 'pc') : 'mixed')
        : (isKnown ? (resolvedProduct.unit_name || resolvedProduct.unitName || 'pc') : (resolvedProduct?.unit_name || 'pc')),
      status: isBatch ? 'pending' : (isKnown || (hasItems && items.every(it => Number(it.price) > 0)) ? 'pending' : 'pending_admin_details'),
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
      ai_document_metadata: ai_document_metadata || null,
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
      condition_grade: 'B - Damaged Packaging Only',
      disposition: effectiveRmaType === 'supplier_outbound' ? '3- Return to Vendor (RTV)' : 'Pending Triage',
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
          supplier_name: it.supplier_name || 'Pending Assignment',
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
          supplier_name: it.supplier_name || 'Pending Assignment',
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
    // - Test Mode is strictly accessible ONLY if user is logged in as Super Admin.
    // - For all anonymous public reporters or non-super-admins, submissions are ALWAYS Live.
    const isTestActive = isSuperAdminTestModeActive();
    notificationService.sendRMANotification(finalReport, isTestActive).catch(err => {
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

    // 1. Fetch current record to resolve id, rma_number, and child items
    let target = null;
    try {
      const getQuery = isNum 
        ? supabase.from('rma_reports').select('*').eq('id', parseInt(cleanId, 10)).maybeSingle()
        : supabase.from('rma_reports').select('*').eq('rma_number', cleanId).maybeSingle();
      const { data } = await getQuery;
      target = data;
    } catch {}

    const recordId = target?.id || (isNum ? parseInt(cleanId, 10) : null);
    const rmaNum = target?.rma_number || (!isNum ? cleanId : null);

    // If report has items JSON array, cascade rma_type and disposition to child items
    if (target && Array.isArray(target.items) && target.items.length > 0) {
      updates.items = target.items.map(it => ({
        ...it,
        rma_type: cleanType,
        disposition: disposition || it.disposition || (cleanType === 'supplier_outbound' ? '1 - Pending Vendor Pickup' : '1- Pending Triage')
      }));
    }

    let query = supabase.from('rma_reports').update(updates);
    if (recordId) {
      query = query.eq('id', recordId);
    } else {
      query = query.eq('rma_number', rmaNum);
    }

    const { data, error } = await query.select().single();
    if (error) {
      console.error('Failed to update rma_type:', error);
      throw error;
    }

    // 2. Cascade update to all child records in rma_reports sharing parent_rma_id or rma_number
    try {
      const childUpdates = { rma_type: cleanType };
      if (disposition) childUpdates.disposition = disposition;

      if (recordId) {
        await supabase.from('rma_reports').update(childUpdates).eq('parent_rma_id', recordId);
      }
      if (rmaNum) {
        await supabase.from('rma_reports').update(childUpdates).eq('rma_number', rmaNum).neq('id', data.id);
      }
    } catch (e) {
      console.warn('Notice cascading rma_type to child rma_reports:', e?.message);
    }

    // 3. Cascade to child records in rma_items if table exists
    try {
      if (recordId) {
        await supabase.from('rma_items').update({ disposition: disposition || undefined }).eq('rma_report_id', recordId);
      }
    } catch (e) {
      console.warn('Notice cascading disposition to rma_items:', e?.message);
    }

    this.notifyChange('report-updated', { report: data });
    return data;
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
   * Fetch all unmapped items (Awaiting SKU) across active standalone reports and batch manifest child items
   */
  async getPendingBarcodes() {
    try {
      // 1. Fetch active (non-deleted) RMA reports (regardless of whether status is pending, received_at_dock, etc.)
      const { data: activeReports, error: rError } = await supabase
        .from('rma_reports')
        .select('id, rma_number, parent_rma_id, barcode, code, name, supplier_name, price, price_with_vat, unit_name, status, created_at, is_parent, items')
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

      const reports = activeReports || [];

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
  async getRecentReports(limit = 100) {
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
          .select('id, rma_number, barcode, name, photos, proof_photos, photo_url, paperwork_photos, google_drive_folder_id, google_drive_folder_url')
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

      let query = supabase.from('rma_reports').delete();
      if (isNumericId) {
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
        if (isNumericId) softQuery = softQuery.eq('id', id);
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
          .select('id, rma_number, barcode, name, photos, paperwork_photos, proof_photos, photo_url, google_drive_folder_id, google_drive_folder_url')
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
  }
};


import React, { useState, useEffect } from 'react';
import { X, Save, Trash2, Upload, AlertCircle, RefreshCw, CheckCircle, Package, Image as ImageIcon, ZoomIn } from 'lucide-react';
import { catalogService } from '../services/catalogService';
import ImageLightboxModal from './ImageLightboxModal';

export default function ProductEditModal({ isOpen, onClose, product, onSaved, onDeleted, currentUser }) {
  const isEditing = Boolean(product && product.id);

  const [name, setName] = useState('');
  const [barcode, setBarcode] = useState('');
  const [code, setCode] = useState('');
  const [supplierName, setSupplierName] = useState('Savemore');
  const [price, setPrice] = useState('');
  const [priceWithVat, setPriceWithVat] = useState('');
  const [unitName, setUnitName] = useState('pc');
  const [imageUrl, setImageUrl] = useState('');
  const [photoFile, setPhotoFile] = useState(null);
  const [photoPreview, setPhotoPreview] = useState(null);
  const [lightboxPhoto, setLightboxPhoto] = useState(null);

  const [isLoading, setIsLoading] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);
  const [showDeleteConfirm, setShowDeleteConfirm] = useState(false);
  const [errorNotice, setErrorNotice] = useState(null);

  const canDelete = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';
  const canEdit = currentUser?.role !== 'viewer';

  useEffect(() => {
    if (isOpen) {
      if (product) {
        setName(product.name || '');
        setBarcode(product.barcode || '');
        setCode(product.code || '');
        setSupplierName(product.supplier_name || product.supplierName || 'Savemore');
        setPrice(product.price !== undefined ? String(product.price) : '0');
        setPriceWithVat(product.price_with_vat !== undefined ? String(product.price_with_vat) : String(product.priceWithVat || '0'));
        setUnitName(product.unit_name || product.unitName || 'pc');
        setImageUrl(product.image_url || product.imageUrl || '');
        setPhotoPreview(product.image_url || product.imageUrl || null);
      } else {
        // Reset for new product
        setName('');
        setBarcode('');
        setCode('');
        setSupplierName('Savemore');
        setPrice('');
        setPriceWithVat('');
        setUnitName('pc');
        setImageUrl('');
        setPhotoPreview(null);
      }
      setPhotoFile(null);
      setShowDeleteConfirm(false);
      setErrorNotice(null);
    }
  }, [isOpen, product]);

  const handlePriceChange = (val) => {
    setPrice(val);
    const num = parseFloat(val);
    if (!isNaN(num)) {
      setPriceWithVat((num * 1.12).toFixed(2));
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!barcode.trim() || !name.trim()) {
      setErrorNotice('Barcode and Product Name are required.');
      return;
    }

    setIsLoading(true);
    setErrorNotice(null);

    try {
      let finalImageUrl = imageUrl;
      if (photoFile) {
        finalImageUrl = await catalogService.uploadPhoto(photoFile);
      }

      const payload = {
        barcode: barcode.trim(),
        code: code.trim() || null,
        name: name.trim(),
        supplierName: supplierName.trim() || 'Savemore',
        price: parseFloat(price) || 0,
        priceWithVat: parseFloat(priceWithVat) || parseFloat(price) || 0,
        unitName: unitName.trim() || 'pc',
        imageUrl: finalImageUrl || null
      };

      if (isEditing) {
        await catalogService.updateProduct(product.id, payload);
      } else {
        await catalogService.createProduct(payload);
      }

      if (onSaved) onSaved();
      onClose();
    } catch (err) {
      setErrorNotice(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  const handleDelete = async () => {
    if (!product?.id && !product?.barcode) return;
    setIsDeleting(true);
    try {
      await catalogService.deleteProduct(product.id, product.barcode);
      if (onDeleted) onDeleted(product);
      onClose();
    } catch (err) {
      setErrorNotice(err.message);
    } finally {
      setIsDeleting(false);
      setShowDeleteConfirm(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-lg w-full flex flex-col max-h-[92vh] overflow-hidden">
        
        {/* Header */}
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 flex items-center justify-between shrink-0 bg-white">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 text-blue-700 rounded-2xl shadow-inner">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 tracking-tight">
                {isEditing ? 'Edit Product Details' : 'Add New Product to Catalog'}
              </h2>
              <p className="text-xs text-slate-500">
                {isEditing 
                  ? 'Update product specs, price, and reference photo' 
                  : 'Register custom item into Supabase products database'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          
          {errorNotice && (
            <div className="p-3 bg-rose-50 border border-rose-200 text-rose-800 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600" />
              <span>{errorNotice}</span>
            </div>
          )}

          {/* Delete Confirmation Box */}
          {showDeleteConfirm && (
            <div className="p-4 bg-rose-50/80 border-2 border-rose-300 rounded-2xl space-y-2.5 text-xs animate-in fade-in">
              <span className="font-bold text-rose-900 block text-sm">
                Confirm Product Deletion?
              </span>
              <p className="text-rose-800">
                Are you sure you want to delete <strong>"{name || barcode}"</strong>? This will remove it from the custom database.
              </p>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setShowDeleteConfirm(false)}
                  className="px-3 py-1.5 bg-white border border-slate-300 hover:bg-slate-50 text-slate-700 font-bold rounded-xl text-xs"
                >
                  Cancel
                </button>
                <button
                  type="button"
                  disabled={isDeleting}
                  onClick={handleDelete}
                  className="px-4 py-1.5 bg-rose-600 hover:bg-rose-700 text-white font-bold rounded-xl text-xs flex items-center gap-1.5 shadow-sm"
                >
                  {isDeleting ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Trash2 className="w-3.5 h-3.5" />}
                  <span>Yes, Delete Product</span>
                </button>
              </div>
            </div>
          )}

          <form id="product-edit-form" onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            
            {/* Reference Image Preview & Upload */}
            <div className="p-3.5 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-700">
                Product Reference Photo
              </label>
              
              <div className="flex items-center gap-3">
                {photoPreview ? (
                  <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-blue-400 bg-white shadow-sm shrink-0 relative group">
                    <img src={photoPreview} alt="Preview" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/45 text-white flex items-center justify-center gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
                      <button
                        type="button"
                        onClick={() => setLightboxPhoto({
                          url: photoPreview,
                          title: name || 'Product Reference Photo',
                          subtitle: barcode ? `Barcode: ${barcode}` : ''
                        })}
                        className="p-1.5 rounded-lg bg-black/60 hover:bg-black/90 text-white cursor-zoom-in"
                        title="Click to zoom image"
                      >
                        <ZoomIn className="w-3.5 h-3.5" />
                      </button>
                      <button
                        type="button"
                        onClick={() => { setPhotoPreview(null); setPhotoFile(null); setImageUrl(''); }}
                        className="p-1.5 rounded-lg bg-rose-600/80 hover:bg-rose-600 text-white"
                        title="Remove photo"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  </div>
                ) : (
                  <div className="w-20 h-20 rounded-2xl bg-slate-200 text-slate-400 flex items-center justify-center shrink-0 border border-slate-300">
                    <ImageIcon className="w-7 h-7" />
                  </div>
                )}

                <div className="flex-1 space-y-1">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-white hover:bg-slate-100 border border-slate-300 text-slate-700 font-bold rounded-xl text-xs cursor-pointer shadow-sm transition-all">
                    <Upload className="w-3.5 h-3.5 text-blue-600" />
                    <span>Upload New Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400">
                    This image will be displayed when reporters scan this barcode.
                  </p>
                </div>
              </div>
            </div>

            {/* Product Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Product Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. Oishi Popcorn Chocolate 60g"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
              />
            </div>

            {/* Barcode & SKU Code */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Barcode / QR Code *
                </label>
                <input
                  type="text"
                  required
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="e.g. 4800016551857"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  SKU / Item Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => setCode(e.target.value)}
                  placeholder="e.g. SS1742P"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-mono font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
            </div>

            {/* Price & Price with VAT */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Net Price (₱)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={price}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Price w/ VAT (₱)
                </label>
                <input
                  type="number"
                  step="0.01"
                  value={priceWithVat}
                  onChange={(e) => setPriceWithVat(e.target.value)}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-emerald-700 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 mb-1">
                  Unit
                </label>
                <input
                  type="text"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="pc, box, case..."
                  className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
                />
              </div>
            </div>

            {/* Supplier */}
            <div>
              <label className="block text-xs font-bold text-slate-700 mb-1">
                Supplier Name
              </label>
              <input
                type="text"
                value={supplierName}
                onChange={(e) => setSupplierName(e.target.value)}
                placeholder="e.g. Savemore / Mondelez"
                className="w-full px-3 py-2 bg-slate-50 border border-slate-300 rounded-xl text-xs font-semibold text-slate-900 focus:outline-none focus:border-blue-600 focus:bg-white"
              />
            </div>

          </form>
        </div>

        {/* Pinned Footer with Actions */}
        <div className="p-4 sm:px-6 bg-slate-50 border-t border-slate-200 flex items-center justify-between gap-3 shrink-0">
          <div>
            {isEditing && canDelete && !showDeleteConfirm && (
              <button
                type="button"
                onClick={() => setShowDeleteConfirm(true)}
                className="px-3 py-2 text-rose-600 hover:text-rose-700 hover:bg-rose-50 rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors"
              >
                <Trash2 className="w-3.5 h-3.5" />
                <span>Delete</span>
              </button>
            )}
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="px-4 py-2 text-slate-500 hover:text-slate-800 text-xs font-bold"
            >
              Cancel
            </button>
            
            {canEdit && (
              <button
                type="submit"
                form="product-edit-form"
                disabled={isLoading}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all"
              >
                {isLoading ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Save className="w-3.5 h-3.5" />}
                <span>{isEditing ? 'Save Changes' : 'Save Product'}</span>
              </button>
            )}
          </div>
        </div>

      </div>

      {/* Fullscreen Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(lightboxPhoto)}
        imageUrl={lightboxPhoto?.url}
        images={lightboxPhoto?.images || (lightboxPhoto?.url ? [lightboxPhoto.url] : [])}
        initialIndex={0}
        title={lightboxPhoto?.title}
        subtitle={lightboxPhoto?.subtitle}
        onClose={() => setLightboxPhoto(null)}
      />
    </div>
  );
}

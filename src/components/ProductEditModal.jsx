import React, { useState, useEffect, useMemo } from 'react';
import { 
  X, 
  Save, 
  Trash2, 
  Upload, 
  AlertCircle, 
  RefreshCw, 
  CheckCircle, 
  Package, 
  Image as ImageIcon, 
  ZoomIn, 
  Search, 
  UserCheck, 
  Building2,
  ChevronDown
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import { authService } from '../services/authService';
import ImageLightboxModal from './ImageLightboxModal';
import SupplierInput from './SupplierInput';

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

  // Customer AE (Account Executive) State
  const [selectedAe, setSelectedAe] = useState(null); // { name, email, department }
  const [aeSearch, setAeSearch] = useState('');
  const [isAeDropdownOpen, setIsAeDropdownOpen] = useState(false);
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);

  // Company Division: 'Pingcon / Bonita' vs 'A2Z2GO / Keysys'
  const [company, setCompany] = useState('Pingcon / Bonita');

  const [isLoading, setIsLoading] = useState(false);
  const [errorNotice, setErrorNotice] = useState(null);
  const [skuError, setSkuError] = useState(null);
  const [nameError, setNameError] = useState(null);

  const canEdit = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  // Fetch employees from authService directory on open
  useEffect(() => {
    if (isOpen) {
      setLoadingEmployees(true);
      authService.getEmployees()
        .then(list => {
          setEmployees(list || []);
        })
        .catch(err => {
          console.warn('Failed to load employees for AE selection:', err);
        })
        .finally(() => {
          setLoadingEmployees(false);
        });
    }
  }, [isOpen]);

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

        // Only preload image if it is an existing verified catalog product with an official image.
        // For unassigned barcodes or new SKU assignments, strictly start with empty state placeholder.
        const isVerifiedCatalogItem = Boolean(product.id && product.is_verified !== false);
        const catalogImage = isVerifiedCatalogItem ? (product.image_url || product.imageUrl || '') : '';
        setImageUrl(catalogImage);
        setPhotoPreview(catalogImage || null);

        // Prepopulate AE if saved
        if (product.ae_name || product.ae_email) {
          setSelectedAe({
            name: product.ae_name || '',
            email: product.ae_email || '',
            department: product.ae_department || 'Account Executive'
          });
        } else {
          setSelectedAe(null);
        }

        // Default unified company
        setCompany('Wholesale Distribution');
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
        setSelectedAe(null);
        setCompany('Wholesale Distribution');
      }
      setPhotoFile(null);
      setAeSearch('');
      setIsAeDropdownOpen(false);
      setErrorNotice(null);
      setSkuError(null);
      setNameError(null);
    }
  }, [isOpen, product]);

  const handleNameChange = (val) => {
    setName(val);
    setNameError(null);
  };

  const handleCodeChange = (val) => {
    setCode(val);
    setSkuError(null);
  };

  const handlePriceChange = (val) => {
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
      setPrice(val);
      const num = parseFloat(val);
      if (!isNaN(num)) {
        setPriceWithVat((num * 1.12).toFixed(2));
      }
    }
  };

  const handlePriceBlur = () => {
    if (price !== '') {
      const p = Number((parseFloat(price) || 0).toFixed(2));
      setPrice(p.toFixed(2));
      setPriceWithVat((p * 1.12).toFixed(2));
    }
  };

  const handlePriceWithVatChange = (val) => {
    if (val === '' || /^\d*\.?\d{0,2}$/.test(val)) {
      setPriceWithVat(val);
    }
  };

  const handlePriceWithVatBlur = () => {
    if (priceWithVat !== '') {
      const p = Number((parseFloat(priceWithVat) || 0).toFixed(2));
      setPriceWithVat(p.toFixed(2));
    }
  };

  const handlePhotoSelect = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      setPhotoFile(file);
      setPhotoPreview(URL.createObjectURL(file));
    }
  };

  // Filter employees for AE Search
  const filteredEmployees = useMemo(() => {
    const q = aeSearch.toLowerCase().trim();
    if (!q) return employees.slice(0, 15);
    return employees.filter(emp => 
      (emp.name || '').toLowerCase().includes(q) ||
      (emp.email || emp.company_email || '').toLowerCase().includes(q) ||
      (emp.department || '').toLowerCase().includes(q)
    );
  }, [employees, aeSearch]);

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!barcode.trim() || !name.trim()) {
      setErrorNotice('Barcode and Product Name are required.');
      return;
    }

    // Customer AE is strictly REQUIRED
    if (!selectedAe || !selectedAe.email) {
      setErrorNotice('Customer Account Executive (AE) is required. Please search and select an AE from the company employee directory.');
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
        price: Number((parseFloat(price) || 0).toFixed(2)),
        priceWithVat: Number((parseFloat(priceWithVat) || parseFloat(price) || 0).toFixed(2)),
        unitName: unitName.trim() || 'pc',
        imageUrl: finalImageUrl || null,
        aeName: selectedAe.name,
        aeEmail: selectedAe.email,
        company: company
      };

      let savedProductData;
      if (isEditing) {
        const res = await catalogService.updateProduct(product.id, payload);
        savedProductData = res?.product || { id: product.id, ...payload };
      } else {
        const res = await catalogService.createProduct(payload);
        savedProductData = res?.product || payload;
      }

      if (onSaved) onSaved(savedProductData);
      onClose();
    } catch (err) {
      setErrorNotice(err.message);
    } finally {
      setIsLoading(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[60] flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-lg w-full flex flex-col max-h-[92dvh] sm:max-h-[92vh] overflow-hidden my-0 sm:my-auto">
        {/* Mobile Drag Indicator */}
        <div className="bottom-sheet-handle sm:hidden" />
        
        {/* Header */}
        <div className="p-4 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-blue-100 dark:bg-blue-950/60 text-blue-700 dark:text-blue-400 rounded-2xl shadow-inner">
              <Package className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                {isEditing ? 'Edit Product Details' : 'Add New Product to Catalog'}
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                {isEditing 
                  ? 'Update product specs, price, Customer AE, and reference photo' 
                  : 'Register custom item into Supabase products database'}
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Form Body */}
        <div className="flex-1 overflow-y-auto p-5 sm:p-6 space-y-4">
          
          {errorNotice && (
            <div className="p-3 bg-rose-50 dark:bg-rose-950/60 border border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-in fade-in">
              <AlertCircle className="w-4 h-4 shrink-0 text-rose-600 dark:text-rose-400" />
              <span>{errorNotice}</span>
            </div>
          )}

          <form id="product-edit-form" onSubmit={handleSubmit} className="space-y-3.5 text-xs">
            
            {/* Reference Image Preview & Upload */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-2">
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300">
                Product Reference Photo
              </label>
              
              <div className="flex items-center gap-3">
                {photoPreview ? (
                  <div className="w-20 h-20 rounded-2xl overflow-hidden border-2 border-blue-400 bg-white dark:bg-slate-800 shadow-sm shrink-0 relative group">
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
                  <div className="w-20 h-20 rounded-2xl bg-slate-100 dark:bg-slate-800 text-slate-400 dark:text-slate-500 flex flex-col items-center justify-center shrink-0 border-2 border-dashed border-slate-300 dark:border-slate-700">
                    <ImageIcon className="w-6 h-6 mb-0.5 opacity-60" />
                    <span className="text-[9px] font-bold uppercase tracking-wider text-slate-400 dark:text-slate-500">No Image</span>
                  </div>
                )}

                <div className="flex-1 space-y-1">
                  <label className="inline-flex items-center gap-1.5 px-3 py-2 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-slate-700 dark:text-slate-200 font-bold rounded-xl text-xs cursor-pointer shadow-sm transition-all">
                    <Upload className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                    <span>Upload New Photo</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handlePhotoSelect}
                      className="hidden"
                    />
                  </label>
                  <p className="text-[11px] text-slate-400 dark:text-slate-500">
                    This image will be displayed when reporters scan this barcode.
                  </p>
                </div>
              </div>
            </div>

            {/* Product Name */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Product Name *
              </label>
              <input
                type="text"
                required
                value={name}
                onChange={(e) => handleNameChange(e.target.value)}
                placeholder="e.g. Oishi Popcorn Chocolate 60g"
                className={`w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border ${
                  nameError ? 'border-rose-500 focus:border-rose-600' : 'border-slate-300 dark:border-slate-700 focus:border-blue-600'
                } rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:bg-white dark:focus:bg-slate-800`}
              />
              {nameError && (
                <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                  {nameError}
                </p>
              )}
            </div>

            {/* Barcode & SKU Code */}
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Barcode / QR Code *
                </label>
                <input
                  type="text"
                  required
                  value={barcode}
                  onChange={(e) => setBarcode(e.target.value)}
                  placeholder="e.g. 4800016551857"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  SKU / Item Code
                </label>
                <input
                  type="text"
                  value={code}
                  onChange={(e) => handleCodeChange(e.target.value)}
                  placeholder="e.g. SS1742P"
                  className={`w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border ${
                    skuError ? 'border-rose-500 focus:border-rose-600' : 'border-slate-300 dark:border-slate-700 focus:border-blue-600'
                  } rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white focus:outline-none focus:bg-white dark:focus:bg-slate-800`}
                />
                {skuError && (
                  <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                    {skuError}
                  </p>
                )}
              </div>
            </div>

            {/* CUSTOMER ACCOUNT EXECUTIVE (AE) SELECTOR - STRICTLY REQUIRED */}
            <div className="p-3.5 bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-2xl space-y-2 relative">
              <div className="flex items-center justify-between">
                <label className="block text-xs font-black text-blue-950 dark:text-blue-300">
                  Customer Account Executive (AE) * <span className="text-rose-500 font-bold">(Required)</span>
                </label>
                <span className="text-[10px] text-blue-700 dark:text-blue-400 font-semibold">
                  Receives CC on report emails
                </span>
              </div>

              {selectedAe ? (
                <div className="p-2.5 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 rounded-xl flex items-center justify-between gap-2 shadow-xs">
                  <div className="flex items-center gap-2 min-w-0">
                    <UserCheck className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
                    <div className="min-w-0">
                      <div className="font-black text-slate-900 dark:text-white text-xs truncate">
                        {selectedAe.name}
                      </div>
                      <div className="font-mono text-[11px] text-blue-600 dark:text-blue-400 truncate">
                        {selectedAe.email}
                      </div>
                    </div>
                  </div>
                  <button
                    type="button"
                    onClick={() => {
                      setSelectedAe(null);
                      setIsAeDropdownOpen(true);
                    }}
                    className="px-2.5 py-1 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-700 rounded-lg text-[11px] font-bold shrink-0 transition-colors"
                  >
                    Change AE
                  </button>
                </div>
              ) : (
                <div className="relative">
                  <div className="relative">
                    <Search className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={aeSearch}
                      onFocus={() => setIsAeDropdownOpen(true)}
                      onChange={(e) => {
                        setAeSearch(e.target.value);
                        setIsAeDropdownOpen(true);
                      }}
                      placeholder={loadingEmployees ? 'Loading company staff directory...' : 'Search AE employee by name, company email, or department...'}
                      className="w-full pl-9 pr-8 py-2 bg-white dark:bg-slate-800 border border-blue-300 dark:border-blue-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-600 shadow-xs"
                    />
                    <button
                      type="button"
                      onClick={() => setIsAeDropdownOpen(prev => !prev)}
                      className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200"
                    >
                      <ChevronDown className="w-3.5 h-3.5" />
                    </button>
                  </div>

                  {/* Dropdown list of matching employees */}
                  {isAeDropdownOpen && (
                    <div className="absolute z-20 left-0 right-0 mt-1 max-h-52 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl divide-y divide-slate-100 dark:divide-slate-700">
                      {filteredEmployees.length === 0 ? (
                        <div className="p-3 text-center text-slate-400 text-xs">
                          No employees found matching "{aeSearch}".
                        </div>
                      ) : (
                        filteredEmployees.map((emp, idx) => {
                          const empEmail = emp.email || emp.company_email || '';
                          return (
                            <button
                              key={emp.id || empEmail || idx}
                              type="button"
                              onClick={() => {
                                setSelectedAe({
                                  name: emp.name,
                                  email: empEmail,
                                  department: emp.department || 'Account Executive'
                                });
                                setIsAeDropdownOpen(false);
                                setAeSearch('');
                              }}
                              className="w-full p-2.5 text-left hover:bg-blue-50 dark:hover:bg-slate-700/60 transition-colors flex items-center justify-between gap-2"
                            >
                              <div className="min-w-0">
                                <div className="font-bold text-slate-900 dark:text-white text-xs truncate">
                                  {emp.name}
                                </div>
                                <div className="font-mono text-[10px] text-slate-500 dark:text-slate-400 truncate">
                                  {empEmail} {emp.department ? `• ${emp.department}` : ''}
                                </div>
                              </div>
                              <span className="text-[10px] font-bold text-blue-600 dark:text-blue-400 uppercase shrink-0">
                                Select
                              </span>
                            </button>
                          );
                        })
                      )}
                    </div>
                  )}
                </div>
              )}
            </div>


            {/* Price & Price with VAT */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Net Price (₱)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={price}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handlePriceChange(e.target.value)}
                  onBlur={handlePriceBlur}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Price w/ VAT (₱)
                </label>
                <input
                  type="text"
                  inputMode="decimal"
                  value={priceWithVat}
                  onFocus={(e) => e.target.select()}
                  onChange={(e) => handlePriceWithVatChange(e.target.value)}
                  onBlur={handlePriceWithVatBlur}
                  placeholder="0.00"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-emerald-700 dark:text-emerald-400 focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>

              <div>
                <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                  Unit
                </label>
                <input
                  type="text"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="pc, box, case..."
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                />
              </div>
            </div>

            {/* Supplier */}
            <div>
              <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
                Supplier Name
              </label>
              <SupplierInput
                value={supplierName}
                onChange={(val) => setSupplierName(val)}
                placeholder="e.g. Savemore / Mondelez / Bonita"
                className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
              />
            </div>

          </form>
        </div>

        {/* Pinned Footer with Actions */}
        <div className="p-4 sm:px-6 pb-safe bg-slate-50 dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 flex items-center justify-end gap-3 shrink-0">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={onClose}
              className="touch-target px-4 py-2 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-white text-xs font-bold"
            >
              Cancel
            </button>
            
            {canEdit && (
              <button
                type="submit"
                form="product-edit-form"
                disabled={isLoading}
                className="touch-target px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all cursor-pointer active:scale-95"
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

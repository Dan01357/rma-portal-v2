import React, { useState, useMemo } from 'react';
import { 
  X, 
  CheckCircle, 
  AlertTriangle, 
  Edit3, 
  Save, 
  RefreshCw, 
  Barcode, 
  Upload, 
  Image as ImageIcon,
  Search,
  ArrowUpDown,
  ArrowUp,
  ArrowDown
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import ImageLightboxModal from './ImageLightboxModal';

export default function PendingBarcodesModal({ isOpen, onClose, pendingList = [], onUpdated }) {
  const [selectedBarcode, setSelectedBarcode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('desc');
  const [lightboxPhoto, setLightboxPhoto] = useState(null);

  const [formData, setFormData] = useState({
    code: '',
    name: '',
    supplierName: 'Savemore',
    price: '',
    priceWithVat: '',
    brandName: '',
    unitName: 'pc',
    imageUrl: ''
  });
  const [isUploadingImage, setIsUploadingImage] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [statusMsg, setStatusMsg] = useState(null);

  if (!isOpen) return null;

  const handleSelect = (item) => {
    setSelectedBarcode(item);
    setFormData({
      code: item.code || '',
      name: item.name && !item.name.includes('Unidentified') ? item.name : '',
      supplierName: item.supplier_name && item.supplier_name !== 'Pending Assignment' ? item.supplier_name : 'Savemore',
      price: item.price ? String(item.price) : '',
      priceWithVat: item.price_with_vat ? String(item.price_with_vat) : '',
      brandName: item.brand_name || '',
      unitName: item.unit_name || 'pc',
      imageUrl: item.image_url || ''
    });
    setStatusMsg(null);
  };

  const handleImageFile = async (e) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setIsUploadingImage(true);
    try {
      const url = await catalogService.uploadPhoto(file);
      if (url) {
        setFormData(prev => ({ ...prev, imageUrl: url }));
      }
    } catch (err) {
      console.warn('Image upload error:', err);
    } finally {
      setIsUploadingImage(false);
    }
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    if (!selectedBarcode) return;
    if (!formData.name.trim()) {
      setStatusMsg({ type: 'error', text: 'Please enter a product name.' });
      return;
    }

    setIsSaving(true);
    setStatusMsg(null);

    try {
      await catalogService.updateBarcodeDetails({
        barcode: selectedBarcode.barcode,
        code: formData.code,
        name: formData.name,
        supplierName: formData.supplierName,
        price: formData.price,
        priceWithVat: formData.priceWithVat || (Number(formData.price) * 1.12).toFixed(2),
        brandName: formData.brandName,
        unitName: formData.unitName,
        imageUrl: formData.imageUrl
      });

      setStatusMsg({ 
        type: 'success', 
        text: `Barcode ${selectedBarcode.barcode} is now verified! Future scans will automatically display "${formData.name}" and its reference photo.` 
      });

      setTimeout(() => {
        setSelectedBarcode(null);
        if (onUpdated) onUpdated();
      }, 1500);
    } catch (err) {
      console.error('Update error:', err);
      setStatusMsg({ type: 'error', text: 'Failed to update: ' + err.message });
    } finally {
      setIsSaving(false);
    }
  };

  // Filter & sort pending barcodes
  const processedPendingList = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    let list = pendingList.filter(item => {
      if (!q) return true;
      return (
        String(item.id || '').includes(q) ||
        (item.barcode || '').toLowerCase().includes(q) ||
        (item.name || '').toLowerCase().includes(q) ||
        (item.code || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      let valA, valB;
      if (sortField === 'id') {
        valA = Number(a.id) || 0;
        valB = Number(b.id) || 0;
      } else if (sortField === 'barcode') {
        valA = String(a.barcode || '');
        valB = String(b.barcode || '');
      } else {
        valA = new Date(a.created_at || 0).getTime();
        valB = new Date(b.created_at || 0).getTime();
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [pendingList, searchQuery, sortField, sortDirection]);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-amber-100 text-amber-700 rounded-xl">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-lg font-bold text-slate-900">
                  Pending Unknown Barcodes
                </h2>
                <span className="px-2 py-0.5 rounded-full text-xs font-bold bg-amber-100 text-amber-800">
                  {processedPendingList.length} Pending
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Filter, sort, & update product details with clickable reference photos.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Status notice */}
        {statusMsg && (
          <div className={`p-3 rounded-xl text-xs font-semibold flex items-center gap-2 ${
            statusMsg.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            <CheckCircle className="w-4 h-4 shrink-0" />
            <span>{statusMsg.text}</span>
          </div>
        )}

        {/* List of unverified barcodes OR edit form */}
        {!selectedBarcode ? (
          <div className="space-y-3">
            {pendingList.length === 0 ? (
              <div className="text-center py-8 space-y-2">
                <CheckCircle className="w-10 h-10 text-emerald-500 mx-auto" />
                <h3 className="text-sm font-bold text-slate-700">All Barcodes Verified</h3>
                <p className="text-xs text-slate-400 max-w-sm mx-auto">
                  When a reporter scans an unrecorded barcode, it will appear here so you can add its name, supplier, price, and reference photo.
                </p>
              </div>
            ) : (
              <div className="space-y-3">
                {/* Search & Sort Controls */}
                <div className="flex items-center gap-2">
                  <div className="relative flex-1">
                    <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                    <input
                      type="text"
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      placeholder="Filter pending by barcode or SN..."
                      className="w-full pl-9 pr-8 py-2 bg-slate-50 border border-slate-200 rounded-xl text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-500"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => setSearchQuery('')}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 p-0.5"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>

                  <button
                    type="button"
                    onClick={() => {
                      if (sortField === 'id') {
                        setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
                      } else {
                        setSortField('id');
                        setSortDirection('desc');
                      }
                    }}
                    className="px-2.5 py-2 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
                    title="Toggle SN sorting"
                  >
                    <span className="font-mono text-[11px]">SN</span>
                    {sortField === 'id' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600" /> : <ArrowDown className="w-3 h-3 text-blue-600" />)}
                  </button>
                </div>

                {/* List Items */}
                <div className="space-y-2 max-h-[50vh] overflow-y-auto">
                  {processedPendingList.map(item => (
                    <div 
                      key={item.id || item.barcode}
                      className="p-3.5 bg-slate-50 hover:bg-blue-50/50 border border-slate-200 rounded-2xl flex items-center justify-between gap-3 transition-colors"
                    >
                      <div className="flex items-center gap-3">
                        <Barcode className="w-6 h-6 text-slate-400 shrink-0" />
                        <div>
                          <div className="flex items-center gap-2">
                            <span className="font-mono font-black text-xs text-amber-900 bg-amber-100 border border-amber-300 px-2 py-0.5 rounded-lg">
                              SN #{item.id}
                            </span>
                            <span className="font-mono text-sm font-bold text-blue-700">
                              {item.barcode}
                            </span>
                          </div>
                          <span className="block text-[11px] text-slate-400 mt-0.5">
                            Reported {new Date(item.created_at).toLocaleString()}
                          </span>
                        </div>
                      </div>

                      <button
                        type="button"
                        onClick={() => handleSelect(item)}
                        className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-all"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Enter Details</span>
                      </button>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </div>
        ) : (
          /* Edit Form */
          <form onSubmit={handleSubmit} className="space-y-4">
            <div className="p-3 bg-blue-50 border border-blue-200 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase text-blue-600 tracking-wider">
                  Target Barcode
                </span>
                <div className="font-mono font-black text-slate-900 text-base">
                  {selectedBarcode.barcode}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBarcode(null)}
                className="text-xs font-bold text-slate-500 hover:text-slate-800 underline"
              >
                Back to List
              </button>
            </div>

            <div className="space-y-3 text-xs font-semibold">
              <div>
                <label className="block text-slate-600 mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laptop Lenovo ThinkPad / Oreo Biscuit"
                  value={formData.name}
                  onChange={(e) => setFormData({ ...formData, name: e.target.value })}
                  className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-blue-600"
                />
              </div>

              {/* Optional Product Reference Photo with Lightbox Zoom */}
              <div className="p-3 bg-slate-50 border border-slate-200 rounded-2xl space-y-2">
                <span className="block text-slate-700 font-bold">
                  Reference Product Photo (Optional)
                </span>
                <p className="text-[11px] text-slate-400 font-normal">
                  If uploaded, this photo will be displayed to reporters whenever they scan this barcode.
                </p>

                <div className="flex items-center gap-3">
                  {formData.imageUrl ? (
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-300 shrink-0 group">
                      <button
                        type="button"
                        onClick={() => setLightboxPhoto({
                          url: formData.imageUrl,
                          title: formData.name || `Barcode ${selectedBarcode.barcode}`,
                          subtitle: `Reference Photo for ${selectedBarcode.barcode}`
                        })}
                        className="w-full h-full block cursor-zoom-in"
                        title="Click to zoom reference photo"
                      >
                        <img src={formData.imageUrl} alt="Reference" className="w-full h-full object-cover" />
                      </button>
                      <button
                        type="button"
                        onClick={() => setFormData({ ...formData, imageUrl: '' })}
                        className="absolute top-0.5 right-0.5 p-0.5 bg-black/70 text-white rounded-full hover:bg-rose-600 transition-colors"
                        title="Remove photo"
                      >
                        <X className="w-3 h-3" />
                      </button>
                    </div>
                  ) : (
                    <div className="w-16 h-16 rounded-xl border border-dashed border-slate-300 flex items-center justify-center text-slate-400 bg-white shrink-0">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <label className="flex-1 py-2 px-3 bg-white hover:bg-slate-50 border border-slate-300 rounded-xl text-center cursor-pointer text-xs font-bold text-slate-700 flex items-center justify-center gap-1.5 shadow-xs">
                    {isUploadingImage ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <Upload className="w-3.5 h-3.5 text-slate-500" />}
                    <span>{isUploadingImage ? 'Uploading...' : 'Upload Reference Photo'}</span>
                    <input
                      type="file"
                      accept="image/*"
                      onChange={handleImageFile}
                      className="hidden"
                    />
                  </label>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">SKU / Item Code</label>
                  <input
                    type="text"
                    placeholder="e.g. P124124141"
                    value={formData.code}
                    onChange={(e) => setFormData({ ...formData, code: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 font-mono focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Supplier Name</label>
                  <input
                    type="text"
                    placeholder="e.g. Savemore, Acer, Lenovo"
                    value={formData.supplierName}
                    onChange={(e) => setFormData({ ...formData, supplierName: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-600 mb-1">Base Price (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.price}
                    onChange={(e) => {
                      const p = e.target.value;
                      setFormData({ 
                        ...formData, 
                        price: p, 
                        priceWithVat: p ? (Number(p) * 1.12).toFixed(2) : '' 
                      });
                    }}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Price w/ VAT (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.priceWithVat}
                    onChange={(e) => setFormData({ ...formData, priceWithVat: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 mb-1">Unit</label>
                  <input
                    type="text"
                    placeholder="pc, box, unit"
                    value={formData.unitName}
                    onChange={(e) => setFormData({ ...formData, unitName: e.target.value })}
                    className="w-full px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-xl text-slate-900 focus:outline-none focus:border-blue-600"
                  />
                </div>
              </div>
            </div>

            <div className="pt-2 flex justify-end gap-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setSelectedBarcode(null)}
                className="px-4 py-2.5 text-slate-600 hover:bg-slate-100 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-600/20"
              >
                {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
                <span>Save & Verify Barcode</span>
              </button>
            </div>
          </form>
        )}

      </div>

      {/* Fullscreen Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(lightboxPhoto)}
        imageUrl={lightboxPhoto?.url}
        title={lightboxPhoto?.title}
        subtitle={lightboxPhoto?.subtitle}
        onClose={() => setLightboxPhoto(null)}
      />
    </div>
  );
}

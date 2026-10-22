import React, { useState, useMemo, useEffect } from 'react';
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
  ArrowDown,
  UserCheck,
  Building2,
  ChevronDown
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import { authService } from '../services/authService';
import { notificationService } from '../services/notificationService';
import ImageLightboxModal from './ImageLightboxModal';
import TablePagination from './TablePagination';
import SupplierInput from './SupplierInput';
import { supabase } from '../supabaseClient';

export default function PendingBarcodesModal({ isOpen, onClose, pendingList = [], onUpdated, currentUser }) {
  const [selectedBarcode, setSelectedBarcode] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('desc');
  const [lightboxPhoto, setLightboxPhoto] = useState(null);
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const canVerify = currentUser?.role !== 'viewer';

  // AE & Company state
  const [employees, setEmployees] = useState([]);
  const [loadingEmployees, setLoadingEmployees] = useState(false);
  const [selectedAe, setSelectedAe] = useState(null);
  const [aeSearch, setAeSearch] = useState('');
  const [isAeDropdownOpen, setIsAeDropdownOpen] = useState(false);
  const [company, setCompany] = useState('Pingcon / Bonita');

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
  const [skuError, setSkuError] = useState(null);
  const [nameError, setNameError] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setLoadingEmployees(true);
      authService.getEmployees()
        .then(list => setEmployees(list || []))
        .catch(err => console.warn('Failed to fetch employees in PendingBarcodesModal:', err))
        .finally(() => setLoadingEmployees(false));
    }
  }, [isOpen]);

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

    if (item.ae_name || item.ae_email) {
      setSelectedAe({
        name: item.ae_name || '',
        email: item.ae_email || '',
        department: item.ae_department || 'Account Executive'
      });
    } else {
      setSelectedAe(null);
    }

    const sup = String(item.supplier_name || '').toLowerCase();
    const nameStr = String(item.name || '').toLowerCase();
    if (sup.includes('a2z') || sup.includes('keysys') || nameStr.includes('a2z') || nameStr.includes('keysys')) {
      setCompany('A2Z2GO / Keysys');
    } else {
      setCompany('Pingcon / Bonita');
    }

    setAeSearch('');
    setIsAeDropdownOpen(false);
    setStatusMsg(null);
    setSkuError(null);
    setNameError(null);
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
    if (!selectedBarcode) return;
    if (!formData.name.trim()) {
      setStatusMsg({ type: 'error', text: 'Please enter a product name.' });
      return;
    }

    // Customer AE required
    if (!selectedAe || !selectedAe.email) {
      setStatusMsg({ type: 'error', text: 'Customer Account Executive (AE) is required. Please search and select an AE.' });
      return;
    }

    // Validate Name uniqueness
    if (formData.name && formData.name.trim()) {
      const nameCheck = await catalogService.checkNameUnique(formData.name.trim(), null, selectedBarcode.barcode);
      if (!nameCheck.isUnique) {
        setNameError(nameCheck.error);
        setStatusMsg({ type: 'error', text: nameCheck.error });
        return;
      }
    }

    // Validate SKU uniqueness
    if (formData.code && formData.code.trim()) {
      const skuCheck = await catalogService.checkSkuUnique(formData.code, null, selectedBarcode.barcode);
      if (!skuCheck.isUnique) {
        setSkuError(skuCheck.error);
        setStatusMsg({ type: 'error', text: skuCheck.error });
        return;
      }
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
        imageUrl: formData.imageUrl,
        aeName: selectedAe.name,
        aeEmail: selectedAe.email,
        company: company
      });

      // Dispatch automated RMA notification email with data from Return Reports table
      try {
        const isTestActive = typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true';
        
        let reportData = null;
        try {
          const { data: matchedReports } = await supabase
            .from('rma_reports')
            .select('*')
            .eq('barcode', selectedBarcode.barcode)
            .order('created_at', { ascending: false })
            .limit(1);
          if (matchedReports && matchedReports.length > 0) {
            reportData = matchedReports[0];
          }
        } catch (e) {
          console.warn('Could not fetch return report for notification:', e);
        }

        const reportToNotify = {
          rma_number: reportData?.rma_number || selectedBarcode.rma_number || `RMA-${new Date().getFullYear()}-0001`,
          barcode: selectedBarcode.barcode,
          code: formData.code,
          name: formData.name,
          quantity: reportData?.quantity || selectedBarcode.quantity || 1,
          unit_name: formData.unitName || reportData?.unit_name || 'pc',
          supplier_name: formData.supplierName,
          reason: reportData?.reason || selectedBarcode.reason || 'Damaged Box / Crushed Packaging',
          explanation: reportData?.explanation || selectedBarcode.explanation || '',
          photos: reportData?.photos || selectedBarcode.photos || (formData.imageUrl ? [formData.imageUrl] : []),
          reporter_name: reportData?.reporter_name || selectedBarcode.reporter_name || 'Warehouse Staff',
          reporter_contact: reportData?.reporter_contact || selectedBarcode.reporter_contact || 'N/A',
          gps_latitude: reportData?.gps_latitude || selectedBarcode.gps_latitude,
          gps_longitude: reportData?.gps_longitude || selectedBarcode.gps_longitude,
          gps_accuracy: reportData?.gps_accuracy || selectedBarcode.gps_accuracy,
          ae_name: selectedAe.name,
          ae_email: selectedAe.email,
          company: company
        };

        notificationService.sendRMANotification(reportToNotify, isTestActive).catch(e => {
          console.warn('Post-verification RMA report notification error:', e);
        });
      } catch (e) {
        console.warn('Non-blocking notification notice:', e);
      }

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
        (item.barcode || '').toLowerCase().includes(q) ||
        String(item.id || '').includes(q) ||
        (item.name || '').toLowerCase().includes(q) ||
        (item.supplier_name || '').toLowerCase().includes(q)
      );
    });

    list.sort((a, b) => {
      if (sortField === 'id') {
        const idA = Number(a.id) || 0;
        const idB = Number(b.id) || 0;
        return sortDirection === 'asc' ? idA - idB : idB - idA;
      }
      return 0;
    });

    return list;
  }, [pendingList, searchQuery, sortField, sortDirection]);

  // Paginated slice
  const paginatedList = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedPendingList.slice(start, start + pageSize);
  }, [processedPendingList, currentPage, pageSize]);

  // Early return strictly placed AFTER hooks to prevent React error #310
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-amber-100 dark:bg-amber-950/60 text-amber-700 dark:text-amber-400 rounded-2xl shadow-inner">
              <AlertTriangle className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white">
                  Pending Unknown Barcodes
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-amber-100 dark:bg-amber-950/60 text-amber-800 dark:text-amber-300">
                  {processedPendingList.length} Pending
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Filter, sort, paginate & update product details with Customer AE assignment.
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

        {/* Status notice */}
        {statusMsg && (
          <div className={`p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
            statusMsg.type === 'success' 
              ? 'bg-emerald-50 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800' 
              : 'bg-rose-50 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
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
                <h3 className="text-sm font-bold text-slate-700 dark:text-slate-200">All Barcodes Verified</h3>
                <p className="text-xs text-slate-400 dark:text-slate-500 max-w-sm mx-auto">
                  When a reporter scans an unrecorded barcode, it will appear here so you can add its name, supplier, Customer AE, and reference photo.
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
                      onChange={(e) => {
                        setSearchQuery(e.target.value);
                        setCurrentPage(1);
                      }}
                      placeholder="Filter pending by barcode or SN..."
                      className="w-full pl-9 pr-8 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 focus:outline-none focus:border-blue-500 shadow-xs"
                    />
                    {searchQuery && (
                      <button
                        type="button"
                        onClick={() => {
                          setSearchQuery('');
                          setCurrentPage(1);
                        }}
                        className="absolute right-2.5 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5"
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
                      setCurrentPage(1);
                    }}
                    className="px-2.5 py-2 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0 border border-slate-200/80 dark:border-slate-700"
                    title="Toggle SN sorting"
                  >
                    <span className="font-mono text-[11px]">SN</span>
                    {sortField === 'id' && (sortDirection === 'asc' ? <ArrowUp className="w-3 h-3 text-blue-600 dark:text-blue-400" /> : <ArrowDown className="w-3 h-3 text-blue-600 dark:text-blue-400" />)}
                  </button>
                </div>

                {/* List Items */}
                <div className="space-y-2 max-h-[45vh] overflow-y-auto">
                  {paginatedList.length === 0 ? (
                    <div className="py-8 text-center text-xs text-slate-400 font-semibold">
                      No pending barcodes match "{searchQuery}"
                    </div>
                  ) : (
                    paginatedList.map(item => (
                      <div 
                        key={item.id || item.barcode}
                        className="p-3 bg-slate-50 dark:bg-slate-800/70 hover:bg-blue-50/50 dark:hover:bg-slate-700/60 border border-slate-200 dark:border-slate-700 rounded-2xl flex items-center justify-between gap-3 transition-colors"
                      >
                        <div className="flex items-center gap-3 min-w-0">
                          <Barcode className="w-6 h-6 text-slate-400 shrink-0" />
                          <div className="min-w-0">
                            <div className="flex items-center gap-2">
                              {item.id && (
                                <span className="font-mono font-black text-[10px] text-amber-900 dark:text-amber-300 bg-amber-100 dark:bg-amber-950/80 px-1.5 py-0.5 rounded-md">
                                  #{item.id}
                                </span>
                              )}
                              <span className="font-mono font-bold text-slate-900 dark:text-white text-xs truncate">
                                {item.barcode}
                              </span>
                            </div>
                            <div className="text-[11px] text-slate-500 dark:text-slate-400 truncate">
                              {item.name || 'Unidentified item scanned by staff'}
                            </div>
                          </div>
                        </div>

                        {canVerify ? (
                          <button
                            type="button"
                            onClick={() => handleSelect(item)}
                            className="px-3.5 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-bold rounded-xl flex items-center gap-1.5 shadow-sm transition-all shrink-0 cursor-pointer"
                          >
                            <Edit3 className="w-3.5 h-3.5" />
                            <span>Enter Details</span>
                          </button>
                        ) : (
                          <span className="px-3 py-1.5 bg-slate-100 dark:bg-slate-800 text-slate-400 text-xs font-bold rounded-xl">
                            Read-Only
                          </span>
                        )}
                      </div>
                    ))
                  )}
                </div>

                {/* Table Pagination */}
                <TablePagination
                  currentPage={currentPage}
                  totalItems={processedPendingList.length}
                  pageSize={pageSize}
                  onPageChange={setCurrentPage}
                  onPageSizeChange={setPageSize}
                  pageSizeOptions={[5, 10, 25, 50]}
                  itemLabel="barcodes"
                />
              </div>
            )}
          </div>
        ) : (
          /* Edit Form */
          <form onSubmit={handleSubmit} className="space-y-4 text-xs">
            <div className="p-3 bg-blue-50 dark:bg-blue-950/60 border border-blue-200 dark:border-blue-800 rounded-2xl flex items-center justify-between">
              <div>
                <span className="text-[10px] font-bold uppercase text-blue-600 dark:text-blue-400 tracking-wider">
                  Target Barcode
                </span>
                <div className="font-mono font-black text-slate-900 dark:text-white text-base">
                  {selectedBarcode.barcode}
                </div>
              </div>
              <button
                type="button"
                onClick={() => setSelectedBarcode(null)}
                className="text-xs font-bold text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-white underline cursor-pointer"
              >
                Back to List
              </button>
            </div>

            <div className="space-y-3 font-semibold">
              <div>
                <label className="block text-slate-700 dark:text-slate-300 mb-1">Product Name *</label>
                <input
                  type="text"
                  required
                  placeholder="e.g. Laptop Lenovo ThinkPad / Oreo Biscuit"
                  value={formData.name}
                  onChange={async (e) => {
                    const val = e.target.value;
                    setFormData({ ...formData, name: val });
                    setNameError(null);
                    if (val.trim()) {
                      try {
                        const res = await catalogService.checkNameUnique(val, null, selectedBarcode?.barcode);
                        if (!res.isUnique) setNameError(res.error);
                      } catch (err) {}
                    }
                  }}
                  className={`w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border ${
                    nameError ? 'border-rose-500 focus:border-rose-600' : 'border-slate-300 dark:border-slate-700 focus:border-blue-600'
                  } rounded-xl text-slate-900 dark:text-white focus:outline-none focus:bg-white dark:focus:bg-slate-800`}
                />
                {nameError && (
                  <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                    {nameError}
                  </p>
                )}
              </div>

              {/* CUSTOMER AE SELECTOR */}
              <div className="p-3 bg-blue-50/60 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-900/60 rounded-2xl space-y-2 relative">
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
                        placeholder={loadingEmployees ? 'Loading staff directory...' : 'Search employee by name or company email...'}
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

                    {isAeDropdownOpen && (
                      <div className="absolute z-20 left-0 right-0 mt-1 max-h-48 overflow-y-auto bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl shadow-xl divide-y divide-slate-100 dark:divide-slate-700">
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



              {/* Optional Product Reference Photo */}
              <div className="p-3 bg-slate-50 dark:bg-slate-800/60 border border-slate-200 dark:border-slate-700 rounded-2xl space-y-2">
                <span className="block text-slate-700 dark:text-slate-300 font-bold">
                  Reference Product Photo (Optional)
                </span>

                <div className="flex items-center gap-3">
                  {formData.imageUrl ? (
                    <div className="relative w-16 h-16 rounded-xl overflow-hidden border border-slate-300 dark:border-slate-700 shrink-0 group">
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
                    <div className="w-16 h-16 rounded-xl border border-dashed border-slate-300 dark:border-slate-700 flex items-center justify-center text-slate-400 bg-white dark:bg-slate-800 shrink-0">
                      <ImageIcon className="w-6 h-6" />
                    </div>
                  )}

                  <label className="flex-1 py-2 px-3 bg-white dark:bg-slate-800 hover:bg-slate-50 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 rounded-xl text-center cursor-pointer text-xs font-bold text-slate-700 dark:text-slate-200 flex items-center justify-center gap-1.5 shadow-xs transition-colors">
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
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">SKU / Item Code</label>
                  <input
                    type="text"
                    placeholder="e.g. P124124141"
                    value={formData.code}
                    onChange={async (e) => {
                      const val = e.target.value;
                      setFormData({ ...formData, code: val });
                      setSkuError(null);
                      if (val.trim()) {
                        try {
                          const res = await catalogService.checkSkuUnique(val, null, selectedBarcode?.barcode);
                          if (!res.isUnique) setSkuError(res.error);
                        } catch (err) {}
                      }
                    }}
                    className={`w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border ${
                      skuError ? 'border-rose-500 focus:border-rose-600' : 'border-slate-300 dark:border-slate-700 focus:border-blue-600'
                    } rounded-xl text-slate-900 dark:text-white font-mono focus:outline-none focus:bg-white dark:focus:bg-slate-800`}
                  />
                  {skuError && (
                    <p className="text-[10px] font-bold text-rose-600 dark:text-rose-400 mt-1">
                      {skuError}
                    </p>
                  )}
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Supplier Name</label>
                  <SupplierInput
                    placeholder="e.g. Savemore, Walter Mart, Mondelez"
                    value={formData.supplierName}
                    onChange={(val) => setFormData({ ...formData, supplierName: val })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800 text-xs sm:text-sm"
                  />
                </div>
              </div>

              <div className="grid grid-cols-3 gap-3">
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Base Price (₱)</label>
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
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Price w/ VAT (₱)</label>
                  <input
                    type="number"
                    step="0.01"
                    placeholder="0.00"
                    value={formData.priceWithVat}
                    onChange={(e) => setFormData({ ...formData, priceWithVat: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                  />
                </div>
                <div>
                  <label className="block text-slate-600 dark:text-slate-400 mb-1">Unit</label>
                  <input
                    type="text"
                    placeholder="pc, box, unit"
                    value={formData.unitName}
                    onChange={(e) => setFormData({ ...formData, unitName: e.target.value })}
                    className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-slate-900 dark:text-white focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800"
                  />
                </div>
              </div>
            </div>

            <div className="pt-3 flex justify-end gap-2 border-t border-slate-100 dark:border-slate-800">
              <button
                type="button"
                onClick={() => setSelectedBarcode(null)}
                className="px-4 py-2 text-slate-600 dark:text-slate-400 hover:bg-slate-100 dark:hover:bg-slate-800 rounded-xl text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                disabled={isSaving}
                className="px-5 py-2.5 bg-emerald-600 hover:bg-emerald-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-2 shadow-md shadow-emerald-600/20 cursor-pointer"
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
        images={lightboxPhoto?.images || (lightboxPhoto?.url ? [lightboxPhoto.url] : [])}
        initialIndex={lightboxPhoto?.initialIndex || 0}
        title={lightboxPhoto?.title}
        subtitle={lightboxPhoto?.subtitle}
        onClose={() => setLightboxPhoto(null)}
      />
    </div>
  );
}

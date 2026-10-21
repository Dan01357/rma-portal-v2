import React, { useState, useMemo } from 'react';
import { 
  Package, 
  Search, 
  Plus, 
  Edit3, 
  Trash2, 
  CheckCircle, 
  Image as ImageIcon, 
  ExternalLink, 
  X, 
  RefreshCw, 
  List, 
  LayoutGrid, 
  Copy, 
  Check,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  Filter,
  RotateCcw
} from 'lucide-react';
import ImageLightboxModal from './ImageLightboxModal';

export default function SavedProductsTab({ 
  products = [], 
  isLoading = false,
  onAddProduct, 
  onEditProduct, 
  onDeleteProduct,
  currentUser 
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [filterSupplier, setFilterSupplier] = useState('all');
  const [filterStatus, setFilterStatus] = useState('all');
  const [sortField, setSortField] = useState('id');
  const [sortDirection, setSortDirection] = useState('desc');
  const [selectedLightbox, setSelectedLightbox] = useState(null);
  const [copiedBarcode, setCopiedBarcode] = useState(null);
  
  // File Explorer view type toggle: default to 'table' (rows list) as requested
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('rma_saved_products_view_mode') || 'table';
  });

  const canEdit = currentUser?.role !== 'viewer';
  const canDelete = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('rma_saved_products_view_mode', mode);
    } catch (e) {}
  };

  const copyToClipboard = (barcode) => {
    if (!barcode) return;
    navigator.clipboard.writeText(barcode);
    setCopiedBarcode(barcode);
    setTimeout(() => setCopiedBarcode(null), 2000);
  };

  // Derive unique suppliers for the filter dropdown
  const uniqueSuppliers = useMemo(() => {
    const set = new Set();
    products.forEach(p => {
      const s = p.supplier_name || p.supplierName;
      if (s && s.trim()) set.add(s.trim());
    });
    return Array.from(set).sort();
  }, [products]);

  // Handle column header sorting
  const handleSort = (field) => {
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter and sort products
  const processedProducts = useMemo(() => {
    const q = filterQuery.toLowerCase().trim();

    let list = products.filter(p => {
      // Text search
      if (q) {
        const matches = (
          (p.name || '').toLowerCase().includes(q) ||
          (p.barcode || '').toLowerCase().includes(q) ||
          (p.code || '').toLowerCase().includes(q) ||
          String(p.id || '').includes(q) ||
          (p.supplier_name || p.supplierName || '').toLowerCase().includes(q)
        );
        if (!matches) return false;
      }

      // Supplier filter
      if (filterSupplier !== 'all') {
        const s = (p.supplier_name || p.supplierName || '').trim();
        if (s !== filterSupplier) return false;
      }

      // Status filter
      if (filterStatus === 'verified' && p.is_verified === false) return false;
      if (filterStatus === 'pending' && p.is_verified !== false) return false;

      return true;
    });

    // Sorting
    list.sort((a, b) => {
      let valA, valB;
      switch (sortField) {
        case 'id':
          valA = Number(a.id) || 0;
          valB = Number(b.id) || 0;
          break;
        case 'barcode':
          valA = String(a.barcode || '').toLowerCase();
          valB = String(b.barcode || '').toLowerCase();
          break;
        case 'code':
          valA = String(a.code || a.sku || '').toLowerCase();
          valB = String(b.code || b.sku || '').toLowerCase();
          break;
        case 'name':
          valA = String(a.name || '').toLowerCase();
          valB = String(b.name || '').toLowerCase();
          break;
        case 'price':
          valA = Number(a.price_with_vat || a.price || 0);
          valB = Number(b.price_with_vat || b.price || 0);
          break;
        case 'supplier':
          valA = String(a.supplier_name || a.supplierName || '').toLowerCase();
          valB = String(b.supplier_name || b.supplierName || '').toLowerCase();
          break;
        case 'status':
          valA = a.is_verified !== false ? 1 : 0;
          valB = b.is_verified !== false ? 1 : 0;
          break;
        default:
          valA = a.id;
          valB = b.id;
      }

      if (valA < valB) return sortDirection === 'asc' ? -1 : 1;
      if (valA > valB) return sortDirection === 'asc' ? 1 : -1;
      return 0;
    });

    return list;
  }, [products, filterQuery, filterSupplier, filterStatus, sortField, sortDirection]);

  const hasActiveFilters = filterQuery || filterSupplier !== 'all' || filterStatus !== 'all';

  const resetFilters = () => {
    setFilterQuery('');
    setFilterSupplier('all');
    setFilterStatus('all');
  };

  const renderSortIndicator = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-indigo-600 shrink-0 ml-1" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 shadow-inner">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Verified Products Catalog
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-800">
                {products.length} Items in DB
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Custom catalog items saved with verified barcodes & reference photos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2.5 self-end sm:self-auto">
          {/* File Explorer Style View Type Switcher */}
          <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200/80">
            <button
              type="button"
              onClick={() => handleSetViewMode('table')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                viewMode === 'table'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Rows / Table View (with SN column)"
            >
              <List className="w-3.5 h-3.5" />
              <span>Rows List</span>
            </button>
            <button
              type="button"
              onClick={() => handleSetViewMode('grid')}
              className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                viewMode === 'grid'
                  ? 'bg-white text-indigo-700 shadow-sm'
                  : 'text-slate-500 hover:text-slate-800'
              }`}
              title="Grid Cards View"
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span>Grid Cards</span>
            </button>
          </div>

          {canEdit && (
            <button
              type="button"
              onClick={onAddProduct}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all shrink-0"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search & Sort Controls Toolbar */}
      <div className="bg-white border border-slate-200 rounded-3xl p-3.5 sm:p-4 shadow-sm space-y-3">
        <div className="flex flex-col md:flex-row md:items-center gap-2.5">
          {/* Search Box */}
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={filterQuery}
              onChange={(e) => setFilterQuery(e.target.value)}
              placeholder="Search by SN (#), product name, barcode, SKU, or supplier..."
              className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-300 rounded-2xl text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            />
            {filterQuery && (
              <button
                type="button"
                onClick={() => setFilterQuery('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Supplier Dropdown Filter */}
          <div className="flex items-center gap-2 shrink-0">
            <select
              value={filterSupplier}
              onChange={(e) => setFilterSupplier(e.target.value)}
              className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-2xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            >
              <option value="all">All Suppliers ({uniqueSuppliers.length})</option>
              {uniqueSuppliers.map(sup => (
                <option key={sup} value={sup}>{sup}</option>
              ))}
            </select>

            {/* Status Dropdown Filter */}
            <select
              value={filterStatus}
              onChange={(e) => setFilterStatus(e.target.value)}
              className="px-3 py-2.5 bg-slate-50 border border-slate-300 rounded-2xl text-xs font-bold text-slate-700 focus:outline-none focus:border-indigo-500 focus:bg-white transition-all"
            >
              <option value="all">All Status</option>
              <option value="verified">Verified Only</option>
              <option value="pending">Pending Verification</option>
            </select>

            {/* Reset Filters Button */}
            {hasActiveFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="px-3 py-2.5 bg-slate-100 hover:bg-slate-200 text-slate-600 rounded-2xl text-xs font-bold flex items-center gap-1 transition-colors shrink-0"
                title="Reset all filters"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span className="hidden sm:inline">Reset</span>
              </button>
            )}
          </div>
        </div>

        {/* Filter Summary & Active Sort Notice */}
        <div className="flex items-center justify-between text-[11px] text-slate-500 px-1 pt-0.5 font-medium">
          <div>
            Showing <strong className="text-slate-900 font-bold">{processedProducts.length}</strong> of {products.length} products
            {hasActiveFilters && <span className="text-indigo-600 font-bold ml-1.5">• Filter active</span>}
          </div>
          <div className="text-slate-400">
            Click column headers to sort (<strong className="text-slate-700 capitalize">{sortField}</strong> {sortDirection === 'asc' ? '▲' : '▼'})
          </div>
        </div>
      </div>

      {/* Products Content: Loading / Empty / Table / Grid */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 space-y-2 bg-white border border-slate-200 rounded-3xl p-6">
          <RefreshCw className="w-6 h-6 mx-auto animate-spin text-indigo-600" />
          <p className="text-xs font-bold text-slate-600">Loading custom catalog from Supabase...</p>
        </div>
      ) : processedProducts.length === 0 ? (
        <div className="py-14 text-center text-slate-400 space-y-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <Package className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-xs font-bold text-slate-700">
            {hasActiveFilters ? 'No products match the selected filters' : 'No saved products in custom database yet'}
          </p>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
            {hasActiveFilters ? (
              <button
                type="button"
                onClick={resetFilters}
                className="text-indigo-600 font-bold hover:underline"
              >
                Click here to clear all filters
              </button>
            ) : (
              'When you verify pending barcodes or add items, they will appear here with instant edit and delete controls.'
            )}
          </p>
          {canEdit && !hasActiveFilters && (
            <button
              type="button"
              onClick={onAddProduct}
              className="mt-3 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Your First Product</span>
            </button>
          )}
        </div>
      ) : viewMode === 'table' ? (
        /* ============================================================ */
        /* VIEW 1: PRODUCTION-LEVEL ROW LIST / TABLE VIEW WITH SORTABLE HEADERS */
        /* ============================================================ */
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <th 
                    onClick={() => handleSort('id')}
                    className="py-3.5 px-4 font-black text-slate-900 w-16 cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by Serial Number"
                  >
                    <div className="flex items-center">
                      <span>SN</span>
                      {renderSortIndicator('id')}
                    </div>
                  </th>
                  <th className="py-3.5 px-3 w-16 text-center select-none">Photo</th>
                  <th 
                    onClick={() => handleSort('barcode')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by Barcode"
                  >
                    <div className="flex items-center">
                      <span>Barcode</span>
                      {renderSortIndicator('barcode')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('code')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by SKU / Code"
                  >
                    <div className="flex items-center">
                      <span>SKU / Code</span>
                      {renderSortIndicator('code')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('name')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by Product Name"
                  >
                    <div className="flex items-center">
                      <span>Product Name</span>
                      {renderSortIndicator('name')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('price')}
                    className="py-3.5 px-4 text-right font-bold cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by Price"
                  >
                    <div className="flex items-center justify-end">
                      <span>Price (w/ VAT)</span>
                      {renderSortIndicator('price')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('supplier')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by Supplier"
                  >
                    <div className="flex items-center">
                      <span>Supplier</span>
                      {renderSortIndicator('supplier')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('status')}
                    className="py-3.5 px-3 text-center font-bold cursor-pointer select-none hover:text-indigo-600 transition-colors group"
                    title="Click to sort by Status"
                  >
                    <div className="flex items-center justify-center">
                      <span>Status</span>
                      {renderSortIndicator('status')}
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-right font-bold w-24 select-none">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100">
                {processedProducts.map((product) => {
                  const hasPhoto = Boolean(product.image_url || product.imageUrl);
                  const photoSrc = product.image_url || product.imageUrl;
                  const isCopied = copiedBarcode === product.barcode;

                  return (
                    <tr 
                      key={product.id || product.barcode} 
                      className="hover:bg-indigo-50/30 transition-colors group"
                    >
                      {/* 1. SN (SERIAL NUMBER / DATABASE ID) COLUMN - AT FAR LEFT */}
                      <td className="py-3 px-4 font-mono">
                        <span className="font-black text-indigo-900 bg-indigo-50 border border-indigo-200/90 px-2 py-0.5 rounded-lg text-xs tracking-tight shadow-xs">
                          #{product.id}
                        </span>
                      </td>

                      {/* 2. Photo thumbnail with Clickable Zoom Lightbox */}
                      <td className="py-2.5 px-3 text-center">
                        {hasPhoto ? (
                          <button
                            type="button"
                            onClick={() => setSelectedLightbox({
                              url: photoSrc,
                              title: product.name,
                              subtitle: `Barcode: ${product.barcode} • SN #${product.id} • ${product.supplier_name || 'Savemore'}`
                            })}
                            className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 inline-block hover:opacity-85 hover:scale-105 transition-all shadow-xs cursor-zoom-in"
                            title="Click to zoom reference photo in fullscreen"
                          >
                            <img 
                              src={photoSrc} 
                              alt={product.name} 
                              className="w-full h-full object-cover" 
                            />
                          </button>
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto border border-slate-200/80">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                        )}
                      </td>

                      {/* 3. Barcode with copy button */}
                      <td className="py-3 px-4">
                        <div className="flex items-center gap-1.5 font-mono font-bold text-slate-800">
                          <span>{product.barcode}</span>
                          <button
                            type="button"
                            onClick={() => copyToClipboard(product.barcode)}
                            className="p-1 text-slate-400 hover:text-slate-700 hover:bg-slate-100 rounded-md transition-colors"
                            title="Copy barcode"
                          >
                            {isCopied ? (
                              <Check className="w-3.5 h-3.5 text-emerald-600" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                      </td>

                      {/* 4. SKU / Code */}
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {product.code ? (
                          <span className="font-bold text-slate-700">
                            {product.code}
                          </span>
                        ) : (
                          <span className="text-slate-300 italic">—</span>
                        )}
                      </td>

                      {/* 5. Product Name */}
                      <td className="py-3 px-4 font-bold text-slate-900 max-w-xs truncate" title={product.name}>
                        {product.name}
                      </td>

                      {/* 6. Price (w/ VAT) */}
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-600 text-sm">
                        ₱{Number(product.price_with_vat || product.priceWithVat || product.price || 0).toFixed(2)}
                      </td>

                      {/* 7. Supplier */}
                      <td className="py-3 px-4 font-semibold text-slate-700 truncate max-w-[140px]">
                        {product.supplier_name || product.supplierName || 'Savemore'}
                      </td>

                      {/* 8. Status */}
                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          product.is_verified !== false 
                            ? 'bg-emerald-100 text-emerald-800 border border-emerald-200' 
                            : 'bg-amber-100 text-amber-800 border border-amber-200'
                        }`}>
                          {product.is_verified !== false ? 'VERIFIED' : 'PENDING'}
                        </span>
                      </td>

                      {/* 9. Actions: Edit & Delete */}
                      <td className="py-3 px-4 text-right">
                        <div className="flex items-center justify-end gap-1">
                          {canEdit && (
                            <button
                              type="button"
                              onClick={() => onEditProduct(product)}
                              className="p-1.5 text-slate-400 hover:text-blue-600 hover:bg-blue-50 rounded-lg transition-colors"
                              title="Edit product"
                            >
                              <Edit3 className="w-4 h-4" />
                            </button>
                          )}
                          {canDelete && (
                            <button
                              type="button"
                              onClick={() => onDeleteProduct(product.id || product.barcode, product.name)}
                              className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 rounded-lg transition-colors"
                              title="Delete product"
                            >
                              <Trash2 className="w-4 h-4" />
                            </button>
                          )}
                        </div>
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 font-semibold px-4 flex justify-between">
            <span>Showing {processedProducts.length} verified products</span>
            <span>Sorted by {sortField} ({sortDirection.toUpperCase()})</span>
          </div>
        </div>
      ) : (
        /* ============================================================ */
        /* VIEW 2: FILE EXPLORER STYLE GRID CARDS VIEW                  */
        /* ============================================================ */
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {processedProducts.map((product) => {
            const hasPhoto = Boolean(product.image_url || product.imageUrl);
            const photoSrc = product.image_url || product.imageUrl;

            return (
              <div 
                key={product.id || product.barcode}
                className="bg-white border border-slate-200 hover:border-indigo-300 rounded-3xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3 group"
              >
                <div>
                  {/* Top: SN Badge + Verified Badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-black text-xs text-indigo-900 bg-indigo-50 border border-indigo-200/80 px-2 py-0.5 rounded-lg">
                      SN #{product.id}
                    </span>
                    <span className="px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                      VERIFIED
                    </span>
                  </div>

                  {/* Photo & Details */}
                  <div className="flex items-start gap-3">
                    {hasPhoto ? (
                      <div 
                        onClick={() => setSelectedLightbox({
                          url: photoSrc,
                          title: product.name,
                          subtitle: `Barcode: ${product.barcode} • SN #${product.id} • ${product.supplier_name || 'Savemore'}`
                        })}
                        className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0 cursor-zoom-in hover:opacity-90 relative"
                        title="Click to zoom reference photo in fullscreen"
                      >
                        <img src={photoSrc} alt={product.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-100">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      {product.code && (
                        <div className="text-[10px] font-mono text-slate-500 font-bold truncate mb-0.5">
                          SKU: <span className="text-slate-800">{product.code}</span>
                        </div>
                      )}
                      
                      <h4 className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-2 leading-tight">
                        {product.name}
                      </h4>
                      
                      <div className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                        Barcode: <strong className="text-slate-800">{product.barcode}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Metadata: Price & Supplier */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Price (w/ VAT)</span>
                      <span className="font-black text-emerald-600 font-mono text-sm">
                        ₱{Number(product.price_with_vat || product.priceWithVat || product.price || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-medium">Supplier</span>
                      <span className="font-bold text-slate-700 truncate max-w-[120px] block">
                        {product.supplier_name || product.supplierName || 'Savemore'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions: Edit & Delete */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-1.5">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onEditProduct(product)}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                      title="Edit product details & photo"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                      <span>Edit</span>
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDeleteProduct(product.id || product.barcode, product.name)}
                      className="px-3 py-1.5 bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                      title="Delete product permanently"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Fullscreen Image Lightbox Modal */}
      <ImageLightboxModal
        isOpen={Boolean(selectedLightbox)}
        imageUrl={selectedLightbox?.url}
        title={selectedLightbox?.title}
        subtitle={selectedLightbox?.subtitle}
        onClose={() => setSelectedLightbox(null)}
      />
    </div>
  );
}

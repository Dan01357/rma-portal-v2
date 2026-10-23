import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Package, 
  RefreshCw, 
  X, 
  Image as ImageIcon, 
  CheckCircle, 
  Plus, 
  ExternalLink, 
  ArrowRight, 
  List, 
  LayoutGrid,
  ArrowUpDown,
  ArrowUp,
  ArrowDown,
  RotateCcw
} from 'lucide-react';
import { catalogService } from '../services/catalogService';
import ImageLightboxModal from './ImageLightboxModal';
import TablePagination from './TablePagination';

export default function ProductSearchTab({ onInspectProduct, onImportToCatalog }) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedLightbox, setSelectedLightbox] = useState(null);
  const [sortField, setSortField] = useState('name');
  const [sortDirection, setSortDirection] = useState('asc');
  const [supplierFilter, setSupplierFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState('all');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);

  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('rma_search_view_mode') || 'table';
  });

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('rma_search_view_mode', mode);
    } catch (e) {}
  };

  const handleSearch = async (e) => {
    if (e) e.preventDefault();
    const query = searchInput.trim();
    if (!query) return;

    setIsSearching(true);
    setHasSearched(true);
    setCurrentPage(1);

    try {
      const items = await catalogService.searchAllProducts(query, 50);
      setResults(items);
    } catch (err) {
      console.warn('Multi-search notice:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  // Derive unique suppliers from search results
  const uniqueSuppliers = useMemo(() => {
    const set = new Set();
    results.forEach(r => {
      const s = r.supplierName || r.supplier;
      if (s && s.trim()) set.add(s.trim());
    });
    return Array.from(set).sort();
  }, [results]);

  // Derive unique sources from search results
  const uniqueSources = useMemo(() => {
    const set = new Set();
    results.forEach(r => {
      if (r.source && r.source.trim()) set.add(r.source.trim());
    });
    return Array.from(set).sort();
  }, [results]);

  // Handle column header sorting
  const handleSort = (field) => {
    setCurrentPage(1);
    if (sortField === field) {
      setSortDirection(prev => prev === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortDirection('asc');
    }
  };

  // Filter and sort results
  const processedResults = useMemo(() => {
    let list = results.filter(item => {
      if (supplierFilter !== 'all') {
        const s = (item.supplierName || item.supplier || '').trim();
        if (s !== supplierFilter) return false;
      }
      if (sourceFilter !== 'all') {
        if ((item.source || '').trim() !== sourceFilter) return false;
      }
      return true;
    });

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
          valA = Number(a.priceWithVat || a.price || 0);
          valB = Number(b.priceWithVat || b.price || 0);
          break;
        case 'supplier':
          valA = String(a.supplierName || a.supplier || '').toLowerCase();
          valB = String(b.supplierName || b.supplier || '').toLowerCase();
          break;
        case 'source':
          valA = String(a.source || '').toLowerCase();
          valB = String(b.source || '').toLowerCase();
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
  }, [results, supplierFilter, sourceFilter, sortField, sortDirection]);

  // Paginated slice
  const paginatedResults = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return processedResults.slice(start, start + pageSize);
  }, [processedResults, currentPage, pageSize]);

  const hasActiveFilters = supplierFilter !== 'all' || sourceFilter !== 'all';

  const resetFilters = () => {
    setSupplierFilter('all');
    setSourceFilter('all');
    setCurrentPage(1);
  };

  const renderSortIndicator = (field) => {
    if (sortField !== field) {
      return <ArrowUpDown className="w-3 h-3 text-slate-300 group-hover:text-slate-400 shrink-0 ml-1" />;
    }
    return sortDirection === 'asc' ? (
      <ArrowUp className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
    ) : (
      <ArrowDown className="w-3.5 h-3.5 text-blue-600 shrink-0 ml-1" />
    );
  };

  return (
    <div className="space-y-4">
      {/* Search Header Bar */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-100 dark:bg-blue-900/40 text-blue-700 dark:text-blue-400 flex items-center justify-center shrink-0 shadow-inner">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 dark:text-white tracking-tight">
              Universal Catalog Search
            </h3>
            <p className="text-xs text-slate-500 dark:text-slate-400">
              Instant multi-item search across your verified database & enterprise wholesale catalog.
            </p>
          </div>
        </div>

        {/* Search Input Form */}
        <form onSubmit={handleSearch} className="flex gap-2">
          <div className="relative flex-1">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
            <input
              type="text"
              value={searchInput}
              onChange={(e) => setSearchInput(e.target.value)}
              placeholder="Search by product name (e.g. Chocolate, Biscuit, Coffee), barcode, or SKU code..."
              className="w-full pl-10 pr-9 py-2.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-2xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-600 focus:bg-white dark:focus:bg-slate-800 transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-200 dark:hover:bg-slate-700"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          <button
            type="submit"
            disabled={isSearching || !searchInput.trim()}
            className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-extrabold text-xs rounded-2xl flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all shrink-0"
          >
            {isSearching ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Search className="w-4 h-4" />}
            <span>Search Catalog</span>
          </button>
        </form>
      </div>

      {/* Results Header with View Mode Switcher and Filters */}
      {hasSearched && (
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-3.5 sm:p-4 shadow-sm space-y-3">
          <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs text-slate-600 dark:text-slate-300">
            <div>
              Found <strong className="text-slate-900 dark:text-white font-bold">{processedResults.length}</strong> products matching "{searchInput}"
              <span className="text-[11px] text-slate-400 dark:text-slate-500 block sm:inline sm:ml-2">
                (Searched across database & product catalog)
              </span>
            </div>

            {results.length > 0 && (
              <div className="flex items-center gap-2 self-end sm:self-auto">
                {/* View switcher */}
                <div className="flex items-center bg-slate-100 dark:bg-slate-800 p-1 rounded-2xl border border-slate-200/80 dark:border-slate-700">
                  <button
                    type="button"
                    onClick={() => handleSetViewMode('table')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                      viewMode === 'table'
                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                    title="Rows / Table View"
                  >
                    <List className="w-3.5 h-3.5" />
                    <span>Rows List</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => handleSetViewMode('grid')}
                    className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                      viewMode === 'grid'
                        ? 'bg-white dark:bg-slate-700 text-blue-700 dark:text-blue-300 shadow-sm'
                        : 'text-slate-500 dark:text-slate-400 hover:text-slate-800 dark:hover:text-slate-200'
                    }`}
                    title="Grid / Cards View"
                  >
                    <LayoutGrid className="w-3.5 h-3.5" />
                    <span>Grid Cards</span>
                  </button>
                </div>
              </div>
            )}
          </div>

          {/* Search Result Filtering Options */}
          {results.length > 0 && (
            <div className="flex flex-wrap items-center gap-2 pt-1 border-t border-slate-100 dark:border-slate-800 text-xs">
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">Filter results:</span>

              {uniqueSuppliers.length > 1 && (
                <select
                  value={supplierFilter}
                  onChange={(e) => {
                    setSupplierFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Suppliers ({uniqueSuppliers.length})</option>
                  {uniqueSuppliers.map(sup => (
                    <option key={sup} value={sup}>{sup}</option>
                  ))}
                </select>
              )}

              {uniqueSources.length > 1 && (
                <select
                  value={sourceFilter}
                  onChange={(e) => {
                    setSourceFilter(e.target.value);
                    setCurrentPage(1);
                  }}
                  className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500"
                >
                  <option value="all">All Sources</option>
                  {uniqueSources.map(src => (
                    <option key={src} value={src}>{src}</option>
                  ))}
                </select>
              )}

              {hasActiveFilters && (
                <button
                  type="button"
                  onClick={resetFilters}
                  className="px-2.5 py-1.5 bg-slate-100 dark:bg-slate-800 hover:bg-slate-200 dark:hover:bg-slate-700 text-slate-600 dark:text-slate-300 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                >
                  <RotateCcw className="w-3 h-3" />
                  <span>Reset Filters</span>
                </button>
              )}

              <span className="text-[11px] text-slate-400 dark:text-slate-500 ml-auto">
                Click column headers to sort (<strong className="text-slate-700 dark:text-slate-300 capitalize">{sortField}</strong> {sortDirection === 'asc' ? '▲' : '▼'})
              </span>
            </div>
          )}
        </div>
      )}

      {/* Results List / Grid */}
      {isSearching ? (
        <div className="py-16 text-center text-slate-400 dark:text-slate-500 space-y-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6">
          <RefreshCw className="w-6 h-6 mx-auto animate-spin text-blue-600 dark:text-blue-400" />
          <p className="text-xs font-bold text-slate-600 dark:text-slate-300">Searching catalog...</p>
        </div>
      ) : hasSearched && processedResults.length === 0 ? (
        <div className="py-14 text-center text-slate-400 dark:text-slate-500 space-y-2 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-sm">
          <Package className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
          <p className="text-xs font-bold text-slate-700 dark:text-slate-200">
            {hasActiveFilters ? 'No products match the selected filters' : `No products found matching "${searchInput}"`}
          </p>
          <p className="text-[11px] text-slate-400 dark:text-slate-500">
            {hasActiveFilters ? 'Try resetting your supplier or source filters.' : 'Try searching with a shorter keyword or checking the barcode spelling.'}
          </p>
          {hasActiveFilters && (
            <button
              type="button"
              onClick={resetFilters}
              className="mt-2 text-blue-600 dark:text-blue-400 font-bold text-xs hover:underline"
            >
              Reset Filters
            </button>
          )}
        </div>
      ) : processedResults.length > 0 && viewMode === 'table' ? (
        /* TABLE / ROWS VIEW WITH SORTABLE HEADERS */
        <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 dark:bg-slate-800/80 border-b border-slate-200 dark:border-slate-800 text-[11px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400">
                  <th 
                    onClick={() => handleSort('id')}
                    className="py-3.5 px-4 font-black text-slate-900 dark:text-white w-16 cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by Serial Number"
                  >
                    <div className="flex items-center">
                      <span>SN</span>
                      {renderSortIndicator('id')}
                    </div>
                  </th>
                  <th className="py-3.5 px-3 w-14 text-center select-none">Photo</th>
                  <th 
                    onClick={() => handleSort('barcode')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by Barcode"
                  >
                    <div className="flex items-center">
                      <span>Barcode</span>
                      {renderSortIndicator('barcode')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('code')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by SKU / Code"
                  >
                    <div className="flex items-center">
                      <span>SKU / Code</span>
                      {renderSortIndicator('code')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('name')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by Product Name"
                  >
                    <div className="flex items-center">
                      <span>Product Name</span>
                      {renderSortIndicator('name')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('price')}
                    className="py-3.5 px-4 text-right font-bold cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by Price"
                  >
                    <div className="flex items-center justify-end">
                      <span>Price (w/ VAT)</span>
                      {renderSortIndicator('price')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('supplier')}
                    className="py-3.5 px-4 font-bold cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by Supplier"
                  >
                    <div className="flex items-center">
                      <span>Supplier</span>
                      {renderSortIndicator('supplier')}
                    </div>
                  </th>
                  <th 
                    onClick={() => handleSort('source')}
                    className="py-3.5 px-3 text-center font-bold cursor-pointer select-none hover:text-blue-600 dark:hover:text-blue-400 transition-colors group"
                    title="Click to sort by Source"
                  >
                    <div className="flex items-center justify-center">
                      <span>Source</span>
                      {renderSortIndicator('source')}
                    </div>
                  </th>
                  <th className="py-3.5 px-4 text-right font-bold w-24 select-none">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 dark:divide-slate-800 font-medium">
                {paginatedResults.map((item, idx) => {
                  const isSupabase = item.source?.includes('Supabase');
                  const hasPhoto = Boolean(item.imageUrl);
                  const serialNum = item.id || ((currentPage - 1) * pageSize + idx + 1);

                  return (
                    <tr key={`${item.barcode || item.code}-${idx}`} className="hover:bg-blue-50/30 dark:hover:bg-slate-800/50 transition-colors">
                      {/* 1. SN COLUMN AT FAR LEFT */}
                      <td className="py-3 px-4 font-mono">
                        <span className="font-black text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg text-xs">
                          #{serialNum}
                        </span>
                      </td>

                      {/* 2. Photo Thumbnail with Lightbox */}
                      <td className="py-2.5 px-3 text-center">
                        {hasPhoto ? (
                          <button
                            type="button"
                            onClick={() => setSelectedLightbox({
                              url: item.imageUrl,
                              title: item.name,
                              subtitle: `Barcode: ${item.barcode} • SN #${serialNum} • ${item.supplierName || 'Wholesale Supplier'}`
                            })}
                            className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 inline-block hover:opacity-85 hover:scale-105 transition-all shadow-xs cursor-zoom-in"
                            title="Click to zoom reference photo in fullscreen"
                          >
                            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-slate-100 dark:bg-slate-800 text-slate-400 flex items-center justify-center mx-auto border border-slate-200 dark:border-slate-700">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                        )}
                      </td>

                      {/* 3. Barcode */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-800 dark:text-slate-200">
                        {item.barcode}
                      </td>

                      {/* 4. SKU / Code */}
                      <td className="py-3 px-4 font-mono text-slate-600 dark:text-slate-400">
                        {item.code ? (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-700 dark:text-slate-300 font-bold text-[11px] border border-slate-200 dark:border-slate-700">
                            {item.code}
                          </span>
                        ) : (
                          <span className="text-slate-300 dark:text-slate-600 italic">—</span>
                        )}
                      </td>

                      {/* 5. Product Name */}
                      <td className="py-3 px-4 font-bold text-slate-900 dark:text-white max-w-xs truncate" title={item.name}>
                        {item.name}
                      </td>

                      {/* 6. Price */}
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-600 dark:text-emerald-400 text-sm">
                        ₱{Number(item.priceWithVat || item.price || 0).toFixed(2)}
                      </td>

                      {/* 7. Supplier */}
                      <td className="py-3 px-4 text-slate-700 dark:text-slate-300 font-semibold truncate max-w-[140px]">
                        {item.supplierName || 'Savemore'}
                      </td>

                      {/* 8. Source */}
                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider ${
                          isSupabase
                            ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                            : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                        }`}>
                          {isSupabase ? 'Database' : 'Catalog'}
                        </span>
                      </td>

                      {/* 9. Action */}
                      <td className="py-3 px-4 text-right">
                        {onImportToCatalog && !isSupabase && (
                          <button
                            type="button"
                            onClick={() => onImportToCatalog(item)}
                            className="px-2.5 py-1 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold rounded-lg text-xs transition-colors"
                            title="Add to Verified Saved Products"
                          >
                            + Save
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <TablePagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={processedResults.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setCurrentPage(1);
            }}
          />
        </div>
      ) : (
        /* GRID CARDS VIEW WITH LIGHTBOX */
        <div className="space-y-4">
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5 gap-3.5">
            {paginatedResults.map((item, idx) => {
              const hasPhoto = Boolean(item.imageUrl);
              const serialNum = item.id || ((currentPage - 1) * pageSize + idx + 1);
              const isSupabase = item.source?.includes('Supabase');

              return (
                <div 
                  key={`${item.barcode || item.code}-${idx}`}
                  className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 hover:border-blue-300 dark:hover:border-blue-700 rounded-3xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3 group"
                >
                  <div>
                    <div className="flex items-center justify-between mb-2">
                      <span className="font-mono font-black text-xs text-blue-900 dark:text-blue-300 bg-blue-50 dark:bg-blue-950/60 border border-blue-200/80 dark:border-blue-800 px-2 py-0.5 rounded-lg">
                        SN #{serialNum}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                        isSupabase
                          ? 'bg-purple-100 dark:bg-purple-950/60 text-purple-800 dark:text-purple-300 border border-purple-200 dark:border-purple-800'
                          : 'bg-blue-100 dark:bg-blue-950/60 text-blue-800 dark:text-blue-300 border border-blue-200 dark:border-blue-800'
                      }`}>
                        {isSupabase ? 'Database' : 'Catalog'}
                      </span>
                    </div>

                    <div className="flex items-start gap-3">
                      {hasPhoto ? (
                        <div 
                          onClick={() => setSelectedLightbox({
                            url: item.imageUrl,
                            title: item.name,
                            subtitle: `Barcode: ${item.barcode} • SN #${serialNum} • ${item.supplierName || 'Wholesale Supplier'}`
                          })}
                          className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 shrink-0 cursor-zoom-in hover:opacity-90 relative"
                          title="Click to zoom reference photo in fullscreen"
                        >
                          <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                        </div>
                      ) : (
                        <div className="w-16 h-16 rounded-2xl bg-blue-50 dark:bg-blue-950/40 text-blue-400 flex items-center justify-center shrink-0 border border-blue-100 dark:border-blue-900/50">
                          <ImageIcon className="w-6 h-6" />
                        </div>
                      )}

                      <div className="min-w-0 flex-1">
                        {item.code && (
                          <div className="text-[10px] font-mono text-slate-500 dark:text-slate-400 font-bold truncate mb-0.5">
                            SKU: <span className="text-slate-800 dark:text-slate-200">{item.code}</span>
                          </div>
                        )}
                        
                        <h4 className="font-bold text-slate-900 dark:text-white text-xs sm:text-sm line-clamp-2 leading-tight">
                          {item.name}
                        </h4>
                        
                        <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-1 truncate">
                          Barcode: <strong className="text-slate-800 dark:text-slate-200">{item.barcode}</strong>
                        </div>
                      </div>
                    </div>

                    <div className="mt-3 pt-2.5 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs">
                      <div>
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-medium">Price (w/ VAT)</span>
                        <span className="font-black text-emerald-600 dark:text-emerald-400 font-mono text-sm">
                          ₱{Number(item.priceWithVat || item.price || 0).toFixed(2)}
                        </span>
                      </div>

                      <div className="text-right">
                        <span className="text-[10px] text-slate-400 dark:text-slate-500 block font-medium">Supplier</span>
                        <span className="font-bold text-slate-700 dark:text-slate-300 truncate max-w-[120px] block">
                          {item.supplierName || 'Savemore'}
                        </span>
                      </div>
                    </div>
                  </div>

                  {onImportToCatalog && !isSupabase && (
                    <div className="pt-2 border-t border-slate-100 dark:border-slate-800 flex justify-end">
                      <button
                        type="button"
                        onClick={() => onImportToCatalog(item)}
                        className="px-3 py-1.5 bg-blue-50 dark:bg-blue-950/60 hover:bg-blue-100 dark:hover:bg-blue-900/60 text-blue-700 dark:text-blue-300 font-bold rounded-xl text-xs flex items-center gap-1 transition-colors"
                      >
                        <Plus className="w-3.5 h-3.5" />
                        <span>Save to DB</span>
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
          </div>
          <TablePagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={processedResults.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setCurrentPage(1);
            }}
          />
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

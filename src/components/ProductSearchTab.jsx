import React, { useState } from 'react';
import { Search, Package, RefreshCw, X, Image as ImageIcon, CheckCircle, Plus, ExternalLink, ArrowRight, List, LayoutGrid } from 'lucide-react';
import { catalogService } from '../services/catalogService';

export default function ProductSearchTab({ onInspectProduct, onImportToCatalog }) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);
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

    try {
      const items = await catalogService.searchAllProducts(query, 40);
      setResults(items);
    } catch (err) {
      console.warn('Multi-search error:', err);
      setResults([]);
    } finally {
      setIsSearching(false);
    }
  };

  const handleQuickSearch = (term) => {
    setSearchInput(term);
    setIsSearching(true);
    setHasSearched(true);
    catalogService.searchAllProducts(term, 40)
      .then(items => setResults(items))
      .finally(() => setIsSearching(false));
  };

  return (
    <div className="space-y-4">
      {/* Search Header Bar */}
      <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-blue-100 text-blue-700 flex items-center justify-center shrink-0 shadow-inner">
            <Search className="w-5 h-5" />
          </div>
          <div>
            <h3 className="text-base font-black text-slate-900 tracking-tight">
              Universal Catalog & Live PO Search Engine
            </h3>
            <p className="text-xs text-slate-500">
              Instant multi-item search across your custom Supabase database & coworker's 5,793 live ERPLY items.
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
              className="w-full pl-10 pr-9 py-2.5 bg-slate-50 border border-slate-300 rounded-2xl text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-all"
            />
            {searchInput && (
              <button
                type="button"
                onClick={() => setSearchInput('')}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-200"
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

        {/* Quick Suggestion Pills */}
        <div className="flex flex-wrap items-center gap-1.5 pt-1 text-xs">
          <span className="text-[11px] text-slate-400 font-semibold mr-1">Quick searches:</span>
          {['Chocolate', 'Oreo', 'Yakisoba', 'Coffee', 'Juice', 'Milk'].map(term => (
            <button
              key={term}
              type="button"
              onClick={() => handleQuickSearch(term)}
              className="px-2.5 py-1 bg-slate-100 hover:bg-slate-200 text-slate-700 rounded-xl text-[11px] font-bold transition-colors"
            >
              {term}
            </button>
          ))}
        </div>
      </div>

      {/* Results Header with View Mode Switcher */}
      {hasSearched && (
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-2 text-xs text-slate-600">
          <div>
            Found <strong className="text-slate-900 font-bold">{results.length}</strong> products matching "{searchInput}"
            <span className="text-[11px] text-slate-400 block sm:inline sm:ml-2">
              (Searched across Supabase DB + 5,793 Coworker items)
            </span>
          </div>

          {results.length > 0 && (
            <div className="flex items-center self-end sm:self-auto bg-slate-100 p-1 rounded-2xl border border-slate-200/80">
              <button
                type="button"
                onClick={() => handleSetViewMode('table')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  viewMode === 'table'
                    ? 'bg-white text-blue-700 shadow-sm'
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
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Grid / Cards View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Grid Cards</span>
              </button>
            </div>
          )}
        </div>
      )}

      {/* Results List / Grid */}
      {isSearching ? (
        <div className="py-16 text-center text-slate-400 space-y-2 bg-white border border-slate-200 rounded-3xl p-6">
          <RefreshCw className="w-6 h-6 mx-auto animate-spin text-blue-600" />
          <p className="text-xs font-bold text-slate-600">Searching all catalogs...</p>
        </div>
      ) : hasSearched && results.length === 0 ? (
        <div className="py-14 text-center text-slate-400 space-y-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <Package className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-xs font-bold text-slate-700">No products found matching "{searchInput}"</p>
          <p className="text-[11px] text-slate-400">Try searching with a shorter term or checking the barcode spelling.</p>
        </div>
      ) : results.length > 0 && viewMode === 'table' ? (
        /* TABLE / ROWS VIEW WITH SN COLUMN AT FAR LEFT */
        <div className="bg-white border border-slate-200 rounded-3xl overflow-hidden shadow-sm">
          <div className="overflow-x-auto">
            <table className="w-full text-left border-collapse text-xs">
              <thead>
                <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                  <th className="py-3.5 px-4 font-black text-slate-900 w-16">SN</th>
                  <th className="py-3.5 px-3 w-14 text-center">Photo</th>
                  <th className="py-3.5 px-4 font-bold">Barcode</th>
                  <th className="py-3.5 px-4 font-bold">SKU / Code</th>
                  <th className="py-3.5 px-4 font-bold">Product Name</th>
                  <th className="py-3.5 px-4 text-right font-bold">Price (w/ VAT)</th>
                  <th className="py-3.5 px-4 font-bold">Supplier</th>
                  <th className="py-3.5 px-3 text-center font-bold">Source</th>
                  <th className="py-3.5 px-4 text-right font-bold w-24">Action</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-100 font-medium">
                {results.map((item, idx) => {
                  const isSupabase = item.source?.includes('Supabase');
                  const hasPhoto = Boolean(item.imageUrl);
                  const serialNum = item.id || idx + 1;

                  return (
                    <tr key={`${item.barcode || item.code}-${idx}`} className="hover:bg-blue-50/30 transition-colors">
                      {/* 1. SN COLUMN AT FAR LEFT */}
                      <td className="py-3 px-4 font-mono">
                        <span className="font-black text-blue-900 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded-lg text-xs">
                          #{serialNum}
                        </span>
                      </td>

                      {/* 2. Photo */}
                      <td className="py-2.5 px-3 text-center">
                        {hasPhoto ? (
                          <button
                            type="button"
                            onClick={() => setSelectedPhoto(item.imageUrl)}
                            className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 inline-block hover:opacity-85 transition-opacity"
                            title="Click to zoom reference photo"
                          >
                            <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                          </button>
                        ) : (
                          <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto border border-slate-200">
                            <ImageIcon className="w-4 h-4" />
                          </div>
                        )}
                      </td>

                      {/* 3. Barcode */}
                      <td className="py-3 px-4 font-mono font-bold text-slate-800">
                        {item.barcode}
                      </td>

                      {/* 4. SKU / Code */}
                      <td className="py-3 px-4 font-mono text-slate-600">
                        {item.code ? (
                          <span className="px-2 py-0.5 rounded-md bg-slate-100 text-slate-700 font-bold text-[11px] border border-slate-200">
                            {item.code}
                          </span>
                        ) : (
                          <span className="text-slate-300 italic">—</span>
                        )}
                      </td>

                      {/* 5. Product Name */}
                      <td className="py-3 px-4 font-bold text-slate-900 max-w-xs truncate" title={item.name}>
                        {item.name}
                      </td>

                      {/* 6. Price */}
                      <td className="py-3 px-4 text-right font-mono font-black text-emerald-600 text-sm">
                        ₱{Number(item.priceWithVat || item.price || 0).toFixed(2)}
                      </td>

                      {/* 7. Supplier */}
                      <td className="py-3 px-4 text-slate-700 font-semibold truncate max-w-[140px]">
                        {item.supplierName || 'Savemore'}
                      </td>

                      {/* 8. Source Badge */}
                      <td className="py-3 px-3 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          isSupabase 
                            ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {isSupabase ? 'Supabase' : 'Coworker'}
                        </span>
                      </td>

                      {/* 9. Action */}
                      <td className="py-3 px-4 text-right">
                        {onInspectProduct && (
                          <button
                            type="button"
                            onClick={() => onInspectProduct(item)}
                            className="px-2.5 py-1.5 bg-slate-100 hover:bg-blue-50 hover:text-blue-700 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold inline-flex items-center gap-1 transition-colors"
                          >
                            <span>Inspect</span>
                            <ArrowRight className="w-3 h-3" />
                          </button>
                        )}
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
          <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 font-semibold px-4 flex justify-between">
            <span>Showing {results.length} search results</span>
            <span>Sorted by relevance & SN</span>
          </div>
        </div>
      ) : results.length > 0 ? (
        /* CARDS / GRID VIEW */
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {results.map((item, idx) => {
            const isSupabase = item.source?.includes('Supabase');
            const hasPhoto = Boolean(item.imageUrl);
            const serialNum = item.id || idx + 1;

            return (
              <div
                key={`${item.barcode || item.code}-${idx}`}
                className="bg-white border border-slate-200 hover:border-blue-300 rounded-3xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3"
              >
                <div>
                  {/* Top: SN Badge + Source Badge */}
                  <div className="flex items-center justify-between mb-2">
                    <span className="font-mono font-black text-xs text-blue-900 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded-lg">
                      SN #{serialNum}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-[9px] font-black uppercase tracking-wider ${
                      isSupabase 
                        ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                        : 'bg-blue-100 text-blue-800'
                    }`}>
                      {isSupabase ? 'Supabase Custom' : 'Coworker API'}
                    </span>
                  </div>

                  {/* Photo & Details */}
                  <div className="flex items-start gap-3">
                    {hasPhoto ? (
                      <div 
                        onClick={() => setSelectedPhoto(item.imageUrl)}
                        className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0 cursor-pointer hover:opacity-90 relative"
                      >
                        <img src={item.imageUrl} alt={item.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-blue-50 text-blue-400 flex items-center justify-center shrink-0 border border-blue-100">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      {item.code && (
                        <div className="text-[10px] font-mono text-slate-500 font-bold truncate mb-0.5">
                          SKU: <span className="text-slate-800">{item.code}</span>
                        </div>
                      )}

                      <h4 className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-2 leading-tight">
                        {item.name}
                      </h4>

                      <div className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                        Barcode: <strong className="text-slate-800">{item.barcode}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Metadata */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Price (w/ VAT)</span>
                      <span className="font-black text-emerald-600 font-mono text-sm">
                        ₱{Number(item.priceWithVat || item.price || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-medium">Supplier</span>
                      <span className="font-bold text-slate-700 truncate max-w-[120px] block">
                        {item.supplierName || 'Savemore'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-between">
                  <span className="text-[10px] text-slate-400">
                    Unit: {item.unitName || 'pc'}
                  </span>

                  {onInspectProduct && (
                    <button
                      type="button"
                      onClick={() => onInspectProduct(item)}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                    >
                      <span>View Details</span>
                      <ArrowRight className="w-3.5 h-3.5" />
                    </button>
                  )}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}
      {selectedPhoto && (
        <div 
          onClick={() => setSelectedPhoto(null)} 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="relative max-w-lg w-full bg-white rounded-3xl overflow-hidden shadow-2xl p-2" onClick={e => e.stopPropagation()}>
            <img src={selectedPhoto} alt="Product Reference" className="w-full h-auto max-h-[75vh] object-contain rounded-2xl" />
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 right-4 p-2 bg-slate-900/70 hover:bg-slate-900 text-white rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

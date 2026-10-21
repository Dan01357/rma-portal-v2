import React, { useState } from 'react';
import { Search, Package, RefreshCw, X, Image as ImageIcon, CheckCircle, Plus, ExternalLink, ArrowRight } from 'lucide-react';
import { catalogService } from '../services/catalogService';

export default function ProductSearchTab({ onInspectProduct, onImportToCatalog }) {
  const [searchInput, setSearchInput] = useState('');
  const [results, setResults] = useState([]);
  const [isSearching, setIsSearching] = useState(false);
  const [hasSearched, setHasSearched] = useState(false);
  const [selectedPhoto, setSelectedPhoto] = useState(null);

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

      {/* Results Header */}
      {hasSearched && (
        <div className="flex items-center justify-between px-2 text-xs text-slate-600">
          <div>
            Found <strong className="text-slate-900 font-bold">{results.length}</strong> products matching "{searchInput}"
          </div>
          <span className="text-[11px] text-slate-400">
            Searched across Supabase DB + 5,793 Coworker items
          </span>
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
      ) : results.length > 0 ? (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {results.map((item, idx) => {
            const isSupabase = item.source?.includes('Supabase');
            const hasPhoto = Boolean(item.imageUrl);

            return (
              <div
                key={`${item.barcode || item.code}-${idx}`}
                className="bg-white border border-slate-200 hover:border-blue-300 rounded-3xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3"
              >
                <div>
                  {/* Photo & Source Badge */}
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
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className={`px-2 py-0.2 rounded-full text-[9px] font-black uppercase tracking-wider ${
                          isSupabase 
                            ? 'bg-purple-100 text-purple-800 border border-purple-200' 
                            : 'bg-blue-100 text-blue-800'
                        }`}>
                          {isSupabase ? 'Supabase Custom' : 'Coworker API'}
                        </span>
                        {item.code && (
                          <span className="text-[10px] font-mono text-slate-500 font-bold truncate">
                            {item.code}
                          </span>
                        )}
                      </div>

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

      {/* Photo Lightbox */}
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

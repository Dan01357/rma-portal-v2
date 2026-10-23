import React, { useState, useEffect, useRef, useMemo } from 'react';
import { 
  Package, 
  Search, 
  Building2, 
  Sparkles, 
  Check, 
  Tag, 
  ChevronDown, 
  RefreshCw, 
  Coins,
  ArrowRight
} from 'lucide-react';
import { purchaseOrdersApi } from '../services/purchaseOrdersApi';
import { catalogService } from '../services/catalogService';

/**
 * Product & SKU Real-Time Auto-Suggest Input
 * 
 * - Supports searching by Product Name OR SKU / Item Code
 * - Queries Coworker's live Purchase Order / Erply DB (5,793+ SKUs)
 * - Concurrently searches saved products catalog in Supabase
 * - Auto-populates: Name, SKU, Supplier, Base Price, Price w/ VAT, Unit
 * - Keyboard navigation (Up/Down/Enter/Escape) & mobile-optimized touch
 */
export default function ProductAutoSuggest({
  mode = 'name', // 'name' | 'code'
  value = '',
  onChange,
  onSelectProduct,
  placeholder,
  className = '',
  id,
  name,
  required = false,
  error = null,
  disabled = false
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [suggestions, setSuggestions] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const [localCatalog, setLocalCatalog] = useState([]);
  const [lastSelected, setLastSelected] = useState(null);

  const wrapperRef = useRef(null);
  const debounceTimerRef = useRef(null);

  // Pre-fetch local catalog once for instant offline/zero-latency matching
  useEffect(() => {
    let isMounted = true;
    const loadCatalog = async () => {
      try {
        const fetchFn = catalogService.getSavedProducts || catalogService.getProducts;
        if (typeof fetchFn === 'function') {
          const products = await fetchFn.call(catalogService);
          if (isMounted && Array.isArray(products)) {
            setLocalCatalog(products);
          }
        }
      } catch (err) {
        console.warn('[ProductAutoSuggest] Catalog prefetch notice:', err?.message || err);
      }
    };
    loadCatalog();
    return () => { isMounted = false; };
  }, []);

  // Close dropdown on click outside
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Perform search whenever value changes
  useEffect(() => {
    const query = String(value || '').trim();

    // If query is short or matches the exact item that was just selected, don't re-trigger popover
    if (query.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      return;
    }

    if (lastSelected && (
      (mode === 'name' && query.toLowerCase() === (lastSelected.name || '').toLowerCase()) ||
      (mode === 'code' && query.toLowerCase() === (lastSelected.code || lastSelected.sku || '').toLowerCase())
    )) {
      return;
    }

    if (debounceTimerRef.current) {
      clearTimeout(debounceTimerRef.current);
    }

    debounceTimerRef.current = setTimeout(async () => {
      setIsLoading(true);
      const cleanLower = query.toLowerCase();

      try {
        // 1. Search local saved products
        const localMatches = localCatalog
          .filter(p => {
            const pName = String(p.name || '').toLowerCase();
            const pCode = String(p.code || p.sku || '').toLowerCase();
            const pBarcode = String(p.barcode || '').toLowerCase();
            return pName.includes(cleanLower) || pCode.includes(cleanLower) || pBarcode.includes(cleanLower);
          })
          .map(p => ({
            id: p.id || p.code || p.sku,
            name: p.name,
            code: p.code || p.sku,
            sku: p.code || p.sku,
            barcode: p.barcode,
            supplierName: p.supplier_name || p.supplierName || 'Savemore',
            price: Number(p.price || 0),
            priceWithVat: Number(p.price_with_vat || (p.price ? p.price * 1.12 : 0)).toFixed(2),
            unitName: p.unit_name || p.unitName || 'pc',
            imageUrl: p.image_url || p.imageUrl || '',
            brandName: p.brand_name || p.brand || '',
            source: 'Master Catalog',
            isCatalog: true
          }));

        // 2. Query coworker external database API (erply_products)
        let apiMatches = [];
        try {
          const remoteResults = await purchaseOrdersApi.searchProducts(query, 30);
          if (Array.isArray(remoteResults)) {
            apiMatches = remoteResults.map(item => {
              const basePrice = item.unit_price ? Number(item.unit_price) : 0;
              const pVat = item.raw_data?.priceWithVat 
                ? Number(item.raw_data.priceWithVat).toFixed(2)
                : (basePrice ? (basePrice * 1.12).toFixed(2) : '0.00');

              return {
                id: item.id || item.sku,
                name: item.name,
                code: item.sku || item.barcode,
                sku: item.sku,
                barcode: item.barcode,
                supplierName: item.supplier || item.raw_data?.supplierName || 'Savemore',
                price: Number(basePrice.toFixed(2)),
                priceWithVat: pVat,
                unitName: item.raw_data?.unitName || 'pc',
                imageUrl: item.image_url || '',
                brandName: item.brand || item.raw_data?.brandName || '',
                source: 'Coworker Erply DB',
                isCatalog: false
              };
            });
          }
        } catch (apiErr) {
          console.warn('[ProductAutoSuggest] Coworker API query notice:', apiErr.message);
        }

        // 3. Deduplicate by code / sku / name (local catalog takes priority)
        const combined = [...localMatches];
        const seenKeys = new Set(localMatches.map(m => `${(m.code || '').toLowerCase()}-${(m.name || '').toLowerCase()}`));

        for (const item of apiMatches) {
          const key = `${(item.code || '').toLowerCase()}-${(item.name || '').toLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            combined.push(item);
          }
        }

        setSuggestions(combined.slice(0, 15));
        setIsOpen(combined.length > 0);
        setHighlightedIndex(-1);
      } catch (err) {
        console.warn('[ProductAutoSuggest] Search error:', err);
      } finally {
        setIsLoading(false);
      }
    }, 220);

    return () => {
      if (debounceTimerRef.current) {
        clearTimeout(debounceTimerRef.current);
      }
    };
  }, [value, mode, localCatalog, lastSelected]);

  const handleSelect = (product) => {
    setLastSelected(product);
    setIsOpen(false);
    setSuggestions([]);
    setHighlightedIndex(-1);

    if (onSelectProduct) {
      onSelectProduct(product);
    } else if (onChange) {
      onChange(mode === 'code' ? (product.code || product.sku) : product.name);
    }
  };

  const handleKeyDown = (e) => {
    if (!isOpen || suggestions.length === 0) {
      if (e.key === 'ArrowDown' && suggestions.length > 0) {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < suggestions.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : suggestions.length - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && suggestions[highlightedIndex]) {
        e.preventDefault();
        handleSelect(suggestions[highlightedIndex]);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative flex items-center">
        <input
          id={id}
          name={name}
          type="text"
          autoComplete="off"
          disabled={disabled}
          required={required}
          value={value}
          onChange={(e) => {
            onChange(e.target.value);
            setLastSelected(null);
          }}
          onFocus={() => {
            if (suggestions.length > 0) setIsOpen(true);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (mode === 'code' ? 'e.g. P124124141 (auto-suggests from DB)' : 'e.g. Oishi Popcorn Chocolate (auto-suggests from DB)')}
          className={`${className} ${isLoading ? 'pr-8' : ''}`}
        />

        {isLoading && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 text-blue-600 dark:text-blue-400 pointer-events-none">
            <RefreshCw className="w-3.5 h-3.5 animate-spin" />
          </div>
        )}
      </div>

      {error && (
        <p className="text-[11px] font-bold text-rose-600 dark:text-rose-400 mt-1">
          {error}
        </p>
      )}

      {/* Floating Suggestions Dropdown */}
      {isOpen && suggestions.length > 0 && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-2xl z-50 overflow-hidden max-h-72 overflow-y-auto animate-in fade-in zoom-in-95 duration-150 divide-y divide-slate-100 dark:divide-slate-800">
          {/* Header pill strip */}
          <div className="px-3 py-1.5 bg-slate-50 dark:bg-slate-800/80 text-[10px] font-black uppercase tracking-wider text-slate-500 dark:text-slate-400 flex items-center justify-between sticky top-0 backdrop-blur-xs z-10 border-b border-slate-100 dark:border-slate-700/60">
            <span className="flex items-center gap-1.5">
              <Sparkles className="w-3 h-3 text-blue-600 dark:text-blue-400" />
              <span>Select to Auto-Populate Product Details</span>
            </span>
            <span className="font-mono text-[9px] bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 px-1.5 py-0.5 rounded-md font-bold">
              {suggestions.length} match{suggestions.length > 1 ? 'es' : ''}
            </span>
          </div>

          {/* List items */}
          <div className="p-1 space-y-0.5">
            {suggestions.map((item, idx) => {
              const isHighlighted = idx === highlightedIndex;

              return (
                <button
                  key={`${item.code}-${idx}`}
                  type="button"
                  onClick={() => handleSelect(item)}
                  onMouseEnter={() => setHighlightedIndex(idx)}
                  className={`w-full text-left p-2.5 rounded-xl text-xs transition-all cursor-pointer flex items-start justify-between gap-3 ${
                    isHighlighted
                      ? 'bg-blue-50 dark:bg-blue-950/70 border border-blue-200 dark:border-blue-800 shadow-xs'
                      : 'hover:bg-slate-50 dark:hover:bg-slate-800/60 border border-transparent'
                  }`}
                >
                  <div className="min-w-0 flex-1 space-y-1">
                    {/* Item Name */}
                    <div className="font-bold text-slate-900 dark:text-white text-xs leading-snug line-clamp-2">
                      {item.name}
                    </div>

                    {/* Metadata tags: SKU, Supplier, Unit */}
                    <div className="flex flex-wrap items-center gap-1.5 text-[10px]">
                      {item.code && (
                        <span className="font-mono font-bold px-1.5 py-0.5 rounded-md bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700">
                          SKU: {item.code}
                        </span>
                      )}

                      {item.supplierName && (
                        <span className="inline-flex items-center gap-0.5 text-slate-600 dark:text-slate-400 font-medium">
                          <Building2 className="w-2.5 h-2.5 opacity-70" />
                          <span>{item.supplierName}</span>
                        </span>
                      )}

                      {item.unitName && (
                        <span className="text-slate-400 dark:text-slate-500 font-mono">
                          • {item.unitName}
                        </span>
                      )}

                      <span className={`px-1.5 py-0.5 rounded-md text-[9px] font-extrabold ${
                        item.isCatalog 
                          ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
                          : 'bg-indigo-50 text-indigo-700 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800'
                      }`}>
                        {item.source}
                      </span>
                    </div>
                  </div>

                  {/* Price & Selection Pill */}
                  <div className="text-right shrink-0 space-y-0.5">
                    <div className="font-mono font-black text-slate-900 dark:text-white text-xs">
                      ₱{Number(item.priceWithVat || item.price || 0).toFixed(2)}
                    </div>
                    <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                      Base: ₱{Number(item.price || 0).toFixed(2)}
                    </div>
                    <span className="inline-flex items-center gap-0.5 text-[10px] font-bold text-blue-600 dark:text-blue-400">
                      <span>Select</span>
                      <ArrowRight className="w-2.5 h-2.5" />
                    </span>
                  </div>
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

import React, { useState, useEffect, useRef } from 'react';
import { 
  Building2, 
  Sparkles, 
  RefreshCw, 
  ArrowRight
} from 'lucide-react';
import { purchaseOrdersApi } from '../services/purchaseOrdersApi';
import { catalogService } from '../services/catalogService';

function mapSuggestionProduct(item, defaultSource, isCatalog) {
  const rawBrand = item.brandName || item.brand_name || item.brand || item.raw_data?.brandName || '';
  const pcsMatch = String(rawBrand).match(/\[Pcs\/Cs:(\d+)\]/);
  const rawPcs = item.pieces_per_case ?? item.piecesPerCase ?? (pcsMatch ? parseInt(pcsMatch[1], 10) : null);
  const numPcs = Number(rawPcs);
  const parsedPcs = Number.isFinite(numPcs) && numPcs > 0 ? numPcs : null;
  const barcodeStr = String(item.barcode || item.raw_data?.ean_code || '').trim();
  const rawCode = String(item.code || item.sku || '').trim();
  const rawSku = (rawCode && rawCode !== barcodeStr) ? rawCode : '';
  const netPrice = Number(item.price ?? item.unit_price ?? 0);
  const vatRaw = item.priceWithVat ?? item.price_with_vat ?? item.raw_data?.priceWithVat;
  const priceWithVat = Number(vatRaw || (netPrice > 0 ? netPrice * 1.12 : 0));
  const rawSup = String(item.supplierName || item.supplier_name || item.supplier || item.raw_data?.supplierName || '').trim();
  const cleanSup = rawSup.toLowerCase() === 'pending assignment' ? '' : rawSup;
  const cleanUnit = String(item.unitName || item.unit_name || item.raw_data?.unitName || 'pc').trim() || 'pc';

  return {
    id: item.id || rawSku || barcodeStr,
    name: item.name || '',
    code: rawSku,
    sku: rawSku,
    barcode: barcodeStr,
    supplierName: cleanSup,
    supplier_name: cleanSup,
    price: Number(netPrice.toFixed(2)),
    priceWithVat: priceWithVat.toFixed(2),
    price_with_vat: priceWithVat.toFixed(2),
    unitName: cleanUnit,
    unit_name: cleanUnit,
    pieces_per_case: parsedPcs,
    piecesPerCase: parsedPcs,
    imageUrl: item.imageUrl || item.image_url || '',
    brandName: String(rawBrand).replace(/\s*\[Pcs\/Cs:\d+\]/g, '').trim(),
    source: isCatalog ? defaultSource : (item.source || defaultSource),
    isCatalog
  };
}

/**
 * Product & SKU Real-Time Auto-Suggest Input
 * 
 * - Supports searching by Product Name OR SKU / Item Code
 * - Queries Enterprise Erply DB (5,793+ SKUs) & Supabase Saved Products
 * - Auto-populates all details on selection WITHOUT re-opening dropdown on other fields
 * - Strictly no fake/auto-generated images or data
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
  const isFocusedRef = useRef(false);
  const userTypedRef = useRef(false);

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
        userTypedRef.current = false;
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    document.addEventListener('touchstart', handleClickOutside);
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
    };
  }, []);

  // Perform search ONLY when value changes due to explicit user typing in THIS field
  useEffect(() => {
    // If change was not initiated by user typing in this specific input, never open or search
    if (!userTypedRef.current) {
      setIsOpen(false);
      setIsLoading(false);
      return;
    }

    const query = String(value || '').trim();

    // If query is short or matches the exact item that was just selected, don't re-trigger popover
    if (query.length < 2) {
      setSuggestions([]);
      setIsLoading(false);
      setIsOpen(false);
      return;
    }

    if (lastSelected && (
      (mode === 'name' && query.toLowerCase() === (lastSelected.name || '').toLowerCase()) ||
      (mode === 'code' && query.toLowerCase() === (lastSelected.code || lastSelected.sku || '').toLowerCase())
    )) {
      setIsOpen(false);
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
          .map(p => mapSuggestionProduct(p, 'Master Catalog', true));

        // 2. Query live database API (via unified catalogService serverless proxy & purchaseOrdersApi)
        let apiMatches = [];
        try {
          const remoteResults = await catalogService.searchAllProducts(query, 30);
          if (Array.isArray(remoteResults) && remoteResults.length > 0) {
            apiMatches = remoteResults.map(item => mapSuggestionProduct(item, 'Catalog API', false));
          } else {
            const fallbackResults = await purchaseOrdersApi.searchProducts(query, 30);
            if (Array.isArray(fallbackResults)) {
              apiMatches = fallbackResults.map(item => mapSuggestionProduct(item, 'Erply Catalog', false));
            }
          }
        } catch (apiErr) {
          console.warn('[ProductAutoSuggest] API query notice:', apiErr.message);
        }

        // 3. Deduplicate by code / barcode / name (local catalog takes priority)
        const combined = [...localMatches];
        const seenKeys = new Set(
          localMatches.map(m => `${(m.code || m.barcode || '').toLowerCase()}-${(m.name || '').toLowerCase()}`)
        );

        for (const item of apiMatches) {
          const key = `${(item.code || item.barcode || '').toLowerCase()}-${(item.name || '').toLowerCase()}`;
          if (!seenKeys.has(key)) {
            seenKeys.add(key);
            combined.push(item);
          }
        }

        // Open dropdown if user typed in this field
        if (userTypedRef.current) {
          setSuggestions(combined.slice(0, 20));
          setIsOpen(combined.length > 0);
          setHighlightedIndex(-1);
        }
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
    userTypedRef.current = false;
    isFocusedRef.current = false;
    setLastSelected(product);
    setIsOpen(false);
    setSuggestions([]);
    setHighlightedIndex(-1);

    if (onSelectProduct) {
      onSelectProduct(product);
    } else if (onChange) {
      const cleanSku = (product.code && product.code !== product.barcode) 
        ? product.code 
        : ((product.sku && product.sku !== product.barcode) ? product.sku : '');
      onChange(mode === 'code' ? cleanSku : product.name);
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
      userTypedRef.current = false;
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
            userTypedRef.current = true;
            onChange(e.target.value);
            setLastSelected(null);
          }}
          onFocus={() => {
            isFocusedRef.current = true;
            if (suggestions.length > 0 && userTypedRef.current) {
              setIsOpen(true);
            }
          }}
          onBlur={() => {
            isFocusedRef.current = false;
            // Delay closing to allow taps or clicks on dropdown items
            setTimeout(() => {
              setIsOpen(false);
              userTypedRef.current = false;
            }, 350);
          }}
          onKeyDown={handleKeyDown}
          placeholder={placeholder || (mode === 'code' ? 'e.g. P124124141' : 'e.g. Oishi Popcorn Chocolate 60g')}
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
                  onMouseDown={(e) => {
                    // Prevent blur from closing dropdown before click registers
                    e.preventDefault();
                    handleSelect(item);
                  }}
                  onTouchEnd={(e) => {
                    e.preventDefault();
                    handleSelect(item);
                  }}
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
                    {item.priceWithVat && Number(item.priceWithVat) > 0 ? (
                      <>
                        <div className="font-mono font-black text-slate-900 dark:text-white text-xs">
                          ₱{Number(item.priceWithVat || item.price || 0).toFixed(2)}
                        </div>
                        <div className="text-[10px] text-slate-500 dark:text-slate-400 font-mono">
                          Base: ₱{Number(item.price || 0).toFixed(2)}
                        </div>
                      </>
                    ) : (
                      <span className="text-[10px] text-slate-400 font-mono italic">
                        No Price
                      </span>
                    )}
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

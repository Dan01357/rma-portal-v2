import React, { useState, useEffect, useRef } from 'react';
import { Building2, Check, Sparkles } from 'lucide-react';
import { catalogService } from '../services/catalogService';

/**
 * Modern Autocomplete Input for Supplier Names
 * - Automatically loads existing suppliers from catalog and RMA returns
 * - Shows instantaneous match suggestions (e.g. typing "Save" suggests "Savemore")
 * - Prevents discrepancies like Savemore vs Save More vs savemore
 */
export default function SupplierInput({
  value = '',
  onChange,
  placeholder = 'e.g. Savemore, Walter Mart, Mondelez',
  className = '',
  id = 'supplier-name-input',
  name = 'supplierName',
  required = false
}) {
  const [knownSuppliers, setKnownSuppliers] = useState([
    'Savemore',
    'Walter Mart',
    'SM Supermarket',
    'Puregold',
    'Robinsons Supermarket',
    'Mondelez',
    'Universal Robina Corporation (URC)',
    'Bonita',
    'Keysys',
    'A2Z2GO',
    'Pingcon Marketing'
  ]);
  const [isOpen, setIsOpen] = useState(false);
  const [highlightedIndex, setHighlightedIndex] = useState(-1);
  const wrapperRef = useRef(null);

  useEffect(() => {
    let mounted = true;
    catalogService.getUniqueSuppliers().then(list => {
      if (mounted && Array.isArray(list) && list.length > 0) {
        setKnownSuppliers(list);
      }
    }).catch(() => {});
    return () => { mounted = false; };
  }, []);

  // Close on outside click
  useEffect(() => {
    function handleClickOutside(event) {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const cleanValue = String(value || '').trim();
  const cleanLower = cleanValue.toLowerCase();

  // Find matches that contain the query
  const matchingSuppliers = knownSuppliers.filter(s => {
    if (!cleanLower) return true;
    return s.toLowerCase().includes(cleanLower);
  });

  // Check if there is a primary suggestion that doesn't exactly match what was typed
  const topSuggestion = matchingSuppliers.find(
    s => s.toLowerCase() !== cleanLower && s.toLowerCase().startsWith(cleanLower)
  ) || matchingSuppliers.find(s => s.toLowerCase() !== cleanLower);

  const handleSelect = (supplier) => {
    onChange(supplier);
    setIsOpen(false);
    setHighlightedIndex(-1);
  };

  const handleKeyDown = (e) => {
    if (!isOpen || matchingSuppliers.length === 0) {
      if (e.key === 'ArrowDown') {
        setIsOpen(true);
      }
      return;
    }

    if (e.key === 'ArrowDown') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev < matchingSuppliers.length - 1 ? prev + 1 : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setHighlightedIndex(prev => (prev > 0 ? prev - 1 : matchingSuppliers.length - 1));
    } else if (e.key === 'Enter') {
      if (highlightedIndex >= 0 && matchingSuppliers[highlightedIndex]) {
        e.preventDefault();
        handleSelect(matchingSuppliers[highlightedIndex]);
      } else if (topSuggestion) {
        e.preventDefault();
        handleSelect(topSuggestion);
      }
    } else if (e.key === 'Escape') {
      setIsOpen(false);
    }
  };

  return (
    <div className="relative w-full" ref={wrapperRef}>
      <div className="relative">
        <input
          id={id}
          name={name}
          type="text"
          autoComplete="off"
          list="known-suppliers-datalist"
          value={value}
          required={required}
          onChange={(e) => {
            onChange(e.target.value);
            setIsOpen(true);
            setHighlightedIndex(-1);
          }}
          onFocus={() => setIsOpen(true)}
          onKeyDown={handleKeyDown}
          placeholder={placeholder}
          className={className}
        />

        <datalist id="known-suppliers-datalist">
          {knownSuppliers.map((s) => (
            <option key={s} value={s} />
          ))}
        </datalist>
      </div>

      {/* Quick Suggestion Pill when typing (e.g. typing "Save" suggests "Savemore") */}
      {cleanValue && topSuggestion && cleanLower !== topSuggestion.toLowerCase() && (
        <div className="mt-1 flex items-center gap-1.5 text-[11px] animate-in fade-in">
          <span className="text-slate-500 dark:text-slate-400 font-medium">Suggestion:</span>
          <button
            type="button"
            onClick={() => handleSelect(topSuggestion)}
            className="px-2 py-0.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900 border border-indigo-200 dark:border-indigo-800 text-indigo-700 dark:text-indigo-300 rounded-lg font-bold flex items-center gap-1 transition-colors cursor-pointer shadow-2xs"
            title={`Auto-fill "${topSuggestion}" to prevent discrepancy`}
          >
            <Sparkles className="w-3 h-3 text-indigo-500" />
            <span>Use "{topSuggestion}"</span>
          </button>
        </div>
      )}

      {/* Floating Dropdown of Matching Suppliers */}
      {isOpen && matchingSuppliers.length > 0 && cleanValue && (
        <div className="absolute left-0 right-0 top-full mt-1.5 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-2xl shadow-xl z-50 overflow-hidden max-h-56 overflow-y-auto animate-in fade-in zoom-in-95 duration-150">
          <div className="p-1.5">
            <div className="px-2.5 py-1 text-[10px] font-black tracking-wider uppercase text-slate-400 dark:text-slate-500 border-b border-slate-100 dark:border-slate-800 mb-1 flex items-center justify-between">
              <span>Recorded Suppliers</span>
              <span>{matchingSuppliers.length} match{matchingSuppliers.length > 1 ? 'es' : ''}</span>
            </div>
            {matchingSuppliers.slice(0, 8).map((supplier, idx) => {
              const isSelected = supplier.toLowerCase() === cleanLower;
              const isHighlighted = idx === highlightedIndex;

              return (
                <button
                  key={supplier}
                  type="button"
                  onClick={() => handleSelect(supplier)}
                  className={`w-full text-left px-3 py-2 rounded-xl text-xs font-semibold flex items-center justify-between transition-colors cursor-pointer ${
                    isHighlighted || isSelected
                      ? 'bg-blue-50 dark:bg-blue-950/60 text-blue-700 dark:text-blue-300 font-bold'
                      : 'text-slate-700 dark:text-slate-200 hover:bg-slate-100 dark:hover:bg-slate-800'
                  }`}
                >
                  <div className="flex items-center gap-2">
                    <Building2 className={`w-3.5 h-3.5 ${isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-slate-400'}`} />
                    <span>{supplier}</span>
                  </div>
                  {isSelected && (
                    <Check className="w-3.5 h-3.5 text-blue-600 dark:text-blue-400" />
                  )}
                </button>
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}

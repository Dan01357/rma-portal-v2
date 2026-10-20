import React, { useState, useEffect } from 'react';
import { Barcode, Search, CheckCircle, AlertCircle, RefreshCw, X, Server, Database, Code, Camera } from 'lucide-react';
import { purchaseOrdersApi } from './services/purchaseOrdersApi';
import ScannerModal from './components/ScannerModal';

/**
 * DIRECT API CONNECTION TESTER & SKU LOOKUP (WITH MOBILE CAMERA SCANNER)
 * 
 * Target Server: https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1
 * Database Table: erply_products (5,793 live items)
 */
export default function App() {
  // 1. Connection Health State
  const [connectionStatus, setConnectionStatus] = useState({ checking: true, connected: false, message: '' });
  
  // 2. Search & Scanned Product State
  const [searchInput, setSearchInput] = useState('');
  const [scannedProduct, setScannedProduct] = useState(null);
  const [searchResultsList, setSearchResultsList] = useState([]);
  const [rawApiResponse, setRawApiResponse] = useState(null);
  const [showRawJson, setShowRawJson] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [statusMessage, setStatusMessage] = useState(null);
  const [isScannerOpen, setIsScannerOpen] = useState(false);

  // Ping your coworker's API as soon as the page loads
  useEffect(() => {
    async function pingApi() {
      try {
        const res = await purchaseOrdersApi.testConnection();
        setConnectionStatus({
          checking: false,
          connected: res.connected,
          message: res.connected 
            ? 'Connected to live Laravel Cloud API (24 tables online)' 
            : `Could not reach API: ${res.error || 'Check internet'}`
        });
      } catch (e) {
        setConnectionStatus({
          checking: false,
          connected: false,
          message: 'Connection failed: ' + e.message
        });
      }
    }
    pingApi();
  }, []);

  const showNotice = (text, type = 'success') => {
    setStatusMessage({ text, type });
    setTimeout(() => setStatusMessage(null), 4000);
  };

  // LOOKUP FUNCTION: Calls your coworker's API live
  const handleLookup = async (queryToSearch) => {
    const query = (queryToSearch || searchInput).trim();
    if (!query) return;

    setIsLoading(true);
    setScannedProduct(null);
    setRawApiResponse(null);
    setSearchResultsList([]);

    try {
      // 1. Query live products using smart search (handles tissue, chocolate, nissin, etc.)
      const results = await purchaseOrdersApi.searchProducts(query, 250);

      if (results && results.length > 0) {
        setSearchResultsList(results);
        const first = results[0];
        setScannedProduct(first);
        setRawApiResponse(first.raw_data || first);
        const total = results.totalRecords || results.length;
        showNotice(`Found ${total} live product(s) for "${query}" (displaying all ${results.length})!`, 'success');
      } else {
        // Fallback: direct code lookup
        const single = await purchaseOrdersApi.findProductByBarcode(query);
        if (single) {
          setSearchResultsList([single]);
          setScannedProduct(single);
          setRawApiResponse(single.raw_data || single);
          showNotice(`Found: "${single.name}" in live database!`, 'success');
        } else {
          showNotice(`No product found for "${query}" in 5,793 items.`, 'warning');
        }
      }
    } catch (err) {
      console.error('API Error:', err);
      showNotice('API Error: ' + err.message, 'warning');
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="min-h-screen bg-slate-100 text-slate-800 font-sans p-4 sm:p-8">
      <div className="max-w-2xl mx-auto space-y-6">

        {/* 1. SERVER CONNECTION STATUS BAR */}
        <div className="bg-white border border-slate-200 rounded-2xl p-4 shadow-sm flex items-center justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <Server className="w-5 h-5 text-slate-400 shrink-0" />
            <div>
              <div className="flex items-center gap-2">
                <span className="text-xs font-bold uppercase tracking-wider text-slate-500">
                  Coworker's API Status:
                </span>
                {connectionStatus.checking ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-amber-600">
                    <RefreshCw className="w-3 h-3 animate-spin" /> Pinging server...
                  </span>
                ) : connectionStatus.connected ? (
                  <span className="inline-flex items-center gap-1 text-xs font-bold text-emerald-600 bg-emerald-50 px-2 py-0.5 rounded-full border border-emerald-200">
                    <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
                    ONLINE & AUTHENTICATED
                  </span>
                ) : (
                  <span className="text-xs font-bold text-rose-600 bg-rose-50 px-2 py-0.5 rounded-full border border-rose-200">
                    OFFLINE
                  </span>
                )}
              </div>
              <p className="text-[11px] text-slate-400 font-mono mt-0.5">
                https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1
              </p>
            </div>
          </div>

          <span className="text-[11px] font-mono text-slate-500 bg-slate-50 border border-slate-200 px-2 py-1 rounded-lg shrink-0">
            5,793 Items
          </span>
        </div>

        {/* 2. SIMPLE TITLE */}
        <div className="text-center space-y-1">
          <h1 className="text-2xl sm:text-3xl font-black text-slate-900 tracking-tight">
            Live SKU / Barcode Lookup
          </h1>
          <p className="text-xs sm:text-sm text-slate-500">
            Type any SKU code, barcode, or product name to test the live connection.
          </p>
        </div>

        {/* 3. TOAST NOTICE */}
        {statusMessage && (
          <div className={`p-3 rounded-xl border text-xs sm:text-sm flex items-center gap-2 shadow-sm ${
            statusMessage.type === 'success' 
              ? 'bg-emerald-50 border-emerald-300 text-emerald-800' 
              : 'bg-amber-50 border-amber-300 text-amber-800'
          }`}>
            {statusMessage.type === 'success' ? (
              <CheckCircle className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span className="font-semibold">{statusMessage.text}</span>
          </div>
        )}

        {/* 4. SEARCH / SCAN CARD */}
        <div className="bg-white border border-slate-200 rounded-3xl p-6 shadow-sm space-y-4">
          
          {/* Phone Camera Scanner Button */}
          <button
            type="button"
            onClick={() => setIsScannerOpen(true)}
            className="w-full py-4 px-5 bg-emerald-600 hover:bg-emerald-700 active:scale-[0.99] text-white font-extrabold text-base rounded-2xl flex items-center justify-center gap-3 shadow-lg shadow-emerald-600/25 transition-all"
          >
            <Camera className="w-6 h-6" />
            <span>Launch Phone Camera Barcode Scanner</span>
          </button>

          <div className="flex items-center gap-3 py-0.5">
            <div className="h-px bg-slate-200 flex-1"></div>
            <span className="text-[11px] font-bold text-slate-400 uppercase tracking-wider">or search / type SKU manually</span>
            <div className="h-px bg-slate-200 flex-1"></div>
          </div>

          <form 
            onSubmit={(e) => {
              e.preventDefault();
              handleLookup();
            }} 
            className="flex gap-2"
          >
            <div className="relative flex-1">
              <Barcode className="w-5 h-5 text-slate-400 absolute left-3.5 top-3.5" />
              <input
                type="text"
                value={searchInput}
                onChange={(e) => setSearchInput(e.target.value)}
                placeholder="Type any SKU (e.g. P2478P) or keyword (e.g. swiss miss, cdo, cookies)..."
                className="w-full pl-11 pr-4 py-3 bg-slate-50 border border-slate-300 rounded-2xl text-sm font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-blue-600 focus:bg-white transition-colors"
                autoFocus
              />
            </div>

            <button
              type="submit"
              disabled={isLoading || !searchInput.trim()}
              className="px-6 py-3 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white font-bold text-sm rounded-2xl transition-all shadow-md shadow-blue-600/20 flex items-center gap-2 shrink-0"
            >
              {isLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Search className="w-4 h-4" />
              )}
              <span>Query API</span>
            </button>
          </form>

          {/* Quick test buttons to click */}
          <div className="space-y-1.5 pt-1 border-t border-slate-100">
            <span className="text-[11px] font-semibold text-slate-400 block">
              Quick test words (click any to query the live API):
            </span>
            <div className="flex flex-wrap gap-2">
              {[
                { label: 'P2478P (CDO)', query: 'P2478P' },
                { label: 'P1728P (Fibisco)', query: 'P1728P' },
                { label: 'SS1247P (Swiss Miss)', query: 'SS1247P' },
                { label: 'P2111P (Cadbury)', query: 'P2111P' },
                { label: 'Type "tissue"', query: 'tissue' },
                { label: 'Type "chocolate"', query: 'chocolate' }
              ].map(btn => (
                <button
                  key={btn.query}
                  type="button"
                  onClick={() => {
                    setSearchInput(btn.query);
                    handleLookup(btn.query);
                  }}
                  className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-blue-50 hover:text-blue-700 hover:border-blue-300 border border-slate-200 text-xs font-mono font-semibold text-slate-700 transition-all"
                >
                  {btn.label}
                </button>
              ))}
            </div>
          </div>
        </div>

        {/* 4b. MULTIPLE MATCHES LIST (Appears if multiple products match) */}
        {searchResultsList.length > 1 && (
          <div className="bg-white border border-slate-200 rounded-3xl p-5 shadow-sm space-y-3 animate-in fade-in">
            <div className="flex items-center justify-between text-xs font-bold text-slate-700">
              <span>
                Matching Live Products in Database: Displaying all {searchResultsList.length} of {searchResultsList.totalRecords || searchResultsList.length} items
              </span>
              <span className="text-[10px] text-slate-400">Click any product to inspect</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 max-h-96 overflow-y-auto pr-1">
              {searchResultsList.map(item => (
                <button
                  key={item.id}
                  type="button"
                  onClick={() => {
                    setScannedProduct(item);
                    setRawApiResponse(item.raw_data || item);
                  }}
                  className={`p-2.5 rounded-xl border text-left text-xs transition-all flex flex-col justify-between ${
                    scannedProduct?.id === item.id 
                      ? 'bg-blue-50 border-blue-500 shadow-sm' 
                      : 'bg-slate-50 hover:bg-slate-100 border-slate-200'
                  }`}
                >
                  <div className="font-bold text-slate-900 truncate">{item.name}</div>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-slate-500 font-mono">
                    <span className="text-blue-600 font-bold">{item.sku}</span>
                    <span className="font-bold text-emerald-600">₱{Number(item.unit_price).toFixed(2)}</span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        )}

        {/* 5. LIVE PRODUCT RESULT CARD */}
        {scannedProduct && (
          <div className="bg-white border-2 border-blue-500 rounded-3xl p-6 shadow-md space-y-4 animate-in fade-in duration-200">
            <div className="flex items-start justify-between">
              <div>
                <span className="px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider bg-emerald-100 text-emerald-800 border border-emerald-200">
                  Live Database Record
                </span>
                <h2 className="text-lg font-bold text-slate-900 mt-1">
                  {scannedProduct.name}
                </h2>
              </div>

              <button
                type="button"
                onClick={() => {
                  setScannedProduct(null);
                  setRawApiResponse(null);
                }}
                className="p-1.5 text-slate-400 hover:text-rose-600 rounded-lg hover:bg-slate-100"
              >
                <X className="w-5 h-5" />
              </button>
            </div>

            {/* Fields table */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs bg-slate-50 p-4 rounded-2xl border border-slate-200 font-mono">
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">SKU / Code</span>
                <span className="font-bold text-slate-900 text-sm">{scannedProduct.sku}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Live Supplier</span>
                <span className="font-bold text-slate-900 text-sm">{scannedProduct.supplier}</span>
              </div>
              <div>
                <span className="text-slate-400 block text-[10px] uppercase font-sans font-bold">Contract Price (VAT)</span>
                <span className="font-black text-emerald-600 text-base">₱{Number(scannedProduct.unit_price).toFixed(2)}</span>
              </div>
            </div>

            {/* RAW JSON TOGGLE */}
            <div className="pt-2 border-t border-slate-100">
              <button
                type="button"
                onClick={() => setShowRawJson(!showRawJson)}
                className="text-xs font-semibold text-blue-600 hover:text-blue-800 flex items-center gap-1.5"
              >
                <Code className="w-3.5 h-3.5" />
                <span>{showRawJson ? 'Hide Raw API JSON' : '🔍 Inspect Raw JSON from Coworker\'s Server'}</span>
              </button>

              {showRawJson && rawApiResponse && (
                <div className="mt-3 p-3 bg-slate-900 text-emerald-400 rounded-xl text-[11px] font-mono overflow-x-auto max-h-60 border border-slate-800">
                  <pre>{JSON.stringify(rawApiResponse, null, 2)}</pre>
                </div>
              )}
            </div>
          </div>
        )}

      </div>

      {/* 6. CAMERA SCANNER MODAL (Phone Camera Barcode Reader) */}
      <ScannerModal
        isOpen={isScannerOpen}
        onClose={() => setIsScannerOpen(false)}
        onScanSuccess={(code) => {
          setIsScannerOpen(false);
          setSearchInput(code);
          handleLookup(code);
        }}
      />

    </div>
  );
}

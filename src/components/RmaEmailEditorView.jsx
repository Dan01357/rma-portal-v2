import React, { useState, useEffect, useMemo } from 'react';
import {
  FileEdit,
  Lock,
  Clock,
  Sun,
  Moon,
  Save,
  RefreshCw,
  CheckCircle2,
  AlertTriangle,
  ShieldCheck,
  Search,
  Package,
  FileText,
  FlaskConical,
  Mail
} from 'lucide-react';
import ProductAutoSuggest from './ProductAutoSuggest';
import { supabase } from '../supabaseClient';
import { formatDateTimeYmdHm, formatDateYmd } from '../utils/rmaHelpers';

async function resolveBearerToken() {
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (session?.access_token) return session.access_token;
  } catch {}
  try {
    const cached = sessionStorage.getItem('rma_oauth_access_token');
    if (cached) return cached;
  } catch {}
  return '';
}

export default function RmaEmailEditorView({
  gateSession,
  sessionCountdown,
  allReports = [],
  catalogProducts = [],
  isDarkMode,
  onToggleTheme,
  onLockStation,
  onRefreshReports,
  onToast
}) {
  const initialRma = useMemo(() => {
    if (gateSession?.rma_number) return String(gateSession.rma_number).trim();
    if (typeof window !== 'undefined') {
      const p = new URLSearchParams(window.location.search);
      return String(p.get('editRma') || p.get('rma') || '').trim();
    }
    return '';
  }, [gateSession?.rma_number]);

  const [lookupRmaInput, setLookupRmaInput] = useState(initialRma);
  const [activeRmaNumber, setActiveRmaNumber] = useState(initialRma);
  const [isLoadingRecord, setIsLoadingRecord] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [loadError, setLoadError] = useState('');
  const [saveError, setSaveError] = useState('');
  const [saveSuccess, setSaveSuccess] = useState(null);
  const [scopeLockedRma, setScopeLockedRma] = useState(Boolean(gateSession?.rma_number));
  const [loadedReport, setLoadedReport] = useState(null);

  // Editable form fields matching QuickRMAActionModal Edit Details & Commercial Documents
  const [supplierName, setSupplierName] = useState('');
  const [productName, setProductName] = useState('');
  const [skuCode, setSkuCode] = useState('');
  const [barcode, setBarcode] = useState('');
  const [quantity, setQuantity] = useState(1);
  const [unitName, setUnitName] = useState('pc');
  const [price, setPrice] = useState(0);
  const [priceWithVat, setPriceWithVat] = useState(0);
  const [expiryDate, setExpiryDate] = useState('');
  const [storeBranch, setStoreBranch] = useState('');
  const [siNumber, setSiNumber] = useState('');
  const [drNumber, setDrNumber] = useState('');
  const [poNumber, setPoNumber] = useState('');
  const [notes, setNotes] = useState('');
  const [manifestItems, setManifestItems] = useState([]);

  const knownSuppliers = useMemo(() => {
    const set = new Set();
    (catalogProducts || []).forEach((p) => {
      const s = String(p?.supplier_name || p?.supplierName || '').trim();
      if (s && !/^(pending assignment|unassigned|n\/a)$/i.test(s)) set.add(s);
    });
    (allReports || []).forEach((r) => {
      const s = String(r?.supplier_name || '').trim();
      if (s && !/^(pending assignment|unassigned|n\/a)$/i.test(s)) set.add(s);
    });
    return Array.from(set).sort((a, b) => a.localeCompare(b));
  }, [catalogProducts, allReports]);

  const hydrateFromReport = (rep) => {
    if (!rep) return;
    setLoadedReport(rep);
    setActiveRmaNumber(rep.rma_number || '');
    setLookupRmaInput(rep.rma_number || '');
    setSupplierName(rep.supplier_name || '');
    setProductName(rep.name || '');
    setSkuCode(rep.code || '');
    setBarcode(rep.barcode || '');
    setQuantity(Number(rep.quantity) || 1);
    setUnitName(rep.unit_name || 'pc');
    const netP = Number(rep.price || 0);
    setPrice(netP);
    const vatP = Number(rep.price_with_vat || 0);
    setPriceWithVat(vatP > 0 ? vatP : (netP > 0 ? Number((netP * 1.12).toFixed(2)) : 0));
    setExpiryDate(rep.expiry_date ? String(rep.expiry_date).slice(0, 10) : '');
    setStoreBranch(rep.store_branch || '');
    setSiNumber(rep.si_number || '');
    setDrNumber(rep.dr_number || rep.invoice_dr_number || '');
    setPoNumber(rep.po_number || '');
    setNotes(String(rep.notes || '').replace(/\[TEST_MODE\]/gi, '').trim());
    setManifestItems(
      Array.isArray(rep.items)
        ? rep.items.map((it) => ({
            ...it,
            name: it.name || it.productName || '',
            code: it.code || it.sku || '',
            supplier_name: it.supplier_name || it.supplierName || rep.supplier_name || '',
            quantity: Number(it.quantity) || 1,
            unit_name: it.unit_name || it.unit || 'pc',
            price: Number(it.price || 0),
            price_with_vat: Number(it.price_with_vat || it.priceWithVat || 0),
            expiry_date: it.expiry_date ? String(it.expiry_date).slice(0, 10) : ''
          }))
        : []
    );
  };

  const fetchScopedReport = async (targetRma) => {
    const cleanRma = String(targetRma || '').trim();
    if (!cleanRma || !gateSession?.token) return;

    setIsLoadingRecord(true);
    setLoadError('');
    setSaveError('');
    setSaveSuccess(null);

    try {
      const jwt = await resolveBearerToken();
      if (!jwt) {
        throw new Error('Your Google Sign-In session is missing or expired. Please Lock & re-verify with Google.');
      }

      const qs = new URLSearchParams({
        token: gateSession.token,
        rma: cleanRma
      });
      const res = await fetch(`/api/v1/rma-email-edit?${qs.toString()}`, {
        method: 'GET',
        headers: {
          Authorization: `Bearer ${jwt}`
        }
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success || !data?.report) {
        throw new Error(data?.message || `Unable to load RMA record (${res.status}).`);
      }

      setScopeLockedRma(Boolean(data.scope_locked_rma));
      hydrateFromReport(data.report);
    } catch (err) {
      setLoadError(err.message || 'Failed to load RMA record.');
      setLoadedReport(null);
    } finally {
      setIsLoadingRecord(false);
    }
  };

  useEffect(() => {
    if (initialRma && gateSession?.token) {
      fetchScopedReport(initialRma);
    }
  }, [initialRma, gateSession?.token]);

  const handleAutoPopulateProduct = (item) => {
    if (!item) return;
    if (item.name) setProductName(item.name);
    const candidateSku = String(item.code || item.sku || '').trim();
    if (candidateSku && candidateSku !== barcode) {
      setSkuCode(candidateSku);
    }
    const sup = String(item.supplierName || item.supplier_name || item.supplier || '').trim();
    if (sup && !/^(pending assignment|unassigned|n\/a)$/i.test(sup)) {
      setSupplierName(sup);
    }
    if (item.unitName || item.unit_name) {
      setUnitName(item.unitName || item.unit_name);
    }
    const netP = Number(item.price || 0);
    const vatP = Number(item.priceWithVat || item.price_with_vat || 0);
    if (netP > 0) {
      setPrice(Number(netP.toFixed(2)));
      setPriceWithVat(vatP > 0 ? Number(vatP.toFixed(2)) : Number((netP * 1.12).toFixed(2)));
    } else if (vatP > 0) {
      setPriceWithVat(Number(vatP.toFixed(2)));
      setPrice(Number((vatP / 1.12).toFixed(2)));
    }
  };

  const handleSaveChanges = async (e) => {
    if (e && e.preventDefault) e.preventDefault();
    if (!activeRmaNumber || !gateSession?.token) return;

    setIsSaving(true);
    setSaveError('');
    setSaveSuccess(null);

    try {
      const jwt = await resolveBearerToken();
      if (!jwt) {
        throw new Error('Your Google Sign-In session expired. Please Lock & re-verify with Google.');
      }

      const res = await fetch('/api/v1/rma-email-edit', {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${jwt}`
        },
        body: JSON.stringify({
          token: gateSession.token,
          rma_number: activeRmaNumber,
          updates: {
            supplier_name: supplierName.trim(),
            name: productName.trim(),
            code: skuCode.trim(),
            quantity: Math.max(1, Number(quantity) || 1),
            unit_name: unitName.trim() || 'pc',
            price: parseFloat(price) || 0,
            price_with_vat: parseFloat(priceWithVat) || 0,
            expiry_date: expiryDate ? expiryDate.slice(0, 10) : '',
            store_branch: storeBranch.trim(),
            si_number: siNumber.trim(),
            dr_number: drNumber.trim(),
            po_number: poNumber.trim(),
            notes: notes.trim(),
            ...(manifestItems.length > 0 ? { items: manifestItems } : {})
          }
        })
      });

      const data = await res.json().catch(() => ({}));
      if (!res.ok || !data?.success) {
        throw new Error(data?.message || `Failed to save changes (${res.status}).`);
      }

      if (data.report) {
        hydrateFromReport(data.report);
      }
      setSaveSuccess({
        editedBy: data.edited_by_email || gateSession.user_email || gateSession.authorized_email,
        updatedAt: data.updated_at || new Date().toISOString()
      });
      if (onToast) {
        onToast(`Saved RMA ${activeRmaNumber} updates cleanly.`, 'success');
      }
      if (onRefreshReports) {
        onRefreshReports();
      }
    } catch (err) {
      setSaveError(err.message || 'Unable to save RMA updates.');
    } finally {
      setIsSaving(false);
    }
  };

  const isTestEnv = Boolean(gateSession?.is_test || /^RMA-TEST-/i.test(activeRmaNumber));

  return (
    <div className="space-y-4 animate-in fade-in duration-200">
      {/* Focused Editor Header Bar (Zero Admin Buttons/Tabs) */}
      <div className="flex flex-wrap items-center justify-between gap-3 p-3.5 sm:p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xs">
        <div className="flex items-center gap-2.5 min-w-0">
          <div className={`p-2 rounded-2xl border shrink-0 ${
            isTestEnv
              ? 'bg-amber-50 dark:bg-amber-950/70 border-amber-300 dark:border-amber-800 text-amber-600 dark:text-amber-400'
              : 'bg-blue-50 dark:bg-blue-950/70 border-blue-200 dark:border-blue-900 text-blue-600 dark:text-blue-400'
          }`}>
            <FileEdit className="w-4 h-4" />
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-1.5 flex-wrap">
              <span className="font-extrabold text-xs sm:text-sm text-slate-900 dark:text-white">
                ✏️ RMA Details &amp; Documents Editor
              </span>
              <span className={`text-[10px] px-2 py-0.5 rounded-full font-black uppercase ${
                isTestEnv
                  ? 'bg-amber-100 dark:bg-amber-950/70 text-amber-800 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
                  : 'bg-emerald-100 dark:bg-emerald-950/70 text-emerald-800 dark:text-emerald-300 border border-emerald-300 dark:border-emerald-700'
              }`}>
                {isTestEnv ? '🧪 Test Sandbox' : '🟢 Live Record'}
              </span>
            </div>
            <div className="flex items-center gap-2 flex-wrap mt-0.5 text-[10.5px] text-slate-500 dark:text-slate-400">
              <span className="inline-flex items-center gap-1 font-mono font-bold text-slate-700 dark:text-slate-300">
                <Mail className="w-3 h-3 text-blue-500" />
                {gateSession?.user_email || gateSession?.authorized_email}
              </span>
              {(gateSession?.no_expiry || sessionCountdown?.isPermanent) ? (
                <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono font-bold border bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800">
                  <ShieldCheck className="w-3 h-3" />
                  <span>No Expiry • Revocable by Admin</span>
                </span>
              ) : sessionCountdown?.text && (
                <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full font-mono font-bold border ${
                  sessionCountdown.totalSeconds < 300
                    ? 'bg-rose-50 text-rose-700 dark:bg-rose-950/70 dark:text-rose-300 border-rose-300 dark:border-rose-800'
                    : 'bg-emerald-50 text-emerald-700 dark:bg-emerald-950/70 dark:text-emerald-300 border-emerald-300 dark:border-emerald-800'
                }`}>
                  <Clock className="w-3 h-3" />
                  <span>Link expires in: {sessionCountdown.text}</span>
                </span>
              )}
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
          <button
            type="button"
            onClick={onLockStation}
            className="px-3 py-1.5 rounded-xl bg-slate-50 hover:bg-rose-50 dark:bg-slate-800 dark:hover:bg-rose-950/40 text-slate-700 dark:text-slate-200 hover:text-rose-600 dark:hover:text-rose-400 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
          >
            <Lock className="w-3.5 h-3.5 text-slate-400" />
            <span>Lock Session</span>
          </button>
          <button
            type="button"
            onClick={onToggleTheme}
            className="p-2 rounded-xl bg-slate-50 hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-600 dark:text-slate-300 cursor-pointer"
            aria-label="Toggle Theme"
          >
            {isDarkMode ? <Sun className="w-4 h-4 text-amber-400" /> : <Moon className="w-4 h-4" />}
          </button>
        </div>
      </div>

      {/* RMA Scope Lookup (only interactive when link is not bound to a single RMA #) */}
      {!scopeLockedRma && (
        <div className="p-4 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-xs space-y-2">
          <label className="block text-xs font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
            Load Target RMA Ticket to Edit
          </label>
          <div className="flex gap-2">
            <input
              type="text"
              value={lookupRmaInput}
              onChange={(e) => setLookupRmaInput(e.target.value)}
              placeholder={isTestEnv ? 'Enter RMA-TEST-2026-...' : 'Enter RMA-2026-...'}
              className="flex-1 px-3 py-2 rounded-xl border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-800 text-xs font-mono font-bold text-slate-900 dark:text-white"
            />
            <button
              type="button"
              disabled={!lookupRmaInput.trim() || isLoadingRecord}
              onClick={() => fetchScopedReport(lookupRmaInput)}
              className="px-4 py-2 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer disabled:opacity-50"
            >
              <Search className="w-3.5 h-3.5" />
              <span>Load RMA</span>
            </button>
          </div>
        </div>
      )}

      {/* Loading / Error / Saved Banners */}
      {isLoadingRecord && (
        <div className="p-8 bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl text-center space-y-2">
          <RefreshCw className="w-6 h-6 text-blue-600 animate-spin mx-auto" />
          <div className="text-xs font-bold text-slate-600 dark:text-slate-300">
            Loading scoped RMA record &amp; verifying Google Identity...
          </div>
        </div>
      )}

      {loadError && !isLoadingRecord && (
        <div role="alert" className="p-4 bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 rounded-2xl text-xs font-bold text-rose-800 dark:text-rose-200 flex items-start gap-2.5">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <div>{loadError}</div>
          </div>
        </div>
      )}

      {saveError && (
        <div role="alert" className="p-3.5 bg-rose-50 dark:bg-rose-950/50 border border-rose-300 dark:border-rose-800 rounded-2xl text-xs font-bold text-rose-800 dark:text-rose-200 flex items-center gap-2">
          <AlertTriangle className="w-4 h-4 text-rose-600 shrink-0" />
          <span>{saveError}</span>
        </div>
      )}

      {saveSuccess && (
        <div className="p-3.5 bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-300 dark:border-emerald-800 rounded-2xl text-xs font-bold text-emerald-800 dark:text-emerald-200 flex items-center gap-2">
          <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
          <span>
            Changes saved cleanly! Updated At (YYYY-MM-DD HH:mm): <strong>{formatDateTimeYmdHm(saveSuccess.updatedAt)}</strong> • By <span className="font-mono">{saveSuccess.editedBy}</span>
          </span>
        </div>
      )}

      {/* Standalone Edit Form */}
      {loadedReport && !isLoadingRecord && (
        <form onSubmit={handleSaveChanges} className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-6 shadow-xs space-y-5">
          <div className="flex flex-wrap items-center justify-between gap-2 pb-3 border-b border-slate-100 dark:border-slate-800">
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <span className="px-2.5 py-1 rounded-xl bg-blue-100 dark:bg-blue-950/70 text-blue-800 dark:text-blue-300 font-mono font-black text-xs border border-blue-200 dark:border-blue-800">
                  {loadedReport.rma_number}
                </span>
                <span className="text-[11px] text-slate-500 dark:text-slate-400 font-semibold">
                  Submission Date (YYYY-MM-DD HH:mm): {formatDateTimeYmdHm(loadedReport.created_at)}
                </span>
              </div>
              {loadedReport.ai_document_metadata?.last_email_edit?.edited_at && (
                <div className="text-[10.5px] text-emerald-700 dark:text-emerald-400 font-semibold mt-1 flex items-center gap-1">
                  <ShieldCheck className="w-3.5 h-3.5" />
                  <span>
                    Last Email Edit (YYYY-MM-DD HH:mm): {formatDateTimeYmdHm(loadedReport.ai_document_metadata.last_email_edit.edited_at)} by {loadedReport.ai_document_metadata.last_email_edit.edited_by_email}
                  </span>
                </div>
              )}
            </div>
            <div className="text-[11px] font-bold text-slate-500 dark:text-slate-400 font-mono">
              Barcode: {loadedReport.barcode || '—'}
            </div>
          </div>

          {/* Product & Pricing Details */}
          <div className="space-y-3 p-3.5 bg-slate-50 dark:bg-slate-800/50 border border-slate-200 dark:border-slate-700 rounded-2xl">
            <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
              <Package className="w-3.5 h-3.5 text-blue-600" />
              <span>Product &amp; Pricing Specifications</span>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Item Name / Product Description
                </label>
                <ProductAutoSuggest
                  mode="name"
                  value={productName}
                  onChange={setProductName}
                  onSelectProduct={handleAutoPopulateProduct}
                  placeholder="Type product name to search catalog..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>

              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
                  Assigned SKU / Item Code
                </label>
                <ProductAutoSuggest
                  mode="code"
                  value={skuCode}
                  onChange={setSkuCode}
                  onSelectProduct={handleAutoPopulateProduct}
                  placeholder="Type SKU / code..."
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Quantity</label>
                <input
                  type="number"
                  min="1"
                  value={quantity}
                  onChange={(e) => setQuantity(e.target.value)}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Unit</label>
                <input
                  type="text"
                  value={unitName}
                  onChange={(e) => setUnitName(e.target.value)}
                  placeholder="pc, case"
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Net Price (PHP)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={price}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPrice(val);
                    const num = parseFloat(val);
                    if (Number.isFinite(num)) {
                      setPriceWithVat(Number((num * 1.12).toFixed(2)));
                    }
                  }}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Price w/ VAT (PHP)</label>
                <input
                  type="number"
                  step="0.01"
                  min="0"
                  value={priceWithVat}
                  onChange={(e) => {
                    const val = e.target.value;
                    setPriceWithVat(val);
                    const num = parseFloat(val);
                    if (Number.isFinite(num)) {
                      setPrice(Number((num / 1.12).toFixed(2)));
                    }
                  }}
                  className="w-full px-3 py-2 bg-white dark:bg-slate-900 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>
          </div>

          {/* Commercial Documents: SI, DR, PO */}
          <div className="space-y-2.5">
            <div className="flex items-center gap-1.5 text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
              <FileText className="w-3.5 h-3.5 text-indigo-600" />
              <span>Commercial Documents &amp; Expiry</span>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
              <div>
                <label className="text-[11px] font-bold text-indigo-700 dark:text-indigo-300 block mb-1">Sales Invoice (SI) #</label>
                <input
                  type="text"
                  value={siNumber}
                  onChange={(e) => setSiNumber(e.target.value)}
                  placeholder="e.g. SI-2026-8819"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-indigo-200 dark:border-indigo-800 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-violet-700 dark:text-violet-300 block mb-1">Delivery Receipt (DR) #</label>
                <input
                  type="text"
                  value={drNumber}
                  onChange={(e) => setDrNumber(e.target.value)}
                  placeholder="e.g. DR-44120"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-violet-200 dark:border-violet-800 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-amber-700 dark:text-amber-300 block mb-1">Purchase Order (PO) #</label>
                <input
                  type="text"
                  value={poNumber}
                  onChange={(e) => setPoNumber(e.target.value)}
                  placeholder="e.g. PO-99120"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-amber-200 dark:border-amber-800 rounded-xl text-xs font-mono font-bold text-slate-900 dark:text-white"
                />
              </div>
            </div>

            <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 pt-1">
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Supplier Name</label>
                <input
                  type="text"
                  list="email-editor-supplier-list"
                  value={supplierName}
                  onChange={(e) => setSupplierName(e.target.value)}
                  placeholder="Supplier / Vendor Name"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
                <datalist id="email-editor-supplier-list">
                  {knownSuppliers.map((s) => (
                    <option key={s} value={s} />
                  ))}
                </datalist>
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Store / Customer Branch</label>
                <input
                  type="text"
                  value={storeBranch}
                  onChange={(e) => setStoreBranch(e.target.value)}
                  placeholder="Branch / Account Name"
                  className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                />
              </div>
              <div>
                <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">Expiry Date (YYYY-MM-DD)</label>
                <div className="flex items-center gap-2">
                  <input
                    type="date"
                    value={expiryDate}
                    onChange={(e) => setExpiryDate(e.target.value)}
                    className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white"
                  />
                  <span className="text-[10px] font-mono font-bold text-slate-500">
                    {expiryDate ? formatDateYmd(expiryDate) : '—'}
                  </span>
                </div>
              </div>
            </div>
          </div>

          {/* Multi-Item Manifest Line Items (if batch ticket) */}
          {manifestItems.length > 0 && (
            <div className="space-y-2 p-3.5 bg-slate-50 dark:bg-slate-800/40 border border-slate-200 dark:border-slate-700 rounded-2xl">
              <div className="text-[11px] font-black uppercase tracking-wider text-slate-600 dark:text-slate-300">
                Manifest Line Items ({manifestItems.length})
              </div>
              <div className="space-y-2">
                {manifestItems.map((it, idx) => (
                  <div key={idx} className="grid grid-cols-2 sm:grid-cols-6 gap-2 p-2.5 bg-white dark:bg-slate-900 rounded-xl border border-slate-200 dark:border-slate-700">
                    <div className="col-span-2">
                      <label className="text-[9.5px] font-bold text-slate-400 block">Item #{idx + 1} Name</label>
                      <input
                        type="text"
                        value={it.name || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setManifestItems((prev) => prev.map((row, i) => i === idx ? { ...row, name: val } : row));
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="text-[9.5px] font-bold text-slate-400 block">SKU</label>
                      <input
                        type="text"
                        value={it.code || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setManifestItems((prev) => prev.map((row, i) => i === idx ? { ...row, code: val, sku: val } : row));
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-mono font-bold bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="text-[9.5px] font-bold text-slate-400 block">Qty</label>
                      <input
                        type="number"
                        min="1"
                        value={it.quantity ?? 1}
                        onChange={(e) => {
                          const val = Number(e.target.value) || 1;
                          setManifestItems((prev) => prev.map((row, i) => i === idx ? { ...row, quantity: val } : row));
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="text-[9.5px] font-bold text-slate-400 block">Net Price</label>
                      <input
                        type="number"
                        step="0.01"
                        value={it.price ?? 0}
                        onChange={(e) => {
                          const net = parseFloat(e.target.value);
                          setManifestItems((prev) => prev.map((row, i) => i === idx ? {
                            ...row,
                            price: e.target.value,
                            ...(Number.isFinite(net) ? { price_with_vat: Number((net * 1.12).toFixed(2)) } : {})
                          } : row));
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                    <div>
                      <label className="text-[9.5px] font-bold text-slate-400 block">Expiry (YYYY-MM-DD)</label>
                      <input
                        type="date"
                        value={it.expiry_date || ''}
                        onChange={(e) => {
                          const val = e.target.value;
                          setManifestItems((prev) => prev.map((row, i) => i === idx ? { ...row, expiry_date: val } : row));
                        }}
                        className="w-full px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 text-xs font-bold bg-slate-50 dark:bg-slate-800"
                      />
                    </div>
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Notes */}
          <div>
            <label className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block mb-1">
              Operational Notes
            </label>
            <textarea
              rows={2}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
              placeholder="Optional notes regarding supplier, invoice correction, or delivery paperwork..."
              className="w-full px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-medium text-slate-900 dark:text-white"
            />
          </div>

          <div className="flex items-center justify-between gap-3 pt-3 border-t border-slate-100 dark:border-slate-800 flex-wrap">
            <span className="text-[10.5px] text-slate-400 flex items-center gap-1">
              {isTestEnv && <FlaskConical className="w-3.5 h-3.5 text-amber-500" />}
              <span>Changes are verified server-side against your Google Identity Lock &amp; written to the audit trail.</span>
            </span>
            <button
              type="submit"
              disabled={isSaving}
              className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 disabled:opacity-50 text-white rounded-xl text-xs font-black flex items-center gap-2 shadow-md transition-all cursor-pointer"
            >
              {isSaving ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Save className="w-4 h-4" />}
              <span>{isSaving ? 'Saving RMA Updates...' : 'Save RMA Changes'}</span>
            </button>
          </div>
        </form>
      )}
    </div>
  );
}

import React, { useState } from 'react';
import { 
  X, 
  BookOpen, 
  ArrowRight, 
  ArrowLeft, 
  CheckCircle2, 
  Printer, 
  QrCode, 
  Camera, 
  Database, 
  Layers, 
  ShieldCheck, 
  Zap, 
  Building2, 
  FileText, 
  Check, 
  Clock, 
  Search, 
  Download,
  Smartphone,
  ExternalLink
} from 'lucide-react';

export default function SystemTutorialModal({ isOpen, onClose }) {
  if (!isOpen) return null;

  const [activeTab, setActiveTab] = useState('overview');
  const [dontShowAgain, setDontShowAgain] = useState(false);

  const handleClose = () => {
    if (dontShowAgain) {
      localStorage.setItem('has_viewed_guide', 'true');
    }
    onClose();
  };

  const tabs = [
    { id: 'overview', label: 'Lifecycle Flowchart', icon: Layers },
    { id: 'warehouse', label: '1. Warehouse Studio', icon: QrCode },
    { id: 'portal', label: '2. Customer Portal', icon: Smartphone },
    { id: 'supervisor', label: '3. Supervisor Dashboard', icon: Database }
  ];

  const handleNextTab = () => {
    const currentIndex = tabs.findIndex(t => t.id === activeTab);
    if (currentIndex < tabs.length - 1) {
      setActiveTab(tabs[currentIndex + 1].id);
    } else {
      handleClose();
    }
  };

  const handlePrevTab = () => {
    const currentIndex = tabs.findIndex(t => t.id === activeTab);
    if (currentIndex > 0) {
      setActiveTab(tabs[currentIndex - 1].id);
    }
  };

  return (
    <div 
      className="fixed inset-0 z-50 overflow-y-auto bg-black/85 backdrop-blur-md flex items-center justify-center p-3 sm:p-5 animate-fade-in"
      onClick={handleClose}
    >
      <div 
        className="relative w-full max-w-4xl bg-slate-900 border border-slate-700/80 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="px-6 py-4 border-b border-slate-800 bg-slate-950/80 flex items-center justify-between shrink-0">
          <div className="flex items-center space-x-3">
            <div className="w-10 h-10 rounded-2xl bg-indigo-600/20 border border-indigo-500/30 text-indigo-400 flex items-center justify-center">
              <BookOpen className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-white">
                  Wholesale RMA System Guide & Interactive Walkthrough
                </h2>
                <span className="text-[10px] font-mono bg-indigo-500/20 text-indigo-300 px-2 py-0.5 rounded font-bold">
                  Tutorial
                </span>
              </div>
              <p className="text-xs text-slate-400">
                End-to-end operational guide for warehouse staff, customers, and supervisors.
              </p>
            </div>
          </div>

          <button
            type="button"
            onClick={handleClose}
            className="p-2 rounded-xl text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Tab Navigation Pill Bar */}
        <div className="px-6 pt-3 pb-2 bg-slate-900/90 border-b border-slate-800 flex overflow-x-auto gap-2 shrink-0 scrollbar-none">
          {tabs.map((tab) => {
            const Icon = tab.icon;
            const isSelected = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveTab(tab.id)}
                className={`flex items-center gap-2 px-3.5 py-2 rounded-xl text-xs font-bold transition-all whitespace-nowrap ${
                  isSelected
                    ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/60'
                }`}
              >
                <Icon className="w-4 h-4" />
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>

        {/* Scrollable Tab Content Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-sm text-slate-300 flex-1">
          
          {/* TAB 1: OVERVIEW & LIFECYCLE FLOWCHART */}
          {activeTab === 'overview' && (
            <div className="space-y-6 animate-fade-in">
              <div className="bg-slate-950/70 rounded-2xl p-5 border border-slate-800">
                <span className="text-xs font-mono font-bold text-indigo-400 uppercase tracking-wider block mb-1">
                  System Architecture & Objective
                </span>
                <p className="text-xs sm:text-sm text-slate-300 leading-relaxed">
                  The Wholesale RMA System eliminates friction in business-to-business return authorizations. By tagging outgoing wholesale pallets and cases with smart QR labels at dispatch, customers never need to create accounts or fill in complex SKU numbers. Supervisors inspect defect proof directly from a central Supabase vault.
                </p>
              </div>

              {/* Visual Step Roadmap */}
              <div>
                <h4 className="text-xs font-bold uppercase tracking-wider text-slate-400 mb-3 flex items-center gap-2">
                  <Layers className="w-4 h-4 text-indigo-400" />
                  <span>3-Stage Lifecycle Roadmap</span>
                </h4>

                <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
                  {/* Step 1 */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="w-8 h-8 rounded-xl bg-blue-500/20 text-blue-400 flex items-center justify-center font-black text-sm">
                        1
                      </div>
                      <h5 className="font-bold text-sm text-white">Warehouse Dispatch</h5>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Staff select company (PINGCON, KEYSYS, BONITA, A2Z2GO), link DR/SI # and packaging unit, then print a 4x4 or 4x6 thermal QR sticker.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-mono text-blue-400 flex items-center gap-1">
                      <Printer className="w-3.5 h-3.5" /> Printable Label
                    </div>
                  </div>

                  {/* Step 2 */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center font-black text-sm">
                        2
                      </div>
                      <h5 className="font-bold text-sm text-white">Zero-Login Customer Scan</h5>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Consignee scans box sticker. Dispatch details lock in automatically. Customer attaches mandatory defect photo & generates RMA tracking ID.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-mono text-emerald-400 flex items-center gap-1">
                      <Camera className="w-3.5 h-3.5" /> Client Compression
                    </div>
                  </div>

                  {/* Step 3 */}
                  <div className="p-4 rounded-2xl bg-slate-950 border border-slate-800 relative flex flex-col justify-between">
                    <div className="space-y-2">
                      <div className="w-8 h-8 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center font-black text-sm">
                        3
                      </div>
                      <h5 className="font-bold text-sm text-white">Supervisor Vault Review</h5>
                      <p className="text-xs text-slate-400 leading-relaxed">
                        Supervisor reviews defect proof in real-time table, changes status (Approved, Credit Memo, Rejected), records ledger notes, and exports CSV.
                      </p>
                    </div>
                    <div className="mt-4 pt-3 border-t border-slate-800/80 text-[11px] font-mono text-purple-400 flex items-center gap-1">
                      <Database className="w-3.5 h-3.5" /> Supabase Vault
                    </div>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 2: MODULE 1: WAREHOUSE QR STUDIO */}
          {activeTab === 'warehouse' && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-indigo-600/20 text-indigo-400 flex items-center justify-center font-bold text-xs">
                  01
                </span>
                <h3 className="font-bold text-white text-base">
                  Pre-Delivery QR Sticker Studio Operations
                </h3>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs">
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <h5 className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Building2 className="w-4 h-4 text-indigo-400" /> Brand Selection
                  </h5>
                  <p className="text-slate-400 leading-relaxed">
                    Choose from 4 pre-configured wholesale brands: PINGCON (Electronics), KEYSYS (IT & Networking), BONITA TISSUE (Commercial Paper), or A2Z2GO (Logistics & Packaging).
                  </p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <h5 className="font-bold text-slate-200 flex items-center gap-1.5">
                    <QrCode className="w-4 h-4 text-indigo-400" /> Catalog or Custom SKU
                  </h5>
                  <p className="text-slate-400 leading-relaxed">
                    Search pre-populated catalog products or click "Enter Custom SKU" for custom industrial items, one-off imports, or custom-packaged goods.
                  </p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <h5 className="font-bold text-slate-200 flex items-center gap-1.5">
                    <Printer className="w-4 h-4 text-indigo-400" /> Thermal Sticker Printing
                  </h5>
                  <p className="text-slate-400 leading-relaxed">
                    Click "Print Sticker Label". Standard print CSS automatically isolates the 4x4 or 4x6 label container, stripping away browser chrome, menus, and buttons.
                  </p>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 space-y-2">
                  <h5 className="font-bold text-slate-200 flex items-center gap-1.5">
                    <ExternalLink className="w-4 h-4 text-indigo-400" /> Dynamic Base URL
                  </h5>
                  <p className="text-slate-400 leading-relaxed">
                    Staff can customize the "QR Destination Domain / Base URL" field to ensure public internet customers reach your production domain outside your warehouse network.
                  </p>
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: MODULE 2: CUSTOMER PORTAL */}
          {activeTab === 'portal' && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-emerald-600/20 text-emerald-400 flex items-center justify-center font-bold text-xs">
                  02
                </span>
                <h3 className="font-bold text-white text-base">
                  Zero-Login Customer Return Portal
                </h3>
              </div>

              <div className="bg-slate-950 rounded-2xl p-4 border border-slate-800 space-y-3 text-xs">
                <div className="flex items-start gap-3">
                  <div className="w-8 h-8 rounded-xl bg-emerald-500/20 text-emerald-400 flex items-center justify-center shrink-0">
                    <Zap className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-sm">Instant Locked Parameters</h5>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      Scanning the QR box sticker passes the SKU, Item Name, Packaging Unit, Delivery Ref, and Consignee. The customer never has to re-type or misspell product part numbers.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-3 border-t border-slate-800/80">
                  <div className="w-8 h-8 rounded-xl bg-indigo-500/20 text-indigo-400 flex items-center justify-center shrink-0">
                    <Camera className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-sm">Automatic Client-Side Image Compression</h5>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      Camera photos up to 15MB are automatically resized (max 1600px, 0.75 quality) on the customer's phone before uploading. This saves bandwidth and Supabase Free Tier storage quotas while maintaining razor-sharp defect proof.
                    </p>
                  </div>
                </div>

                <div className="flex items-start gap-3 pt-3 border-t border-slate-800/80">
                  <div className="w-8 h-8 rounded-xl bg-amber-500/20 text-amber-400 flex items-center justify-center shrink-0">
                    <FileText className="w-4 h-4" />
                  </div>
                  <div>
                    <h5 className="font-bold text-white text-sm">Official RMA Tracking ID Formula</h5>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      Generates standard reference tracking codes formatted as:
                      <code className="block mt-1 font-mono text-emerald-400 bg-slate-900 p-2 rounded border border-slate-800 text-xs">
                        RMA-[Year]-[4-Digit Sequence]-[4-Character Alphanumeric] (e.g. RMA-2026-0001-A9K4)
                      </code>
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: MODULE 3: SUPERVISOR DASHBOARD */}
          {activeTab === 'supervisor' && (
            <div className="space-y-5 animate-fade-in">
              <div className="flex items-center gap-2">
                <span className="w-7 h-7 rounded-lg bg-purple-600/20 text-purple-400 flex items-center justify-center font-bold text-xs">
                  03
                </span>
                <h3 className="font-bold text-white text-base">
                  Returns Management Dashboard & Audit Workflows
                </h3>
              </div>

              <div className="space-y-3 text-xs">
                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-start gap-3">
                  <Clock className="w-5 h-5 text-amber-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-white">Status State Machine</h5>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      Tickets progress through: <span className="text-amber-400 font-semibold">Pending Inspection</span> ➔ <span className="text-blue-400 font-semibold">Approved for Replacement</span> or <span className="text-emerald-400 font-semibold">Credit Memo Issued</span> or <span className="text-rose-400 font-semibold">Rejected</span>.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-start gap-3">
                  <Search className="w-5 h-5 text-indigo-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-white">Full-Text Filtering</h5>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      Instant multi-field filtering by RMA ID, Customer, Item Description, SKU, or DR Number, filtered by Company or Status.
                    </p>
                  </div>
                </div>

                <div className="p-4 bg-slate-950 rounded-2xl border border-slate-800 flex items-start gap-3">
                  <Download className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" />
                  <div>
                    <h5 className="font-bold text-white">CSV Ledger Export</h5>
                    <p className="text-slate-400 mt-0.5 leading-relaxed">
                      One-click export produces clean CSV spreadsheets formatted for finance, inventory adjustments, and vendor warranty claims.
                    </p>
                  </div>
                </div>
              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 border-t border-slate-800 bg-slate-950/90 flex flex-col sm:flex-row items-center justify-between gap-3 shrink-0">
          <label className="flex items-center gap-2 text-xs text-slate-400 cursor-pointer">
            <input
              type="checkbox"
              checked={dontShowAgain}
              onChange={(e) => setDontShowAgain(e.target.checked)}
              className="rounded bg-slate-900 border-slate-700 text-indigo-600 focus:ring-0 w-3.5 h-3.5"
            />
            <span>Don't show this guide on startup</span>
          </label>

          <div className="flex items-center gap-2 w-full sm:w-auto justify-end">
            {activeTab !== 'overview' && (
              <button
                type="button"
                onClick={handlePrevTab}
                className="px-3.5 py-2 rounded-xl border border-slate-700 text-slate-300 hover:bg-slate-800 text-xs font-semibold flex items-center gap-1.5 transition-colors"
              >
                <ArrowLeft className="w-3.5 h-3.5" />
                <span>Back</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleNextTab}
              className="px-5 py-2 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold flex items-center gap-1.5 shadow-md shadow-indigo-600/30 transition-all hover:scale-[1.02] active:scale-[0.98]"
            >
              <span>{activeTab === 'supervisor' ? 'Start Using System' : 'Next Section'}</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </div>
        </div>

      </div>
    </div>
  );
}

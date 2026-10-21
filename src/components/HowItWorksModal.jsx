import React, { useState } from 'react';
import { 
  X, 
  Lightbulb, 
  Barcode, 
  Mail, 
  Receipt, 
  Truck, 
  Printer, 
  Settings, 
  Camera, 
  CheckCircle2, 
  MapPin, 
  Sparkles, 
  ShieldCheck, 
  Layers, 
  ArrowRight,
  BookOpen,
  Info
} from 'lucide-react';

export default function HowItWorksModal({ isOpen, onClose }) {
  const [activeGuideTab, setActiveGuideTab] = useState('workflow'); // 'workflow' | 'tabs'

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-5 bg-slate-950/60 backdrop-blur-md overflow-y-auto animate-in fade-in duration-200">
      <div className="relative w-full max-w-4xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden my-6 max-h-[92vh] flex flex-col text-slate-900 dark:text-slate-100">
        
        {/* Modal Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-slate-100 dark:border-slate-800 bg-white/95 dark:bg-slate-900/95 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-2xl bg-amber-50 dark:bg-amber-500/15 text-amber-600 dark:text-amber-400 border border-amber-200 dark:border-amber-500/30">
              <Lightbulb className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-bold text-slate-900 dark:text-white text-lg">System Workflow & User Guide</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Step-by-step operating standard for Wholesale RMA processing</p>
            </div>
          </div>

          <button
            onClick={onClose}
            className="p-1.5 rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Sub-navigation inside guide */}
        <div className="px-6 pt-3 border-b border-slate-100 dark:border-slate-800 bg-slate-50/50 dark:bg-slate-900/50 flex space-x-2 shrink-0">
          <button
            onClick={() => setActiveGuideTab('workflow')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center space-x-1.5 transition-colors ${
              activeGuideTab === 'workflow'
                ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <Layers className="w-4 h-4" />
            <span>4-Step Core Workflow</span>
          </button>

          <button
            onClick={() => setActiveGuideTab('tabs')}
            className={`pb-2.5 px-3 text-xs font-semibold border-b-2 flex items-center space-x-1.5 transition-colors ${
              activeGuideTab === 'tabs'
                ? 'border-brand-600 text-brand-600 dark:text-brand-400'
                : 'border-transparent text-slate-500 hover:text-slate-700 dark:text-slate-400 dark:hover:text-slate-200'
            }`}
          >
            <BookOpen className="w-4 h-4" />
            <span>Tab-by-Tab Visual Walkthrough</span>
          </button>
        </div>

        {/* Modal Scrollable Body */}
        <div className="p-6 overflow-y-auto space-y-6 text-xs sm:text-sm leading-relaxed">
          
          {activeGuideTab === 'workflow' ? (
            <div className="space-y-6">
              <div className="p-4 rounded-2xl bg-brand-50 dark:bg-brand-950/40 border border-brand-200 dark:border-brand-500/30">
                <span className="font-bold text-brand-900 dark:text-brand-300 text-sm block mb-1">
                  End-to-End RMA Authorization Architecture
                </span>
                <p className="text-brand-800/80 dark:text-slate-300 text-xs">
                  This portal handles the complete lifecycle of wholesale returns: from initial box barcode scan at customer stores to automated supervisor routing, finance credit issuance, and supplier replenishment POs.
                </p>
              </div>

              {/* 4 Steps Timeline */}
              <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
                
                {/* Step 1 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-brand-100 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/40">
                      Step 1
                    </span>
                    <Barcode className="w-4 h-4 text-brand-600 dark:text-brand-400" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Scan Existing Barcode & File Return</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Repackers scan the <strong>existing factory barcode or SKU on the box</strong> via phone camera. The app queries <strong>wholesale database items</strong> in real-time. No need to pre-print product QR codes!
                  </p>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc list-inside">
                    <li><strong>Live SKU Lookup:</strong> Automatically fills official Product Name, Supplier Name, and Contract Price from ERP database.</li>
                    <li><strong>Re-scan increment:</strong> Scanning the same barcode again increments quantity by +1.</li>
                    <li><strong>Direct numeric box:</strong> Click the box and type large quantities (e.g. <code>20</code> or <code>100</code>) immediately.</li>
                    <li><strong>Defect Photo & GPS:</strong> Upload carton photos and capture dock GPS coordinates.</li>
                    <li><strong>Return QR Label:</strong> Generated AFTER filing so repacker can slap 1 tracking sticker on the return box.</li>
                  </ul>
                </div>

                {/* Step 2 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-blue-100 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40">
                      Step 2
                    </span>
                    <Mail className="w-4 h-4 text-blue-600 dark:text-blue-400" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Smart Automated AE Routing</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Upon submission, a unique Ticket ID (e.g. <code>RMA-2026-0004-3YNZ</code>) and return QR code are created, and an automated email dispatch is sent based on business group:
                  </p>
                  <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 text-[11px] font-mono space-y-1">
                    <div>
                      <span className="text-brand-600 dark:text-brand-400 font-bold font-sans">Group 1 (KEYSYS / A2Z2GO):</span>
                      <br/><span className="text-slate-500">From:</span> finance2@a2z2go.net → azgodev@gmail.com
                    </div>
                    <div className="pt-1">
                      <span className="text-brand-600 dark:text-brand-400 font-bold font-sans">Group 2 (PINGCON / BONITA):</span>
                      <br/><span className="text-slate-500">From:</span> finance@pingconmarketing.com → azgodev@gmail.com
                    </div>
                  </div>
                </div>

                {/* Step 3 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-emerald-100 dark:bg-emerald-500/20 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-500/40">
                      Step 3
                    </span>
                    <Receipt className="w-4 h-4 text-emerald-600 dark:text-emerald-400" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Finance Credit Memo Issuance</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Finance reconciles physically returned goods against customer billing:
                  </p>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc list-inside">
                    <li><strong>Pull-Out Checkbox:</strong> Verifies physical receipt of goods at warehouse receiving dock.</li>
                    <li><strong>Credit Memo Number:</strong> Issues official credit reference (e.g. <code>CM-2026-0145</code>).</li>
                    <li><strong>Amount Authorization:</strong> Full or partial credit amount in ₱, posted under GL-4010.</li>
                    <li>Updates ticket status to <strong>"Credit Memo Issued"</strong> with date & finance officer stamp.</li>
                  </ul>
                </div>

                {/* Step 4 */}
                <div className="p-4 bg-slate-50 dark:bg-slate-950/80 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-2.5">
                  <div className="flex items-center justify-between">
                    <span className="px-2 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider bg-purple-100 dark:bg-purple-500/20 text-purple-700 dark:text-purple-300 border border-purple-200 dark:border-purple-500/40">
                      Step 4
                    </span>
                    <Truck className="w-4 h-4 text-purple-600 dark:text-purple-400" />
                  </div>
                  <h3 className="font-bold text-slate-900 dark:text-white text-sm">Purchasing & Replenishment Buffer</h3>
                  <p className="text-slate-600 dark:text-slate-400 text-xs">
                    Consolidates broken and defective inventory across stores by primary manufacturer/supplier:
                  </p>
                  <ul className="text-xs text-slate-600 dark:text-slate-300 space-y-1 list-disc list-inside">
                    <li><strong>Supplier Lot Consolidation:</strong> Bundles returns for Bonita Mills, Pingcon Paper, Keysys, and A2Z.</li>
                    <li><strong>7-Day Buffer SLA Countdown:</strong> Tracks vendor turnaround SLA (Green &gt; 3d, Amber &le; 3d, Red Overdue).</li>
                    <li><strong>Vendor PO Generation:</strong> One-click creation of replacement Purchase Orders (<code>PO-RET-2026-###</code>).</li>
                    <li><strong>Inventory Buffer Dispatch:</strong> Releases replacement stock immediately to the customer.</li>
                  </ul>
                </div>

              </div>
            </div>
          ) : (
            /* Tab-by-Tab Visual Walkthrough */
            <div className="space-y-4">
              <p className="text-xs text-slate-500 dark:text-slate-400 mb-2">
                Click any tab in the top navigation bar to access its specific operational workstation:
              </p>

              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                
                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center space-x-2 text-brand-600 dark:text-brand-400 font-bold text-xs uppercase">
                    <Barcode className="w-4 h-4" />
                    <span>Submit Return</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    High-contrast mobile-friendly intake form. Tap <strong>"Launch Camera Barcode Scanner"</strong> to scan physical boxes, use <strong>[ - ] [ 20 ] [ + ]</strong> to set quantities, grab dock GPS, and upload defect photos.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center space-x-2 text-blue-600 dark:text-blue-400 font-bold text-xs uppercase">
                    <Layers className="w-4 h-4" />
                    <span>Tickets Vault</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    The central audit log of all filed RMAs. Filter by status (Pending, Approved, In Transit, Credit Issued, Rejected) or search by Ticket ID, Customer, or SKU. Click <strong>"Return QR"</strong> to reprint return labels.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center space-x-2 text-emerald-600 dark:text-emerald-400 font-bold text-xs uppercase">
                    <Receipt className="w-4 h-4" />
                    <span>Finance Credit Memo</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Dedicated accounting station. Tick the pull-out checkbox once goods physically arrive at warehouse dock. Click <strong>"Issue Credit Memo"</strong>, verify Credit Amount (₱), enter CM#, and record authorized clearance.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center space-x-2 text-purple-600 dark:text-purple-400 font-bold text-xs uppercase">
                    <Truck className="w-4 h-4" />
                    <span>Purchasing & Inventory Buffer</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Supplier-level claims management. Automatically groups tickets by manufacturer (e.g. Bonita Mills vs Pingcon Paper). Displays active buffer countdown and generates vendor return POs in one click.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center space-x-2 text-amber-600 dark:text-amber-400 font-bold text-xs uppercase">
                    <Printer className="w-4 h-4" />
                    <span>Print SKU Barcodes</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Clean printable A4 sheet layout for Pingcon and Bonita SKU barcodes. Repackers can print thermal or paper sticker sheets directly for plain corrugated boxes without barcodes.
                  </p>
                </div>

                <div className="p-4 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 space-y-1.5">
                  <div className="flex items-center space-x-2 text-slate-700 dark:text-slate-300 font-bold text-xs uppercase">
                    <Settings className="w-4 h-4 text-brand-600" />
                    <span>Settings</span>
                  </div>
                  <p className="text-xs text-slate-600 dark:text-slate-300">
                    Toggle <strong>Test Mode</strong> ON/OFF, test Supabase backend connectivity, review email recipient routing matrices, or reset demonstration sample data.
                  </p>
                </div>

              </div>
            </div>
          )}

        </div>

        {/* Modal Footer */}
        <div className="px-6 py-4 bg-white dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0">
          <div className="text-[11px] text-slate-500 dark:text-slate-400 flex items-center gap-1.5">
            <Info className="w-3.5 h-3.5 text-brand-600 dark:text-brand-400" />
            <span>Need extra assistance? Contact Finance Systems Administration.</span>
          </div>

          <button
            onClick={onClose}
            className="px-5 py-2 bg-brand-600 hover:bg-brand-500 text-white font-semibold text-xs rounded-xl shadow-md transition-colors"
          >
            Got It, Close Guide
          </button>
        </div>

      </div>
    </div>
  );
}

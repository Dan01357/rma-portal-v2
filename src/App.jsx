import React, { useState, useEffect } from 'react';
import { 
  Barcode, 
  Archive, 
  Receipt, 
  Truck, 
  Printer, 
  Settings, 
  ShieldCheck, 
  CheckCircle2, 
  Package, 
  Sparkles,
  QrCode,
  Lightbulb
} from 'lucide-react';

import SubmitRMATab from './components/SubmitRMATab';
import TicketsVaultTab from './components/TicketsVaultTab';
import FinanceCreditMemoTab from './components/FinanceCreditMemoTab';
import PurchasingBufferTab from './components/PurchasingBufferTab';
import PrintBarcodesTab from './components/PrintBarcodesTab';
import SettingsTab from './components/SettingsTab';
import ReturnQRModal from './components/ReturnQRModal';
import HowItWorksModal from './components/HowItWorksModal';

import { rmaApi, saveLocalTickets } from './supabaseClient';
import { INITIAL_PRODUCTS, INITIAL_TICKETS } from './data/mockData';

export default function App() {
  const [activeTab, setActiveTab] = useState('submit');
  const [tickets, setTickets] = useState([]);
  const [catalog, setCatalog] = useState([]);
  const [isTestMode, setIsTestMode] = useState(() => {
    const saved = localStorage.getItem('wholesale_rma_test_mode');
    return saved !== null ? JSON.parse(saved) : true; // Default test mode ON for safety
  });
  const [activeModalTicket, setActiveModalTicket] = useState(null);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Load data on startup
  useEffect(() => {
    async function loadData() {
      setIsLoading(true);
      try {
        const [prods, tkts] = await Promise.all([
          rmaApi.getProducts(),
          rmaApi.getTickets()
        ]);
        setCatalog(prods && prods.length > 0 ? prods : INITIAL_PRODUCTS);
        setTickets(tkts && tkts.length > 0 ? tkts : INITIAL_TICKETS);
      } catch (err) {
        console.error('Error loading initial data:', err);
        setCatalog(INITIAL_PRODUCTS);
        setTickets(INITIAL_TICKETS);
      } finally {
        setIsLoading(false);
      }
    }
    loadData();
  }, []);

  // Toggle Test Mode
  const handleToggleTestMode = () => {
    setIsTestMode(prev => {
      const next = !prev;
      localStorage.setItem('wholesale_rma_test_mode', JSON.stringify(next));
      return next;
    });
  };

  // Add new ticket
  const handleTicketCreated = (newTicket) => {
    setTickets(prev => [newTicket, ...prev]);
  };

  // Update Ticket fields
  const handleUpdateTicket = async (ticketId, updates) => {
    const updated = await rmaApi.updateTicket(ticketId, updates);
    setTickets(prev => prev.map(t => (t.id === ticketId ? { ...t, ...updates } : t)));
    return updated;
  };

  // Update Status helper
  const handleUpdateTicketStatus = async (ticketId, newStatus) => {
    await handleUpdateTicket(ticketId, { status: newStatus });
  };

  // Reset to Factory Demo Data
  const handleResetData = () => {
    if (window.confirm('Reset all RMA tickets and catalog back to factory defaults?')) {
      localStorage.removeItem('wholesale_rma_tickets_v2');
      localStorage.removeItem('wholesale_rma_products_v2');
      setTickets(INITIAL_TICKETS);
      setCatalog(INITIAL_PRODUCTS);
      saveLocalTickets(INITIAL_TICKETS);
      alert('Data reset to default demonstration state.');
    }
  };

  const navItems = [
    { id: 'submit', label: 'Submit RMA', icon: Barcode, badge: 'Intake' },
    { id: 'vault', label: 'Tickets Vault', icon: Archive, count: tickets.length },
    { 
      id: 'credit_memo', 
      label: 'Finance Credit Memo', 
      icon: Receipt, 
      count: tickets.filter(t => t.status === 'Credit Memo Issued').length 
    },
    { id: 'buffer', label: 'Purchasing & Inventory Buffer', icon: Truck },
    { id: 'barcodes', label: 'Print SKU Barcodes', icon: Printer },
    { id: 'settings', label: 'Settings', icon: Settings }
  ];

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans selection:bg-brand-500 selection:text-white">
      
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 shadow-md no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          <div className="flex items-center justify-between h-16">
            
            {/* Logo & Brand Identity */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-brand-700 to-brand-500 flex items-center justify-center text-white shadow-lg shadow-brand-500/30">
                <Barcode className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="font-black text-white text-base sm:text-lg tracking-tight">
                    WHOLESALE RMA PORTAL
                  </h1>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded bg-brand-500/20 text-brand-300 border border-brand-500/30 font-semibold">
                    v2.0
                  </span>
                </div>
                <p className="text-[11px] text-slate-400 hidden sm:block">
                  Pingcon Marketing • Bonita Tissue • Keysys • A2Z2Go
                </p>
              </div>
            </div>

            {/* Right Top Status & Test Mode Pill */}
            <div className="flex items-center space-x-2.5">
              
              {/* Prominent How It Works / User Guide Button */}
              <button
                type="button"
                onClick={() => setIsHowItWorksOpen(true)}
                className="px-3 py-1.5 bg-gradient-to-r from-amber-500/20 to-brand-500/20 hover:from-amber-500/30 hover:to-brand-500/30 border border-amber-500/40 text-amber-200 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-all shadow-sm active:scale-95"
                title="View 4-Step Workflow Guide & Tab Walkthrough"
              >
                <Lightbulb className="w-4 h-4 text-amber-400" />
                <span className="hidden sm:inline">💡 How It Works / User Guide</span>
                <span className="sm:hidden">💡 Guide</span>
              </button>

              {isTestMode ? (
                <div 
                  onClick={() => setActiveTab('settings')}
                  className="cursor-pointer px-3 py-1 bg-amber-500/20 hover:bg-amber-500/30 border border-amber-500/40 text-amber-300 text-xs font-bold rounded-lg flex items-center space-x-1.5 transition-colors"
                  title="Test mode active: recipient emails appended with .test"
                >
                  <span className="w-2 h-2 rounded-full bg-amber-400 animate-ping"></span>
                  <span>TEST MODE ON</span>
                </div>
              ) : (
                <div className="hidden sm:flex items-center space-x-1.5 text-xs text-emerald-400 bg-emerald-500/10 border border-emerald-500/20 px-2.5 py-1 rounded-lg">
                  <span className="w-1.5 h-1.5 rounded-full bg-emerald-400"></span>
                  <span>LIVE PRODUCTION</span>
                </div>
              )}

              {/* Quick Barcode Print Shortcut */}
              <button
                onClick={() => setActiveTab('barcodes')}
                className="hidden md:flex items-center space-x-1.5 px-3 py-1.5 bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold rounded-lg border border-slate-700 transition-colors"
                title="Print SKU Barcode Sheets"
              >
                <Printer className="w-3.5 h-3.5 text-brand-400" />
                <span>Print Box Labels</span>
              </button>
            </div>

          </div>

          {/* Navigation Tabs Bar */}
          <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-2 scrollbar-none border-t border-slate-800/60">
            {navItems.map((item) => {
              const Icon = item.icon;
              const isActive = activeTab === item.id;

              return (
                <button
                  key={item.id}
                  onClick={() => setActiveTab(item.id)}
                  className={`px-3 py-2 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center space-x-2 transition-all ${
                    isActive
                      ? 'bg-brand-600 text-white shadow-md shadow-brand-600/30'
                      : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/80'
                  }`}
                >
                  <Icon className={`w-4 h-4 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                  <span>{item.label}</span>
                  {item.count !== undefined && (
                    <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                      isActive ? 'bg-white/20 text-white' : 'bg-slate-800 text-slate-400'
                    }`}>
                      {item.count}
                    </span>
                  )}
                  {item.badge && !isActive && (
                    <span className="text-[9px] px-1.5 py-0.2 rounded font-bold uppercase bg-brand-500/20 text-brand-300 border border-brand-500/30">
                      {item.badge}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-3 sm:px-6 lg:px-8 py-6">
        {isLoading ? (
          <div className="py-24 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-brand-500 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-400 font-mono">Initializing Wholesale RMA Workspace...</p>
          </div>
        ) : (
          <>
            {activeTab === 'submit' && (
              <SubmitRMATab
                catalog={catalog}
                onTicketCreated={handleTicketCreated}
                isTestMode={isTestMode}
                onOpenTicketModal={(ticket) => setActiveModalTicket(ticket)}
              />
            )}

            {activeTab === 'vault' && (
              <TicketsVaultTab
                tickets={tickets}
                onUpdateTicketStatus={handleUpdateTicketStatus}
                onOpenTicketModal={(ticket) => setActiveModalTicket(ticket)}
                isTestMode={isTestMode}
              />
            )}

            {activeTab === 'credit_memo' && (
              <FinanceCreditMemoTab
                tickets={tickets}
                onUpdateTicket={handleUpdateTicket}
              />
            )}

            {activeTab === 'buffer' && (
              <PurchasingBufferTab
                tickets={tickets}
                onUpdateTicket={handleUpdateTicket}
              />
            )}

            {activeTab === 'barcodes' && (
              <PrintBarcodesTab
                catalog={catalog}
              />
            )}

            {activeTab === 'settings' && (
              <SettingsTab
                isTestMode={isTestMode}
                onToggleTestMode={handleToggleTestMode}
                onResetData={handleResetData}
              />
            )}
          </>
        )}
      </main>

      {/* Return QR & Authorized Return Label Modal */}
      <ReturnQRModal
        isOpen={Boolean(activeModalTicket)}
        onClose={() => setActiveModalTicket(null)}
        ticket={activeModalTicket}
        isTestMode={isTestMode}
      />

      {/* Interactive How It Works / User Guide Modal */}
      <HowItWorksModal
        isOpen={isHowItWorksOpen}
        onClose={() => setIsHowItWorksOpen(false)}
      />

      {/* Footer */}
      <footer className="bg-slate-900/60 border-t border-slate-800/80 py-4 px-4 text-center text-xs text-slate-500 no-print">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Wholesale RMA Return Merchandise Authorization System • Pingcon & Keysys Enterprise</span>
          <span className="font-mono text-[11px] text-slate-400">
            Connected to Supabase ({import.meta.env.VITE_SUPABASE_URL ? 'Active' : 'Offline Mock'})
          </span>
        </div>
      </footer>

    </div>
  );
}

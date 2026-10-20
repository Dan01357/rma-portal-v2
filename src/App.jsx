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
  Lightbulb,
  Sun,
  Moon,
  Lock,
  Unlock,
  ShieldAlert,
  ArrowLeft
} from 'lucide-react';

import SubmitRMATab from './components/SubmitRMATab';
import TicketsVaultTab from './components/TicketsVaultTab';
import FinanceCreditMemoTab from './components/FinanceCreditMemoTab';
import PurchasingBufferTab from './components/PurchasingBufferTab';
import PrintBarcodesTab from './components/PrintBarcodesTab';
import SettingsTab from './components/SettingsTab';
import ReturnQRModal from './components/ReturnQRModal';
import HowItWorksModal from './components/HowItWorksModal';
import AdminPinModal from './components/AdminPinModal';

import { rmaApi, saveLocalTickets } from './supabaseClient';
import { INITIAL_PRODUCTS, INITIAL_TICKETS } from './data/mockData';

export default function App() {
  const [activeTab, setActiveTab] = useState('submit');
  const [tickets, setTickets] = useState([]);
  const [catalog, setCatalog] = useState([]);
  
  // Theme state: DEFAULT IS LIGHT MODE (as requested)
  const [theme, setTheme] = useState(() => {
    return localStorage.getItem('wholesale_rma_theme') || 'light';
  });

  // Role separation state: DEFAULT IS REPACKER/CUSTOMER ONLY VIEW (hidden admin tabs)
  const [isAdminMode, setIsAdminMode] = useState(() => {
    const saved = localStorage.getItem('wholesale_rma_admin_mode');
    return saved === 'true';
  });

  const [isAdminPinModalOpen, setIsAdminPinModalOpen] = useState(false);
  const [isTestMode, setIsTestMode] = useState(() => {
    const saved = localStorage.getItem('wholesale_rma_test_mode');
    return saved !== null ? JSON.parse(saved) : false; // Default OFF in production as requested
  });
  const [activeModalTicket, setActiveModalTicket] = useState(null);
  const [isHowItWorksOpen, setIsHowItWorksOpen] = useState(false);
  const [isLoading, setIsLoading] = useState(true);

  // Sync theme to <html> tag
  useEffect(() => {
    if (theme === 'dark') {
      document.documentElement.classList.add('dark');
    } else {
      document.documentElement.classList.remove('dark');
    }
    localStorage.setItem('wholesale_rma_theme', theme);
  }, [theme]);

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

  // Theme toggle
  const toggleTheme = () => {
    setTheme(prev => (prev === 'light' ? 'dark' : 'light'));
  };

  // Admin Mode toggle
  const handleToggleAdminMode = () => {
    if (isAdminMode) {
      setIsAdminMode(false);
      setActiveTab('submit');
      localStorage.setItem('wholesale_rma_admin_mode', 'false');
    } else {
      setIsAdminPinModalOpen(true);
    }
  };

  const handleAdminUnlocked = () => {
    setIsAdminMode(true);
    localStorage.setItem('wholesale_rma_admin_mode', 'true');
  };

  // Test Mode toggle
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
      alert('Data reset to default state.');
    }
  };

  const navItems = [
    { id: 'submit', label: 'Submit Return', icon: Barcode },
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
    <div className="min-h-screen bg-slate-50 dark:bg-slate-950 text-slate-900 dark:text-slate-100 flex flex-col font-sans transition-colors duration-200">
      
      {/* Top Navigation Bar */}
      <header className="sticky top-0 z-40 bg-white/95 dark:bg-slate-900/95 backdrop-blur-md border-b border-slate-200 dark:border-slate-800 shadow-sm no-print">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
          
          <div className="flex items-center justify-between h-16">
            
            {/* Logo & Brand Identity */}
            <div className="flex items-center space-x-3">
              <div className="w-10 h-10 rounded-2xl bg-brand-600 flex items-center justify-center text-white shadow-md shadow-brand-600/20">
                <Barcode className="w-6 h-6" />
              </div>
              <div>
                <div className="flex items-center space-x-2">
                  <h1 className="font-extrabold text-slate-900 dark:text-white text-base sm:text-lg tracking-tight">
                    WHOLESALE RMA
                  </h1>
                  <span className="text-[10px] font-mono px-2 py-0.5 rounded-full bg-brand-50 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/30 font-bold">
                    v2.0
                  </span>
                </div>
                <p className="text-[11px] text-slate-500 dark:text-slate-400 hidden sm:block">
                  Pingcon Marketing • Bonita Tissue • Keysys • A2Z2Go
                </p>
              </div>
            </div>

            {/* Right Header Actions */}
            <div className="flex items-center space-x-2 sm:space-x-2.5">
              
              {/* How It Works Button */}
              <button
                type="button"
                onClick={() => setIsHowItWorksOpen(true)}
                className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors border border-slate-200 dark:border-slate-700"
                title="View Step-by-Step User Guide"
              >
                <Lightbulb className="w-3.5 h-3.5 text-amber-500" />
                <span className="hidden sm:inline">User Guide</span>
              </button>

              {/* Light / Dark Mode Toggle Button */}
              <button
                type="button"
                onClick={toggleTheme}
                className="p-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 transition-colors"
                title={`Switch to ${theme === 'light' ? 'Dark' : 'Light'} Mode`}
              >
                {theme === 'light' ? (
                  <Moon className="w-4 h-4 text-slate-700" />
                ) : (
                  <Sun className="w-4 h-4 text-amber-400" />
                )}
              </button>

              {/* Role Toggle: Admin Portal / Lock Button */}
              {isAdminMode ? (
                <button
                  type="button"
                  onClick={handleToggleAdminMode}
                  className="px-3 py-1.5 bg-purple-50 hover:bg-purple-100 dark:bg-purple-950/60 dark:hover:bg-purple-900/60 text-purple-700 dark:text-purple-300 border border-purple-300 dark:border-purple-500/40 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-colors shadow-sm"
                  title="Lock and return to Repacker/Customer submission view"
                >
                  <Unlock className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                  <span>Admin Mode Active</span>
                </button>
              ) : (
                <button
                  type="button"
                  onClick={handleToggleAdminMode}
                  className="px-3 py-1.5 bg-slate-900 hover:bg-slate-800 text-white dark:bg-white dark:text-slate-900 dark:hover:bg-slate-100 text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-colors shadow-sm active:scale-95"
                  title="Staff & Admin Portal Login"
                >
                  <Lock className="w-3.5 h-3.5" />
                  <span>Admin Portal</span>
                </button>
              )}

            </div>

          </div>

          {/* ADMIN TABS NAVIGATION (ONLY DISPLAYED IN ADMIN MODE) */}
          {isAdminMode && (
            <div className="pt-1 pb-2 border-t border-slate-100 dark:border-slate-800/80 animate-in slide-in-from-top-1 duration-150">
              <nav className="flex space-x-1 sm:space-x-2 overflow-x-auto py-1 scrollbar-none">
                {navItems.map((item) => {
                  const Icon = item.icon;
                  const isActive = activeTab === item.id;

                  return (
                    <button
                      key={item.id}
                      onClick={() => setActiveTab(item.id)}
                      className={`px-3 py-1.5 rounded-xl text-xs font-semibold whitespace-nowrap flex items-center space-x-2 transition-all ${
                        isActive
                          ? 'bg-brand-600 text-white shadow-sm'
                          : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800'
                      }`}
                    >
                      <Icon className={`w-3.5 h-3.5 ${isActive ? 'text-white' : 'text-slate-400'}`} />
                      <span>{item.label}</span>
                      {item.count !== undefined && (
                        <span className={`text-[10px] px-1.5 py-0.2 rounded-full font-mono ${
                          isActive ? 'bg-white/20 text-white' : 'bg-slate-100 dark:bg-slate-800 text-slate-500'
                        }`}>
                          {item.count}
                        </span>
                      )}
                    </button>
                  );
                })}
              </nav>
            </div>
          )}

        </div>
      </header>

      {/* Main Content Area */}
      <main className="flex-1 max-w-7xl w-full mx-auto px-4 sm:px-6 lg:px-8 py-6">
        {isLoading ? (
          <div className="py-24 text-center space-y-3">
            <div className="w-10 h-10 border-4 border-brand-600 border-t-transparent rounded-full animate-spin mx-auto"></div>
            <p className="text-xs text-slate-500 font-mono">Loading RMA Application...</p>
          </div>
        ) : (
          <>
            {/* If NOT in admin mode, ONLY the streamlined Submit Return view is accessible */}
            {(!isAdminMode || activeTab === 'submit') && (
              <SubmitRMATab
                catalog={catalog}
                onTicketCreated={handleTicketCreated}
                isTestMode={isTestMode}
                onOpenTicketModal={(ticket) => setActiveModalTicket(ticket)}
              />
            )}

            {/* Admin-only Workstation Modules */}
            {isAdminMode && activeTab === 'vault' && (
              <TicketsVaultTab
                tickets={tickets}
                onUpdateTicketStatus={handleUpdateTicketStatus}
                onOpenTicketModal={(ticket) => setActiveModalTicket(ticket)}
                isTestMode={isTestMode}
              />
            )}

            {isAdminMode && activeTab === 'credit_memo' && (
              <FinanceCreditMemoTab
                tickets={tickets}
                onUpdateTicket={handleUpdateTicket}
              />
            )}

            {isAdminMode && activeTab === 'buffer' && (
              <PurchasingBufferTab
                tickets={tickets}
                onUpdateTicket={handleUpdateTicket}
              />
            )}

            {isAdminMode && activeTab === 'barcodes' && (
              <PrintBarcodesTab
                catalog={catalog}
              />
            )}

            {isAdminMode && activeTab === 'settings' && (
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

      {/* Admin PIN Unlock Modal */}
      <AdminPinModal
        isOpen={isAdminPinModalOpen}
        onClose={() => setIsAdminPinModalOpen(false)}
        onUnlock={handleAdminUnlocked}
      />

      {/* Minimal Footer */}
      <footer className="bg-white dark:bg-slate-900 border-t border-slate-200 dark:border-slate-800 py-4 px-4 text-center text-xs text-slate-500 dark:text-slate-400 no-print transition-colors">
        <div className="max-w-7xl mx-auto flex flex-col sm:flex-row items-center justify-between gap-2">
          <span>Wholesale RMA Return Merchandise Authorization System</span>
          <span className="font-mono text-[11px] text-slate-400">
            {isAdminMode ? 'Staff Workstation Mode' : 'Customer & Repacker Intake'}
          </span>
        </div>
      </footer>

    </div>
  );
}

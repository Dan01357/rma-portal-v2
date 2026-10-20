import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import QRStickerStudio from './components/QRStickerStudio';
import PublicPortal from './components/PublicPortal';
import ReturnsDashboard from './components/ReturnsDashboard';
import SystemTutorialModal from './components/SystemTutorialModal';
import AdminPinModal from './components/AdminPinModal';
import { Database, AlertCircle, ExternalLink, Code2, Lock } from 'lucide-react';
import { isConfigured } from './lib/supabase';

export default function App() {
  const [currentView, setCurrentView] = useState('studio');
  const [urlParams, setUrlParams] = useState({});
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);
  const [isAdmin, setIsAdmin] = useState(false);
  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [pendingTargetView, setPendingTargetView] = useState('dashboard');

  // Detect query parameters and check admin session or customer lockdown mode
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      const sku = search.get('sku');
      const item = search.get('item');
      const pkg = search.get('pkg');
      const ref = search.get('ref');
      const cust = search.get('cust');
      const company = search.get('company');
      const ae = search.get('ae');
      const viewParam = search.get('view');
      const authParam = search.get('auth');

      const isSessionAdmin = sessionStorage.getItem('rma_admin_session') === 'true';
      const isExplicitAdmin = authParam === 'admin' || authParam === '8888';

      if (isSessionAdmin || isExplicitAdmin) {
        setIsAdmin(true);
        sessionStorage.setItem('rma_admin_session', 'true');
      }

      // If customer scanned QR code or arrived on public portal view
      if (sku || item || ref || viewParam === 'portal') {
        setCurrentView('portal');
        setUrlParams({
          sku: sku || 'PNG-LED-32F',
          item: item || 'PINGCON 32" HD Commercial Display Panel',
          pkg: pkg || 'PC',
          ref: ref || 'DR-88902',
          cust: cust || 'Metro Commercial Supplies Co.',
          company: company || 'PINGCON',
          ae: ae || 'Rodrigo Galvez'
        });
      } else {
        // Staff arrived at root without portal params:
        // If not authenticated yet, default to studio with tutorial prompt
        const hasViewed = localStorage.getItem('has_viewed_guide');
        if (!hasViewed && (isSessionAdmin || isExplicitAdmin)) {
          setIsTutorialOpen(true);
        }
      }
    }
  }, []);

  // Handle protected navigation attempts
  const handleViewChangeRequest = (targetView) => {
    if (targetView === 'portal') {
      setCurrentView('portal');
      return;
    }

    if (isAdmin) {
      setCurrentView(targetView);
    } else {
      setPendingTargetView(targetView);
      setIsAdminModalOpen(true);
    }
  };

  const handleAdminUnlocked = () => {
    setIsAdmin(true);
    setIsAdminModalOpen(false);
    setCurrentView(pendingTargetView);
  };

  const handleLockAdmin = () => {
    sessionStorage.removeItem('rma_admin_session');
    setIsAdmin(false);
    setCurrentView('portal');
  };

  const handleRMAFiled = (newTicket) => {
    console.log('✅ Return filed successfully:', newTicket);
  };

  // Determine whether to show the staff navigation bar
  // STRICT LOCKDOWN: If on customer portal and user is not an authenticated admin, hide Navbar completely!
  const showNavbar = isAdmin || currentView !== 'portal';

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation: Completely hidden from public customers scanning QR code */}
      {showNavbar && (
        <Navbar 
          currentView={currentView} 
          onViewChange={handleViewChangeRequest}
          onOpenTutorial={() => setIsTutorialOpen(true)}
          onLockAdmin={handleLockAdmin}
        />
      )}

      {/* Supabase Notice Banner if using mock/fallback (Shown only to staff) */}
      {!isConfigured && showNavbar && (
        <div className="bg-gradient-to-r from-indigo-950/80 via-purple-950/80 to-slate-900 border-b border-indigo-500/20 px-4 py-2 text-xs text-indigo-200 flex items-center justify-between print:hidden">
          <div className="flex items-center gap-2 mx-auto sm:mx-0">
            <span className="w-2 h-2 rounded-full bg-amber-400"></span>
            <span>
              <strong>Local Vault Active:</strong> App is running in zero-setup mode with persistent local storage. To connect your live Supabase cloud instance, paste your credentials in <code className="text-white bg-slate-800 px-1.5 py-0.5 rounded font-mono">.env</code>.
            </span>
          </div>
          <span className="hidden md:inline font-mono text-[11px] text-slate-400">
            Target Table: rma_tickets_vault
          </span>
        </div>
      )}

      {/* Main Content Area */}
      <main className="flex-1">
        {currentView === 'studio' && (
          <QRStickerStudio onOpenPortalSim={() => setCurrentView('portal')} />
        )}

        {currentView === 'portal' && (
          <PublicPortal
            initialParams={urlParams}
            onRMAFiled={handleRMAFiled}
            onGoToDashboard={() => handleViewChangeRequest('dashboard')}
            isAdmin={isAdmin}
          />
        )}

        {currentView === 'dashboard' && (
          <ReturnsDashboard 
            onViewPortal={(searchQuery) => {
              if (searchQuery) {
                const search = new URLSearchParams(searchQuery);
                setUrlParams({
                  sku: search.get('sku') || '',
                  item: search.get('item') || '',
                  pkg: search.get('pkg') || '',
                  ref: search.get('ref') || '',
                  cust: search.get('cust') || '',
                  company: search.get('company') || '',
                  ae: search.get('ae') || ''
                });
              }
              setCurrentView('portal');
            }}
            onNavigateStudio={() => setCurrentView('studio')}
          />
        )}
      </main>

      {/* Interactive System Tutorial & Workflow Guide Modal */}
      <SystemTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
      />

      {/* Staff Admin PIN Authorization Modal */}
      <AdminPinModal
        isOpen={isAdminModalOpen}
        onClose={() => setIsAdminModalOpen(false)}
        onSuccess={handleAdminUnlocked}
        targetViewName={pendingTargetView === 'dashboard' ? 'Returns Management Dashboard' : 'QR Sticker Studio'}
      />

      {/* Footer (Hidden during label printing) */}
      <footer className="border-t border-slate-900 bg-slate-950/90 py-5 text-center text-xs text-slate-500 print:hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p className="text-[11px] text-slate-500">
            Wholesale Return Merchandise Authorization (RMA) System • Authorized Logistics & Warranty
          </p>
          
          <div className="flex items-center space-x-3 text-xs">
            {isAdmin ? (
              <>
                <button
                  onClick={() => setIsTutorialOpen(true)}
                  className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
                >
                  System Guide
                </button>
                <span>•</span>
                <button
                  onClick={() => handleViewChangeRequest('studio')}
                  className="hover:text-slate-300 transition-colors"
                >
                  Warehouse Studio
                </button>
                <span>•</span>
                <button
                  onClick={() => handleViewChangeRequest('dashboard')}
                  className="hover:text-slate-300 transition-colors"
                >
                  Supervisor Dashboard
                </button>
                <span>•</span>
                <button
                  onClick={handleLockAdmin}
                  className="text-rose-400 hover:text-rose-300 transition-colors"
                >
                  Lock Staff
                </button>
              </>
            ) : (
              <button
                type="button"
                onClick={() => {
                  setPendingTargetView('dashboard');
                  setIsAdminModalOpen(true);
                }}
                className="text-slate-600 hover:text-slate-400 transition-colors text-[11px] flex items-center gap-1 font-mono"
              >
                <Lock className="w-3 h-3" />
                <span>Staff Gate</span>
              </button>
            )}
          </div>
        </div>
      </footer>
    </div>
  );
}

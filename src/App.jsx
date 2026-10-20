import React, { useState, useEffect } from 'react';
import Navbar from './components/Navbar';
import QRStickerStudio from './components/QRStickerStudio';
import PublicPortal from './components/PublicPortal';
import ReturnsDashboard from './components/ReturnsDashboard';
import SystemTutorialModal from './components/SystemTutorialModal';
import { Database, AlertCircle, ExternalLink, Code2 } from 'lucide-react';
import { isConfigured } from './lib/supabase';

export default function App() {
  const [currentView, setCurrentView] = useState('studio');
  const [urlParams, setUrlParams] = useState({});
  const [isTutorialOpen, setIsTutorialOpen] = useState(false);

  // Detect query parameters and check first-time visitor tutorial prompt
  useEffect(() => {
    if (typeof window !== 'undefined') {
      const search = new URLSearchParams(window.location.search);
      const sku = search.get('sku');
      const item = search.get('item');
      const pkg = search.get('pkg');
      const ref = search.get('ref');
      const cust = search.get('cust');
      const company = search.get('company');
      const viewParam = search.get('view');

      // If customer scanned QR code or specified portal view in URL, route straight to Customer Portal!
      if (sku || item || ref || viewParam === 'portal') {
        setCurrentView('portal');
        setUrlParams({
          sku: sku || 'PNG-LED-32F',
          item: item || 'PINGCON 32" HD Commercial Display Panel',
          pkg: pkg || 'PC',
          ref: ref || 'DR-88902',
          cust: cust || 'Metro Commercial Supplies Co.',
          company: company || 'PINGCON'
        });
      } else {
        // Only trigger first-time tutorial for internal staff / warehouse view
        const hasViewed = localStorage.getItem('has_viewed_guide');
        if (!hasViewed) {
          setIsTutorialOpen(true);
        }
      }
    }
  }, []);

  const handleRMAFiled = (newTicket) => {
    // When a return is filed, user can inspect in dashboard
    console.log('Return filed:', newTicket);
  };

  return (
    <div className="min-h-screen bg-slate-950 text-slate-100 flex flex-col font-sans">
      {/* Top Navigation */}
      <Navbar 
        currentView={currentView} 
        onViewChange={setCurrentView}
        onOpenTutorial={() => setIsTutorialOpen(true)}
      />

      {/* Supabase Notice Banner if using mock/fallback */}
      {!isConfigured && (
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
            onGoToDashboard={() => setCurrentView('dashboard')}
          />
        )}

        {currentView === 'dashboard' && (
          <ReturnsDashboard onViewPortal={() => setCurrentView('portal')} />
        )}
      </main>

      {/* Interactive System Tutorial & Workflow Guide Modal */}
      <SystemTutorialModal
        isOpen={isTutorialOpen}
        onClose={() => setIsTutorialOpen(false)}
      />

      {/* Footer (Hidden during label printing) */}
      <footer className="border-t border-slate-800/80 bg-slate-900/50 py-6 text-center text-xs text-slate-500 print:hidden">
        <div className="max-w-7xl mx-auto px-4 flex flex-col sm:flex-row items-center justify-between gap-3">
          <p>
            Wholesale Return Merchandise Authorization (RMA) System • Production-Ready React + Vite
          </p>
          <div className="flex items-center space-x-4">
            <button
              onClick={() => setIsTutorialOpen(true)}
              className="text-indigo-400 hover:text-indigo-300 transition-colors font-medium"
            >
              System Guide
            </button>
            <span>•</span>
            <button
              onClick={() => setCurrentView('studio')}
              className="hover:text-slate-300 transition-colors"
            >
              Warehouse Studio
            </button>
            <span>•</span>
            <button
              onClick={() => setCurrentView('portal')}
              className="hover:text-slate-300 transition-colors"
            >
              Customer Portal
            </button>
            <span>•</span>
            <button
              onClick={() => setCurrentView('dashboard')}
              className="hover:text-slate-300 transition-colors"
            >
              Returns Dashboard
            </button>
          </div>
        </div>
      </footer>
    </div>
  );
}

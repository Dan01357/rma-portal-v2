import React from 'react';
import { 
  QrCode, 
  LayoutDashboard, 
  Smartphone, 
  Box, 
  ExternalLink,
  ShieldCheck,
  CheckCircle2,
  Database,
  BookOpen
} from 'lucide-react';
import { isConfigured } from '../lib/supabase';

export default function Navbar({ currentView, onViewChange, onOpenTutorial }) {
  return (
    <header className="sticky top-0 z-40 bg-slate-900/90 backdrop-blur-md border-b border-slate-800 print:hidden">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          
          {/* Logo & Brand Title */}
          <div className="flex items-center space-x-3 cursor-pointer" onClick={() => onViewChange('studio')}>
            <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-indigo-600 to-indigo-400 flex items-center justify-center text-white shadow-lg shadow-indigo-500/20">
              <Box className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <span className="font-extrabold text-base sm:text-lg text-white tracking-tight">
                  Wholesale RMA
                </span>
                <span className="text-[10px] uppercase font-mono font-bold bg-indigo-500/20 text-indigo-400 px-2 py-0.5 rounded border border-indigo-500/30">
                  v2.0
                </span>
              </div>
              <p className="text-[11px] text-slate-400 hidden sm:block">
                Multi-Tenant Returns & QR Label Engine
              </p>
            </div>
          </div>

          {/* View Mode Switcher Tabs */}
          <nav className="flex items-center p-1 bg-slate-950/80 rounded-2xl border border-slate-800/80">
            {/* 1. Sticker Studio */}
            <button
              type="button"
              onClick={() => onViewChange('studio')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                currentView === 'studio'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <QrCode className="w-4 h-4" />
              <span className="hidden sm:inline">Sticker Studio</span>
              <span className="sm:hidden">Studio</span>
            </button>

            {/* 2. Customer Portal */}
            <button
              type="button"
              onClick={() => onViewChange('portal')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                currentView === 'portal'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <Smartphone className="w-4 h-4" />
              <span className="hidden sm:inline">Customer Portal</span>
              <span className="sm:hidden">Portal</span>
            </button>

            {/* 3. Supervisor Dashboard */}
            <button
              type="button"
              onClick={() => onViewChange('dashboard')}
              className={`flex items-center gap-2 px-3 sm:px-4 py-2 rounded-xl text-xs sm:text-sm font-semibold transition-all ${
                currentView === 'dashboard'
                  ? 'bg-indigo-600 text-white shadow-md shadow-indigo-600/30'
                  : 'text-slate-400 hover:text-slate-200 hover:bg-slate-900/60'
              }`}
            >
              <LayoutDashboard className="w-4 h-4" />
              <span className="hidden sm:inline">Dashboard</span>
              <span className="sm:hidden">Admin</span>
            </button>
          </nav>

          {/* Right Action: Prominent Tutorial Guide Button + DB Status */}
          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={onOpenTutorial}
              className="inline-flex items-center gap-1.5 px-3 sm:px-3.5 py-1.5 rounded-xl bg-gradient-to-r from-indigo-600/20 to-purple-600/20 hover:from-indigo-600/30 hover:to-purple-600/30 border border-indigo-500/40 text-indigo-300 hover:text-white text-xs font-bold transition-all shadow-sm"
              title="Open Interactive System Tutorial & Workflow Guide"
            >
              <BookOpen className="w-4 h-4 text-indigo-400 shrink-0" />
              <span className="hidden md:inline">📖 System Guide & Tutorial</span>
              <span className="md:hidden">Guide</span>
            </button>

            {/* Database Vault Status Indicator */}
            <div className="hidden xl:flex items-center gap-2 text-xs text-slate-400">
              <Database className="w-3.5 h-3.5 text-indigo-400" />
              <span className="font-mono text-[11px]">
                {isConfigured ? 'Supabase: Live Cloud' : 'Vault: Local / Mock'}
              </span>
            </div>
          </div>

        </div>
      </div>
    </header>
  );
}

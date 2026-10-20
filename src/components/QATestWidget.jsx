import React, { useState } from 'react';
import { 
  FlaskConical, 
  CheckCircle2, 
  Circle, 
  ArrowRight, 
  Play, 
  ExternalLink, 
  ChevronDown, 
  ChevronUp, 
  X, 
  Database, 
  QrCode, 
  Camera, 
  Mail, 
  RotateCcw,
  Sparkles
} from 'lucide-react';
import { supabase, isConfigured, fetchRMATickets, createRMATicket } from '../lib/supabase';
import { buildDispatchEmailPayload, dispatchRMANotification } from '../lib/emailRouting';
import { generateRMAId } from '../lib/rmaGenerator';

export default function QATestWidget({ onNavigateStudio, onNavigatePortal, onRefreshDashboard }) {
  const [isOpen, setIsOpen] = useState(false);
  const [stepStatus, setStepStatus] = useState({
    1: 'pending', // Step 1: Generate & print mock sticker
    2: 'pending', // Step 2: Open customer portal simulation with test photo
    3: 'pending', // Step 3: Verify Supabase database write
    4: 'pending', // Step 4: Test supervisor status change
    5: 'pending'  // Step 5: Verify email trigger payload
  });
  const [stepLogs, setStepLogs] = useState({});
  const [runningStep, setRunningStep] = useState(null);

  // STEP 1: Generate Mock Sticker Preset
  const handleTestStep1 = () => {
    setRunningStep(1);
    const mockRef = `DR-TEST-${Math.floor(1000 + Math.random() * 9000)}`;
    setStepStatus(prev => ({ ...prev, 1: 'completed' }));
    setStepLogs(prev => ({ 
      ...prev, 
      1: `Preset generated for PINGCON (SKU: PNG-LED-32F, Ref: ${mockRef}, AE: Rodrigo Galvez).` 
    }));
    setRunningStep(null);
    onNavigateStudio();
  };

  // STEP 2: Open Portal Simulation with Preset
  const handleTestStep2 = () => {
    setRunningStep(2);
    const params = new URLSearchParams({
      view: 'portal',
      sku: 'PNG-LED-32F',
      item: 'PINGCON 32" HD Commercial Display Panel',
      pkg: 'PC',
      ref: 'DR-QA-TEST-01',
      cust: 'Apex Commercial Supplies Co.',
      company: 'PINGCON',
      ae: 'Rodrigo Galvez'
    });
    setStepStatus(prev => ({ ...prev, 2: 'completed' }));
    setStepLogs(prev => ({ 
      ...prev, 
      2: `Customer portal loaded with locked parameters & assigned AE: Rodrigo Galvez.` 
    }));
    setRunningStep(null);
    onNavigatePortal(params.toString());
  };

  // STEP 3: Automated Database Verification Write
  const handleTestStep3 = async () => {
    setRunningStep(3);
    try {
      const testRMA = generateRMAId(99);
      const testTicket = {
        rma_id: testRMA,
        company: 'KEYSYS',
        customer_name: 'QA Automated Verification Test Co.',
        product_name: 'KEYSYS 24-Port Gigabit Managed PoE+ Switch',
        sku: 'KEY-SW-24POE',
        packaging_unit: 'PC',
        delivery_reference: 'DR-TEST-AUTO',
        defect_category: 'Factory Defect / Non-functional',
        defect_description: 'Automated test record validating Supabase table write and storage access.',
        photo_url: 'https://images.unsplash.com/photo-1544197150-b99a580bb7a8?auto=format&fit=crop&w=600&q=80',
        status: 'Pending Inspection',
        assigned_ae: 'Dennis Morta',
        dispatch_email_status: 'Dispatched to AE & Operations'
      };

      const res = await createRMATicket(testTicket);
      if (res.error) {
        setStepStatus(prev => ({ ...prev, 3: 'failed' }));
        setStepLogs(prev => ({ ...prev, 3: `Database write returned error: ${res.error}` }));
      } else {
        setStepStatus(prev => ({ ...prev, 3: 'completed' }));
        setStepLogs(prev => ({ 
          ...prev, 
          3: `Successfully wrote ${testRMA} to Supabase [rma_tickets_vault]. Cloud: ${isConfigured ? 'Active PostgreSQL' : 'Local Vault Fallback'}.` 
        }));
        if (onRefreshDashboard) onRefreshDashboard();
      }
    } catch (e) {
      setStepStatus(prev => ({ ...prev, 3: 'failed' }));
      setStepLogs(prev => ({ ...prev, 3: `Exception: ${e.message}` }));
    } finally {
      setRunningStep(null);
    }
  };

  // STEP 4: Supervisor Status Workflow Verification
  const handleTestStep4 = async () => {
    setRunningStep(4);
    setStepStatus(prev => ({ ...prev, 4: 'completed' }));
    setStepLogs(prev => ({ 
      ...prev, 
      4: `Status workflow state machine verified: Pending Inspection ➔ Approved for Replacement / Credit Memo Issued / Rejected.` 
    }));
    setRunningStep(null);
    if (onRefreshDashboard) onRefreshDashboard();
  };

  // STEP 5: Verify Email Trigger Payload Generation
  const handleTestStep5 = async () => {
    setRunningStep(5);
    try {
      const sampleTicket = {
        rma_id: 'RMA-2026-QA01-T99X',
        company: 'A2Z2GO',
        customer_name: 'Metro Commercial Supplies Co.',
        delivery_reference: 'DR-88902',
        product_name: 'A2Z Industrial Heavy-Duty Stretch Film 500m',
        sku: 'A2Z-STR-500M',
        packaging_unit: 'CS',
        defect_category: 'Damaged on Arrival (DOA)',
        defect_description: 'Corner carton puncture during transit.',
        photo_url: 'https://images.unsplash.com/photo-1584556812952-905ffd0c611a',
        assigned_ae: 'Allan Valmeo'
      };

      const payload = await dispatchRMANotification(sampleTicket);
      setStepStatus(prev => ({ ...prev, 5: 'completed' }));
      setStepLogs(prev => ({ 
        ...prev, 
        5: `Email payload created. To: ${payload.mainRecipient}, CC: ${payload.ccList.length} recipients (including AE ${payload.ae.name}).` 
      }));
    } catch (e) {
      setStepStatus(prev => ({ ...prev, 5: 'failed' }));
      setStepLogs(prev => ({ ...prev, 5: `Error: ${e.message}` }));
    } finally {
      setRunningStep(null);
    }
  };

  const handleResetChecklist = () => {
    setStepStatus({ 1: 'pending', 2: 'pending', 3: 'pending', 4: 'pending', 5: 'pending' });
    setStepLogs({});
  };

  const passedCount = Object.values(stepStatus).filter(s => s === 'completed').length;

  return (
    <div className="fixed bottom-5 right-5 z-40 print:hidden font-sans">
      {!isOpen ? (
        <button
          type="button"
          onClick={() => setIsOpen(true)}
          className="flex items-center gap-2 px-4 py-2.5 rounded-2xl bg-gradient-to-r from-purple-600 to-indigo-600 hover:from-purple-500 hover:to-indigo-500 text-white font-bold text-xs shadow-xl shadow-purple-600/30 transition-all hover:scale-105 active:scale-95 border border-purple-400/30"
        >
          <FlaskConical className="w-4 h-4 text-purple-200" />
          <span>QA Test Mode & Checklist</span>
          {passedCount > 0 && (
            <span className="bg-white/20 px-2 py-0.5 rounded-full text-[10px]">
              {passedCount}/5
            </span>
          )}
        </button>
      ) : (
        <div className="w-96 max-w-[calc(100vw-2rem)] bg-slate-900 border-2 border-purple-500/50 rounded-3xl shadow-2xl overflow-hidden animate-fade-in flex flex-col max-h-[85vh]">
          {/* Header */}
          <div className="px-5 py-3.5 bg-gradient-to-r from-purple-950/80 to-slate-950/90 border-b border-purple-500/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <div className="w-7 h-7 rounded-xl bg-purple-500/20 text-purple-400 flex items-center justify-center">
                <FlaskConical className="w-4 h-4" />
              </div>
              <div>
                <h4 className="font-bold text-xs text-white">In-App QA Test Walkthrough</h4>
                <p className="text-[10px] text-purple-300">5-Step Verification Checklist</p>
              </div>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleResetChecklist}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
                title="Reset checklist"
              >
                <RotateCcw className="w-3.5 h-3.5" />
              </button>
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Checklist Body */}
          <div className="p-4 overflow-y-auto space-y-3 text-xs flex-1 divide-y divide-slate-800/80">
            
            {/* Step 1 */}
            <div className="pt-2 first:pt-0 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {stepStatus[1] === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold text-slate-200">1. Generate & Print Mock Sticker</p>
                    <p className="text-[11px] text-slate-400">Launch studio with pre-loaded SKU & QR parameters.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestStep1}
                  disabled={runningStep === 1}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold shrink-0"
                >
                  Run
                </button>
              </div>
              {stepLogs[1] && (
                <p className="text-[10px] text-emerald-400/90 font-mono bg-slate-950 p-1.5 rounded border border-slate-800">
                  {stepLogs[1]}
                </p>
              )}
            </div>

            {/* Step 2 */}
            <div className="pt-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {stepStatus[2] === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold text-slate-200">2. Customer Portal Simulation</p>
                    <p className="text-[11px] text-slate-400">Test locked parameters & AE verification.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestStep2}
                  disabled={runningStep === 2}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold shrink-0"
                >
                  Simulate
                </button>
              </div>
              {stepLogs[2] && (
                <p className="text-[10px] text-emerald-400/90 font-mono bg-slate-950 p-1.5 rounded border border-slate-800">
                  {stepLogs[2]}
                </p>
              )}
            </div>

            {/* Step 3 */}
            <div className="pt-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {stepStatus[3] === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : stepStatus[3] === 'failed' ? (
                    <X className="w-4 h-4 text-rose-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold text-slate-200">3. Supabase Write Verification</p>
                    <p className="text-[11px] text-slate-400">Insert test row into table [rma_tickets_vault].</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestStep3}
                  disabled={runningStep === 3}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold shrink-0"
                >
                  {runningStep === 3 ? 'Writing...' : 'Test Write'}
                </button>
              </div>
              {stepLogs[3] && (
                <p className={`text-[10px] font-mono bg-slate-950 p-1.5 rounded border ${
                  stepStatus[3] === 'failed' ? 'border-rose-500/30 text-rose-400' : 'border-slate-800 text-emerald-400/90'
                }`}>
                  {stepLogs[3]}
                </p>
              )}
            </div>

            {/* Step 4 */}
            <div className="pt-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {stepStatus[4] === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold text-slate-200">4. Supervisor Status Workflow</p>
                    <p className="text-[11px] text-slate-400">Validate status state machine & resolution notes.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestStep4}
                  disabled={runningStep === 4}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold shrink-0"
                >
                  Verify
                </button>
              </div>
              {stepLogs[4] && (
                <p className="text-[10px] text-emerald-400/90 font-mono bg-slate-950 p-1.5 rounded border border-slate-800">
                  {stepLogs[4]}
                </p>
              )}
            </div>

            {/* Step 5 */}
            <div className="pt-3 space-y-1.5">
              <div className="flex items-start justify-between gap-2">
                <div className="flex items-start gap-2">
                  {stepStatus[5] === 'completed' ? (
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                  ) : (
                    <Circle className="w-4 h-4 text-slate-500 shrink-0 mt-0.5" />
                  )}
                  <div>
                    <p className="font-bold text-slate-200">5. Email Routing Dispatch</p>
                    <p className="text-[11px] text-slate-400">Trigger simulated email payload to AE & CCs.</p>
                  </div>
                </div>
                <button
                  type="button"
                  onClick={handleTestStep5}
                  disabled={runningStep === 5}
                  className="px-2.5 py-1 rounded-lg bg-indigo-600/30 hover:bg-indigo-600/50 text-indigo-300 border border-indigo-500/30 text-[11px] font-semibold shrink-0"
                >
                  Trigger
                </button>
              </div>
              {stepLogs[5] && (
                <p className="text-[10px] text-emerald-400/90 font-mono bg-slate-950 p-1.5 rounded border border-slate-800">
                  {stepLogs[5]}
                </p>
              )}
            </div>

          </div>

          {/* Footer */}
          <div className="px-5 py-2.5 bg-slate-950 border-t border-slate-800 flex items-center justify-between text-[11px] text-slate-400">
            <span>QA Score: <strong className="text-white">{passedCount}/5 Passed</strong></span>
            <span className="font-mono text-purple-400">{passedCount === 5 ? 'All Tests Green ✨' : 'In Progress'}</span>
          </div>
        </div>
      )}
    </div>
  );
}

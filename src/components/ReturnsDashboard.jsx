import React, { useState, useEffect, useMemo } from 'react';
import { 
  fetchRMATickets, 
  updateRMATicket, 
  isConfigured 
} from '../lib/supabase';
import { COMPANIES, RMA_STATUSES } from '../data/mockCatalog';
import StatusBadge from './StatusBadge';
import ResolutionModal from './ResolutionModal';
import { 
  Search, 
  Filter, 
  RefreshCw, 
  Eye, 
  Edit3, 
  Download, 
  ExternalLink, 
  CheckCircle2, 
  Clock, 
  FileText, 
  XCircle, 
  Layers, 
  Building2, 
  Calendar, 
  User, 
  Database,
  Info,
  ChevronDown
} from 'lucide-react';

export default function ReturnsDashboard({ onViewPortal }) {
  const [tickets, setTickets] = useState([]);
  const [loading, setLoading] = useState(true);
  const [dataSource, setDataSource] = useState('local');
  const [searchTerm, setSearchTerm] = useState('');
  const [selectedCompanyFilter, setSelectedCompanyFilter] = useState('ALL');
  const [selectedStatusFilter, setSelectedStatusFilter] = useState('ALL');

  // Modal states
  const [activeEditingTicket, setActiveEditingTicket] = useState(null);
  const [activePhotoModal, setActivePhotoModal] = useState(null);

  // Load tickets on mount
  const loadData = async () => {
    setLoading(true);
    try {
      const res = await fetchRMATickets();
      setTickets(res.data || []);
      setDataSource(res.source);
    } catch (err) {
      console.error('Failed to load tickets:', err);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadData();
  }, []);

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter(t => {
      // Company filter
      if (selectedCompanyFilter !== 'ALL' && t.company !== selectedCompanyFilter) {
        return false;
      }
      // Status filter
      if (selectedStatusFilter !== 'ALL' && t.status !== selectedStatusFilter) {
        return false;
      }
      // Search term
      if (searchTerm.trim()) {
        const query = searchTerm.toLowerCase();
        const matchRma = t.rma_id?.toLowerCase().includes(query);
        const matchCust = t.customer_name?.toLowerCase().includes(query);
        const matchItem = t.product_name?.toLowerCase().includes(query);
        const matchSku = t.sku?.toLowerCase().includes(query);
        const matchRef = t.delivery_reference?.toLowerCase().includes(query);
        return matchRma || matchCust || matchItem || matchSku || matchRef;
      }
      return true;
    });
  }, [tickets, selectedCompanyFilter, selectedStatusFilter, searchTerm]);

  // Compute KPI metrics
  const metrics = useMemo(() => {
    const total = tickets.length;
    const pending = tickets.filter(t => t.status === 'Pending Inspection').length;
    const approved = tickets.filter(t => t.status === 'Approved for Replacement').length;
    const creditMemo = tickets.filter(t => t.status === 'Credit Memo Issued').length;
    const rejected = tickets.filter(t => t.status === 'Rejected').length;
    return { total, pending, approved, creditMemo, rejected };
  }, [tickets]);

  // Handle Supervisor Update Save
  const handleSaveResolution = async (ticketId, updates) => {
    const res = await updateRMATicket(ticketId, updates);
    if (res.data) {
      setTickets(prev => prev.map(t => (t.id === ticketId || t.rma_id === ticketId) ? { ...t, ...updates } : t));
    }
  };

  // Export to CSV
  const handleExportCSV = () => {
    if (filteredTickets.length === 0) return;

    const headers = [
      'RMA ID', 'Filing Date', 'Company', 'Customer', 'Product', 'SKU', 
      'Packaging', 'Delivery Ref', 'Defect Category', 'Status', 'Resolution Notes'
    ];

    const rows = filteredTickets.map(t => [
      `"${t.rma_id || ''}"`,
      `"${new Date(t.created_at).toLocaleDateString()}"`,
      `"${t.company || ''}"`,
      `"${t.customer_name || ''}"`,
      `"${t.product_name || ''}"`,
      `"${t.sku || ''}"`,
      `"${t.packaging_unit || ''}"`,
      `"${t.delivery_reference || ''}"`,
      `"${t.defect_category || ''}"`,
      `"${t.status || ''}"`,
      `"${(t.resolution_notes || '').replace(/"/g, '""')}"`
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `RMA_Registry_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      
      {/* Top Banner & Header */}
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 mb-8">
        <div>
          <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-2">
            <Database className="w-3.5 h-3.5" />
            <span>Module 3 • Supervisor Operations</span>
          </div>
          <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
            Returns Management Dashboard
          </h1>
          <p className="text-slate-400 text-sm mt-1">
            Real-time inspection queue, defect authorization, and credit memo ledger.
          </p>
        </div>

        {/* Database connectivity badge & controls */}
        <div className="flex flex-wrap items-center gap-2.5">
          <div className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-slate-800 border border-slate-700 text-xs font-mono">
            <span className={`w-2 h-2 rounded-full ${dataSource === 'supabase' ? 'bg-emerald-400' : 'bg-amber-400'}`}></span>
            <span className="text-slate-300">
              {dataSource === 'supabase' ? 'Supabase Table: rma_tickets_vault' : 'Vault: Local / Seed Mode'}
            </span>
          </div>

          <button
            type="button"
            onClick={loadData}
            disabled={loading}
            className="p-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-300 transition-colors"
            title="Refresh returns registry"
          >
            <RefreshCw className={`w-4 h-4 ${loading ? 'animate-spin text-indigo-400' : ''}`} />
          </button>

          <button
            type="button"
            onClick={handleExportCSV}
            className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-slate-200 text-xs font-semibold transition-colors"
          >
            <Download className="w-3.5 h-3.5 text-indigo-400" />
            <span>Export CSV</span>
          </button>
        </div>
      </div>

      {/* KPI METRIC CARDS */}
      <div className="grid grid-cols-2 sm:grid-cols-5 gap-3.5 mb-8">
        {/* Total Returns */}
        <div className="bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/80 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-slate-400 block mb-1">
            Total Returns
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-white">{metrics.total}</span>
            <Layers className="w-4 h-4 text-slate-500" />
          </div>
        </div>

        {/* Pending Inspection */}
        <div className="bg-amber-950/20 backdrop-blur-md rounded-2xl border border-amber-500/30 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-amber-400 block mb-1">
            Pending Inspection
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-amber-300">{metrics.pending}</span>
            <Clock className="w-4 h-4 text-amber-400" />
          </div>
        </div>

        {/* Approved for Replacement */}
        <div className="bg-blue-950/20 backdrop-blur-md rounded-2xl border border-blue-500/30 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-blue-400 block mb-1">
            Replacement Approved
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-blue-300">{metrics.approved}</span>
            <CheckCircle2 className="w-4 h-4 text-blue-400" />
          </div>
        </div>

        {/* Credit Memo Issued */}
        <div className="bg-emerald-950/20 backdrop-blur-md rounded-2xl border border-emerald-500/30 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-emerald-400 block mb-1">
            Credit Memo Issued
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-emerald-300">{metrics.creditMemo}</span>
            <FileText className="w-4 h-4 text-emerald-400" />
          </div>
        </div>

        {/* Rejected */}
        <div className="col-span-2 sm:col-span-1 bg-rose-950/20 backdrop-blur-md rounded-2xl border border-rose-500/30 p-4">
          <span className="text-[11px] font-bold uppercase tracking-wider text-rose-400 block mb-1">
            Rejected
          </span>
          <div className="flex items-baseline justify-between">
            <span className="text-2xl font-black text-rose-300">{metrics.rejected}</span>
            <XCircle className="w-4 h-4 text-rose-400" />
          </div>
        </div>
      </div>

      {/* SEARCH & FILTERS BAR */}
      <div className="bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/80 p-4 mb-6 shadow-xl flex flex-col md:flex-row gap-3 items-center justify-between">
        
        {/* Search input */}
        <div className="relative w-full md:w-80">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search RMA ID, Customer, SKU, DR..."
            className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-xs sm:text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
          />
        </div>

        {/* Dropdown Filters */}
        <div className="flex flex-wrap items-center gap-2.5 w-full md:w-auto">
          {/* Company filter */}
          <div className="relative">
            <select
              value={selectedCompanyFilter}
              onChange={(e) => setSelectedCompanyFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Companies</option>
              {COMPANIES.map(c => (
                <option key={c.id} value={c.id}>{c.short}</option>
              ))}
            </select>
          </div>

          {/* Status filter */}
          <div className="relative">
            <select
              value={selectedStatusFilter}
              onChange={(e) => setSelectedStatusFilter(e.target.value)}
              className="bg-slate-900 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-200 focus:outline-none focus:border-indigo-500 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              {RMA_STATUSES.map(s => (
                <option key={s.id} value={s.id}>{s.label}</option>
              ))}
            </select>
          </div>

          {/* Clear filters */}
          {(searchTerm || selectedCompanyFilter !== 'ALL' || selectedStatusFilter !== 'ALL') && (
            <button
              type="button"
              onClick={() => {
                setSearchTerm('');
                setSelectedCompanyFilter('ALL');
                setSelectedStatusFilter('ALL');
              }}
              className="text-xs text-indigo-400 hover:text-indigo-300 underline font-medium px-2 py-1"
            >
              Reset Filters
            </button>
          )}
        </div>
      </div>

      {/* TABLE DISPLAY */}
      <div className="bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/80 shadow-2xl overflow-hidden">
        <div className="overflow-x-auto">
          <table className="w-full text-left border-collapse text-xs">
            <thead>
              <tr className="bg-slate-900/90 text-slate-400 border-b border-slate-700/80 font-bold uppercase tracking-wider text-[11px]">
                <th className="py-3.5 px-4">RMA ID</th>
                <th className="py-3.5 px-4">Filing Date</th>
                <th className="py-3.5 px-4">Customer</th>
                <th className="py-3.5 px-4">Item & Packaging</th>
                <th className="py-3.5 px-4">Defect Reason</th>
                <th className="py-3.5 px-4 text-center">Defect Photo</th>
                <th className="py-3.5 px-4">Status</th>
                <th className="py-3.5 px-4 text-right">Actions</th>
              </tr>
            </thead>

            <tbody className="divide-y divide-slate-800 text-slate-300">
              {loading ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <div className="flex flex-col items-center justify-center gap-2">
                      <div className="w-6 h-6 border-2 border-indigo-500 border-t-transparent rounded-full animate-spin"></div>
                      <span>Querying Supabase 'rma_tickets_vault'...</span>
                    </div>
                  </td>
                </tr>
              ) : filteredTickets.length === 0 ? (
                <tr>
                  <td colSpan={8} className="py-12 text-center text-slate-400">
                    <p className="text-sm font-semibold text-slate-300">No returns match the selected filter criteria.</p>
                    <p className="text-xs text-slate-500 mt-1">Try resetting the search filters or filing a return from the customer portal.</p>
                  </td>
                </tr>
              ) : (
                filteredTickets.map((ticket) => (
                  <tr 
                    key={ticket.id || ticket.rma_id}
                    className="hover:bg-slate-800/40 transition-colors"
                  >
                    {/* RMA ID */}
                    <td className="py-3.5 px-4 font-mono font-bold text-indigo-400 whitespace-nowrap">
                      <div>
                        <span>{ticket.rma_id}</span>
                        <span className="block text-[10px] text-slate-500 font-sans font-medium">
                          {ticket.company}
                        </span>
                      </div>
                    </td>

                    {/* Filing Date */}
                    <td className="py-3.5 px-4 whitespace-nowrap text-slate-400 font-mono text-[11px]">
                      {ticket.created_at ? new Date(ticket.created_at).toLocaleDateString('en-US', {
                        month: 'short',
                        day: 'numeric',
                        year: 'numeric'
                      }) : 'Recent'}
                    </td>

                    {/* Customer */}
                    <td className="py-3.5 px-4">
                      <p className="font-semibold text-white truncate max-w-[180px]">
                        {ticket.customer_name}
                      </p>
                      {ticket.delivery_reference && (
                        <span className="text-[10px] font-mono text-slate-500">
                          Ref: {ticket.delivery_reference}
                        </span>
                      )}
                    </td>

                    {/* Item & Packaging */}
                    <td className="py-3.5 px-4">
                      <p className="font-medium text-slate-200 truncate max-w-[200px]" title={ticket.product_name}>
                        {ticket.product_name}
                      </p>
                      <div className="flex items-center gap-2 mt-0.5">
                        <span className="font-mono text-[10px] text-slate-400">
                          SKU: {ticket.sku}
                        </span>
                        <span className="bg-slate-800 px-1.5 py-0.2 rounded font-mono text-[10px] text-slate-300">
                          {ticket.packaging_unit}
                        </span>
                      </div>
                    </td>

                    {/* Defect Description */}
                    <td className="py-3.5 px-4 max-w-[220px]">
                      <span className="font-semibold text-rose-300 block truncate">
                        {ticket.defect_category}
                      </span>
                      <p className="text-[11px] text-slate-400 truncate mt-0.5 italic" title={ticket.defect_description}>
                        "{ticket.defect_description}"
                      </p>
                    </td>

                    {/* Photo Link / Thumbnail */}
                    <td className="py-3.5 px-4 text-center whitespace-nowrap">
                      {ticket.photo_url ? (
                        <button
                          type="button"
                          onClick={() => setActivePhotoModal(ticket.photo_url)}
                          className="inline-flex items-center gap-1.5 px-2.5 py-1 rounded-lg bg-indigo-600/10 hover:bg-indigo-600/20 text-indigo-400 border border-indigo-500/30 text-xs font-semibold transition-colors"
                        >
                          <Eye className="w-3.5 h-3.5" />
                          <span>View Proof</span>
                        </button>
                      ) : (
                        <span className="text-slate-500 text-[11px] italic">No image</span>
                      )}
                    </td>

                    {/* Status */}
                    <td className="py-3.5 px-4 whitespace-nowrap">
                      <StatusBadge status={ticket.status} />
                      {ticket.resolution_notes && (
                        <p className="text-[10px] text-slate-400 max-w-[160px] truncate mt-1 italic" title={ticket.resolution_notes}>
                          Note: {ticket.resolution_notes}
                        </p>
                      )}
                    </td>

                    {/* Actions: Update Status & Resolution */}
                    <td className="py-3.5 px-4 text-right whitespace-nowrap">
                      <button
                        type="button"
                        onClick={() => setActiveEditingTicket(ticket)}
                        className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white font-semibold text-xs shadow-md shadow-indigo-600/20 transition-all hover:scale-[1.02] active:scale-[0.98]"
                      >
                        <Edit3 className="w-3.5 h-3.5" />
                        <span>Update</span>
                      </button>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>

        {/* Table footer with counts */}
        <div className="px-6 py-3 bg-slate-900/90 border-t border-slate-800 flex items-center justify-between text-xs text-slate-400">
          <span>Showing {filteredTickets.length} of {tickets.length} total return tickets</span>
          <span>Supabase table: <code className="text-indigo-400">public.rma_tickets_vault</code></span>
        </div>
      </div>

      {/* RESOLUTION MODAL */}
      <ResolutionModal
        ticket={activeEditingTicket}
        isOpen={Boolean(activeEditingTicket)}
        onClose={() => setActiveEditingTicket(null)}
        onSave={handleSaveResolution}
      />

      {/* PHOTO PREVIEW MODAL */}
      {activePhotoModal && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setActivePhotoModal(null)}
        >
          <div className="relative max-w-4xl max-h-[90vh] w-full flex flex-col items-center">
            <img
              src={activePhotoModal}
              alt="Defect Evidence Full"
              className="max-h-[85vh] max-w-full rounded-2xl object-contain shadow-2xl border-2 border-slate-800"
            />
            <button
              type="button"
              onClick={() => setActivePhotoModal(null)}
              className="mt-3 px-5 py-2 bg-slate-800 hover:bg-slate-700 text-white rounded-xl text-xs font-semibold shadow-md"
            >
              Close Defect Proof
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

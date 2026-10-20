import React, { useState, useMemo } from 'react';
import { 
  Search, 
  Filter, 
  Download, 
  QrCode, 
  Eye, 
  Building2, 
  Package, 
  Clock, 
  CheckCircle2, 
  AlertCircle, 
  ExternalLink,
  MapPin,
  ChevronDown
} from 'lucide-react';
import { formatPeso, getEmailRoutingPayload } from '../utils/rmaHelpers';

export default function TicketsVaultTab({ 
  tickets = [], 
  onUpdateTicketStatus, 
  onOpenTicketModal, 
  isTestMode = false 
}) {
  const [searchTerm, setSearchTerm] = useState('');
  const [statusFilter, setStatusFilter] = useState('ALL');
  const [selectedGroup, setSelectedGroup] = useState('ALL');
  const [expandedTicketId, setExpandedTicketId] = useState(null);

  // Status badge styling helper
  const getStatusBadge = (status) => {
    switch (status) {
      case 'Credit Memo Issued':
        return 'bg-emerald-500/15 text-emerald-300 border-emerald-500/30';
      case 'Buffer Replacement':
        return 'bg-purple-500/15 text-purple-300 border-purple-500/30';
      case 'Approved':
        return 'bg-blue-500/15 text-blue-300 border-blue-500/30';
      case 'In Transit':
        return 'bg-amber-500/15 text-amber-300 border-amber-500/30';
      case 'Rejected':
        return 'bg-rose-500/15 text-rose-300 border-rose-500/30';
      default:
        return 'bg-slate-700/60 text-slate-300 border-slate-600';
    }
  };

  // Filtered tickets
  const filteredTickets = useMemo(() => {
    return tickets.filter(ticket => {
      const matchesSearch = 
        ticket.id?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ticket.customer_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ticket.product_name?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ticket.sku?.toLowerCase().includes(searchTerm.toLowerCase()) ||
        ticket.ae_name?.toLowerCase().includes(searchTerm.toLowerCase());

      const matchesStatus = statusFilter === 'ALL' || ticket.status === statusFilter;
      const matchesGroup = selectedGroup === 'ALL' || ticket.group?.includes(selectedGroup);

      return matchesSearch && matchesStatus && matchesGroup;
    });
  }, [tickets, searchTerm, statusFilter, selectedGroup]);

  // Export to CSV
  const handleExportCSV = () => {
    const headers = [
      'Ticket ID',
      'Date',
      'Customer',
      'Branch',
      'Product',
      'SKU',
      'Qty',
      'Unit Price',
      'Total Value (PHP)',
      'Status',
      'Defect Category',
      'AE Name',
      'Credit Memo #',
      'Supplier'
    ];

    const rows = filteredTickets.map(t => [
      t.id,
      new Date(t.created_at).toLocaleDateString(),
      `"${(t.customer_name || '').replace(/"/g, '""')}"`,
      `"${(t.store_branch || '').replace(/"/g, '""')}"`,
      `"${(t.product_name || '').replace(/"/g, '""')}"`,
      t.sku,
      t.quantity,
      t.unit_price,
      t.total_amount,
      t.status,
      `"${(t.defect_category || '').replace(/"/g, '""')}"`,
      t.ae_name,
      t.credit_memo_no || '',
      t.supplier
    ]);

    const csvContent = 'data:text/csv;charset=utf-8,' + [headers.join(','), ...rows.map(e => e.join(','))].join('\n');
    const encodedUri = encodeURI(csvContent);
    const link = document.createElement('a');
    link.setAttribute('href', encodedUri);
    link.setAttribute('download', `RMA_Vault_Export_${new Date().toISOString().slice(0, 10)}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  return (
    <div className="space-y-6">
      
      {/* Header & Stats Banner */}
      <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 bg-slate-900 border border-slate-800 rounded-2xl p-5 shadow-xl">
        <div>
          <h1 className="text-xl sm:text-2xl font-bold text-white tracking-tight flex items-center gap-2">
            <span>RMA Tickets Vault</span>
            <span className="text-xs px-2.5 py-0.5 rounded-full bg-slate-800 border border-slate-700 text-brand-300 font-mono">
              {filteredTickets.length} of {tickets.length} Records
            </span>
          </h1>
          <p className="text-xs text-slate-400 mt-1">
            Complete archive of wholesale returns, return authorization QR codes, and resolution audit trail.
          </p>
        </div>

        <button
          onClick={handleExportCSV}
          className="px-4 py-2 bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold rounded-xl border border-slate-700 flex items-center space-x-2 transition-colors shadow-sm"
        >
          <Download className="w-4 h-4 text-brand-400" />
          <span>Export Vault to CSV</span>
        </button>
      </div>

      {/* Filter and Search Bar */}
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 bg-slate-900/80 border border-slate-800 rounded-2xl p-4 shadow-lg">
        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-3" />
          <input
            type="text"
            value={searchTerm}
            onChange={(e) => setSearchTerm(e.target.value)}
            placeholder="Search Ticket ID, SKU, Customer..."
            className="w-full bg-slate-950 border border-slate-700 rounded-xl pl-9 pr-3.5 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
          />
        </div>

        {/* Status Filter */}
        <div className="flex items-center space-x-2">
          <Filter className="w-4 h-4 text-slate-400 shrink-0" />
          <select
            value={statusFilter}
            onChange={(e) => setStatusFilter(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
          >
            <option value="ALL">All Statuses</option>
            <option value="Pending Inspection">Pending Inspection</option>
            <option value="Approved">Approved</option>
            <option value="In Transit">In Transit</option>
            <option value="Buffer Replacement">Buffer Replacement</option>
            <option value="Credit Memo Issued">Credit Memo Issued</option>
            <option value="Rejected">Rejected</option>
          </select>
        </div>

        {/* Business Group Filter */}
        <div>
          <select
            value={selectedGroup}
            onChange={(e) => setSelectedGroup(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
          >
            <option value="ALL">All Business Groups</option>
            <option value="Group 2">Group 2 (PINGCON & BONITA)</option>
            <option value="Group 1">Group 1 (KEYSYS & A2Z2GO)</option>
          </select>
        </div>
      </div>

      {/* Tickets List */}
      <div className="space-y-3">
        {filteredTickets.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-2xl p-12 text-center text-slate-400">
            <Package className="w-10 h-10 text-slate-600 mx-auto mb-3" />
            <h3 className="font-semibold text-slate-300 text-sm">No RMA tickets found</h3>
            <p className="text-xs text-slate-500 mt-1">Try modifying your search or filter criteria.</p>
          </div>
        ) : (
          filteredTickets.map((ticket) => {
            const isExpanded = expandedTicketId === ticket.id;
            const routing = getEmailRoutingPayload(ticket, isTestMode);

            return (
              <div 
                key={ticket.id}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-2xl p-4 sm:p-5 shadow-md transition-all space-y-4"
              >
                {/* Primary Row */}
                <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-mono text-base font-bold text-white tracking-wide">
                        {ticket.id}
                      </span>
                      <span className={`px-2.5 py-0.5 rounded-full text-[10px] font-bold uppercase border ${getStatusBadge(ticket.status)}`}>
                        {ticket.status}
                      </span>
                      <span className="text-xs text-slate-500 font-mono">
                        {new Date(ticket.created_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric' })}
                      </span>
                    </div>

                    <div className="flex flex-wrap items-center gap-2 text-xs text-slate-300">
                      <span className="font-semibold text-slate-100">{ticket.customer_name}</span>
                      <span className="text-slate-500">•</span>
                      <span className="text-slate-400">{ticket.store_branch}</span>
                    </div>
                  </div>

                  {/* Actions & QR Code Launch */}
                  <div className="flex items-center space-x-2 self-end sm:self-auto">
                    <button
                      onClick={() => onOpenTicketModal(ticket)}
                      className="px-3 py-1.5 bg-brand-600/15 hover:bg-brand-600/25 border border-brand-500/40 text-brand-300 text-xs font-semibold rounded-xl flex items-center space-x-1.5 transition-colors"
                      title="View Printable Return QR Code"
                    >
                      <QrCode className="w-3.5 h-3.5 text-brand-400" />
                      <span>Return QR</span>
                    </button>

                    {/* Inline Status Changer */}
                    <select
                      value={ticket.status}
                      onChange={(e) => onUpdateTicketStatus(ticket.id, e.target.value)}
                      className="bg-slate-950 border border-slate-700 rounded-xl px-2.5 py-1.5 text-xs text-slate-200 focus:outline-none focus:border-brand-500 font-medium"
                    >
                      <option value="Pending Inspection">Pending Inspection</option>
                      <option value="Approved">Approved</option>
                      <option value="In Transit">In Transit</option>
                      <option value="Buffer Replacement">Buffer Replacement</option>
                      <option value="Credit Memo Issued">Credit Memo Issued</option>
                      <option value="Rejected">Rejected</option>
                    </select>

                    {/* Expand Toggle */}
                    <button
                      onClick={() => setExpandedTicketId(isExpanded ? null : ticket.id)}
                      className="p-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
                      title="Expand details"
                    >
                      <ChevronDown className={`w-4 h-4 transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                    </button>
                  </div>
                </div>

                {/* Second Line: Product Summary Chips */}
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-2 text-xs pt-1 border-t border-slate-800/60">
                  <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Product & SKU</span>
                    <span className="font-medium text-slate-200 truncate block" title={ticket.product_name}>
                      {ticket.product_name}
                    </span>
                    <span className="text-[10px] text-slate-400 font-mono">{ticket.sku}</span>
                  </div>

                  <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Return Quantity</span>
                    <span className="font-bold text-white font-mono text-sm">{ticket.quantity} Units</span>
                    <span className="text-[10px] text-slate-400 block font-mono">@{formatPeso(ticket.unit_price)}</span>
                  </div>

                  <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Total RMA Value</span>
                    <span className="font-bold text-emerald-400 font-mono text-sm">{formatPeso(ticket.total_amount)}</span>
                    <span className="text-[10px] text-slate-400 block">{ticket.supplier}</span>
                  </div>

                  <div className="bg-slate-950/50 p-2 rounded-lg border border-slate-800">
                    <span className="text-slate-500 text-[10px] block">Responsible AE</span>
                    <span className="font-medium text-slate-200 truncate block">{ticket.ae_name}</span>
                    <span className="text-[10px] text-slate-400 truncate block">{ticket.credit_memo_no ? `CM: ${ticket.credit_memo_no}` : 'CM Pending'}</span>
                  </div>
                </div>

                {/* Expanded Details Drawer */}
                {isExpanded && (
                  <div className="pt-3 border-t border-slate-800 space-y-3 text-xs bg-slate-950/60 p-4 rounded-xl">
                    {/* Defect Statement */}
                    <div>
                      <span className="font-semibold text-amber-400 block mb-1">
                        Reason: {ticket.defect_category}
                      </span>
                      <p className="text-slate-300 font-mono text-[11px] leading-relaxed bg-slate-900/90 p-3 rounded-lg border border-slate-800">
                        {ticket.technical_diagnosis}
                      </p>
                    </div>

                    {/* Metadata & GPS */}
                    <div className="flex flex-wrap items-center gap-4 text-slate-400 text-[11px]">
                      {ticket.gps_coordinates && (
                        <div className="flex items-center space-x-1.5">
                          <MapPin className="w-3.5 h-3.5 text-rose-400" />
                          <span>GPS: {ticket.gps_coordinates}</span>
                        </div>
                      )}
                      <div>
                        <span>Invoice: </span>
                        <span className="font-mono text-slate-200">{ticket.invoice_no || 'N/A'}</span>
                      </div>
                      <div>
                        <span>Group Channel: </span>
                        <span className="text-slate-200">{ticket.group}</span>
                      </div>
                    </div>

                    {/* Photos Preview */}
                    {ticket.photos && ticket.photos.length > 0 && (
                      <div>
                        <span className="text-slate-400 text-[11px] font-medium block mb-1.5">Defect Documentation Photos:</span>
                        <div className="flex items-center space-x-2">
                          {ticket.photos.map((p, idx) => (
                            <a key={idx} href={p} target="_blank" rel="noopener noreferrer" className="relative w-16 h-16 rounded-lg overflow-hidden border border-slate-700 group shrink-0">
                              <img src={p} alt="Defect" className="w-full h-full object-cover group-hover:scale-110 transition-transform" />
                              <div className="absolute inset-0 bg-black/40 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                                <ExternalLink className="w-3.5 h-3.5 text-white" />
                              </div>
                            </a>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>
                )}

              </div>
            );
          })
        )}
      </div>

    </div>
  );
}

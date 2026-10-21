import React, { useState } from 'react';
import { 
  X, 
  CheckCircle, 
  Clock, 
  Barcode, 
  FileText, 
  Package, 
  MapPin, 
  Image as ImageIcon, 
  ExternalLink, 
  User, 
  Phone, 
  Mail, 
  List, 
  LayoutGrid 
} from 'lucide-react';

export default function RMAReportsModal({ isOpen, onClose, reports = [] }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);
  const [viewMode, setViewMode] = useState(() => {
    return localStorage.getItem('rma_reports_modal_view_mode') || 'table';
  });

  if (!isOpen) return null;

  const handleSetViewMode = (mode) => {
    setViewMode(mode);
    try {
      localStorage.setItem('rma_reports_modal_view_mode', mode);
    } catch (e) {}
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-3 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-5xl w-full p-5 sm:p-6 space-y-4 max-h-[92vh] overflow-y-auto">
        
        {/* Header & Controls */}
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2.5 bg-blue-100 text-blue-700 rounded-2xl shadow-inner">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2">
                <h2 className="text-base sm:text-lg font-black text-slate-900">
                  Logged RMA Return Reports
                </h2>
                <span className="px-2.5 py-0.5 rounded-full text-xs font-black bg-blue-100 text-blue-800">
                  {reports.length} Reports
                </span>
              </div>
              <p className="text-xs text-slate-500">
                Incoming return reports with proof photos, reporter contact info, and GPS coordinates.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-end sm:self-auto">
            {/* View Type Switcher */}
            <div className="flex items-center bg-slate-100 p-1 rounded-2xl border border-slate-200/80">
              <button
                type="button"
                onClick={() => handleSetViewMode('table')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  viewMode === 'table'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Rows / Table View (with SN column)"
              >
                <List className="w-3.5 h-3.5" />
                <span>Rows List</span>
              </button>
              <button
                type="button"
                onClick={() => handleSetViewMode('grid')}
                className={`px-3 py-1.5 rounded-xl text-xs font-black flex items-center gap-1.5 transition-all ${
                  viewMode === 'grid'
                    ? 'bg-white text-blue-700 shadow-sm'
                    : 'text-slate-500 hover:text-slate-800'
                }`}
                title="Grid / Cards View"
              >
                <LayoutGrid className="w-3.5 h-3.5" />
                <span>Cards View</span>
              </button>
            </div>

            <button
              onClick={onClose}
              className="p-2 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Content */}
        {reports.length === 0 ? (
          <div className="text-center py-12 space-y-2">
            <Package className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No RMA Reports Yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Scan any item barcode in Reporter Mode and submit to record your first return with proof photos and contact details.
            </p>
          </div>
        ) : viewMode === 'table' ? (
          /* ============================================================ */
          /* TABLE VIEW: WITH SN (ID) AS FAR-LEFT COLUMN                  */
          /* ============================================================ */
          <div className="bg-white border border-slate-200 rounded-2xl overflow-hidden shadow-xs">
            <div className="overflow-x-auto">
              <table className="w-full text-left border-collapse text-xs">
                <thead>
                  <tr className="bg-slate-50/90 border-b border-slate-200 text-[11px] font-black uppercase tracking-wider text-slate-500">
                    <th className="py-3 px-3.5 font-black text-slate-900 w-16">SN</th>
                    <th className="py-3 px-3.5 font-bold">RMA #</th>
                    <th className="py-3 px-3 w-14 text-center">Photo</th>
                    <th className="py-3 px-3.5 font-bold">Barcode</th>
                    <th className="py-3 px-3.5 font-bold">Item Name</th>
                    <th className="py-3 px-3.5 font-bold">Reason</th>
                    <th className="py-3 px-3.5 font-bold">Reported By</th>
                    <th className="py-3 px-3 text-center font-bold">Status</th>
                    <th className="py-3 px-3.5 text-right font-bold">Date & GPS</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 font-medium">
                  {reports.map((item) => {
                    const photoList = Array.isArray(item.photos) 
                      ? item.photos 
                      : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);

                    const reporterName = item.reporter_name || (item.reported_by && !item.reported_by.includes('(') ? item.reported_by : '') || 'Reporter';
                    const reporterContact = item.reporter_contact || (item.reported_by && item.reported_by.includes('(') ? item.reported_by.replace(/.*\((.*)\).*/, '$1') : '');

                    return (
                      <tr key={item.id || item.rma_number} className="hover:bg-blue-50/30 transition-colors">
                        {/* 1. SN COLUMN AT FAR LEFT */}
                        <td className="py-3 px-3.5 font-mono">
                          <span className="font-black text-blue-900 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded-lg text-xs">
                            #{item.id}
                          </span>
                        </td>

                        {/* 2. RMA Number */}
                        <td className="py-3 px-3.5 font-mono font-bold text-blue-700">
                          {item.rma_number}
                        </td>

                        {/* 3. Photo */}
                        <td className="py-2.5 px-3 text-center">
                          {photoList.length > 0 ? (
                            <button
                              type="button"
                              onClick={() => setSelectedPhoto(photoList[0])}
                              className="w-10 h-10 rounded-xl overflow-hidden border border-slate-200 bg-slate-50 inline-block hover:opacity-85 transition-opacity"
                              title="Click to view proof photo"
                            >
                              <img src={photoList[0]} alt="Proof" className="w-full h-full object-cover" />
                            </button>
                          ) : (
                            <div className="w-10 h-10 rounded-xl bg-slate-100 text-slate-400 flex items-center justify-center mx-auto border border-slate-200">
                              <ImageIcon className="w-4 h-4" />
                            </div>
                          )}
                        </td>

                        {/* 4. Barcode & SKU */}
                        <td className="py-3 px-3.5 font-mono">
                          <div className="font-bold text-slate-800">{item.barcode}</div>
                          {item.code && <div className="text-[10px] text-slate-400">{item.code}</div>}
                        </td>

                        {/* 5. Item Name */}
                        <td className="py-3 px-3.5 font-bold text-slate-900 max-w-[200px] truncate" title={item.name}>
                          {item.name}
                        </td>

                        {/* 6. Reason */}
                        <td className="py-3 px-3.5">
                          <span className="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold text-[10px] inline-block">
                            {item.reason || 'Damaged'}
                          </span>
                        </td>

                        {/* 7. Reported By */}
                        <td className="py-3 px-3.5">
                          <div className="font-bold text-slate-900 text-[11px]">{reporterName}</div>
                          {reporterContact && (
                            <div className="font-mono text-slate-500 text-[10px]">{reporterContact}</div>
                          )}
                        </td>

                        {/* 8. Status */}
                        <td className="py-3 px-3 text-center">
                          <span className={`px-2 py-0.5 rounded-full text-[9px] font-bold uppercase tracking-wider ${
                            item.status === 'pending_admin_details'
                              ? 'bg-amber-100 text-amber-800 border border-amber-200'
                              : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                          }`}>
                            {item.status === 'pending_admin_details' ? 'Unknown' : 'Logged'}
                          </span>
                        </td>

                        {/* 9. Date & GPS */}
                        <td className="py-3 px-3.5 text-right font-mono text-[11px] text-slate-500">
                          <div>{new Date(item.created_at).toLocaleDateString()}</div>
                          {item.gps_latitude && item.gps_longitude ? (
                            <a
                              href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                              target="_blank"
                              rel="noreferrer"
                              className="text-blue-600 hover:underline inline-flex items-center gap-0.5 text-[10px] font-bold"
                            >
                              <MapPin className="w-3 h-3 text-rose-500" />
                              <span>Map</span>
                            </a>
                          ) : (
                            <span className="text-slate-300 text-[10px]">No GPS</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="p-3 bg-slate-50 border-t border-slate-200 text-[11px] text-slate-500 font-semibold px-4 flex justify-between">
              <span>Showing {reports.length} reports</span>
              <span>Sorted by latest</span>
            </div>
          </div>
        ) : (
          /* ============================================================ */
          /* CARDS VIEW: WITH SN DISPLAYED ON TOP-LEFT OF EACH CARD        */
          /* ============================================================ */
          <div className="space-y-3">
            {reports.map((item) => {
              const photoList = Array.isArray(item.photos) 
                ? item.photos 
                : (typeof item.photos === 'string' ? JSON.parse(item.photos || '[]') : []);

              const reporterDisplayName = item.reporter_name || (item.reported_by && !item.reported_by.includes('(') ? item.reported_by : '') || 'Customer / Reporter';
              const reporterContactInfo = item.reporter_contact || (item.reported_by && item.reported_by.includes('(') ? item.reported_by.replace(/.*\((.*)\).*/, '$1') : '');

              return (
                <div
                  key={item.id || item.rma_number}
                  className="p-4 bg-slate-50 border border-slate-200 rounded-2xl space-y-3 text-xs shadow-sm hover:shadow transition-shadow"
                >
                  {/* Top Bar: SN + RMA Number & Timestamp */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                    <div className="flex items-center gap-2">
                      <span className="font-mono font-black text-xs text-blue-900 bg-blue-50 border border-blue-200/80 px-2 py-0.5 rounded-lg">
                        SN #{item.id}
                      </span>
                      <span className="font-mono font-black text-blue-700 text-sm">
                        {item.rma_number}
                      </span>
                      <span className={`px-2 py-0.5 rounded-full text-[10px] font-bold uppercase tracking-wider ${
                        item.status === 'pending_admin_details'
                          ? 'bg-amber-100 text-amber-800 border border-amber-200'
                          : 'bg-emerald-100 text-emerald-800 border border-emerald-200'
                      }`}>
                        {item.status === 'pending_admin_details' ? 'Unknown Barcode' : 'Recorded Return'}
                      </span>
                    </div>

                    <div className="flex items-center gap-3 text-slate-500 font-mono text-[11px]">
                      <span className="font-bold text-slate-800 text-sm">
                        Qty: {item.quantity} {item.unit_name || 'pc'}
                      </span>
                      <span>{new Date(item.created_at).toLocaleString()}</span>
                    </div>
                  </div>

                  {/* PROMINENT REPORTER INFO CARD */}
                  <div className="bg-white p-2.5 rounded-xl border border-slate-200 flex flex-wrap items-center justify-between gap-2 text-xs">
                    <div className="flex items-center gap-2">
                      <div className="p-1.5 bg-blue-50 text-blue-600 rounded-lg">
                        <User className="w-4 h-4" />
                      </div>
                      <div>
                        <span className="text-[10px] uppercase font-bold text-slate-400 block leading-tight">
                          Reported By
                        </span>
                        <span className="font-bold text-slate-900 text-sm">
                          {reporterDisplayName}
                        </span>
                      </div>
                    </div>

                    {reporterContactInfo && (
                      <div className="flex items-center gap-1.5 font-mono text-slate-700 bg-slate-50 px-2.5 py-1 rounded-lg border border-slate-200">
                        <Phone className="w-3.5 h-3.5 text-emerald-600" />
                        <span className="font-semibold">{reporterContactInfo}</span>
                      </div>
                    )}
                  </div>

                  {/* Item and Reason Info */}
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                    <div>
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">Item / Barcode</span>
                      <span className="font-bold text-slate-900 block text-sm">{item.name}</span>
                      <span className="font-mono text-slate-500 text-[11px]">Barcode: {item.barcode}</span>
                      {item.code && <span className="font-mono text-blue-600 text-[11px] block">SKU: {item.code}</span>}
                    </div>

                    <div className="space-y-1">
                      <div>
                        <span className="text-[10px] font-bold uppercase text-slate-400 block">Return Reason</span>
                        <span className="px-2 py-0.5 rounded-lg bg-rose-50 text-rose-700 border border-rose-200 font-bold inline-block text-[11px]">
                          {item.reason || 'Damaged Box / Crushed Packaging'}
                        </span>
                      </div>
                      {item.explanation && (
                        <p className="text-slate-600 italic bg-white p-2 rounded-xl border border-slate-200 text-[11px]">
                          "{item.explanation}"
                        </p>
                      )}
                    </div>
                  </div>

                  {/* GPS & Location */}
                  <div className="flex flex-wrap items-center justify-between gap-2 pt-2 border-t border-slate-200/60 text-[11px]">
                    <div className="flex items-center gap-1.5 text-slate-600">
                      <MapPin className="w-3.5 h-3.5 text-rose-500 shrink-0" />
                      {item.gps_latitude && item.gps_longitude ? (
                        <a
                          href={`https://www.google.com/maps?q=${item.gps_latitude},${item.gps_longitude}`}
                          target="_blank"
                          rel="noreferrer"
                          className="text-blue-600 hover:underline flex items-center gap-1 font-mono font-bold"
                        >
                          <span>GPS: {Number(item.gps_latitude).toFixed(4)}, {Number(item.gps_longitude).toFixed(4)}</span>
                          <ExternalLink className="w-3 h-3" />
                        </a>
                      ) : (
                        <span className="text-slate-400">GPS: Not available (Location blank)</span>
                      )}
                    </div>

                    {/* Proof Photos */}
                    {photoList.length > 0 && (
                      <div className="flex items-center gap-1.5">
                        <span className="text-slate-400 font-semibold">Proof Photos:</span>
                        <div className="flex items-center gap-1.5">
                          {photoList.map((url, idx) => (
                            <button
                              key={idx}
                              type="button"
                              onClick={() => setSelectedPhoto(url)}
                              className="w-9 h-9 rounded-xl overflow-hidden border border-slate-300 hover:scale-105 shadow-sm transition-transform"
                            >
                              <img src={url} alt="Proof" className="w-full h-full object-cover" />
                            </button>
                          ))}
                        </div>
                      </div>
                    )}
                  </div>

                </div>
              );
            })}
          </div>
        )}

      </div>

      {/* Fullscreen Photo Zoom Modal */}
      {selectedPhoto && (
        <div 
          onClick={() => setSelectedPhoto(null)}
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-md animate-in fade-in"
        >
          <div className="relative max-w-2xl max-h-[85vh]">
            <img src={selectedPhoto} alt="Full Proof" className="max-w-full max-h-[80vh] rounded-2xl shadow-2xl object-contain" />
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute -top-3 -right-3 p-2 bg-white text-slate-900 rounded-full shadow-lg hover:bg-slate-100"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}

    </div>
  );
}

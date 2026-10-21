import React, { useState } from 'react';
import { X, CheckCircle, Clock, Barcode, FileText, Package, MapPin, Image as ImageIcon, ExternalLink, User, Phone, Mail } from 'lucide-react';

export default function RMAReportsModal({ isOpen, onClose, reports = [] }) {
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-3xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-blue-100 text-blue-700 rounded-xl">
              <FileText className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Logged RMA Return Reports ({reports.length})
              </h2>
              <p className="text-xs text-slate-500">
                Incoming return reports with proof photos, reporter contact info, and GPS coordinates.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 rounded-xl hover:bg-slate-100 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* List of Reports */}
        {reports.length === 0 ? (
          <div className="text-center py-10 space-y-2">
            <Package className="w-10 h-10 text-slate-300 mx-auto" />
            <h3 className="text-sm font-bold text-slate-700">No RMA Reports Yet</h3>
            <p className="text-xs text-slate-400 max-w-sm mx-auto">
              Scan any item barcode in Reporter Mode and submit to record your first return with proof photos and contact details.
            </p>
          </div>
        ) : (
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
                  {/* Top Bar: RMA Number & Timestamp */}
                  <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 border-b border-slate-200/60 pb-2">
                    <div className="flex items-center gap-2">
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

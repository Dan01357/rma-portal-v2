import React, { useState, useEffect } from 'react';
import { 
  X, 
  MapPin, 
  Plus, 
  Trash2, 
  Edit2, 
  Check, 
  RotateCcw, 
  AlertCircle 
} from 'lucide-react';
import { 
  DEFAULT_WAREHOUSE_LOCATIONS, 
  getWarehouseLocations, 
  saveWarehouseLocations 
} from '../utils/rmaHelpers';

export default function WarehouseLocationsModal({ isOpen, onClose }) {
  const [locations, setLocations] = useState([]);
  const [newLocInput, setNewLocInput] = useState('');
  const [editingIndex, setEditingIndex] = useState(null);
  const [editingValue, setEditingValue] = useState('');
  const [feedback, setFeedback] = useState(null);

  useEffect(() => {
    if (isOpen) {
      setLocations(getWarehouseLocations());
      setNewLocInput('');
      setEditingIndex(null);
      setFeedback(null);
    }
  }, [isOpen]);

  if (!isOpen) return null;

  const handleAddLocation = (e) => {
    e?.preventDefault();
    const clean = newLocInput.trim();
    if (!clean) return;
    if (locations.some(l => l.toLowerCase() === clean.toLowerCase())) {
      setFeedback({ type: 'error', text: 'This warehouse location name already exists.' });
      return;
    }
    const updated = [...locations, clean];
    setLocations(updated);
    saveWarehouseLocations(updated);
    setNewLocInput('');
    setFeedback({ type: 'success', text: `Added "${clean}" to warehouse locations.` });
  };

  const handleStartEdit = (idx) => {
    setEditingIndex(idx);
    setEditingValue(locations[idx]);
    setFeedback(null);
  };

  const handleSaveEdit = (idx) => {
    const clean = editingValue.trim();
    if (!clean) return;
    const updated = [...locations];
    updated[idx] = clean;
    setLocations(updated);
    saveWarehouseLocations(updated);
    setEditingIndex(null);
    setFeedback({ type: 'success', text: `Renamed location to "${clean}".` });
  };

  const handleDeleteLocation = (idx) => {
    const locToDelete = locations[idx];
    if (locations.length <= 1) {
      setFeedback({ type: 'error', text: 'At least one warehouse location must remain.' });
      return;
    }
    const updated = locations.filter((_, i) => i !== idx);
    setLocations(updated);
    saveWarehouseLocations(updated);
    setFeedback({ type: 'success', text: `Deleted location "${locToDelete}".` });
  };

  const handleResetDefaults = () => {
    setLocations([...DEFAULT_WAREHOUSE_LOCATIONS]);
    saveWarehouseLocations([...DEFAULT_WAREHOUSE_LOCATIONS]);
    setFeedback({ type: 'success', text: 'Reset locations to default 6 warehouse areas.' });
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/70 backdrop-blur-sm animate-in fade-in duration-200">
      <div 
        className="w-full max-w-md bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[85vh]"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="p-5 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-indigo-50 dark:bg-indigo-950/70 text-indigo-600 dark:text-indigo-400 rounded-xl">
              <MapPin className="w-5 h-5" />
            </div>
            <div>
              <h3 className="text-sm font-black text-slate-900 dark:text-white">
                Warehouse Locations & Areas
              </h3>
              <p className="text-[11px] text-slate-400">
                Manage standardized rack, bin, and area locations.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Feedback Alert */}
        {feedback && (
          <div className={`mx-5 mt-3 p-2.5 rounded-xl text-xs font-bold flex items-center gap-2 ${
            feedback.type === 'error'
              ? 'bg-rose-50 text-rose-800 dark:bg-rose-950/60 dark:text-rose-300'
              : 'bg-emerald-50 text-emerald-800 dark:bg-emerald-950/60 dark:text-emerald-300'
          }`}>
            <AlertCircle className="w-4 h-4 shrink-0" />
            <span>{feedback.text}</span>
          </div>
        )}

        {/* Add Location Input */}
        <form onSubmit={handleAddLocation} className="p-5 pb-3">
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={newLocInput}
              onChange={(e) => setNewLocInput(e.target.value)}
              placeholder="e.g. Bin Rack C-04..."
              className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-bold text-slate-900 dark:text-white placeholder:text-slate-400 focus:outline-none focus:border-indigo-500"
            />
            <button
              type="submit"
              disabled={!newLocInput.trim()}
              className="px-3.5 py-2 bg-indigo-600 hover:bg-indigo-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1 cursor-pointer shadow-xs transition-colors"
            >
              <Plus className="w-4 h-4" />
              <span>Add</span>
            </button>
          </div>
        </form>

        {/* Locations List */}
        <div className="p-5 pt-0 overflow-y-auto space-y-1.5 flex-1 divide-y divide-slate-100 dark:divide-slate-800/60">
          {locations.map((loc, idx) => (
            <div key={idx} className="pt-1.5 first:pt-0 flex items-center justify-between gap-2">
              {editingIndex === idx ? (
                <div className="flex-1 flex items-center gap-1.5">
                  <input
                    type="text"
                    value={editingValue}
                    onChange={(e) => setEditingValue(e.target.value)}
                    className="flex-1 px-2.5 py-1 bg-white dark:bg-slate-950 border border-indigo-500 rounded-lg text-xs font-bold font-mono"
                    autoFocus
                  />
                  <button
                    type="button"
                    onClick={() => handleSaveEdit(idx)}
                    className="p-1.5 bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 cursor-pointer"
                  >
                    <Check className="w-3.5 h-3.5" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setEditingIndex(null)}
                    className="p-1.5 bg-slate-200 dark:bg-slate-800 text-slate-600 dark:text-slate-300 rounded-lg hover:bg-slate-300 cursor-pointer"
                  >
                    <X className="w-3.5 h-3.5" />
                  </button>
                </div>
              ) : (
                <>
                  <div className="font-mono text-xs font-bold text-slate-800 dark:text-slate-200 truncate flex items-center gap-2">
                    <span className="w-2 h-2 rounded-full bg-indigo-500 shrink-0" />
                    <span>{loc}</span>
                  </div>
                  <div className="flex items-center gap-1 shrink-0">
                    <button
                      type="button"
                      onClick={() => handleStartEdit(idx)}
                      className="p-1.5 text-slate-400 hover:text-indigo-600 hover:bg-indigo-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                      title="Rename location"
                    >
                      <Edit2 className="w-3 h-3" />
                    </button>
                    <button
                      type="button"
                      onClick={() => handleDeleteLocation(idx)}
                      className="p-1.5 text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-slate-800 rounded-lg cursor-pointer"
                      title="Delete location"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  </div>
                </>
              )}
            </div>
          ))}
        </div>

        {/* Footer */}
        <div className="p-4 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between bg-slate-50 dark:bg-slate-900/50">
          <button
            type="button"
            onClick={handleResetDefaults}
            className="text-[11px] font-bold text-slate-500 hover:text-slate-800 dark:hover:text-slate-200 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            <span>Reset to Defaults</span>
          </button>
          <button
            type="button"
            onClick={onClose}
            className="px-4 py-2 bg-slate-900 hover:bg-slate-800 dark:bg-white dark:hover:bg-slate-100 text-white dark:text-slate-900 font-bold text-xs rounded-xl cursor-pointer"
          >
            Done
          </button>
        </div>
      </div>
    </div>
  );
}


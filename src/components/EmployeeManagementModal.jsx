import React, { useState, useEffect } from 'react';
import { X, CheckCircle, AlertTriangle, UserCheck, UserX, Shield, RefreshCw, Plus, Users, Key, Save } from 'lucide-react';
import { authService } from '../services/authService';

const ROLES = [
  { id: 'super_admin', label: '👑 Super Admin', desc: 'Full permissions (manage roles, catalog, verify barcodes, view reports)' },
  { id: 'admin', label: '🛡️ Admin', desc: 'Catalog management, verify barcodes, view reports' },
  { id: 'inventory_staff', label: '📦 Inventory Staff', desc: 'Can verify pending barcodes & update item details' },
  { id: 'viewer', label: '👁️ Viewer', desc: 'Read-only access to view RMA reports' }
];

export default function EmployeeManagementModal({ isOpen, onClose, currentUser }) {
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [hrApiKey, setHrApiKey] = useState(authService.getHrApiKey());
  const [showApiKeyInput, setShowApiKeyInput] = useState(false);
  const [isSyncing, setIsSyncing] = useState(false);
  const [notice, setNotice] = useState(null);

  // Add new employee state
  const [isAdding, setIsAdding] = useState(false);
  const [newName, setNewName] = useState('');
  const [newEmail, setNewEmail] = useState('');
  const [newRole, setNewRole] = useState('inventory_staff');
  const [newDept, setNewDept] = useState('Operations');

  useEffect(() => {
    if (isOpen) {
      loadEmployees();
    }
  }, [isOpen]);

  const loadEmployees = async () => {
    setIsLoading(true);
    try {
      const list = await authService.getEmployees();
      setEmployees(list);
    } catch (err) {
      console.warn('Load employees error:', err);
    } finally {
      setIsLoading(false);
    }
  };

  const showStatus = (text, type = 'success') => {
    setNotice({ text, type });
    setTimeout(() => setNotice(null), 4000);
  };

  const handleRoleChange = async (email, newRole) => {
    try {
      await authService.setEmployeeRole(email, newRole);
      setEmployees(prev => prev.map(e => e.email === email ? { ...e, role: newRole } : e));
      showStatus(`Updated role for ${email} to ${newRole}`);
    } catch (err) {
      showStatus(err.message, 'error');
    }
  };

  const handleStatusToggle = async (email, currentStatus) => {
    const nextStatus = !currentStatus;
    try {
      await authService.setEmployeeStatus(null, email, nextStatus);
      setEmployees(prev => prev.map(e => e.email === email ? { ...e, is_active: nextStatus } : e));
      showStatus(`Employee ${email} is now marked as ${nextStatus ? 'ACTIVE' : 'RESIGNED'}`);
    } catch (err) {
      showStatus(err.message, 'error');
    }
  };

  const handleAddEmployee = async (e) => {
    e.preventDefault();
    if (!newEmail.trim() || !newName.trim()) return;

    try {
      await authService.addEmployee({
        name: newName,
        email: newEmail,
        role: newRole,
        department: newDept
      });
      showStatus(`Added ${newName} (${newEmail}) to employee directory!`);
      setNewName('');
      setNewEmail('');
      setIsAdding(false);
      loadEmployees();
    } catch (err) {
      showStatus(err.message, 'error');
    }
  };

  const handleSyncFromHRCenter = async () => {
    setIsSyncing(true);
    setNotice(null);
    try {
      const res = await authService.syncFromHRCenter(hrApiKey);
      showStatus(res.message, 'success');
      loadEmployees();
      setShowApiKeyInput(false);
    } catch (err) {
      showStatus(err.message, 'error');
    } finally {
      setIsSyncing(false);
    }
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      <div className="bg-white rounded-3xl shadow-2xl border border-slate-200 max-w-2xl w-full p-6 space-y-5 max-h-[90vh] overflow-y-auto">
        
        {/* Header */}
        <div className="flex items-center justify-between border-b border-slate-100 pb-4">
          <div className="flex items-center gap-2.5">
            <div className="p-2 bg-purple-100 text-purple-700 rounded-xl">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-lg font-bold text-slate-900">
                Employee Access & Roles Management
              </h2>
              <p className="text-xs text-slate-500">
                Super Admin portal to assign roles & toggle active / resigned status.
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

        {/* Notice Banner */}
        {notice && (
          <div className={`p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 ${
            notice.type === 'success' 
              ? 'bg-emerald-50 text-emerald-800 border border-emerald-200' 
              : 'bg-rose-50 text-rose-800 border border-rose-200'
          }`}>
            {notice.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0" /> : <AlertTriangle className="w-4 h-4 shrink-0" />}
            <span>{notice.text}</span>
          </div>
        )}

        {/* Quick Toolbar: Add Employee + Sync with HR Center API */}
        <div className="flex flex-wrap items-center justify-between gap-2 p-3 bg-slate-50 border border-slate-200 rounded-2xl">
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => setIsAdding(!isAdding)}
              className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Employee</span>
            </button>

            <button
              type="button"
              onClick={() => setShowApiKeyInput(!showApiKeyInput)}
              className="px-3 py-1.5 bg-white hover:bg-slate-100 border border-slate-200 text-slate-700 rounded-xl text-xs font-bold flex items-center gap-1.5"
            >
              <Key className="w-3.5 h-3.5 text-purple-600" />
              <span>HR Center API Sync</span>
            </button>
          </div>

          <span className="text-[11px] font-mono text-slate-400">
            Total Staff: {employees.length}
          </span>
        </div>

        {/* HR Center API Key Drawer / Input */}
        {showApiKeyInput && (
          <div className="p-4 bg-purple-50/70 border border-purple-200 rounded-2xl space-y-3 text-xs animate-in fade-in">
            <div className="flex items-center justify-between">
              <span className="font-bold text-purple-900 block">
                Sync with HR Center API (hr-center-pingcon.laravel.cloud)
              </span>
              <span className="text-[10px] text-purple-700 font-mono">/api/v1/employees</span>
            </div>
            <p className="text-[11px] text-purple-800">
              Paste your Bearer API Key from the HR Center developer tools to automatically import the employee masterlist.
            </p>
            <div className="flex gap-2">
              <input
                type="password"
                value={hrApiKey}
                onChange={(e) => setHrApiKey(e.target.value)}
                placeholder="Bearer API Key..."
                className="flex-1 px-3 py-2 bg-white border border-purple-300 rounded-xl text-xs font-mono text-slate-900 focus:outline-none focus:border-purple-600"
              />
              <button
                type="button"
                disabled={isSyncing || !hrApiKey.trim()}
                onClick={handleSyncFromHRCenter}
                className="px-4 py-2 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
              >
                {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                <span>Sync Now</span>
              </button>
            </div>
          </div>
        )}

        {/* Add Employee Form */}
        {isAdding && (
          <form onSubmit={handleAddEmployee} className="p-4 bg-blue-50/60 border border-blue-200 rounded-2xl space-y-3 text-xs animate-in fade-in">
            <span className="font-bold text-blue-900 block">Add Authorized Employee</span>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <input
                type="text"
                required
                placeholder="Full Name (e.g. Maria Clara)"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600"
              />
              <input
                type="email"
                required
                placeholder="Company Email (e.g. maria@pingconmarketing.com)"
                value={newEmail}
                onChange={(e) => setNewEmail(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
              <select
                value={newRole}
                onChange={(e) => setNewRole(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-bold focus:outline-none focus:border-blue-600"
              >
                {ROLES.map(r => (
                  <option key={r.id} value={r.id}>{r.label}</option>
                ))}
              </select>
              <input
                type="text"
                placeholder="Department (e.g. Warehouse / Finance)"
                value={newDept}
                onChange={(e) => setNewDept(e.target.value)}
                className="px-3 py-2 bg-white border border-slate-300 rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600"
              />
            </div>
            <div className="flex justify-end gap-2 pt-1">
              <button
                type="button"
                onClick={() => setIsAdding(false)}
                className="px-3 py-1.5 text-slate-500 hover:text-slate-800 text-xs font-bold"
              >
                Cancel
              </button>
              <button
                type="submit"
                className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold"
              >
                Save Employee
              </button>
            </div>
          </form>
        )}

        {/* Employee List */}
        <div className="space-y-2">
          {employees.map(emp => (
            <div
              key={emp.email}
              className={`p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                emp.is_active === false 
                  ? 'bg-slate-100 border-slate-300 opacity-60' 
                  : 'bg-white hover:bg-slate-50 border-slate-200'
              }`}
            >
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-slate-900 text-sm">
                    {emp.name}
                  </span>
                  {emp.email === currentUser?.email && (
                    <span className="px-2 py-0.2 rounded-full text-[10px] font-black bg-blue-100 text-blue-800">
                      YOU
                    </span>
                  )}
                  {emp.is_active === false ? (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 text-rose-800 border border-rose-200">
                      RESIGNED / BLOCKED
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 text-emerald-800">
                      ACTIVE
                    </span>
                  )}
                </div>
                <div className="text-[11px] font-mono text-slate-500 mt-0.5">
                  {emp.email} • {emp.department || 'General'}
                </div>
              </div>

              {/* Role Selection & Active/Resigned Toggle */}
              <div className="flex items-center gap-2 shrink-0">
                <select
                  value={emp.role || 'inventory_staff'}
                  onChange={(e) => handleRoleChange(emp.email, e.target.value)}
                  disabled={emp.email === currentUser?.email}
                  className="px-2.5 py-1.5 bg-slate-50 border border-slate-300 rounded-xl text-xs font-bold text-slate-800 focus:outline-none focus:border-blue-600 disabled:opacity-50"
                >
                  {ROLES.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>

                <button
                  type="button"
                  onClick={() => handleStatusToggle(emp.email, emp.is_active !== false)}
                  disabled={emp.email === currentUser?.email}
                  className={`px-3 py-1.5 rounded-xl text-xs font-bold flex items-center gap-1 transition-all disabled:opacity-30 ${
                    emp.is_active !== false
                      ? 'bg-rose-50 hover:bg-rose-100 text-rose-700 border border-rose-200'
                      : 'bg-emerald-50 hover:bg-emerald-100 text-emerald-700 border border-emerald-200'
                  }`}
                  title={emp.is_active !== false ? 'Mark as Resigned (Block Access)' : 'Restore Active Access'}
                >
                  {emp.is_active !== false ? (
                    <>
                      <UserX className="w-3.5 h-3.5" />
                      <span>Mark Resigned</span>
                    </>
                  ) : (
                    <>
                      <UserCheck className="w-3.5 h-3.5" />
                      <span>Reactivate</span>
                    </>
                  )}
                </button>
              </div>
            </div>
          ))}
        </div>

      </div>
    </div>
  );
}

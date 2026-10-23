import React, { useState, useEffect, useMemo } from 'react';
import { X, CheckCircle, AlertTriangle, UserCheck, UserX, Shield, RefreshCw, Plus, Users, Key, Search, Mail, Building2 } from 'lucide-react';
import { authService } from '../services/authService';
import TablePagination from './TablePagination';

const ROLES = [
  { id: 'super_admin', label: '👑 Super Admin', desc: 'Full permissions (manage roles, catalog, verify barcodes, view reports)' },
  { id: 'admin', label: '🛡️ Admin', desc: 'Catalog management, verify barcodes, view reports' },
  { id: 'inventory_staff', label: '📦 Inventory Staff', desc: 'Can verify pending barcodes & update item details' },
  { id: 'viewer', label: '👁️ Viewer', desc: 'Read-only access to view RMA reports' }
];

export default function EmployeeManagementModal({ isOpen, onClose, currentUser }) {
  const [employees, setEmployees] = useState([]);
  const [isLoading, setIsLoading] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [statusFilter, setStatusFilter] = useState('all');
  const [sortBy, setSortBy] = useState('name_asc');
  const [currentPage, setCurrentPage] = useState(1);
  const [pageSize, setPageSize] = useState(10);
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
      showStatus(`Added ${newName} (${newEmail}) to company directory!`);
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

  // Filter and sort employees memo
  const filteredEmployees = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();
    return employees
      .filter(emp => {
        if (q) {
          const matches = (
            (emp.name || '').toLowerCase().includes(q) ||
            (emp.email || '').toLowerCase().includes(q) ||
            (emp.department || '').toLowerCase().includes(q) ||
            (emp.role || '').toLowerCase().includes(q)
          );
          if (!matches) return false;
        }

        if (roleFilter !== 'all' && (emp.role || 'inventory_staff') !== roleFilter) {
          return false;
        }

        if (statusFilter === 'active' && emp.is_active === false) return false;
        if (statusFilter === 'resigned' && emp.is_active !== false) return false;

        return true;
      })
      .sort((a, b) => {
        if (sortBy === 'name_asc') {
          return (a.name || '').localeCompare(b.name || '');
        } else if (sortBy === 'name_desc') {
          return (b.name || '').localeCompare(a.name || '');
        } else if (sortBy === 'role') {
          return (a.role || '').localeCompare(b.role || '');
        } else if (sortBy === 'status') {
          return (a.is_active === false ? 1 : 0) - (b.is_active === false ? 1 : 0);
        }
        return 0;
      });
  }, [employees, searchQuery, roleFilter, statusFilter, sortBy]);

  // Paginated slice
  const paginatedEmployees = useMemo(() => {
    const start = (currentPage - 1) * pageSize;
    return filteredEmployees.slice(start, start + pageSize);
  }, [filteredEmployees, currentPage, pageSize]);

  // All hooks declared above. Early return only right before JSX render!
  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-900/60 backdrop-blur-sm animate-in fade-in">
      {/* Outer Card: Clean rounded corners with overflow-hidden so scrollbar never overlaps borders */}
      <div className="bg-white dark:bg-slate-900 rounded-t-3xl sm:rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800 max-w-2xl w-full flex flex-col max-h-[92dvh] sm:max-h-[88vh] overflow-hidden my-0 sm:my-auto pb-safe">
        {/* Mobile Drag Indicator */}
        <div className="bottom-sheet-handle sm:hidden" />
        
        {/* Pinned Header */}
        <div className="p-5 sm:p-6 pb-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
          <div className="flex items-center gap-3">
            <div className="p-2.5 bg-purple-100 dark:bg-purple-900/40 text-purple-700 dark:text-purple-300 rounded-2xl shadow-inner">
              <Users className="w-5 h-5" />
            </div>
            <div>
              <h2 className="text-base sm:text-lg font-black text-slate-900 dark:text-white tracking-tight">
                Employee Access & Roles Management
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Super Admin portal to assign staff roles & toggle active / resigned status.
              </p>
            </div>
          </div>
          <button
            onClick={onClose}
            className="p-2 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Pinned Top Controls & Search Bar */}
        <div className="p-4 sm:px-6 sm:py-3.5 bg-slate-50/80 dark:bg-slate-900/80 border-b border-slate-200/80 dark:border-slate-800 space-y-3 shrink-0">
          
          {/* Status Notice */}
          {notice && (
            <div className={`p-3 rounded-2xl text-xs font-semibold flex items-center gap-2 animate-in fade-in ${
              notice.type === 'success' 
                ? 'bg-emerald-50 dark:bg-emerald-950/40 text-emerald-800 dark:text-emerald-200 border border-emerald-200 dark:border-emerald-800' 
                : 'bg-rose-50 dark:bg-rose-950/40 text-rose-800 dark:text-rose-200 border border-rose-200 dark:border-rose-800'
            }`}>
              {notice.type === 'success' ? <CheckCircle className="w-4 h-4 shrink-0 text-emerald-600" /> : <AlertTriangle className="w-4 h-4 shrink-0 text-rose-600" />}
              <span>{notice.text}</span>
            </div>
          )}

          {/* Quick Toolbar: Add Staff & HR Sync */}
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={() => setIsAdding(!isAdding)}
                className="px-3 py-1.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add Employee</span>
              </button>

              <button
                type="button"
                onClick={() => setShowApiKeyInput(!showApiKeyInput)}
                className="px-3 py-1.5 bg-white dark:bg-slate-800 hover:bg-slate-100 dark:hover:bg-slate-700 border border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm transition-all"
              >
                <Key className="w-3.5 h-3.5 text-purple-600 dark:text-purple-400" />
                <span>HR Center API Sync</span>
              </button>
            </div>

            <div className="text-[11px] font-semibold text-slate-500 dark:text-slate-400">
              Total Staff: <strong className="text-slate-800 dark:text-white">{employees.length}</strong>
            </div>
          </div>

          {/* SEARCH BAR (Filter by name, company email, or department) */}
          <div className="relative">
            <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-2.5" />
            <input
              type="text"
              value={searchQuery}
              onChange={(e) => {
                setSearchQuery(e.target.value);
                setCurrentPage(1);
              }}
              placeholder="Search by employee name, company email (@keysys, @pingcon, @a2z2go), or department..."
              className="w-full pl-10 pr-9 py-2 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-semibold text-slate-900 dark:text-white placeholder-slate-400 dark:placeholder-slate-500 focus:outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100 dark:focus:ring-blue-900/30 shadow-sm transition-all"
            />
            {searchQuery && (
              <button
                onClick={() => {
                  setSearchQuery('');
                  setCurrentPage(1);
                }}
                className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 p-0.5 rounded-full hover:bg-slate-100 dark:hover:bg-slate-700"
                title="Clear search"
              >
                <X className="w-3.5 h-3.5" />
              </button>
            )}
          </div>

          {/* Quick Filters Strip */}
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <select
              value={roleFilter}
              onChange={(e) => {
                setRoleFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 shadow-xs"
            >
              <option value="all">All Roles</option>
              <option value="super_admin">👑 Super Admin</option>
              <option value="admin">🛡️ Admin</option>
              <option value="inventory_staff">📦 Inventory Staff</option>
              <option value="viewer">👁️ Viewer</option>
            </select>

            <select
              value={statusFilter}
              onChange={(e) => {
                setStatusFilter(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 shadow-xs"
            >
              <option value="all">All Status</option>
              <option value="active">Active Only</option>
              <option value="resigned">Resigned Only</option>
            </select>

            <select
              value={sortBy}
              onChange={(e) => {
                setSortBy(e.target.value);
                setCurrentPage(1);
              }}
              className="px-2.5 py-1.5 bg-white dark:bg-slate-800 border border-slate-200 dark:border-slate-700 rounded-xl font-bold text-slate-700 dark:text-slate-200 focus:outline-none focus:border-blue-500 shadow-xs"
            >
              <option value="name_asc">Sort: Name (A-Z)</option>
              <option value="name_desc">Sort: Name (Z-A)</option>
              <option value="role">Sort: Role</option>
              <option value="status">Sort: Status</option>
            </select>

            {(searchQuery.trim() !== '' || roleFilter !== 'all' || statusFilter !== 'all') && (
              <button
                type="button"
                onClick={() => {
                  setSearchQuery('');
                  setRoleFilter('all');
                  setStatusFilter('all');
                  setCurrentPage(1);
                }}
                className="px-2 py-1.5 bg-slate-200 dark:bg-slate-800 hover:bg-slate-300 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 rounded-xl font-bold text-[11px] transition-colors"
              >
                Reset
              </button>
            )}

            <span className="text-[11px] text-slate-400 dark:text-slate-500 font-semibold ml-auto">
              Showing {filteredEmployees.length} of {employees.length}
            </span>
          </div>

          {/* HR Center API Key Drawer */}
          {showApiKeyInput && (
            <div className="p-3.5 bg-purple-50/80 dark:bg-purple-950/40 border border-purple-200 dark:border-purple-800 rounded-2xl space-y-2 text-xs animate-in fade-in">
              <div className="flex items-center justify-between">
                <span className="font-bold text-purple-900 dark:text-purple-200 block">
                  Sync Active Staff with HR Center API
                </span>
                <span className="text-[10px] text-purple-700 dark:text-purple-400 font-mono">/api/v1/employees</span>
              </div>
              <p className="text-[11px] text-purple-800 dark:text-purple-300 leading-tight">
                Pulls employee records and strictly connects their official company emails (@keysysincorporated.com, @ph.keysys.com, @pingcon.com, @a2z2go.net).
              </p>
              <div className="flex gap-2">
                <input
                  type="password"
                  value={hrApiKey}
                  onChange={(e) => setHrApiKey(e.target.value)}
                  placeholder="Bearer API Key..."
                  className="flex-1 px-3 py-1.5 bg-white dark:bg-slate-800 border border-purple-300 dark:border-purple-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-purple-600 shadow-sm"
                />
                <button
                  type="button"
                  disabled={isSyncing || !hrApiKey.trim()}
                  onClick={handleSyncFromHRCenter}
                  className="px-3.5 py-1.5 bg-purple-600 hover:bg-purple-700 disabled:opacity-50 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 shadow-sm"
                >
                  {isSyncing ? <RefreshCw className="w-3.5 h-3.5 animate-spin" /> : <RefreshCw className="w-3.5 h-3.5" />}
                  <span>Sync Now</span>
                </button>
              </div>
            </div>
          )}

          {/* Add Employee Form Drawer */}
          {isAdding && (
            <form onSubmit={handleAddEmployee} className="p-3.5 bg-blue-50/70 dark:bg-blue-950/40 border border-blue-200 dark:border-blue-800 rounded-2xl space-y-2.5 text-xs animate-in fade-in">
              <span className="font-bold text-blue-900 dark:text-blue-200 block">Add Authorized Company Staff</span>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <input
                  type="text"
                  required
                  placeholder="Full Name (e.g. Maria Clara)"
                  value={newName}
                  onChange={(e) => setNewName(e.target.value)}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600"
                />
                <input
                  type="email"
                  required
                  placeholder="Company Email (@keysys, @pingcon...)"
                  value={newEmail}
                  onChange={(e) => setNewEmail(e.target.value)}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-2">
                <select
                  value={newRole}
                  onChange={(e) => setNewRole(e.target.value)}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-bold focus:outline-none focus:border-blue-600"
                >
                  {ROLES.map(r => (
                    <option key={r.id} value={r.id}>{r.label}</option>
                  ))}
                </select>
                <input
                  type="text"
                  placeholder="Department (e.g. Finance / Warehouse)"
                  value={newDept}
                  onChange={(e) => setNewDept(e.target.value)}
                  className="px-3 py-2 bg-white dark:bg-slate-800 border border-slate-300 dark:border-slate-700 text-slate-900 dark:text-white rounded-xl text-xs font-semibold focus:outline-none focus:border-blue-600"
                />
              </div>
              <div className="flex justify-end gap-2 pt-1">
                <button
                  type="button"
                  onClick={() => setIsAdding(false)}
                  className="px-3 py-1.5 text-slate-500 hover:text-slate-800 dark:text-slate-400 dark:hover:text-slate-200 text-xs font-bold"
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

        </div>

        {/* Scrollable Employee List Container (Scrollbar stays strictly within this area, avoiding curved card borders) */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-3.5 space-y-2.5 overscroll-contain">
          {filteredEmployees.length === 0 ? (
            <div className="py-12 text-center text-slate-400 dark:text-slate-500 space-y-1">
              <Users className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600" />
              <p className="text-xs font-semibold">No employees found matching "{searchQuery}"</p>
              <p className="text-[11px] text-slate-400 dark:text-slate-500">Try searching with a different name or company email address.</p>
            </div>
          ) : (
            paginatedEmployees.map(emp => (
              <div
                key={emp.email}
                className={`p-3 sm:p-3.5 rounded-2xl border transition-all flex flex-col sm:flex-row sm:items-center justify-between gap-3 text-xs ${
                  emp.is_active === false 
                    ? 'bg-slate-100/80 dark:bg-slate-800/40 border-slate-300 dark:border-slate-700 opacity-60' 
                    : 'bg-white dark:bg-slate-800/80 hover:bg-slate-50 dark:hover:bg-slate-800 border-slate-200 dark:border-slate-700/80 shadow-sm'
                }`}
              >
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-1.5 sm:gap-2">
                    <span className="font-bold text-slate-900 dark:text-white text-sm truncate">
                      {emp.name}
                    </span>
                    {emp.email === currentUser?.email && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-blue-100 dark:bg-blue-900/50 text-blue-800 dark:text-blue-300 shrink-0">
                        YOU
                      </span>
                    )}
                    {emp.role === 'super_admin' && (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-purple-100 dark:bg-purple-900/50 text-purple-800 dark:text-purple-300 shrink-0">
                        SUPER ADMIN
                      </span>
                    )}
                    {emp.is_active === false ? (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-rose-100 dark:bg-rose-950/60 text-rose-800 dark:text-rose-300 border border-rose-200 dark:border-rose-800 shrink-0">
                        RESIGNED
                      </span>
                    ) : (
                      <span className="px-2 py-0.5 rounded-full text-[10px] font-bold bg-emerald-100 dark:bg-emerald-950/60 text-emerald-800 dark:text-emerald-300 shrink-0">
                        ACTIVE
                      </span>
                    )}
                  </div>
                  <div className="text-[11px] font-mono text-slate-500 dark:text-slate-400 mt-0.5 truncate">
                    <strong className="text-slate-700 dark:text-slate-300 font-semibold">{emp.email}</strong> • {emp.department || 'General'}
                  </div>
                </div>

                {/* Role Selection & Active/Resigned Toggle */}
                <div className="flex items-center gap-2 shrink-0 pt-1 sm:pt-0 border-t sm:border-t-0 border-slate-100 dark:border-slate-700/60">
                  <select
                    value={emp.role || 'inventory_staff'}
                    onChange={(e) => handleRoleChange(emp.email, e.target.value)}
                    disabled={emp.email === currentUser?.email}
                    className="px-2.5 py-1.5 bg-slate-50 dark:bg-slate-700 border border-slate-300 dark:border-slate-600 rounded-xl text-xs font-bold text-slate-800 dark:text-slate-200 focus:outline-none focus:border-blue-600 disabled:opacity-50"
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
                        ? 'bg-rose-50 dark:bg-rose-950/40 hover:bg-rose-100 dark:hover:bg-rose-900/60 text-rose-700 dark:text-rose-300 border border-rose-200 dark:border-rose-800'
                        : 'bg-emerald-50 dark:bg-emerald-950/40 hover:bg-emerald-100 dark:hover:bg-emerald-900/60 text-emerald-700 dark:text-emerald-300 border border-emerald-200 dark:border-emerald-800'
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
            ))
          )}
        </div>

        {/* Pinned Footer with pagination */}
        <div className="bg-slate-50 dark:bg-slate-900 border-t border-slate-200/80 dark:border-slate-800 shrink-0">
          <TablePagination
            currentPage={currentPage}
            pageSize={pageSize}
            totalItems={filteredEmployees.length}
            onPageChange={setCurrentPage}
            onPageSizeChange={(newSize) => {
              setPageSize(newSize);
              setCurrentPage(1);
            }}
          />
        </div>

      </div>
    </div>
  );
}

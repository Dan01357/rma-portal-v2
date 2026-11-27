import React from 'react';
import {
  FileText,
  Building2,
  Receipt,
  AlertTriangle,
  Package,
  ClipboardCheck,
  Archive,
  BookOpen,
  MapPin,
  Ticket,
  Users,
  KeyRound,
  FlaskConical,
  Settings,
  PanelLeftClose,
  PanelLeftOpen,
  X,
  ShieldCheck
} from 'lucide-react';

/**
 * Collapsible Enterprise Left Sidebar for Admin Portal.
 * - Desktop (lg+): Sticky collapsible rail (w-64 expanded / w-[72px] icon-only rail).
 * - Mobile/Tablet (<lg): Slide-out drawer with backdrop overlay.
 */
export default function AdminSidebar({
  activeTab,
  onSelectTab,
  isCollapsed = false,
  onToggleCollapse,
  isMobileOpen = false,
  onCloseMobile,
  isSuperAdmin = false,
  isTestMode = false,
  counts = {}
}) {
  const navGroups = [
    {
      id: 'operations',
      label: 'Operations',
      items: [
        {
          id: 'customer_reports',
          label: 'Customer Returns',
          shortLabel: 'Returns',
          icon: FileText,
          count: counts.customerInbound,
          accent: 'text-blue-600 dark:text-blue-400',
          badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
        },
        {
          id: 'supplier_claims',
          label: 'Supplier Claims (RTV)',
          shortLabel: 'Supplier RTV',
          icon: Building2,
          count: counts.supplierClaims,
          accent: 'text-purple-600 dark:text-purple-400',
          badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300'
        },
        {
          id: 'credit_memos',
          label: 'Credit Memos Ledger',
          shortLabel: 'Credit Memos',
          icon: Receipt,
          count: counts.creditMemos,
          accent: 'text-emerald-600 dark:text-emerald-400',
          badgeClass: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950/70 dark:text-emerald-300'
        },
        {
          id: 'pending_barcodes',
          label: 'Awaiting SKU Queue',
          shortLabel: 'Awaiting SKU',
          icon: AlertTriangle,
          count: counts.pendingBarcodes,
          accent: 'text-amber-600 dark:text-amber-400',
          badgeClass: (counts.pendingBarcodes || 0) > 0
            ? 'bg-amber-500 text-slate-950 font-black'
            : 'bg-slate-100 text-slate-600 dark:bg-slate-800 dark:text-slate-400'
        }
      ]
    },
    {
      id: 'catalog_records',
      label: 'Catalog & Records',
      items: [
        {
          id: 'products',
          label: 'Saved Products',
          shortLabel: 'Products',
          icon: Package,
          count: counts.products,
          accent: 'text-indigo-600 dark:text-indigo-400',
          badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300'
        },
        {
          id: 'rma_reports',
          label: 'Full Audit & Reports',
          shortLabel: 'Audit Log',
          icon: ClipboardCheck,
          count: counts.allLiveReports,
          accent: 'text-sky-600 dark:text-sky-400',
          badgeClass: 'bg-sky-100 text-sky-800 dark:bg-sky-950/70 dark:text-sky-300'
        },
        {
          id: 'archive_trash',
          label: 'Archive & Trash Bin',
          shortLabel: 'Archive & Trash',
          icon: Archive,
          count: counts.archiveTrash,
          accent: 'text-slate-600 dark:text-slate-400',
          badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
        }
      ]
    },
    {
      id: 'directory_locations',
      label: 'Directory & Locations',
      items: [
        {
          id: 'supplier_directory',
          label: 'Supplier Directory',
          shortLabel: 'Suppliers',
          icon: BookOpen,
          count: counts.supplierContacts,
          accent: 'text-amber-600 dark:text-amber-400',
          badgeClass: 'bg-amber-100 text-amber-800 dark:bg-amber-950/70 dark:text-amber-300'
        },
        ...(isSuperAdmin
          ? [
              {
                id: 'warehouse_locations',
                label: 'Warehouse Locations & GPS',
                shortLabel: 'Locations',
                icon: MapPin,
                count: counts.locations,
                accent: 'text-blue-600 dark:text-blue-400',
                badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }
            ]
          : [])
      ]
    },
    {
      id: 'access_integrations',
      label: 'Access & Integrations',
      items: [
        {
          id: 'rma_invites',
          label: 'Customer & RMA Invites',
          shortLabel: 'RMA Invites',
          icon: Ticket,
          accent: 'text-blue-600 dark:text-blue-400',
          badgeClass: 'bg-blue-100 text-blue-800 dark:bg-blue-950/70 dark:text-blue-300'
        },
        ...(isSuperAdmin
          ? [
              {
                id: 'roles_access',
                label: 'Roles & Team Access',
                shortLabel: 'Roles',
                icon: Users,
                count: counts.staff,
                accent: 'text-purple-600 dark:text-purple-400',
                badgeClass: 'bg-purple-100 text-purple-800 dark:bg-purple-950/70 dark:text-purple-300'
              },
              {
                id: 'api_keys',
                label: 'API Keys & Webhooks',
                shortLabel: 'API Keys',
                icon: KeyRound,
                accent: 'text-indigo-600 dark:text-indigo-400',
                badgeClass: 'bg-indigo-100 text-indigo-800 dark:bg-indigo-950/70 dark:text-indigo-300'
              }
            ]
          : [])
      ]
    },
    {
      id: 'qa_system',
      label: 'QA & System',
      items: [
        {
          id: 'sandbox',
          label: 'Test Mode Sandbox',
          shortLabel: 'Sandbox',
          icon: FlaskConical,
          count: counts.sandbox,
          accent: 'text-amber-600 dark:text-amber-400',
          badgeClass: 'bg-amber-100 text-amber-900 dark:bg-amber-950/80 dark:text-amber-300 border border-amber-300 dark:border-amber-700'
        },
        ...(isSuperAdmin
          ? [
              {
                id: 'settings',
                label: 'System Settings',
                shortLabel: 'Settings',
                icon: Settings,
                accent: 'text-slate-600 dark:text-slate-300',
                badgeClass: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
              }
            ]
          : [])
      ]
    }
  ].filter((g) => g.items.length > 0);

  const normalizedActiveTab = activeTab === 'reports' ? 'customer_reports' : activeTab;

  const renderSidebarBody = (compactMode) => (
    <div className="flex flex-col h-full bg-white dark:bg-slate-900 border-r border-slate-200 dark:border-slate-800 select-none">
      {/* Sidebar Brand Header */}
      <div className={`h-14 px-3 border-b border-slate-200 dark:border-slate-800 flex items-center ${compactMode ? 'justify-center' : 'justify-between'} shrink-0`}>
        <div className="flex items-center gap-2.5 min-w-0">
          <div className="w-9 h-9 rounded-xl bg-slate-900 dark:bg-blue-600 text-white flex items-center justify-center font-black text-sm shrink-0 shadow-sm">
            <ShieldCheck className="w-5 h-5" />
          </div>
          {!compactMode && (
            <div className="min-w-0">
              <div className="text-xs font-black tracking-tight text-slate-900 dark:text-white truncate">
                Pingcon RMA
              </div>
              <div className="text-[10px] font-semibold text-slate-500 dark:text-slate-400 truncate flex items-center gap-1">
                <span>Enterprise Portal</span>
                {isTestMode && (
                  <span className="px-1 py-0.2 rounded bg-amber-100 dark:bg-amber-950 text-amber-800 dark:text-amber-300 text-[8.5px] font-black uppercase">
                    TEST
                  </span>
                )}
              </div>
            </div>
          )}
        </div>

        {/* Mobile close drawer button */}
        {onCloseMobile && (
          <button
            type="button"
            onClick={onCloseMobile}
            aria-label="Close navigation menu"
            className="lg:hidden touch-target p-2 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        )}

        {/* Desktop collapse toggle */}
        {!compactMode && onToggleCollapse && (
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Collapse sidebar"
            title="Collapse sidebar to icon rail"
            className="hidden lg:inline-flex p-1.5 rounded-xl text-slate-400 hover:text-slate-700 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer shrink-0"
          >
            <PanelLeftClose className="w-4 h-4" />
          </button>
        )}
      </div>

      {/* Scrollable Navigation Groups */}
      <nav aria-label="Admin Sidebar Navigation" className="flex-1 overflow-y-auto px-2.5 py-3 space-y-4 no-scrollbar">
        {navGroups.map((group) => (
          <div key={group.id} className="space-y-1">
            {!compactMode ? (
              <div className="px-2.5 pb-1 text-[10px] font-black uppercase tracking-wider text-slate-400 dark:text-slate-500">
                {group.label}
              </div>
            ) : (
              <div className="border-t border-slate-100 dark:border-slate-800 my-1.5 mx-2" />
            )}

            {group.items.map((item) => {
              const Icon = item.icon;
              const isActive = normalizedActiveTab === item.id;
              const hasCount = item.count !== undefined && item.count !== null;

              return (
                <button
                  key={item.id}
                  type="button"
                  data-sidebar-item={item.id}
                  aria-current={isActive ? 'page' : undefined}
                  aria-label={compactMode ? `${item.label}${hasCount ? ` (${item.count})` : ''}` : undefined}
                  title={compactMode ? `${item.label}${hasCount ? ` (${item.count})` : ''}` : item.label}
                  onClick={() => {
                    onSelectTab(item.id);
                    onCloseMobile?.();
                  }}
                  className={`relative w-full touch-target rounded-xl transition-all flex items-center cursor-pointer ${
                    compactMode ? 'justify-center px-2 py-2.5' : 'justify-between gap-2 px-2.5 py-2'
                  } ${
                    isActive
                      ? 'bg-slate-900 text-white dark:bg-blue-600 dark:text-white shadow-sm font-black'
                      : 'text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/80 font-bold'
                  }`}
                >
                  <span className={`flex items-center ${compactMode ? 'justify-center' : 'gap-2.5 min-w-0'}`}>
                    <Icon
                      className={`w-4 h-4 shrink-0 ${
                        isActive ? 'text-white' : item.accent
                      }`}
                    />
                    {!compactMode && (
                      <span className="text-xs truncate">{item.label}</span>
                    )}
                  </span>

                  {!compactMode && hasCount && (
                    <span
                      className={`px-1.5 py-0.5 rounded-full text-[10px] font-mono font-bold shrink-0 ${
                        isActive ? 'bg-white/20 text-white' : item.badgeClass
                      }`}
                    >
                      {item.count}
                    </span>
                  )}

                  {compactMode && hasCount && Number(item.count) > 0 && item.id === 'pending_barcodes' && (
                    <span className="absolute top-1.5 right-2 w-2 h-2 rounded-full bg-amber-500 ring-2 ring-white dark:ring-slate-900" />
                  )}
                </button>
              );
            })}
          </div>
        ))}
      </nav>

      {/* Sidebar Bottom Expand Toggle (when collapsed on Desktop) */}
      {compactMode && onToggleCollapse && (
        <div className="p-2.5 border-t border-slate-200 dark:border-slate-800 hidden lg:flex justify-center shrink-0">
          <button
            type="button"
            onClick={onToggleCollapse}
            aria-label="Expand sidebar"
            title="Expand sidebar labels"
            className="touch-target w-full flex items-center justify-center p-2 rounded-xl text-slate-500 hover:text-slate-900 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors cursor-pointer"
          >
            <PanelLeftOpen className="w-4 h-4" />
          </button>
        </div>
      )}
    </div>
  );

  return (
    <>
      {/* Desktop Sticky Collapsible Rail */}
      <aside
        data-testid="admin-sidebar-desktop"
        className={`hidden lg:block sticky top-0 h-dvh shrink-0 transition-all duration-200 z-30 ${
          isCollapsed ? 'w-[72px]' : 'w-64'
        }`}
      >
        {renderSidebarBody(isCollapsed)}
      </aside>

      {/* Mobile & Tablet Slide-Out Navigation Drawer */}
      {isMobileOpen && (
        <div
          data-testid="admin-sidebar-mobile-drawer"
          className="fixed inset-0 z-50 lg:hidden flex animate-in fade-in duration-150"
        >
          <div
            className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs"
            onClick={onCloseMobile}
            aria-hidden="true"
          />
          <aside className="relative w-72 max-w-[85vw] h-full z-10 shadow-2xl">
            {renderSidebarBody(false)}
          </aside>
        </div>
      )}
    </>
  );
}

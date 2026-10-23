import React, { useState, useRef, useEffect } from 'react';
import { 
  Bell, 
  Check, 
  CheckCheck, 
  Trash2, 
  Package, 
  AlertTriangle, 
  Layers, 
  Info, 
  ExternalLink,
  X,
  Sparkles
} from 'lucide-react';

export default function NotificationBell({ 
  notifications = [], 
  onMarkAsRead, 
  onMarkAllAsRead, 
  onClearAll, 
  onSelectNotification 
}) {
  const [isOpen, setIsOpen] = useState(false);
  const [filter, setFilter] = useState('all'); // 'all' | 'unread'
  const dropdownRef = useRef(null);

  const unreadCount = notifications.filter(n => !n.read).length;

  // Close dropdown on click outside or touch or Escape key
  useEffect(() => {
    function handleClickOutside(event) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        setIsOpen(false);
      }
    }
    function handleKeyDown(event) {
      if (event.key === 'Escape') {
        setIsOpen(false);
      }
    }
    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
      document.addEventListener('touchstart', handleClickOutside);
      document.addEventListener('keydown', handleKeyDown);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
      document.removeEventListener('touchstart', handleClickOutside);
      document.removeEventListener('keydown', handleKeyDown);
    };
  }, [isOpen]);

  // Format relative timestamp (Facebook style)
  const formatTimeAgo = (isoString) => {
    if (!isoString) return 'Just now';
    const now = new Date();
    const past = new Date(isoString);
    const diffSec = Math.floor((now - past) / 1000);

    if (diffSec < 60) return 'Just now';
    const diffMin = Math.floor(diffSec / 60);
    if (diffMin < 60) return `${diffMin}m ago`;
    const diffHour = Math.floor(diffMin / 60);
    if (diffHour < 24) return `${diffHour}h ago`;
    const diffDay = Math.floor(diffHour / 24);
    if (diffDay < 7) return `${diffDay}d ago`;
    return past.toLocaleDateString();
  };

  const getIcon = (type) => {
    switch (type) {
      case 'rma':
        return (
          <div className="w-9 h-9 rounded-full bg-blue-100 dark:bg-blue-900/50 text-blue-600 dark:text-blue-300 flex items-center justify-center shrink-0">
            <Package className="w-4 h-4" />
          </div>
        );
      case 'unknown':
        return (
          <div className="w-9 h-9 rounded-full bg-amber-100 dark:bg-amber-900/50 text-amber-600 dark:text-amber-300 flex items-center justify-center shrink-0">
            <AlertTriangle className="w-4 h-4" />
          </div>
        );
      case 'product':
        return (
          <div className="w-9 h-9 rounded-full bg-indigo-100 dark:bg-indigo-900/50 text-indigo-600 dark:text-indigo-300 flex items-center justify-center shrink-0">
            <Layers className="w-4 h-4" />
          </div>
        );
      case 'delete':
        return (
          <div className="w-9 h-9 rounded-full bg-rose-100 dark:bg-rose-900/50 text-rose-600 dark:text-rose-300 flex items-center justify-center shrink-0">
            <Trash2 className="w-4 h-4" />
          </div>
        );
      default:
        return (
          <div className="w-9 h-9 rounded-full bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-300 flex items-center justify-center shrink-0">
            <Info className="w-4 h-4" />
          </div>
        );
    }
  };

  const filteredNotifications = notifications.filter(n => {
    if (filter === 'unread') return !n.read;
    return true;
  });

  return (
    <div className="relative inline-block text-left" ref={dropdownRef}>
      {/* Bell Button with unread counter */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        className={`relative p-2.5 rounded-2xl border transition-all ${
          isOpen
            ? 'bg-blue-50 dark:bg-blue-950/60 border-blue-300 dark:border-blue-700 text-blue-600 dark:text-blue-400 shadow-sm'
            : 'bg-white dark:bg-slate-800 border-slate-200 dark:border-slate-700 text-slate-700 dark:text-slate-200 hover:bg-slate-50 dark:hover:bg-slate-700/80 shadow-xs'
        }`}
        title="Notifications"
        aria-label="Open notifications"
      >
        <Bell className="w-4 h-4" />
        {unreadCount > 0 && (
          <span className="absolute -top-1.5 -right-1.5 min-w-[20px] h-5 px-1 rounded-full bg-rose-600 text-white font-black text-[10px] flex items-center justify-center border-2 border-white dark:border-slate-900 shadow-sm animate-pulse">
            {unreadCount > 99 ? '99+' : unreadCount}
          </span>
        )}
      </button>

      {/* Mobile Backdrop Overlay (< 768px) */}
      {isOpen && (
        <div 
          className="fixed inset-0 bg-slate-950/60 backdrop-blur-xs z-50 md:hidden transition-opacity"
          onClick={() => setIsOpen(false)}
          aria-hidden="true"
        />
      )}

      {/* Responsive Notification Menu / Drawer */}
      {isOpen && (
        <div 
          className="
            fixed inset-x-3 top-16 z-50 max-h-[80dvh]
            md:absolute md:inset-auto md:right-0 md:top-full md:mt-2.5 md:w-[420px] md:max-h-[580px]
            bg-white dark:bg-slate-900 rounded-3xl shadow-2xl border border-slate-200 dark:border-slate-800
            overflow-hidden flex flex-col animate-in fade-in zoom-in-95 duration-150
          "
        >
          {/* Mobile Drag Indicator */}
          <div className="md:hidden pt-2.5 pb-0.5 flex justify-center shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
          </div>

          {/* Header */}
          <div className="p-4 border-b border-slate-100 dark:border-slate-800 flex items-center justify-between shrink-0 bg-white dark:bg-slate-900">
            <div className="flex items-center gap-2">
              <h3 className="font-black text-slate-900 dark:text-white text-base tracking-tight">
                Notifications
              </h3>
              {unreadCount > 0 && (
                <span className="px-2 py-0.5 rounded-full text-[11px] font-black bg-rose-100 dark:bg-rose-950/60 text-rose-700 dark:text-rose-300">
                  {unreadCount} new
                </span>
              )}
            </div>

            <div className="flex items-center gap-1">
              {unreadCount > 0 && onMarkAllAsRead && (
                <button
                  type="button"
                  onClick={onMarkAllAsRead}
                  className="px-2.5 py-1 text-[11px] font-bold text-blue-600 dark:text-blue-400 hover:bg-blue-50 dark:hover:bg-blue-950/50 rounded-xl transition-colors flex items-center gap-1 cursor-pointer"
                  title="Mark all as read"
                >
                  <CheckCheck className="w-3.5 h-3.5" />
                  <span>Mark all read</span>
                </button>
              )}
              <button
                type="button"
                onClick={() => setIsOpen(false)}
                className="p-1.5 text-slate-400 hover:text-slate-600 dark:hover:text-slate-200 rounded-xl hover:bg-slate-100 dark:hover:bg-slate-800 cursor-pointer touch-target"
                title="Close notifications"
                aria-label="Close notifications"
              >
                <X className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Filter Pills Strip */}
          <div className="px-4 py-2 bg-slate-50 dark:bg-slate-800/60 border-b border-slate-100 dark:border-slate-800/80 flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setFilter('all')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                filter === 'all'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              All ({notifications.length})
            </button>
            <button
              type="button"
              onClick={() => setFilter('unread')}
              className={`px-3 py-1 rounded-xl text-xs font-bold transition-all ${
                filter === 'unread'
                  ? 'bg-blue-600 text-white shadow-xs'
                  : 'text-slate-600 dark:text-slate-400 hover:bg-slate-200 dark:hover:bg-slate-700'
              }`}
            >
              Unread ({unreadCount})
            </button>
          </div>

          {/* Notification Items List */}
          <div className="flex-1 overflow-y-auto divide-y divide-slate-100 dark:divide-slate-800/60 overscroll-contain">
            {filteredNotifications.length === 0 ? (
              <div className="py-12 px-4 text-center text-slate-400 dark:text-slate-500 space-y-2">
                <Bell className="w-8 h-8 mx-auto text-slate-300 dark:text-slate-600 opacity-60" />
                <p className="text-xs font-bold text-slate-600 dark:text-slate-400">
                  {filter === 'unread' ? 'No unread notifications' : 'No notifications yet'}
                </p>
                <p className="text-[11px] text-slate-400 dark:text-slate-500">
                  New RMA reports and catalog updates will appear here in real-time.
                </p>
              </div>
            ) : (
              filteredNotifications.map((notif) => (
                <div
                  key={notif.id}
                  onClick={() => {
                    if (!notif.read && onMarkAsRead) {
                      onMarkAsRead(notif.id);
                    }
                    if (onSelectNotification) {
                      onSelectNotification(notif);
                      setIsOpen(false);
                    }
                  }}
                  className={`p-3.5 flex items-start gap-3 cursor-pointer transition-colors text-left group ${
                    notif.read
                      ? 'bg-white dark:bg-slate-900 hover:bg-slate-50 dark:hover:bg-slate-800/50'
                      : 'bg-blue-50/50 dark:bg-blue-950/25 hover:bg-blue-50 dark:hover:bg-blue-950/40'
                  }`}
                >
                  {getIcon(notif.type)}

                  <div className="flex-1 min-w-0">
                    <div className="flex items-center justify-between gap-1">
                      <h4 className={`text-xs truncate ${notif.read ? 'font-bold text-slate-800 dark:text-slate-200' : 'font-black text-slate-900 dark:text-white'}`}>
                        {notif.title}
                      </h4>
                      <span className="text-[10px] font-medium text-slate-400 dark:text-slate-500 shrink-0">
                        {formatTimeAgo(notif.timestamp)}
                      </span>
                    </div>

                    <p className="text-[11px] text-slate-600 dark:text-slate-400 mt-0.5 line-clamp-2 leading-relaxed">
                      {notif.message}
                    </p>

                    {notif.subtext && (
                      <span className="inline-block mt-1 text-[10px] font-mono text-blue-700 dark:text-blue-400 font-bold bg-blue-100/60 dark:bg-blue-900/40 px-2 py-0.5 rounded-md">
                        {notif.subtext}
                      </span>
                    )}
                  </div>

                  {/* Unread indicator dot */}
                  {!notif.read && (
                    <span className="w-2.5 h-2.5 rounded-full bg-blue-600 shrink-0 mt-1.5 shadow-sm" title="Unread"></span>
                  )}
                </div>
              ))
            )}
          </div>

          {/* Footer */}
          {notifications.length > 0 && (
            <div className="p-3 bg-slate-50 dark:bg-slate-900 border-t border-slate-100 dark:border-slate-800 flex items-center justify-between text-xs shrink-0">
              <span className="text-[11px] text-slate-400 font-medium">
                {notifications.length} total notifications
              </span>
              {onClearAll && (
                <button
                  type="button"
                  onClick={onClearAll}
                  className="text-slate-500 hover:text-rose-600 dark:text-slate-400 dark:hover:text-rose-400 font-bold text-[11px] transition-colors"
                >
                  Clear all
                </button>
              )}
            </div>
          )}

        </div>
      )}
    </div>
  );
}

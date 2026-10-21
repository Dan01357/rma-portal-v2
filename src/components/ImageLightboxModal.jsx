import React, { useEffect } from 'react';
import { X, ExternalLink, Download, ZoomIn } from 'lucide-react';

export default function ImageLightboxModal({ isOpen, imageUrl, title, subtitle, onClose }) {
  useEffect(() => {
    const handleKeyDown = (e) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };
    if (isOpen) {
      window.addEventListener('keydown', handleKeyDown);
      document.body.style.overflow = 'hidden';
    }
    return () => {
      window.removeEventListener('keydown', handleKeyDown);
      document.body.style.overflow = '';
    };
  }, [isOpen, onClose]);

  if (!isOpen || !imageUrl) return null;

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-950/85 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative max-w-4xl max-h-[92vh] w-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Controls Bar */}
        <div className="w-full flex items-center justify-between mb-2 px-2 text-white/90">
          <div className="min-w-0 pr-4">
            {title && (
              <h4 className="text-sm sm:text-base font-black truncate text-white drop-shadow-sm">
                {title}
              </h4>
            )}
            {subtitle && (
              <p className="text-[11px] text-white/70 font-mono truncate">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={imageUrl}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors"
              title="Open full image in new tab"
            >
              <ExternalLink className="w-4 h-4" />
            </a>
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-xl bg-white/10 hover:bg-rose-600/80 text-white transition-colors"
              title="Close (Esc)"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Main Image View */}
        <div className="relative rounded-3xl overflow-hidden bg-slate-900 border border-white/10 shadow-2xl max-h-[82vh] flex items-center justify-center">
          <img
            src={imageUrl}
            alt={title || 'Enlarged Image Preview'}
            className="w-auto h-auto max-w-full max-h-[82vh] object-contain rounded-2xl select-none"
          />
        </div>

        {/* Bottom Helper Hint */}
        <div className="mt-2 text-center text-[11px] text-white/60">
          Click anywhere outside or press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">Esc</kbd> to exit preview
        </div>
      </div>
    </div>
  );
}

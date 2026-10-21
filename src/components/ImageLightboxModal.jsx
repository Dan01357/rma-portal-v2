import React, { useState, useEffect, useMemo } from 'react';
import { X, ExternalLink, ChevronLeft, ChevronRight, Image as ImageIcon } from 'lucide-react';

export default function ImageLightboxModal({ 
  isOpen, 
  imageUrl, 
  images = [], 
  initialIndex = 0, 
  title, 
  subtitle, 
  onClose 
}) {
  const imageList = useMemo(() => {
    if (Array.isArray(images) && images.length > 0) {
      return images.filter(Boolean);
    }
    if (imageUrl) return [imageUrl];
    return [];
  }, [images, imageUrl]);

  const [currentIndex, setCurrentIndex] = useState(initialIndex || 0);

  useEffect(() => {
    if (isOpen) {
      const idx = typeof initialIndex === 'number' && initialIndex >= 0 && initialIndex < imageList.length
        ? initialIndex
        : 0;
      setCurrentIndex(idx);
    }
  }, [isOpen, initialIndex, imageList.length]);

  const handlePrev = (e) => {
    if (e) e.stopPropagation();
    if (imageList.length <= 1) return;
    setCurrentIndex((prev) => (prev > 0 ? prev - 1 : imageList.length - 1));
  };

  const handleNext = (e) => {
    if (e) e.stopPropagation();
    if (imageList.length <= 1) return;
    setCurrentIndex((prev) => (prev < imageList.length - 1 ? prev + 1 : 0));
  };

  useEffect(() => {
    const handleKeyDown = (e) => {
      if (!isOpen) return;
      if (e.key === 'Escape') {
        onClose();
      } else if (e.key === 'ArrowLeft') {
        handlePrev();
      } else if (e.key === 'ArrowRight') {
        handleNext();
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
  }, [isOpen, imageList.length]);

  if (!isOpen || imageList.length === 0) return null;

  const currentSrc = imageList[currentIndex] || imageList[0];

  return (
    <div 
      className="fixed inset-0 z-[100] flex items-center justify-center p-3 sm:p-6 bg-slate-950/90 backdrop-blur-md animate-in fade-in duration-200"
      onClick={onClose}
    >
      <div 
        className="relative max-w-4xl max-h-[94vh] w-full flex flex-col items-center justify-center"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Top Controls Bar */}
        <div className="w-full flex items-center justify-between mb-2.5 px-2 text-white/90">
          <div className="min-w-0 pr-4">
            <div className="flex items-center gap-2">
              {title && (
                <h4 className="text-sm sm:text-base font-black truncate text-white drop-shadow-sm">
                  {title}
                </h4>
              )}
              {imageList.length > 1 && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-600/80 text-white shrink-0 shadow-xs">
                  {currentIndex + 1} / {imageList.length}
                </span>
              )}
            </div>
            {subtitle && (
              <p className="text-[11px] text-white/70 font-mono truncate mt-0.5">
                {subtitle}
              </p>
            )}
          </div>

          <div className="flex items-center gap-2 shrink-0">
            <a
              href={currentSrc}
              target="_blank"
              rel="noreferrer"
              className="p-2 rounded-xl bg-white/10 hover:bg-white/20 text-white/90 hover:text-white transition-colors"
              title="Open full resolution in new tab"
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

        {/* Main Image View with Left & Right Arrow Controls */}
        <div className="relative rounded-3xl overflow-hidden bg-slate-900 border border-white/10 shadow-2xl max-h-[78vh] w-full flex items-center justify-center group/viewer select-none">
          
          {/* Previous Button (Only if multiple images) */}
          {imageList.length > 1 && (
            <button
              type="button"
              onClick={handlePrev}
              aria-label="Previous image"
              className="absolute left-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-2xl bg-black/60 hover:bg-blue-600 text-white flex items-center justify-center backdrop-blur-sm transition-all shadow-lg hover:scale-105 active:scale-95 border border-white/20"
              title="Previous image (Left Arrow)"
            >
              <ChevronLeft className="w-6 h-6" />
            </button>
          )}

          <img
            key={currentSrc}
            src={currentSrc}
            alt={title || `Photo ${currentIndex + 1}`}
            className="w-auto h-auto max-w-full max-h-[78vh] object-contain rounded-2xl animate-in fade-in duration-150"
          />

          {/* Next Button (Only if multiple images) */}
          {imageList.length > 1 && (
            <button
              type="button"
              onClick={handleNext}
              aria-label="Next image"
              className="absolute right-3 top-1/2 -translate-y-1/2 z-10 w-11 h-11 rounded-2xl bg-black/60 hover:bg-blue-600 text-white flex items-center justify-center backdrop-blur-sm transition-all shadow-lg hover:scale-105 active:scale-95 border border-white/20"
              title="Next image (Right Arrow)"
            >
              <ChevronRight className="w-6 h-6" />
            </button>
          )}
        </div>

        {/* Bottom Thumbnail Strip (If multiple images) */}
        {imageList.length > 1 && (
          <div className="flex items-center justify-center gap-2 mt-3 px-3 py-1.5 bg-black/40 backdrop-blur-sm rounded-2xl border border-white/10 max-w-full overflow-x-auto">
            {imageList.map((img, i) => (
              <button
                key={i}
                type="button"
                onClick={() => setCurrentIndex(i)}
                className={`relative w-10 h-10 rounded-xl overflow-hidden border-2 transition-all shrink-0 ${
                  i === currentIndex
                    ? 'border-blue-500 scale-110 shadow-md shadow-blue-500/30'
                    : 'border-white/20 opacity-60 hover:opacity-100 hover:border-white/50'
                }`}
                title={`Jump to photo ${i + 1}`}
              >
                <img src={img} alt={`Thumbnail ${i + 1}`} className="w-full h-full object-cover" />
              </button>
            ))}
          </div>
        )}

        {/* Bottom Helper Hint */}
        <div className="mt-2 text-center text-[11px] text-white/60">
          {imageList.length > 1 ? (
            <span>Use <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">←</kbd> and <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">→</kbd> to browse • Press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">Esc</kbd> to exit</span>
          ) : (
            <span>Click outside or press <kbd className="px-1.5 py-0.5 rounded bg-white/10 text-white/80 font-mono text-[10px]">Esc</kbd> to exit preview</span>
          )}
        </div>
      </div>
    </div>
  );
}

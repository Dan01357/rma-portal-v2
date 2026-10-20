import React, { useRef, useState } from 'react';
import { Camera, Upload, Trash2, Eye, AlertCircle, CheckCircle2, Zap, RefreshCw } from 'lucide-react';
import { compressImage } from '../lib/imageCompressor';

export default function DefectUploader({
  photoFile,
  photoPreview,
  compressionStats,
  onPhotoSelected,
  onPhotoRemoved,
  error
}) {
  const fileInputRef = useRef(null);
  const cameraInputRef = useRef(null);
  const [isDragging, setIsDragging] = useState(false);
  const [isCompressing, setIsCompressing] = useState(false);
  const [modalOpen, setModalOpen] = useState(false);

  const handleFileChange = (e) => {
    const file = e.target.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  const processFile = async (file) => {
    if (!file.type.startsWith('image/')) {
      alert('Please upload a valid image file (JPG, PNG, WebP).');
      return;
    }

    setIsCompressing(true);
    try {
      // Automatic client-side compression: max 1600px, 0.75 quality JPEG
      const result = await compressImage(file, {
        maxWidth: 1600,
        maxHeight: 1600,
        quality: 0.75
      });

      onPhotoSelected(result.file, result.previewUrl, {
        original: result.formattedOriginal,
        compressed: result.formattedCompressed,
        savings: result.savingsPercent,
        width: result.width,
        height: result.height
      });
    } catch (err) {
      console.error('Image compression failed, falling back to original:', err);
      // Fallback to uncompressed file
      const reader = new FileReader();
      reader.onload = (e) => {
        onPhotoSelected(file, e.target.result, null);
      };
      reader.readAsDataURL(file);
    } finally {
      setIsCompressing(false);
    }
  };

  const handleDragOver = (e) => {
    e.preventDefault();
    setIsDragging(true);
  };

  const handleDragLeave = (e) => {
    e.preventDefault();
    setIsDragging(false);
  };

  const handleDrop = (e) => {
    e.preventDefault();
    setIsDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) {
      processFile(file);
    }
  };

  return (
    <div className="w-full">
      <div className="flex items-center justify-between mb-1.5">
        <label className="block text-sm font-semibold text-slate-200">
          Mandatory Proof of Defect <span className="text-rose-500">*</span>
        </label>
        <span className="text-xs text-rose-400 font-medium flex items-center gap-1">
          <AlertCircle className="w-3.5 h-3.5" /> Required for filing
        </span>
      </div>

      {isCompressing ? (
        /* Compressing State Indicator */
        <div className="rounded-2xl border-2 border-indigo-500/40 bg-indigo-950/20 p-8 text-center flex flex-col items-center justify-center space-y-3">
          <div className="w-12 h-12 rounded-full bg-indigo-600/20 text-indigo-400 flex items-center justify-center animate-spin">
            <RefreshCw className="w-6 h-6" />
          </div>
          <div>
            <h4 className="text-sm font-bold text-white">
              Optimizing Camera Image...
            </h4>
            <p className="text-xs text-indigo-300/80 mt-0.5">
              Downscaling & compressing on device for instant upload while maintaining sharp detail.
            </p>
          </div>
        </div>
      ) : photoPreview ? (
        /* Preview Card */
        <div className="relative rounded-2xl overflow-hidden border-2 border-emerald-500/50 bg-slate-900/90 p-3 shadow-lg">
          <div className="relative aspect-video sm:aspect-[16/9] w-full rounded-xl overflow-hidden bg-black flex items-center justify-center">
            <img
              src={photoPreview}
              alt="Defect proof preview"
              className="w-full h-full object-contain cursor-pointer hover:opacity-95 transition-opacity"
              onClick={() => setModalOpen(true)}
            />

            <div className="absolute top-2 left-2 bg-emerald-600/90 text-white text-[11px] font-semibold px-2.5 py-1 rounded-full flex items-center gap-1 shadow-md backdrop-blur-sm">
              <CheckCircle2 className="w-3.5 h-3.5" /> Photo Attached
            </div>

            <div className="absolute top-2 right-2 flex gap-1.5">
              <button
                type="button"
                onClick={() => setModalOpen(true)}
                className="p-1.5 bg-slate-900/80 hover:bg-slate-900 text-white rounded-lg backdrop-blur-sm transition-all shadow"
                title="View full image"
              >
                <Eye className="w-4 h-4" />
              </button>
              <button
                type="button"
                onClick={onPhotoRemoved}
                className="p-1.5 bg-rose-600/90 hover:bg-rose-600 text-white rounded-lg shadow-md transition-all"
                title="Remove photo"
              >
                <Trash2 className="w-4 h-4" />
              </button>
            </div>
          </div>

          {/* Dynamic Compression Savings Badge */}
          {compressionStats && (
            <div className="mt-2.5 p-2 bg-emerald-950/40 border border-emerald-500/30 rounded-xl flex items-center justify-between text-xs text-emerald-300">
              <div className="flex items-center gap-1.5">
                <Zap className="w-4 h-4 text-emerald-400 shrink-0" />
                <span className="font-semibold text-[11px]">
                  Compressed: <span className="line-through text-slate-400 font-mono">{compressionStats.original}</span> ➔ <span className="text-emerald-300 font-bold font-mono">{compressionStats.compressed}</span>
                </span>
              </div>
              <span className="bg-emerald-500/20 text-emerald-300 font-bold text-[10px] px-2 py-0.5 rounded-full border border-emerald-500/30">
                {compressionStats.savings}% saved
              </span>
            </div>
          )}

          <div className="mt-2 flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="truncate max-w-[200px] text-slate-300 font-mono text-[11px]">
              {photoFile?.name || 'defect_evidence.jpg'}
            </span>
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="text-indigo-400 hover:text-indigo-300 font-medium underline text-xs"
            >
              Replace Photo
            </button>
          </div>
        </div>
      ) : (
        /* Upload Action Box */
        <div
          onDragOver={handleDragOver}
          onDragLeave={handleDragLeave}
          onDrop={handleDrop}
          className={`border-2 border-dashed rounded-2xl p-6 text-center transition-all ${
            isDragging
              ? 'border-indigo-500 bg-indigo-500/10'
              : error
              ? 'border-rose-500/60 bg-rose-500/5'
              : 'border-slate-700 hover:border-slate-600 bg-slate-900/50'
          }`}
        >
          <div className="w-14 h-14 mx-auto rounded-full bg-slate-800 text-indigo-400 flex items-center justify-center mb-3">
            <Camera className="w-7 h-7" />
          </div>

          <h4 className="text-sm font-semibold text-slate-200 mb-1">
            Capture or Upload Defect Photo
          </h4>
          <p className="text-xs text-slate-400 max-w-xs mx-auto mb-4">
            Take a clear photo showing the damage, cracked casing, or serial tag. Large smartphone camera photos are automatically optimized.
          </p>

          {/* Dual buttons for Mobile Camera & File Explorer */}
          <div className="flex flex-col sm:flex-row gap-2 justify-center max-w-xs mx-auto">
            {/* Direct Camera Capture (Mobile-optimized) */}
            <button
              type="button"
              onClick={() => cameraInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-md shadow-indigo-600/30 transition-all active:scale-95"
            >
              <Camera className="w-4 h-4" />
              <span>Take Photo</span>
            </button>

            {/* File Explorer upload */}
            <button
              type="button"
              onClick={() => fileInputRef.current?.click()}
              className="inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all active:scale-95"
            >
              <Upload className="w-4 h-4 text-slate-400" />
              <span>Choose File</span>
            </button>
          </div>

          {error && (
            <p className="mt-3 text-xs text-rose-400 font-medium flex items-center justify-center gap-1">
              <AlertCircle className="w-3.5 h-3.5" /> {error}
            </p>
          )}
        </div>
      )}

      {/* Hidden File Inputs */}
      {/* 1. Mobile Camera capture */}
      <input
        ref={cameraInputRef}
        type="file"
        accept="image/*"
        capture="environment"
        onChange={handleFileChange}
        className="hidden"
      />
      {/* 2. File picker */}
      <input
        ref={fileInputRef}
        type="file"
        accept="image/*"
        onChange={handleFileChange}
        className="hidden"
      />

      {/* Fullscreen Photo Modal */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4"
          onClick={() => setModalOpen(false)}
        >
          <div className="relative max-w-3xl max-h-[90vh] w-full flex flex-col items-center">
            <img
              src={photoPreview}
              alt="Full view defect evidence"
              className="max-h-[85vh] max-w-full rounded-xl object-contain shadow-2xl"
            />
            <button
              type="button"
              onClick={() => setModalOpen(false)}
              className="mt-3 px-4 py-1.5 bg-slate-800 hover:bg-slate-700 text-white rounded-lg text-xs font-semibold"
            >
              Close Preview
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

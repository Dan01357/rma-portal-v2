import React, { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import { Camera, RefreshCw, Upload, X, MapPin, CheckCircle2, SwitchCamera, AlertCircle } from 'lucide-react';
import { formatCameraTimestamp, getGpsCoordinatesText, getGpsAddressDisplay } from '../utils/rmaHelpers';
import { drawWatermarkOverlay, stampWatermarkOnImage, markFileWatermarked } from '../utils/cameraWatermark';

export default function CameraCaptureModal({
  isOpen,
  onClose,
  onCapture,
  title = 'Live Watermarked Camera',
  subtitle = 'Stamps live PHT timestamp & street address',
  gpsLocation = null,
  tagName = 'Staff',
  multiple = false
}) {
  const videoRef = useRef(null);
  const streamRef = useRef(null);

  const [facingMode, setFacingMode] = useState('environment');
  const [retryTick, setRetryTick] = useState(0);
  const [liveTime, setLiveTime] = useState(() => formatCameraTimestamp(new Date()));
  const [isStarting, setIsStarting] = useState(false);
  const [cameraError, setCameraError] = useState('');
  const [isCapturing, setIsCapturing] = useState(false);
  const [localGeo, setLocalGeo] = useState({
    address: gpsLocation?.address || '',
    addressParts: gpsLocation?.addressParts || null,
    addressLines: gpsLocation?.addressLines || [],
    latitude: gpsLocation?.latitude ?? null,
    longitude: gpsLocation?.longitude ?? null
  });

  // Sync passed GPS info whenever parent resolves reverse-geocoded street address
  useEffect(() => {
    setLocalGeo((prev) => ({
      address: gpsLocation?.address || prev.address || '',
      addressParts: gpsLocation?.addressParts || prev.addressParts || null,
      addressLines:
        Array.isArray(gpsLocation?.addressLines) && gpsLocation.addressLines.length > 0
          ? gpsLocation.addressLines
          : prev.addressLines,
      latitude: gpsLocation?.latitude ?? prev.latitude,
      longitude: gpsLocation?.longitude ?? prev.longitude
    }));
  }, [gpsLocation?.address, gpsLocation?.addressParts, gpsLocation?.latitude, gpsLocation?.longitude, gpsLocation?.addressLines]);

  // Live ticking Asia/Manila clock while modal is open
  useEffect(() => {
    if (!isOpen) return undefined;
    setLiveTime(formatCameraTimestamp(new Date()));
    const interval = setInterval(() => {
      setLiveTime(formatCameraTimestamp(new Date()));
    }, 1000);
    return () => clearInterval(interval);
  }, [isOpen]);

  // Resolve clear GPS street/barangay/city/ZIP if parent has not resolved it yet
  useEffect(() => {
    if (!isOpen) return undefined;
    if (localGeo.address) return undefined;
    let cancelled = false;

    const resolveAddress = async (lat, lon) => {
      try {
        const res = await fetch(`/api/v1/products/lookup?action=reverse-geocode&lat=${encodeURIComponent(lat)}&lon=${encodeURIComponent(lon)}`);
        if (!res.ok) return;
        const data = await res.json();
        if (!cancelled && data?.formatted) {
          setLocalGeo({
            address: data.formatted,
            addressParts: {
              street: data.street || '',
              barangay: data.barangay || '',
              city: data.city || '',
              region: data.region || '',
              zip: data.zip || '',
              formatted: data.formatted
            },
            addressLines: Array.isArray(data.lines) ? data.lines : [data.formatted],
            latitude: lat,
            longitude: lon
          });
        }
      } catch {}
    };

    if (localGeo.latitude != null && localGeo.longitude != null) {
      resolveAddress(localGeo.latitude, localGeo.longitude);
    } else if (typeof navigator !== 'undefined' && navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          if (pos?.coords?.accuracy <= 150) {
            resolveAddress(pos.coords.latitude, pos.coords.longitude);
          }
        },
        () => {},
        { enableHighAccuracy: true, timeout: 6000, maximumAge: 60000 }
      );
    }

    return () => {
      cancelled = true;
    };
  }, [isOpen, localGeo.address, localGeo.latitude, localGeo.longitude]);

  // Start / switch MediaDevices camera stream with progressive constraint fallbacks
  useEffect(() => {
    const stopCurrent = () => {
      if (streamRef.current) {
        streamRef.current.getTracks().forEach((t) => {
          try { t.stop(); } catch {}
        });
        streamRef.current = null;
      }
      if (videoRef.current) {
        try { videoRef.current.srcObject = null; } catch {}
      }
    };

    if (!isOpen) {
      stopCurrent();
      return undefined;
    }

    let cancelled = false;
    setIsStarting(true);
    setCameraError('');

    const openStreamWithFallback = async () => {
      const candidates = [
        {
          video: {
            facingMode: { ideal: facingMode },
            width: { ideal: 1280 },
            height: { ideal: 720 }
          },
          audio: false
        },
        { video: { facingMode }, audio: false },
        { video: true, audio: false }
      ];

      let lastErr = null;
      for (const constraints of candidates) {
        try {
          return await navigator.mediaDevices.getUserMedia(constraints);
        } catch (err) {
          lastErr = err;
          if (err?.name === 'NotAllowedError' || err?.name === 'SecurityError') {
            throw err;
          }
        }
      }
      throw lastErr || new Error('Unable to access camera stream.');
    };

    const startCamera = async () => {
      stopCurrent();
      if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
        setCameraError('Live browser camera stream unavailable on this device. Use "Choose / Native Camera" below — your photo will still receive the live timestamp & address stamp.');
        setIsStarting(false);
        return;
      }
      try {
        const stream = await openStreamWithFallback();
        if (cancelled) {
          stream.getTracks().forEach((t) => {
            try { t.stop(); } catch {}
          });
          return;
        }
        streamRef.current = stream;
        const videoEl = videoRef.current;
        if (videoEl) {
          videoEl.muted = true;
          videoEl.playsInline = true;
          videoEl.setAttribute('playsinline', '');
          videoEl.setAttribute('muted', '');
          videoEl.srcObject = stream;
          try {
            await videoEl.play();
          } catch (playErr) {
            if (playErr?.name !== 'AbortError') {
              console.warn('Camera preview play notice:', playErr);
            }
          }
        }
        if (!cancelled) {
          setIsStarting(false);
        }
      } catch (err) {
        if (!cancelled) {
          setCameraError(
            err?.name === 'NotAllowedError'
              ? 'Camera permission denied. Allow browser camera access or use "Select Image (Auto-Stamped)" below (watermark stamp still applies).'
              : 'Live viewfinder unavailable on this device/camera. Use "Select Image (Auto-Stamped)" below (watermark stamp still applies).'
          );
          setIsStarting(false);
        }
      }
    };

    startCamera();

    return () => {
      cancelled = true;
      stopCurrent();
    };
  }, [isOpen, facingMode, retryTick]);

  if (!isOpen) return null;

  const coordFallback = getGpsCoordinatesText(localGeo);
  const fullDisplayAddr = getGpsAddressDisplay(localGeo);
  const resolvedAddressText = fullDisplayAddr || (coordFallback ? `Coords: ${coordFallback}` : 'GPS: Location not captured');
  const resolvedTag = String(tagName || 'Staff').trim();

  const handleCaptureSnap = async () => {
    const video = videoRef.current;
    if (!video || !video.videoWidth || !video.videoHeight || isCapturing) return;
    setIsCapturing(true);
    try {
      const srcW = video.videoWidth;
      const srcH = video.videoHeight;
      const maxDim = Math.max(srcW, srcH);
      const scale = maxDim > 1600 ? 1600 / maxDim : 1;
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(srcW * scale);
      canvas.height = Math.round(srcH * scale);
      const ctx = canvas.getContext('2d');
      ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

      drawWatermarkOverlay(ctx, canvas.width, canvas.height, {
        timestampText: formatCameraTimestamp(new Date()),
        addressText: resolvedAddressText,
        addressLines: localGeo.addressLines,
        tagText: resolvedTag
      });

      const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9));
      if (blob && onCapture) {
        const file = new File([blob], `camera-capture-${Date.now()}.jpg`, {
          type: 'image/jpeg',
          lastModified: Date.now()
        });
        markFileWatermarked(file);
        await onCapture([file]);
      }
    } catch (err) {
      setCameraError(err?.message || 'Could not capture photo frame.');
    } finally {
      setIsCapturing(false);
    }
  };

  const handleFallbackFiles = async (e) => {
    const files = Array.from(e.target.files || []).filter(Boolean);
    if (e.target) e.target.value = '';
    if (files.length === 0 || !onCapture) return;
    setIsCapturing(true);
    try {
      const stamped = [];
      for (const file of files) {
        stamped.push(await stampWatermarkOnImage(file, {
          timestampText: formatCameraTimestamp(new Date()),
          addressText: resolvedAddressText,
          addressLines: localGeo.addressLines,
          tagText: resolvedTag
        }));
      }
      await onCapture(stamped);
    } finally {
      setIsCapturing(false);
    }
  };

  const modalContent = (
    <div
      data-testid="camera-capture-modal"
      className="fixed inset-0 z-[200] bg-slate-950/90 backdrop-blur-xs flex items-center justify-center p-2 sm:p-4 animate-in fade-in"
      role="dialog"
      aria-modal="true"
      aria-label={title}
    >
      <div className="bg-slate-900 text-white border border-slate-700 rounded-3xl w-full max-w-xl overflow-hidden shadow-2xl flex flex-col max-h-[94dvh]">
        {/* Header */}
        <div className="px-4 py-3 border-b border-slate-800 flex items-center justify-between gap-2">
          <div className="min-w-0">
            <h3 className="text-sm font-black text-white flex items-center gap-1.5 truncate">
              <Camera className="w-4 h-4 text-emerald-400 shrink-0" />
              <span>{title}</span>
            </h3>
            <p className="text-[11px] text-slate-400 truncate">{subtitle}</p>
          </div>
          <div className="flex items-center gap-1.5 shrink-0">
            <button
              type="button"
              onClick={() => setFacingMode((prev) => (prev === 'environment' ? 'user' : 'environment'))}
              className="px-2.5 py-1.5 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 text-[11px] font-bold flex items-center gap-1 cursor-pointer border border-slate-700"
              title="Switch Front / Back Camera"
            >
              <SwitchCamera className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">{facingMode === 'environment' ? 'Back Cam' : 'Front Cam'}</span>
            </button>
            <button
              type="button"
              onClick={onClose}
              className="p-1.5 rounded-xl bg-slate-800 hover:bg-rose-600 text-slate-300 hover:text-white cursor-pointer"
              aria-label="Close Camera Modal"
            >
              <X className="w-4 h-4" />
            </button>
          </div>
        </div>

        {/* Viewfinder */}
        <div className="relative bg-black w-full flex-1 min-h-[300px] sm:min-h-[340px] max-h-[64dvh] flex items-center justify-center overflow-hidden">
          <video
            ref={videoRef}
            autoPlay
            playsInline
            muted
            className={cameraError ? 'hidden' : 'w-full h-full object-cover'}
          />
          {cameraError && (
            <div className="p-6 text-center max-w-sm space-y-3">
              <AlertCircle className="w-8 h-8 text-amber-400 mx-auto" />
              <p className="text-xs text-slate-200 leading-relaxed">{cameraError}</p>
              <div className="flex flex-wrap items-center justify-center gap-2">
                <button
                  type="button"
                  onClick={() => setRetryTick((prev) => prev + 1)}
                  className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-slate-700 hover:bg-slate-600 text-white text-xs font-bold cursor-pointer shadow-md"
                >
                  Retry Camera
                </button>
                <label className="inline-flex items-center justify-center gap-1.5 px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-black cursor-pointer shadow-md">
                  <Upload className="w-3.5 h-3.5" />
                  <span>Select Image (Auto-Stamped)</span>
                  <input
                    type="file"
                    accept="image/*"
                    multiple={multiple}
                    onChange={handleFallbackFiles}
                    className="hidden"
                  />
                </label>
              </div>
            </div>
          )}

          {isStarting && !cameraError && (
            <div className="absolute inset-0 bg-slate-950/70 flex items-center justify-center gap-2 text-xs font-bold text-slate-200">
              <RefreshCw className="w-4 h-4 animate-spin text-emerald-400" />
              <span>Starting camera...</span>
            </div>
          )}

          {/* Live HUD Corner Preview (Mirrors Final Watermark) */}
          <div
            data-testid="camera-watermark-hud"
            className="absolute bottom-3 left-3 max-w-[88%] sm:max-w-[74%] px-3 py-2 rounded-xl bg-slate-950/75 border border-white/20 text-left space-y-0.5 pointer-events-none shadow-lg"
          >
            <div className="text-[11px] font-black text-white font-mono tracking-tight">
              {liveTime}
            </div>
            <div className="text-[10.5px] font-semibold text-slate-200 flex items-start gap-1 leading-snug">
              <MapPin className="w-3 h-3 text-emerald-400 shrink-0 mt-0.5" />
              <span>{resolvedAddressText}</span>
            </div>
            {resolvedTag && (
              <div className="text-[10px] font-extrabold text-amber-300">
                {resolvedTag.startsWith('#') ? resolvedTag : `#${resolvedTag}`}
              </div>
            )}
          </div>
        </div>

        {/* Footer Controls */}
        <div className="p-3.5 border-t border-slate-800 bg-slate-900 flex flex-wrap items-center justify-between gap-2">
          {cameraError ? (
            <label className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 border border-slate-700 text-xs font-bold text-slate-200 flex items-center gap-1.5 cursor-pointer">
              <Upload className="w-3.5 h-3.5 text-sky-400" />
              <span>Fallback Photo (Auto-Stamped)</span>
              <input
                type="file"
                accept="image/*"
                multiple={multiple}
                onChange={handleFallbackFiles}
                className="hidden"
              />
            </label>
          ) : (
            <span className="text-[11px] font-semibold text-slate-400 hidden sm:inline">
              Live watermarked viewfinder active
            </span>
          )}

          <div className="flex items-center gap-2 ml-auto">
            <button
              type="button"
              onClick={onClose}
              className="px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-xs font-bold text-slate-300 cursor-pointer"
            >
              Done
            </button>
            {!cameraError && (
              <button
                type="button"
                disabled={isStarting || isCapturing}
                onClick={handleCaptureSnap}
                className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-500 disabled:opacity-50 text-white text-xs font-black flex items-center gap-1.5 cursor-pointer shadow-lg shadow-emerald-600/25"
              >
                {isCapturing ? <RefreshCw className="w-4 h-4 animate-spin" /> : <CheckCircle2 className="w-4 h-4" />}
                <span>{isCapturing ? 'Stamping...' : 'Capture Photo'}</span>
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );

  return typeof document !== 'undefined' ? createPortal(modalContent, document.body) : modalContent;
}

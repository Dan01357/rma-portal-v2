import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, RefreshCw, Zap, AlertCircle, Sparkles } from 'lucide-react';
import { playBeep } from '../utils/rmaHelpers';

export default function ScannerModal({ isOpen, onClose, onScanSuccess, catalog = [] }) {
  const [errorMsg, setErrorMsg] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const html5QrCodeRef = useRef(null);

  useEffect(() => {
    if (!isOpen) {
      stopScanner();
      return;
    }

    // Discover cameras
    Html5Qrcode.getCameras()
      .then(devices => {
        if (devices && devices.length > 0) {
          setCameras(devices);
          // Prefer back/environment camera
          const backCam = devices.find(d => 
            d.label.toLowerCase().includes('back') || 
            d.label.toLowerCase().includes('rear') ||
            d.label.toLowerCase().includes('environment')
          );
          const chosen = backCam ? backCam.id : devices[0].id;
          setActiveCameraId(chosen);
          startScanner(chosen);
        } else {
          setErrorMsg('No camera hardware detected on this device. You can use the quick simulation barcodes below.');
        }
      })
      .catch(err => {
        console.warn('Camera discovery error:', err);
        setErrorMsg('Camera access was not granted or is blocked by browser permissions. You can use manual entry or simulation barcodes.');
      });

    return () => {
      stopScanner();
    };
  }, [isOpen]);

  const startScanner = async (cameraId) => {
    try {
      setErrorMsg(null);
      if (html5QrCodeRef.current) {
        await stopScanner();
      }

      const html5QrCode = new Html5Qrcode('camera-reader-viewport');
      html5QrCodeRef.current = html5QrCode;

      const config = {
        fps: 15,
        qrbox: { width: 280, height: 280 },
        aspectRatio: 1.0,
      };

      await html5QrCode.start(
        cameraId,
        config,
        (decodedText) => {
          playBeep('success');
          onScanSuccess(decodedText);
          onClose();
        },
        (errorMessage) => {
          // Standard scanning frame error (no barcode in view), ignore to avoid log flooding
        }
      );

      setIsScanning(true);
    } catch (err) {
      console.warn('Start scanner error:', err);
      setErrorMsg('Unable to start camera stream. Ensure camera permissions are allowed in your browser.');
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    if (html5QrCodeRef.current) {
      try {
        if (html5QrCodeRef.current.isScanning) {
          await html5QrCodeRef.current.stop();
        }
        await html5QrCodeRef.current.clear();
      } catch (e) {
        console.debug('Scanner stop error:', e);
      }
      html5QrCodeRef.current = null;
    }
    setIsScanning(false);
  };

  const switchCamera = () => {
    if (cameras.length <= 1) return;
    const currentIndex = cameras.findIndex(c => c.id === activeCameraId);
    const nextIndex = (currentIndex + 1) % cameras.length;
    const nextCamera = cameras[nextIndex];
    setActiveCameraId(nextCamera.id);
    startScanner(nextCamera.id);
  };

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-slate-950/80 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-slate-900 border border-slate-700/80 rounded-2xl shadow-2xl overflow-hidden flex flex-col max-h-[92vh]">
        
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-800 bg-slate-900/90">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-lg bg-brand-500/10 text-brand-400 border border-brand-500/20">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-semibold text-slate-100 text-base">In-Browser Camera Scanner</h3>
              <p className="text-xs text-slate-400">Scan box barcode or return QR code</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs flex items-center space-x-1 border border-slate-700 transition-colors"
                title="Switch Camera"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline">Flip</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="p-2 rounded-lg bg-slate-800/80 hover:bg-slate-700 text-slate-400 hover:text-white transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewfinder Area */}
        <div className="p-4 flex-1 flex flex-col items-center justify-center bg-slate-950 relative overflow-hidden">
          <div className="relative w-full max-w-xs aspect-square rounded-xl overflow-hidden border-2 border-brand-500/40 bg-black flex items-center justify-center shadow-inner">
            <div id="camera-reader-viewport" className="w-full h-full object-cover"></div>
            
            {/* Visual targeting overlay */}
            <div className="absolute inset-4 pointer-events-none border border-brand-400/30 rounded-lg flex flex-col justify-between p-2">
              <div className="flex justify-between">
                <span className="w-4 h-4 border-t-2 border-l-2 border-brand-400"></span>
                <span className="w-4 h-4 border-t-2 border-r-2 border-brand-400"></span>
              </div>
              <div className="relative w-full">
                <div className="w-full h-0.5 bg-brand-400 shadow-[0_0_12px_#38bdf8] scanner-laser"></div>
              </div>
              <div className="flex justify-between">
                <span className="w-4 h-4 border-b-2 border-l-2 border-brand-400"></span>
                <span className="w-4 h-4 border-b-2 border-r-2 border-brand-400"></span>
              </div>
            </div>

            {/* Error or waiting state */}
            {errorMsg && (
              <div className="absolute inset-0 bg-slate-900/90 p-4 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
                <p className="text-xs text-slate-300 leading-relaxed">{errorMsg}</p>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center space-x-2 text-xs text-slate-400">
            <Zap className="w-3.5 h-3.5 text-brand-400" />
            <span>Align barcode within the target box</span>
          </div>
        </div>

        {/* Quick Simulation Bar for Repackers & Laptop Testing */}
        <div className="p-4 border-t border-slate-800 bg-slate-900/60">
          <div className="flex items-center justify-between mb-2">
            <span className="text-xs font-medium text-slate-400 uppercase tracking-wider flex items-center gap-1.5">
              <Sparkles className="w-3.5 h-3.5 text-amber-400" />
              Quick Warehouse Simulation Barcodes
            </span>
            <span className="text-[11px] text-slate-500">Tap to test scan</span>
          </div>

          <div className="grid grid-cols-2 gap-2 max-h-36 overflow-y-auto pr-1">
            {catalog.slice(0, 6).map((prod) => (
              <button
                key={prod.barcode}
                type="button"
                onClick={() => {
                  playBeep('success');
                  onScanSuccess(prod.barcode);
                  onClose();
                }}
                className="p-2 text-left bg-slate-800/80 hover:bg-brand-900/30 hover:border-brand-500/50 border border-slate-700/70 rounded-lg transition-all group"
              >
                <div className="text-[11px] font-semibold text-slate-200 group-hover:text-brand-300 truncate">
                  {prod.name}
                </div>
                <div className="flex items-center justify-between mt-1 text-[10px] text-slate-400 font-mono">
                  <span>{prod.barcode}</span>
                  <span className="text-slate-500">{prod.sku}</span>
                </div>
              </button>
            ))}
          </div>
        </div>

      </div>
    </div>
  );
}

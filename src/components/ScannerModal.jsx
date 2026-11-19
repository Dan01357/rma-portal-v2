import React, { useEffect, useRef, useState } from 'react';
import { Html5Qrcode } from 'html5-qrcode';
import { Camera, X, RefreshCw, Zap, AlertCircle, QrCode, ArrowRight } from 'lucide-react';
import { playBeep } from '../utils/rmaHelpers';

export default function ScannerModal({ isOpen, onClose, onScanSuccess, catalog = [] }) {
  const [errorMsg, setErrorMsg] = useState(null);
  const [isScanning, setIsScanning] = useState(false);
  const [cameras, setCameras] = useState([]);
  const [activeCameraId, setActiveCameraId] = useState(null);
  const [manualCodeInput, setManualCodeInput] = useState('');
  const html5QrCodeRef = useRef(null);
  const isOpenRef = useRef(isOpen);
  const scanHandledRef = useRef(false);
  const onScanSuccessRef = useRef(onScanSuccess);
  const onCloseRef = useRef(onClose);

  isOpenRef.current = isOpen;
  onScanSuccessRef.current = onScanSuccess;
  onCloseRef.current = onClose;

  const triggerDecodedScan = async (rawText) => {
    const clean = String(rawText || '').trim();
    if (!clean || scanHandledRef.current) return;
    scanHandledRef.current = true;
    playBeep('success');
    await stopScanner();
    if (onCloseRef.current) onCloseRef.current();
    if (onScanSuccessRef.current) {
      try {
        await onScanSuccessRef.current(clean);
      } catch (err) {
        console.error('QR scan handler error:', err);
      }
    }
  };

  useEffect(() => {
    let isCancelled = false;

    if (!isOpen) {
      scanHandledRef.current = false;
      stopScanner();
      return () => {
        isCancelled = true;
      };
    }

    scanHandledRef.current = false;
    setManualCodeInput('');
    setErrorMsg(null);

    // Discover cameras
    Html5Qrcode.getCameras()
      .then(devices => {
        if (isCancelled || !isOpenRef.current) return;
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
          startScanner(chosen, () => isCancelled || !isOpenRef.current);
        } else {
          setErrorMsg('No camera hardware detected on this device. You can paste a QR payload or enter a barcode/RMA below.');
        }
      })
      .catch(err => {
        if (isCancelled || !isOpenRef.current) return;
        console.warn('Camera discovery error:', err);
        setErrorMsg('Camera access was not granted or is blocked by browser permissions. You can paste a QR payload or enter a barcode/RMA below.');
      });

    return () => {
      isCancelled = true;
      stopScanner();
    };
  }, [isOpen]);

  const startScanner = async (cameraId, shouldAbort = () => false) => {
    try {
      setErrorMsg(null);
      if (html5QrCodeRef.current) {
        await stopScanner();
      }
      if (shouldAbort() || !document.getElementById('camera-reader-viewport')) return;

      const html5QrCode = new Html5Qrcode('camera-reader-viewport');
      html5QrCodeRef.current = html5QrCode;

      const config = {
        fps: 15,
        qrbox: { width: 260, height: 260 },
        aspectRatio: 1.0,
      };

      await html5QrCode.start(
        cameraId,
        config,
        (decodedText) => {
          triggerDecodedScan(decodedText);
        },
        () => {
          // Frame error, ignore
        }
      );

      if (shouldAbort()) {
        await stopScanner();
        return;
      }

      setIsScanning(true);
    } catch (err) {
      console.warn('Start scanner error:', err);
      setErrorMsg('Unable to start camera stream. You can still scan or paste a QR payload or RMA code below.');
      setIsScanning(false);
    }
  };

  const stopScanner = async () => {
    const instance = html5QrCodeRef.current;
    html5QrCodeRef.current = null;
    if (instance) {
      try {
        if (instance.isScanning) {
          await instance.stop();
        }
        await instance.clear();
      } catch (e) {
        console.debug('Scanner stop error:', e);
      }
    }
    setIsScanning(false);
  };

  const handleManualScanSubmit = async (e) => {
    e.preventDefault();
    if (!manualCodeInput.trim()) return;
    await triggerDecodedScan(manualCodeInput);
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
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center p-0 sm:p-4 bg-slate-950/75 backdrop-blur-sm animate-in fade-in duration-200">
      <div className="relative w-full max-w-lg bg-white dark:bg-slate-900 border-t sm:border border-slate-200 dark:border-slate-800 rounded-t-3xl sm:rounded-3xl shadow-2xl overflow-hidden flex flex-col max-h-[92dvh] pb-safe">
        
        {/* Mobile bottom-sheet drag handle */}
        <div className="sm:hidden pt-2.5 pb-1 flex justify-center shrink-0">
          <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-slate-700"></div>
        </div>

        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3.5 border-b border-slate-100 dark:border-slate-800 bg-white dark:bg-slate-900 shrink-0">
          <div className="flex items-center space-x-3">
            <div className="p-2 rounded-xl bg-brand-50 dark:bg-brand-500/10 text-brand-600 dark:text-brand-400 border border-brand-200 dark:border-brand-500/20">
              <Camera className="w-5 h-5" />
            </div>
            <div>
              <h3 className="font-bold text-slate-900 dark:text-white text-base">Product &amp; RMA QR Scanner</h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">Scan product barcode or internal Pingcon RMA sticker QR</p>
            </div>
          </div>

          <div className="flex items-center space-x-2">
            {cameras.length > 1 && (
              <button
                type="button"
                onClick={switchCamera}
                className="min-h-[44px] px-3 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs flex items-center space-x-1.5 border border-slate-200 dark:border-slate-700 transition-colors"
                title="Switch Camera"
              >
                <RefreshCw className="w-4 h-4" />
                <span className="hidden sm:inline">Flip</span>
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              className="min-w-[44px] min-h-[44px] flex items-center justify-center rounded-xl text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-slate-800 transition-colors"
              aria-label="Close scanner"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Viewfinder Area */}
        <div className="p-4 flex-1 flex flex-col items-center justify-center bg-slate-950 relative overflow-hidden">
          <div className="relative w-full max-w-xs aspect-square rounded-2xl overflow-hidden border-2 border-brand-500/40 bg-black flex items-center justify-center shadow-inner">
            <div id="camera-reader-viewport" className="w-full h-full object-cover"></div>
            
            {/* Visual targeting overlay */}
            <div className="absolute inset-4 pointer-events-none border border-brand-400/30 rounded-xl flex flex-col justify-between p-2">
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
              <div className="absolute inset-0 bg-slate-900/95 p-4 flex flex-col items-center justify-center text-center">
                <AlertCircle className="w-8 h-8 text-amber-400 mb-2" />
                <p className="text-xs text-slate-200 leading-relaxed">{errorMsg}</p>
              </div>
            )}
          </div>

          <div className="mt-3 flex items-center space-x-2 text-xs text-slate-400">
            <Zap className="w-3.5 h-3.5 text-brand-400" />
            <span>Align barcode within the target box</span>
          </div>

          {/* USB / Handheld Scanner or Manual QR Payload Entry */}
          <form onSubmit={handleManualScanSubmit} className="mt-3 w-full max-w-sm flex items-center gap-2">
            <div className="relative flex-1">
              <QrCode className="w-3.5 h-3.5 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="text"
                value={manualCodeInput}
                onChange={(e) => setManualCodeInput(e.target.value)}
                placeholder="USB scanner / paste QR payload or RMA #..."
                aria-label="Manual QR or barcode input"
                className="w-full pl-8 pr-3 py-2 rounded-xl bg-slate-900 border border-slate-700 text-xs font-mono text-white placeholder-slate-400 focus:outline-none focus:border-brand-400"
              />
            </div>
            <button
              type="submit"
              disabled={!manualCodeInput.trim()}
              className="px-3 py-2 rounded-xl bg-brand-600 hover:bg-brand-500 disabled:opacity-40 text-white text-xs font-bold flex items-center gap-1 shrink-0 transition-colors cursor-pointer"
            >
              <span>Process</span>
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
          </form>
        </div>

      </div>
    </div>
  );
}

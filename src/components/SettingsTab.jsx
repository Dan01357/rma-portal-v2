import React, { useState, useEffect } from 'react';
import { 
  Settings, 
  ToggleLeft, 
  ToggleRight, 
  Database, 
  Mail, 
  RefreshCw, 
  CheckCircle2, 
  AlertCircle,
  QrCode,
  Users,
  Plus,
  Trash2,
  Save,
  RotateCcw,
  Check,
  AtSign,
  Shield,
  KeyRound,
  ExternalLink,
  MapPin,
  FileSpreadsheet,
  Send,
  Clock,
  FlaskConical,
  BookOpen,
  X,
  Zap,
  Timer
} from 'lucide-react';
import { rmaApi, supabase } from '../supabaseClient';
import {
  applyEmailTestMode,
  getWarehouseLocations,
  DEFAULT_KNOWN_GPS_LOCATIONS,
  formatGpsAddressParts,
  getGpsMapUrl,
  formatDateTimeYmdHm
} from '../utils/rmaHelpers';
import {
  formatTime12hFromHhmm,
  formatDurationCompact,
  normalizeTestStepIntervalSeconds
} from '../utils/followUpWorkflow';
import { notificationService, EMAIL_PROFILE_TYPES } from '../services/notificationService';
import { purchaseOrdersApi } from '../services/purchaseOrdersApi';
import ApiKeysManagementSection from './ApiKeysManagementSection';
import WarehouseLocationsModal from './WarehouseLocationsModal';
import EmailRecipientsEditor from './EmailRecipientsEditor';
import SupplierDirectoryModal from './SupplierDirectoryModal';

export default function SettingsTab({ 
  isTestMode, 
  onToggleTestMode,
  onOpenPortalQr,
  currentUser,
  viewMode = 'settings',
  initialSubTab = 'emails',
  onNavigateTab = null
}) {
  const [activeSettingsSubTab, setActiveSettingsSubTab] = useState(initialSubTab || 'emails');
  useEffect(() => {
    if (initialSubTab) setActiveSettingsSubTab(initialSubTab);
  }, [initialSubTab]);
  const [connectionStatus, setConnectionStatus] = useState({
    loading: false,
    checked: false,
    connected: false,
    message: ''
  });

  const [smtpStatus, setSmtpStatus] = useState({
    loading: false,
    checked: false,
    success: false,
    message: '',
    diagnostic: '',
    passLength: null,
    hadSpaces: false
  });

  const [replySyncDiagnostics, setReplySyncDiagnostics] = useState({
    loading: false,
    runningSync: false,
    statusSummary: null,
    logs: [],
    processedMessageIdCount: 0,
    error: ''
  });

  const [dailyMatrixStatus, setDailyMatrixStatus] = useState({
    loading: false,
    done: false,
    success: false,
    message: '',
    detail: ''
  });

  // Per-Email Recipient Manager Active Type & Scope (Live vs Test) + Matrix Config State
  const [activeEmailProfileType, setActiveEmailProfileType] = useState('new_rma');
  const [recipientScopeIsTest, setRecipientScopeIsTest] = useState(() => Boolean(isTestMode));
  const [syncMatrixFeedback, setSyncMatrixFeedback] = useState('');
  const [testGlobalRecipients, setTestGlobalRecipients] = useState(() => notificationService.getEmailSettings(true));
  const [newTestToInput, setNewTestToInput] = useState('');
  const [newTestCcInput, setNewTestCcInput] = useState('');
  const [isSavingTestGlobal, setIsSavingTestGlobal] = useState(false);
  const [testGlobalFeedback, setTestGlobalFeedback] = useState(null);
  const [matrixConfig, setMatrixConfig] = useState(() => notificationService.getDailyMatrixConfig());
  const [isSavingMatrixConfig, setIsSavingMatrixConfig] = useState(false);
  const [matrixConfigFeedback, setMatrixConfigFeedback] = useState(null);

  // Known Warehouse / Dock GPS Anchors State
  const [knownGpsAnchors, setKnownGpsAnchors] = useState(() => {
    try {
      const raw = localStorage.getItem('rma_portal_known_gps_locations');
      const parsed = raw ? JSON.parse(raw) : null;
      if (Array.isArray(parsed) && parsed.length > 0) return parsed;
    } catch {}
    return DEFAULT_KNOWN_GPS_LOCATIONS;
  });
  const [isSavingGpsAnchors, setIsSavingGpsAnchors] = useState(false);
  const [gpsAnchorsFeedback, setGpsAnchorsFeedback] = useState(null);

  const [testSandboxEmail, setTestSandboxEmail] = useState(() => notificationService.getTestSandboxEmail());
  const [sandboxEmailInput, setSandboxEmailInput] = useState(() => notificationService.getTestSandboxEmail());
  const [isSavingSandboxEmail, setIsSavingSandboxEmail] = useState(false);
  const [sandboxEmailFeedback, setSandboxEmailFeedback] = useState(null);

  const [followUpConfig, setFollowUpConfig] = useState(() => notificationService.getDailyFollowUpConfig());
  const followUpDirtyRef = React.useRef(false);
  const [isSavingFollowUpConfig, setIsSavingFollowUpConfig] = useState(false);
  const [followUpConfigFeedback, setFollowUpConfigFeedback] = useState(null);
  const [isDirectoryOpen, setIsDirectoryOpen] = useState(false);

  // Super Admin Configurable RMA Email Recipients State
  const [mainRecipient, setMainRecipient] = useState('azgodev@gmail.com');
  const [ccRecipients, setCcRecipients] = useState([
    'mgan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'azgan@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com'
  ]);
  const [newCcInput, setNewCcInput] = useState('');
  const [isSavingRecipients, setIsSavingRecipients] = useState(false);
  const [recipientFeedback, setRecipientFeedback] = useState(null);

  // Live Product Catalog API State
  const [poApiKey, setPoApiKey] = useState(() => purchaseOrdersApi.getApiKey() || '');
  const [poApiStatus, setPoApiStatus] = useState({
    loading: false,
    checked: false,
    connected: false,
    message: ''
  });
  const [isSavingPoKey, setIsSavingPoKey] = useState(false);
  const [poKeyFeedback, setPoKeyFeedback] = useState(null);

  // Warehouse Locations Management State
  const [isLocationsModalOpen, setIsLocationsModalOpen] = useState(false);
  const [locationsList, setLocationsList] = useState(() => getWarehouseLocations());

  const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || 'https://lschluviltzsknptwgrz.supabase.co';
  const supabaseKey = import.meta.env.VITE_SUPABASE_ANON_KEY || 'sb_publishable_Jrv9ZNgGXJ4PZoNWCJSHxQ_7hZtQqd3';

  useEffect(() => {
    const handleLocs = () => setLocationsList(getWarehouseLocations());
    window.addEventListener('rma-locations-changed', handleLocs);
    return () => window.removeEventListener('rma-locations-changed', handleLocs);
  }, []);

  useEffect(() => {
    handleCheckConnection();
    handleCheckPoApi();

    // Auto-sync Catalog API key from/to Supabase cloud for seamless mobile/desktop sharing
    purchaseOrdersApi.loadApiKeyFromCloud().then(cloudKey => {
      if (cloudKey) {
        setPoApiKey(cloudKey);
        handleCheckPoApi();
      } else {
        const localKey = purchaseOrdersApi.getApiKey();
        if (localKey && localKey !== 'pk_live_po_cloud_db_2026_dev_key') {
          purchaseOrdersApi.setApiKey(localKey);
        }
      }
    });

    // 1. Load active email recipient settings & matrix config
    const active = notificationService.getEmailSettings();
    if (active?.toEmail) setMainRecipient(active.toEmail);
    if (Array.isArray(active?.baseCcList)) setCcRecipients(active.baseCcList);
    setMatrixConfig(notificationService.getDailyMatrixConfig());
    setFollowUpConfig(notificationService.getDailyFollowUpConfig());
    const initialSandbox = notificationService.getTestSandboxEmail();
    setTestSandboxEmail(initialSandbox);
    setSandboxEmailInput(initialSandbox);
    setTestGlobalRecipients(notificationService.getEmailSettings(true));

    // 2. Load global + per-type profiles + matrix config from Supabase rma_settings
    notificationService.loadAllEmailProfilesFromDb().then(({ globalSettings, testSettings, dailyMatrixConfig, dailyFollowUpConfig, testSandboxEmail: dbSandbox }) => {
      if (globalSettings?.toEmail) setMainRecipient(globalSettings.toEmail);
      if (Array.isArray(globalSettings?.baseCcList)) setCcRecipients(globalSettings.baseCcList);
      if (testSettings) setTestGlobalRecipients(testSettings);
      if (dailyMatrixConfig) setMatrixConfig(dailyMatrixConfig);
      if (dailyFollowUpConfig && !followUpDirtyRef.current) setFollowUpConfig(dailyFollowUpConfig);
      if (dbSandbox) {
        setTestSandboxEmail(dbSandbox);
        setSandboxEmailInput(dbSandbox);
      }
    });

    // 2b. Load Known Warehouse / Dock GPS Anchors from Supabase rma_settings
    (async () => {
      try {
        const { data, error } = await supabase
          .from('rma_settings')
          .select('value')
          .eq('key', 'known_gps_locations')
          .maybeSingle();
        if (!error && data && data.value != null) {
          let parsed = data.value;
          if (typeof parsed === 'string') {
            try { parsed = JSON.parse(parsed); } catch { parsed = null; }
          }
          if (Array.isArray(parsed) && parsed.length > 0) {
            setKnownGpsAnchors(parsed);
            try { localStorage.setItem('rma_portal_known_gps_locations', JSON.stringify(parsed)); } catch {}
          }
        }
      } catch {}
    })();

    const handleSyncRecipients = (evt) => {
      if (evt?.type === 'storage') {
        const storageKey = String(evt?.key || '');
        if (!storageKey) return; // Ignore synthetic new Event('storage'); handled via granular rma-settings-changed
        if (storageKey === 'rma_portal_email_recipients') {
          const updated = notificationService.getEmailSettings(false);
          if (updated?.toEmail) setMainRecipient(updated.toEmail);
          if (Array.isArray(updated?.baseCcList)) setCcRecipients(updated.baseCcList);
        } else if (storageKey === 'rma_portal_test_email_recipients' || storageKey === 'rma_portal_test_sandbox_email') {
          setTestGlobalRecipients(notificationService.getEmailSettings(true));
          if (storageKey === 'rma_portal_test_sandbox_email') {
            const curSandbox = notificationService.getTestSandboxEmail();
            setTestSandboxEmail(curSandbox);
            setSandboxEmailInput(curSandbox);
          }
        } else if (storageKey === 'rma_portal_daily_matrix_config') {
          setMatrixConfig(notificationService.getDailyMatrixConfig());
        } else if (storageKey === 'rma_portal_daily_followup_config') {
          setFollowUpConfig(notificationService.getDailyFollowUpConfig());
        }
        return;
      }
      const detail = evt?.detail && typeof evt.detail === 'object' ? evt.detail : null;
      const syncAll = !detail || Boolean(detail.loadedFromDb);
      if (syncAll || detail.toEmail || detail.baseCcList || detail.settings) {
        const updated = notificationService.getEmailSettings(false);
        if (updated?.toEmail) setMainRecipient(updated.toEmail);
        if (Array.isArray(updated?.baseCcList)) setCcRecipients(updated.baseCcList);
      }
      if (syncAll || detail.testSettings || detail.testSandboxEmail) {
        setTestGlobalRecipients(notificationService.getEmailSettings(true));
      }
      if (syncAll || detail.dailyMatrixConfig) {
        setMatrixConfig(notificationService.getDailyMatrixConfig());
      }
      if ((syncAll || detail.dailyFollowUpConfig) && !followUpDirtyRef.current) {
        setFollowUpConfig(notificationService.getDailyFollowUpConfig());
      }
      if (syncAll || detail.testSandboxEmail) {
        const curSandbox = notificationService.getTestSandboxEmail();
        setTestSandboxEmail(curSandbox);
        setSandboxEmailInput(curSandbox);
      }
    };

    window.addEventListener('rma-settings-changed', handleSyncRecipients);
    window.addEventListener('storage', handleSyncRecipients);
    const handleReplySyncUpdated = () => {
      loadReplySyncLogs(false);
    };
    window.addEventListener('rma-reply-sync-updated', handleReplySyncUpdated);
    loadReplySyncLogs(true);
    return () => {
      window.removeEventListener('rma-settings-changed', handleSyncRecipients);
      window.removeEventListener('rma-reply-sync-updated', handleReplySyncUpdated);
      window.removeEventListener('storage', handleSyncRecipients);
    };
  }, []);

  useEffect(() => {
    setRecipientScopeIsTest(Boolean(isTestMode));
  }, [isTestMode]);

  const handleAddGpsAnchor = () => {
    setGpsAnchorsFeedback(null);
    setKnownGpsAnchors((prev) => [
      ...prev,
      {
        name: '',
        street: '',
        barangay: '',
        city: '',
        region: 'Metro Manila',
        zip: '',
        formatted: '',
        lat: '',
        lon: '',
        radiusMeters: 250
      }
    ]);
  };

  const handleUpdateGpsAnchor = (idx, field, val) => {
    setGpsAnchorsFeedback(null);
    setKnownGpsAnchors((prev) =>
      prev.map((item, i) => {
        if (i !== idx) return item;
        const next = { ...item, [field]: val };
        if (['street', 'barangay', 'city', 'region', 'zip'].includes(field)) {
          next.formatted = formatGpsAddressParts({
            street: next.street,
            barangay: next.barangay,
            city: next.city,
            region: next.region,
            zip: next.zip
          });
        }
        return next;
      })
    );
  };

  const handleRemoveGpsAnchor = (idx) => {
    setGpsAnchorsFeedback(null);
    setKnownGpsAnchors((prev) => prev.filter((_, i) => i !== idx));
  };

  const handleResetDefaultGpsAnchors = () => {
    setGpsAnchorsFeedback(null);
    setKnownGpsAnchors(DEFAULT_KNOWN_GPS_LOCATIONS.map((a) => ({ ...a })));
  };

  const handleCaptureCurrentGpsForAnchor = (idx) => {
    if (typeof navigator === 'undefined' || !navigator.geolocation) {
      setGpsAnchorsFeedback({ type: 'error', message: 'Geolocation is not available in this browser.' });
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = Number(pos.coords.latitude.toFixed(6));
        const lon = Number(pos.coords.longitude.toFixed(6));
        setKnownGpsAnchors((prev) =>
          prev.map((item, i) => (i === idx ? { ...item, lat, lon } : item))
        );
        setGpsAnchorsFeedback({
          type: 'success',
          message: `Captured current GPS coordinates (${lat}, ${lon}, ±${Math.round(pos.coords.accuracy)}m) into anchor #${idx + 1}.`
        });
      },
      (err) => {
        setGpsAnchorsFeedback({
          type: 'error',
          message: err?.message || 'Could not capture GPS coordinates.'
        });
      },
      { enableHighAccuracy: true, timeout: 8000 }
    );
  };

  const handleSaveGpsAnchors = async () => {
    const normalized = [];
    for (let i = 0; i < knownGpsAnchors.length; i += 1) {
      const a = knownGpsAnchors[i];
      const latNum = Number(a.lat);
      const lonNum = Number(a.lon ?? a.lng);
      if (!Number.isFinite(latNum) || latNum < -90 || latNum > 90 || !Number.isFinite(lonNum) || lonNum < -180 || lonNum > 180) {
        setGpsAnchorsFeedback({
          type: 'error',
          message: `Anchor #${i + 1} (${a.name || 'Unnamed'}) requires valid numeric latitude and longitude.`
        });
        return;
      }
      const street = String(a.street || '').trim();
      const barangay = String(a.barangay || '').trim();
      const city = String(a.city || '').trim();
      const region = String(a.region || '').trim();
      const zip = String(a.zip || '').trim();
      const autoFormatted = formatGpsAddressParts({ street, barangay, city, region, zip });
      const formatted = String(a.formatted || '').trim() || autoFormatted;
      if (!formatted) {
        setGpsAnchorsFeedback({
          type: 'error',
          message: `Anchor #${i + 1} requires at least a street, city, or formatted address.`
        });
        return;
      }
      normalized.push({
        name: String(a.name || '').trim() || `Warehouse / Dock #${i + 1}`,
        street,
        barangay,
        city,
        region,
        zip,
        formatted,
        lat: latNum,
        lon: lonNum,
        radiusMeters: Math.max(25, Math.min(5000, Number(a.radiusMeters) || 250))
      });
    }

    const payload = normalized.length > 0 ? normalized : DEFAULT_KNOWN_GPS_LOCATIONS;
    setIsSavingGpsAnchors(true);
    setGpsAnchorsFeedback(null);
    try {
      try {
        localStorage.setItem('rma_portal_known_gps_locations', JSON.stringify(payload));
      } catch {}
      const { error } = await supabase
        .from('rma_settings')
        .upsert(
          {
            key: 'known_gps_locations',
            value: payload,
            updated_at: new Date().toISOString()
          },
          { onConflict: 'key' }
        );
      if (error) throw error;
      setKnownGpsAnchors(payload);
      setGpsAnchorsFeedback({
        type: 'success',
        message: `Saved ${payload.length} Known Warehouse / Dock GPS anchor(s) to cloud database.`
      });
    } catch (err) {
      setGpsAnchorsFeedback({
        type: 'error',
        message: err?.message || 'Could not save Known GPS Anchors to Supabase.'
      });
    } finally {
      setIsSavingGpsAnchors(false);
    }
  };

  const handleCheckConnection = async () => {
    setConnectionStatus({ loading: true, checked: false, connected: false, message: 'Pinging Supabase...' });
    const result = await rmaApi.testConnection();
    setConnectionStatus({
      loading: false,
      checked: true,
      connected: result.connected,
      message: result.message
    });
  };

  const handleCheckPoApi = async () => {
    setPoApiStatus({ loading: true, checked: false, connected: false, message: 'Testing Product Catalog API...' });
    const result = await purchaseOrdersApi.testConnection(true);
    setPoApiStatus({
      loading: false,
      checked: true,
      connected: result.connected,
      message: result.connected 
        ? `Connected! Access verified to 5,793+ live SKUs in erply_products.` 
        : (result.error || 'Connection failed.')
    });
  };

  const handleSavePoKey = async () => {
    setIsSavingPoKey(true);
    setPoKeyFeedback(null);
    try {
      await purchaseOrdersApi.setApiKey(poApiKey);
      setPoKeyFeedback({ type: 'success', message: 'Catalog API Key saved and synced across all devices!' });
      handleCheckPoApi();
    } catch (err) {
      setPoKeyFeedback({ type: 'error', message: err.message });
    } finally {
      setIsSavingPoKey(false);
      setTimeout(() => setPoKeyFeedback(null), 4000);
    }
  };

  const loadReplySyncLogs = async (showSpinner = true) => {
    if (showSpinner) {
      setReplySyncDiagnostics((prev) => ({ ...prev, loading: true, error: '' }));
    }
    const res = await notificationService.getEmailReplySyncLogs();
    setReplySyncDiagnostics((prev) => ({
      ...prev,
      loading: false,
      statusSummary: res?.statusSummary || null,
      logs: Array.isArray(res?.logs) ? res.logs : [],
      processedMessageIdCount: Number(res?.processedMessageIdCount || 0),
      error: res?.success ? '' : (res?.error || 'Unable to load IMAP reply sync logs.')
    }));
  };

  const handleRunDiagnosticReplySync = async () => {
    setReplySyncDiagnostics((prev) => ({ ...prev, runningSync: true, error: '' }));
    const res = await notificationService.syncEmailRepliesNow({
      source: 'admin_settings_diagnostic',
      includeIdleLogs: true
    });
    await loadReplySyncLogs(false);
    setReplySyncDiagnostics((prev) => ({
      ...prev,
      runningSync: false,
      error: res?.success === false && res?.error ? res.error : ''
    }));
  };

  const handleTestSmtp = async () => {
    setSmtpStatus({ loading: true, checked: false, success: false, message: 'Authenticating with Google SMTP...', diagnostic: '', passLength: null, hadSpaces: false });
    const res = await notificationService.testSmtpConnection();
    setSmtpStatus({
      loading: false,
      checked: true,
      success: Boolean(res.success || res.verified),
      message: res.message || res.error || 'Connection failed',
      diagnostic: res.diagnostic || '',
      passLength: res.passLength || null,
      hadSpaces: Boolean(res.hadSpaces)
    });
  };

  const handleSaveSandboxEmail = async () => {
    const raw = String(sandboxEmailInput || '').trim().toLowerCase();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(raw)) {
      setSandboxEmailFeedback({ type: 'error', message: 'Please enter a valid Test Mode sandbox email address.' });
      return;
    }
    setIsSavingSandboxEmail(true);
    setSandboxEmailFeedback(null);
    try {
      const saved = await notificationService.saveTestSandboxEmail(raw);
      setTestSandboxEmail(saved);
      setSandboxEmailInput(saved);
      setTestGlobalRecipients(notificationService.getEmailSettings(true));
      setSandboxEmailFeedback({ type: 'success', message: `Test Mode sandbox override updated to ${saved}!` });
      setTimeout(() => setSandboxEmailFeedback(null), 4000);
    } catch (err) {
      setSandboxEmailFeedback({ type: 'error', message: err?.message || 'Failed to save sandbox email.' });
    } finally {
      setIsSavingSandboxEmail(false);
    }
  };

  const handleSaveTestGlobalRecipients = async () => {
    setIsSavingTestGlobal(true);
    setTestGlobalFeedback(null);
    try {
      const toList = Array.isArray(testGlobalRecipients?.toList) ? testGlobalRecipients.toList : [];
      const baseCcList = Array.isArray(testGlobalRecipients?.baseCcList) ? testGlobalRecipients.baseCcList : [];
      const res = await notificationService.saveEmailSettings({ toList, baseCcList }, true);
      if (res?.settings) setTestGlobalRecipients(res.settings);
      setTestGlobalFeedback({ type: 'success', message: 'Test Mode Global Fallback TO & CC saved & synced to cloud!' });
      setTimeout(() => setTestGlobalFeedback(null), 4000);
    } catch (err) {
      setTestGlobalFeedback({ type: 'error', message: err?.message || 'Failed to save Test Mode fallback recipients.' });
    } finally {
      setIsSavingTestGlobal(false);
    }
  };

  const handleResetTestGlobalFallback = async () => {
    const sandbox = notificationService.getTestSandboxEmail();
    setIsSavingTestGlobal(true);
    setTestGlobalFeedback(null);
    try {
      const res = await notificationService.saveEmailSettings({ toList: [sandbox], baseCcList: [] }, true);
      if (res?.settings) setTestGlobalRecipients(res.settings);
      setTestGlobalFeedback({ type: 'success', message: `Reset Global Test Mode recipients to Sandbox (${sandbox})!` });
      setTimeout(() => setTestGlobalFeedback(null), 3500);
    } catch (err) {
      setTestGlobalFeedback({ type: 'error', message: err?.message || 'Failed to reset Test Mode fallback.' });
    } finally {
      setIsSavingTestGlobal(false);
    }
  };

  const handleSaveFollowUpConfig = async () => {
    setIsSavingFollowUpConfig(true);
    setFollowUpConfigFeedback(null);
    try {
      const saved = await notificationService.saveDailyFollowUpConfig(followUpConfig);
      followUpDirtyRef.current = false;
      setFollowUpConfig(saved);
      const testSpeedMsg = saved.testStepIntervalSeconds > 0
        ? ` • Sandbox speed: ${formatDurationCompact(saved.testStepIntervalSeconds)}/day${saved.testAutoCronEnabled ? ' (Auto-Cron ON)' : ''}`
        : '';
      setFollowUpConfigFeedback({ type: 'success', message: `10-Day Pickup Follow-Up schedule (${formatTime12hFromHhmm(saved.autoSendTimePht)} PHT${testSpeedMsg}) saved to cloud!` });
      setTimeout(() => setFollowUpConfigFeedback(null), 4000);
    } catch (err) {
      setFollowUpConfigFeedback({ type: 'error', message: err?.message || 'Failed to save follow-up schedule.' });
    } finally {
      setIsSavingFollowUpConfig(false);
    }
  };

  const handleSaveMatrixConfig = async () => {
    setIsSavingMatrixConfig(true);
    setMatrixConfigFeedback(null);
    try {
      const autoProf = notificationService.getEmailProfile('daily_matrix_auto');
      const saved = await notificationService.saveDailyMatrixConfig({
        ...matrixConfig,
        toList: autoProf.toList,
        ccList: autoProf.ccList
      });
      setMatrixConfig(saved);
      setMatrixConfigFeedback({ type: 'success', message: 'Overall Matrix schedule, date range & scope saved to cloud!' });
      setTimeout(() => setMatrixConfigFeedback(null), 4000);
    } catch (err) {
      setMatrixConfigFeedback({ type: 'error', message: err?.message || 'Failed to save Matrix config.' });
    } finally {
      setIsSavingMatrixConfig(false);
    }
  };

  const handleSyncAutoAndManualMatrixRecipients = async () => {
    const scopeIsTest = Boolean(recipientScopeIsTest);
    const sourceKey = activeEmailProfileType === 'manual_matrix' ? 'manual_matrix' : 'daily_matrix_auto';
    const srcProfile = notificationService.getEmailProfile(sourceKey, scopeIsTest);
    await notificationService.saveEmailProfile('daily_matrix_auto', srcProfile, scopeIsTest);
    await notificationService.saveEmailProfile('manual_matrix', srcProfile, scopeIsTest);
    setSyncMatrixFeedback(
      scopeIsTest
        ? 'Synced Test Mode TO & CC recipients between Auto Daily Matrix and Manual Matrix!'
        : 'Synced TO & CC recipients between Auto Daily 1:00 PM Matrix and Manual Matrix!'
    );
    setTimeout(() => setSyncMatrixFeedback(''), 4000);
  };

  const handleSendDailyMatrixNow = async () => {
    setDailyMatrixStatus({
      loading: true,
      done: false,
      success: false,
      message: 'Generating & emailing Overall RMA Matrix (.xlsx)...',
      detail: ''
    });
    const manualProf = notificationService.getEmailProfile('manual_matrix', Boolean(isTestMode));
    const autoProf = notificationService.getEmailProfile('daily_matrix_auto', Boolean(isTestMode));
    const chosenProf = manualProf.isCustom ? manualProf : autoProf;

    const useAll = matrixConfig.includeAllRecords !== false;
    const payloadDates = !useAll && matrixConfig.rangeMode === 'custom' && matrixConfig.startDate && matrixConfig.endDate
      ? { startDate: matrixConfig.startDate, endDate: matrixConfig.endDate }
      : {};

    const res = await notificationService.sendDailyMatrixEmailNow({
      ...payloadDates,
      includeAllRecords: useAll,
      rollingDays: matrixConfig.rollingDays,
      stream: matrixConfig.stream || 'overall',
      includeZeroCatalogSkus: Boolean(matrixConfig.includeZeroCatalogSkus),
      toList: chosenProf.toList,
      ccList: chosenProf.ccList,
      isTestMode: Boolean(isTestMode),
      force: true
    });
    if (res?.success) {
      const ccTxt = Array.isArray(res.cc) && res.cc.length > 0 ? ` (CC: ${res.cc.join(', ')})` : '';
      setDailyMatrixStatus({
        loading: false,
        done: true,
        success: true,
        message: `Daily Matrix dispatched to ${res.to || chosenProf.toEmail || mainRecipient}${ccTxt}`,
        detail: `${res.filename || 'Overall_RMA_Matrix_Report.xlsx'} • ${res.dataset?.lineCount ?? 0} lines • ${res.dataset?.grandTotalPcs ?? 0} pcs`
      });
    } else {
      setDailyMatrixStatus({
        loading: false,
        done: true,
        success: false,
        message: res?.message || res?.error || 'Failed to dispatch Daily Matrix email.',
        detail: res?.diagnostic || ''
      });
    }
  };

  // Add CC email to list
  const handleAddCcEmail = (e) => {
    if (e) e.preventDefault();
    const clean = newCcInput.trim().toLowerCase();
    if (!clean) return;

    if (!clean.includes('@') || !clean.includes('.')) {
      setRecipientFeedback({ type: 'error', message: 'Please enter a valid email address.' });
      return;
    }

    if (ccRecipients.map(c => c.toLowerCase()).includes(clean)) {
      setRecipientFeedback({ type: 'error', message: 'This email is already in the CC list.' });
      return;
    }

    setCcRecipients(prev => [...prev, clean]);
    setNewCcInput('');
    setRecipientFeedback(null);
  };

  // Remove CC email from list
  const handleRemoveCcEmail = (emailToRemove) => {
    setCcRecipients(prev => prev.filter(email => email.toLowerCase() !== emailToRemove.toLowerCase()));
    setRecipientFeedback(null);
  };

  // Restore Default Corporate Recipients
  const handleResetDefaults = () => {
    const defaults = {
      toEmail: 'azgodev@gmail.com',
      baseCcList: [
        'mgan@pingconmarketing.com',
        'marketing@pingconmarketing.com',
        'azgan@pingconmarketing.com',
        'jaezelle.benito@pingconmarketing.com'
      ]
    };
    setMainRecipient(defaults.toEmail);
    setCcRecipients(defaults.baseCcList);
    setRecipientFeedback({ type: 'success', message: 'Corporate defaults restored! Click "Save Changes" to apply.' });
  };

  // Save Recipient Settings
  const handleSaveRecipients = async () => {
    const cleanTo = mainRecipient.trim().toLowerCase();
    if (!cleanTo || !cleanTo.includes('@') || !cleanTo.includes('.')) {
      setRecipientFeedback({ type: 'error', message: 'Please enter a valid Primary TO recipient email address.' });
      return;
    }

    setIsSavingRecipients(true);
    setRecipientFeedback(null);

    try {
      await notificationService.saveEmailSettings({
        toEmail: cleanTo,
        baseCcList: ccRecipients
      });
      setRecipientFeedback({ 
        type: 'success', 
        message: 'RMA email recipients successfully updated and active for all notifications!' 
      });
      setTimeout(() => setRecipientFeedback(null), 4000);
    } catch (err) {
      setRecipientFeedback({ type: 'error', message: err.message || 'Failed to save recipients.' });
    } finally {
      setIsSavingRecipients(false);
    }
  };

  const isSuperAdmin = currentUser?.role === 'super_admin';
  const showAllSections = false;
  const showEmailsTab = viewMode === 'settings' && (showAllSections || activeSettingsSubTab === 'emails');
  const showSchedulesTab = viewMode === 'settings' && (showAllSections || activeSettingsSubTab === 'schedules');
  const showConnectionsTab = viewMode === 'settings' && (showAllSections || activeSettingsSubTab === 'connections');
  const showWarehouseLocationsView = viewMode === 'warehouse_locations';
  const showApiKeysView = viewMode === 'api_keys';

  return (
    <div className="w-full max-w-6xl mx-auto space-y-5">

      {viewMode === 'settings' && (
        <>
          {/* Header Banner + Clean 3-Subtab Navigation */}
          <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3">
              <div>
                <div className="flex items-center space-x-2">
                  <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-brand-50 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/40">
                    System Administration
                  </span>
                </div>
                <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
                  <Settings className="w-6 h-6 text-brand-600 dark:text-brand-400" />
                  <span>Settings &amp; Environment Control</span>
                </h1>
                <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
                  Manage email distribution routing, 10-day pickup SLA schedules, Test Mode simulation controls, and diagnostics.
                </p>
              </div>
              {onNavigateTab && (
                <div className="flex flex-wrap items-center gap-2 shrink-0">
                  <button
                    type="button"
                    onClick={() => onNavigateTab('warehouse_locations')}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <MapPin className="w-3.5 h-3.5 text-blue-600" />
                    <span>Warehouse Locations &amp; GPS</span>
                  </button>
                  <button
                    type="button"
                    onClick={() => onNavigateTab('api_keys')}
                    className="px-3 py-1.5 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-slate-200 dark:border-slate-700 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
                  >
                    <KeyRound className="w-3.5 h-3.5 text-indigo-600" />
                    <span>API Keys &amp; Webhooks</span>
                  </button>
                </div>
              )}
            </div>

            <div className="flex items-center gap-1.5 bg-slate-100 dark:bg-slate-800/80 p-1 rounded-2xl overflow-x-auto no-scrollbar border border-slate-200 dark:border-slate-700" role="tablist" aria-label="Settings Sections">
              <button
                type="button"
                role="tab"
                aria-selected={activeSettingsSubTab === 'emails'}
                onClick={() => setActiveSettingsSubTab('emails')}
                className={`touch-target px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  activeSettingsSubTab === 'emails'
                    ? 'bg-white dark:bg-slate-900 text-indigo-700 dark:text-indigo-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Mail className="w-4 h-4 shrink-0" />
                <span>Email &amp; Recipients</span>
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSettingsSubTab === 'schedules'}
                onClick={() => setActiveSettingsSubTab('schedules')}
                className={`touch-target px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  activeSettingsSubTab === 'schedules'
                    ? 'bg-white dark:bg-slate-900 text-emerald-700 dark:text-emerald-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Clock className="w-4 h-4 shrink-0" />
                <span>Schedules &amp; 10-Day SLA</span>
                {Number(followUpConfig?.testStepIntervalSeconds || 0) > 0 && (
                  <span className="px-1.5 py-0.5 rounded-full text-[9px] font-black bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300 border border-amber-300 dark:border-amber-700">
                    Test {formatDurationCompact(followUpConfig.testStepIntervalSeconds)}
                  </span>
                )}
              </button>
              <button
                type="button"
                role="tab"
                aria-selected={activeSettingsSubTab === 'connections'}
                onClick={() => setActiveSettingsSubTab('connections')}
                className={`touch-target px-4 py-2 rounded-xl text-xs font-black flex items-center gap-2 transition-all whitespace-nowrap cursor-pointer ${
                  activeSettingsSubTab === 'connections'
                    ? 'bg-white dark:bg-slate-900 text-blue-700 dark:text-blue-300 shadow-sm'
                    : 'text-slate-600 dark:text-slate-400 hover:text-slate-900 dark:hover:text-white'
                }`}
              >
                <Database className="w-4 h-4 shrink-0" />
                <span>Test Mode, Diagnostics &amp; Portal</span>
              </button>
            </div>
          </div>
        </>
      )}

      {showEmailsTab && (
      <>
      {/* CARD 1: SUPER ADMIN RMA EMAIL RECIPIENTS CONFIGURATION */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-sm space-y-6 w-full min-w-0 box-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4 w-full min-w-0">
          <div className="flex items-center space-x-3 min-w-0">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-950/60 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-800 shrink-0">
              <Users className="w-5 h-5" />
            </div>
            <div className="min-w-0">
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                  RMA Email Notification Recipients
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-indigo-100 text-indigo-800 dark:bg-indigo-950 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 shrink-0">
                  Super Admin
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400 truncate">
                Configure Main TO recipient and Corporate CC distribution list for all official RMA return reports.
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2 self-start sm:self-auto flex-wrap shrink-0">
            <button
              type="button"
              onClick={handleResetDefaults}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 flex items-center gap-1.5 transition-colors cursor-pointer shrink-0"
              title="Reset to corporate standard recipients"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Defaults</span>
            </button>

            <button
              type="button"
              onClick={handleSaveRecipients}
              disabled={isSavingRecipients}
              className="px-4 py-1.5 bg-blue-600 hover:bg-blue-700 text-white text-xs font-black rounded-xl flex items-center gap-1.5 transition-all shadow-sm cursor-pointer disabled:opacity-50 shrink-0"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingRecipients ? 'Saving...' : 'Save Recipients'}</span>
            </button>
          </div>
        </div>

        {/* Feedback message */}
        {recipientFeedback && (
          <div className={`p-3.5 rounded-2xl text-xs font-bold border flex items-center gap-2 animate-in fade-in ${
            recipientFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-800 text-rose-800 dark:text-rose-300'
          }`}>
            {recipientFeedback.type === 'success' ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
            )}
            <span>{recipientFeedback.message}</span>
          </div>
        )}

        <div className="grid grid-cols-1 gap-6">
          {/* Main Primary Recipient (TO) */}
          <div className="space-y-2">
            <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300 flex items-center justify-between">
              <span>Primary Main Recipient (TO Address)</span>
              <span className="text-[11px] font-normal text-slate-400 lowercase">Single Primary Target</span>
            </label>
            <div className="relative">
              <AtSign className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
              <input
                type="email"
                value={mainRecipient}
                onChange={(e) => setMainRecipient(e.target.value)}
                placeholder="e.g. azgodev@gmail.com or finance@company.com"
                className="w-full pl-10 pr-4 py-2.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400">
              The primary destination mailbox for automated RMA alerts. In Live Mode, emails are dispatched directly to this address.
            </p>
          </div>

          {/* CC Distribution List */}
          <div className="space-y-3">
            <div className="flex items-center justify-between">
              <label className="block text-xs font-black uppercase tracking-wider text-slate-700 dark:text-slate-300">
                Carbon Copy Distribution List (CC Addresses)
              </label>
              <span className="text-[11px] font-bold text-slate-500 dark:text-slate-400">
                {ccRecipients.length} Recipient{ccRecipients.length === 1 ? '' : 's'}
              </span>
            </div>

            {/* CC Chips / Badges Container */}
            <div className="p-3.5 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl min-h-[58px] flex flex-wrap gap-2 items-center">
              {ccRecipients.length === 0 ? (
                <span className="text-xs text-slate-400 italic">No CC recipients configured. Add one below.</span>
              ) : (
                ccRecipients.map((email) => (
                  <span
                    key={email}
                    className="inline-flex items-center gap-1.5 px-3 py-1 bg-white dark:bg-slate-800 text-slate-800 dark:text-slate-200 border border-slate-200 dark:border-slate-700 rounded-xl text-xs font-mono shadow-2xs group max-w-full"
                  >
                    <span className="truncate max-w-[200px] sm:max-w-xs">{email}</span>
                    <button
                      type="button"
                      onClick={() => handleRemoveCcEmail(email)}
                      className="text-slate-400 hover:text-rose-600 dark:hover:text-rose-400 transition-colors cursor-pointer p-0.5 rounded-md shrink-0"
                      title={`Remove ${email}`}
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </span>
                ))
              )}
            </div>

            {/* Add new CC form */}
            <form onSubmit={handleAddCcEmail} className="flex flex-col sm:flex-row gap-2 w-full min-w-0">
              <div className="relative flex-1 min-w-0">
                <Mail className="w-4 h-4 text-slate-400 absolute left-3.5 top-1/2 -translate-y-1/2 pointer-events-none" />
                <input
                  type="email"
                  value={newCcInput}
                  onChange={(e) => setNewCcInput(e.target.value)}
                  placeholder="Enter email to add to CC (e.g. manager@pingconmarketing.com)"
                  className="w-full pl-10 pr-4 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-hidden focus:ring-2 focus:ring-blue-500 box-border"
                />
              </div>
              <button
                type="submit"
                className="w-full sm:w-auto px-3.5 py-2 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-800 dark:text-slate-200 text-xs font-bold rounded-xl border border-slate-200 dark:border-slate-700 flex items-center justify-center gap-1.5 transition-colors cursor-pointer shrink-0 box-border"
              >
                <Plus className="w-3.5 h-3.5" />
                <span>Add CC</span>
              </button>
            </form>

            <div className="p-3 bg-blue-50/60 dark:bg-blue-950/30 border border-blue-200/80 dark:border-blue-900/40 rounded-xl text-[11px] text-blue-900 dark:text-blue-200 leading-relaxed flex items-start gap-2">
              <Check className="w-4 h-4 text-blue-600 dark:text-blue-400 shrink-0 mt-0.5" />
              <span>
                <strong>Smart Dynamic AE Addition:</strong> The Customer Account Executive (AE) assigned to the product (e.g. <code>alleli.almaida@ph.keysys.com</code>) is <strong>automatically appended</strong> to this CC list upon report dispatch.
              </span>
            </div>
          </div>
        </div>
      </div>

      {/* CARD 1B: PER-EMAIL RECIPIENT MANAGER (ALL 9 SYSTEM EMAIL TYPES) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-4 sm:p-7 shadow-sm space-y-5 w-full min-w-0 box-border">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-950/60 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-800 shrink-0">
              <Mail className="w-5 h-5" />
            </div>
            <div>
              <div className="flex items-center gap-2 flex-wrap">
                <h2 className="text-base font-extrabold text-slate-900 dark:text-white">
                  Per-Email Recipient Manager
                </h2>
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase bg-blue-100 text-blue-800 dark:bg-blue-950 dark:text-blue-300 border border-blue-200 dark:border-blue-800">
                  {EMAIL_PROFILE_TYPES.length} Email Profiles
                </span>
              </div>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Customize Primary TO and CC recipients independently for each email workflow (synced to Supabase).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            {/* Live vs Test Scope Switcher for Per-Email Recipient Manager */}
            <div className="inline-flex rounded-xl bg-slate-100 dark:bg-slate-800 p-0.5 border border-slate-200 dark:border-slate-700" role="group" aria-label="Email Recipient Mode Scope">
              <button
                type="button"
                onClick={() => setRecipientScopeIsTest(false)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  !recipientScopeIsTest
                    ? 'bg-emerald-600 text-white shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                🟢 Live Mode
              </button>
              <button
                type="button"
                onClick={() => setRecipientScopeIsTest(true)}
                className={`px-2.5 py-1 rounded-lg text-[11px] font-black transition-all cursor-pointer ${
                  recipientScopeIsTest
                    ? 'bg-amber-500 text-slate-950 shadow-2xs'
                    : 'text-slate-600 dark:text-slate-300 hover:text-slate-900'
                }`}
              >
                🧪 Test Mode
              </button>
            </div>

            <button
              type="button"
              onClick={() => setIsDirectoryOpen(true)}
              className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 dark:bg-slate-800 dark:hover:bg-slate-700 text-white text-xs font-black flex items-center gap-1.5 shadow-2xs cursor-pointer shrink-0"
              title="Open Persistent Supplier Emails Directory (Add, Edit, Search, Delete contacts)"
            >
              <BookOpen className="w-3.5 h-3.5 text-amber-400" />
              <span>📒 Supplier Emails Directory</span>
            </button>

            {(activeEmailProfileType === 'daily_matrix_auto' || activeEmailProfileType === 'manual_matrix') && (
              <button
                type="button"
                onClick={handleSyncAutoAndManualMatrixRecipients}
                className="px-3 py-1.5 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-xs font-black flex items-center gap-1.5 shadow-2xs cursor-pointer shrink-0"
              >
                <RefreshCw className="w-3.5 h-3.5" />
                <span>Sync Recipients Between Auto &amp; Manual</span>
              </button>
            )}
          </div>
        </div>

        {/* Profile Selector Pills */}
        <div className="flex flex-wrap gap-1.5">
          {EMAIL_PROFILE_TYPES.map((t) => {
            const isActive = activeEmailProfileType === t.id;
            return (
              <button
                key={t.id}
                type="button"
                onClick={() => setActiveEmailProfileType(t.id)}
                className={`px-3 py-1.5 rounded-xl text-xs font-bold border transition-all flex items-center gap-1.5 cursor-pointer ${
                  isActive
                    ? 'bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-500 shadow-xs'
                    : 'bg-slate-50 dark:bg-slate-950 text-slate-700 dark:text-slate-300 border-slate-200 dark:border-slate-800 hover:border-blue-400'
                }`}
              >
                <span>{t.label}</span>
                <span className={`px-1.5 py-0.2 rounded text-[9px] font-mono font-black uppercase ${
                  isActive ? 'bg-white/20 text-white' : 'bg-slate-200/70 dark:bg-slate-800 text-slate-500 dark:text-slate-400'
                }`}>
                  {t.badge}
                </span>
              </button>
            );
          })}
        </div>

        {syncMatrixFeedback && (
          <div className="p-3 rounded-xl bg-emerald-50 dark:bg-emerald-950/50 border border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200 text-xs font-bold flex items-center gap-2">
            <CheckCircle2 className="w-4 h-4 shrink-0" />
            <span>{syncMatrixFeedback}</span>
          </div>
        )}

        <EmailRecipientsEditor
          emailType={activeEmailProfileType}
          isTestMode={recipientScopeIsTest}
          allowEmptyTo={activeEmailProfileType === 'invite_email' || activeEmailProfileType === 'supplier_followup'}
          extraHint={
            recipientScopeIsTest
              ? 'Test Mode profile is stored separately under test_email_recipients_by_type and falls back to Global Test Mode recipients / Sandbox email.'
              : activeEmailProfileType === 'invite_email'
                ? 'Addresses added here are included as extra CCs on generated Portal/Editor Invite emails.'
                : activeEmailProfileType === 'supplier_followup'
                  ? 'Extra internal CCs copied on automated 10-Calendar-Day pickup follow-up emails (Primary TO comes from each RMA’s Supplier Email).'
                  : activeEmailProfileType === 'pickup_debit_claim' || activeEmailProfileType === 'pickup_replacement'
                    ? 'Supplier To/CC fields entered in Driver Pickup Verification merge automatically with these base recipients.'
                    : 'Product Account Executive (AE) email is also CC’d automatically when applicable.'
          }
        />
      </div>
      </>
      )}

      {showConnectionsTab && (
      <>
      {/* CARD 2: TEST MODE SWITCH CARD */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4">
          <div className="space-y-1">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Simulation / Test Mode Toggle</h2>
              <span className="px-2 py-0.5 rounded-full text-[10px] font-black uppercase tracking-wider bg-purple-100 text-purple-800 dark:bg-purple-950/60 dark:text-purple-300 border border-purple-200 dark:border-purple-800">
                👑 Super Admin Exclusive
              </span>
              {isTestMode ? (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-amber-100 text-amber-800 dark:bg-amber-500/20 dark:text-amber-300 border border-amber-300 dark:border-amber-500/40">
                  ACTIVE
                </span>
              ) : (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-bold uppercase bg-slate-100 dark:bg-slate-800 text-slate-600 dark:text-slate-400 border border-slate-200 dark:border-slate-700">
                  OFF
                </span>
              )}
            </div>
            <p className="text-xs text-slate-500 dark:text-slate-400 max-w-xl">
              When ON, test emails are safely sent exclusively to <code className="text-amber-600 dark:text-amber-300 font-mono font-bold">{testSandboxEmail}</code> with <code className="text-amber-600 dark:text-amber-300 font-mono font-bold">[TEST] </code> at the very beginning of the subject. <strong>This setting is strictly restricted to Super Admin; all other staff roles and public intake users operate permanently in Live Mode.</strong>
            </p>
          </div>

          <button
            type="button"
            onClick={onToggleTestMode}
            className={`flex items-center space-x-2 px-5 py-2.5 rounded-xl font-bold text-xs transition-all shadow-sm ${
              isTestMode 
                ? 'bg-amber-500 hover:bg-amber-400 text-slate-950 shadow-amber-500/20' 
                : 'bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-700'
            }`}
          >
            {isTestMode ? (
              <>
                <ToggleRight className="w-5 h-5 text-slate-950" />
                <span>Test Mode: ON</span>
              </>
            ) : (
              <>
                <ToggleLeft className="w-5 h-5 text-slate-400" />
                <span>Test Mode: OFF</span>
              </>
            )}
          </button>
        </div>

        {/* Live email preview example */}
        <div className="p-3 bg-slate-50 dark:bg-slate-950 rounded-2xl border border-slate-200 dark:border-slate-800 text-xs font-mono space-y-1.5">
          <span className="text-[11px] font-sans font-semibold text-slate-500 dark:text-slate-400 block mb-1">
            Live Recipient Output with Current Configuration:
          </span>
          <div className="text-slate-700 dark:text-slate-300">
            <strong>Target TO:</strong> <span className={isTestMode ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-emerald-600 dark:text-emerald-400 font-bold'}>
              {isTestMode ? `${testGlobalRecipients?.toEmail || testSandboxEmail} (Live target "${mainRecipient}" safely bypassed)` : mainRecipient}
            </span>
          </div>
          <div className="text-slate-700 dark:text-slate-300">
            <strong>Target CC:</strong> <span className={isTestMode ? 'text-amber-600 dark:text-amber-400 font-bold' : 'text-slate-700 dark:text-slate-300'}>
              {isTestMode 
                ? `${(testGlobalRecipients?.baseCcList || []).join(', ') || '[] (No Test Mode CC — Live CCs bypassed)'}` 
                : `${ccRecipients.join(', ') || 'None'} + [Customer AE email]`}
            </span>
          </div>
        </div>

        {/* Configurable Test Mode Sandbox Email Override */}
        <div className="p-3.5 rounded-2xl bg-amber-50/70 dark:bg-amber-950/30 border border-amber-200 dark:border-amber-800/70 space-y-2 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="font-bold text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
              <FlaskConical className="w-4 h-4 text-amber-600" />
              <span>Test Mode Sandbox Email Override (Default: mgan@pingconmarketing.com)</span>
            </div>
            <button
              type="button"
              onClick={handleSaveSandboxEmail}
              disabled={isSavingSandboxEmail}
              className="px-3 py-1 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3 h-3" />
              <span>{isSavingSandboxEmail ? 'Saving...' : 'Save Sandbox Email'}</span>
            </button>
          </div>
          <input
            type="email"
            aria-label="Test Mode Sandbox Email Override"
            value={sandboxEmailInput}
            onChange={(e) => setSandboxEmailInput(e.target.value)}
            placeholder="mgan@pingconmarketing.com"
            className="w-full px-3 py-2 rounded-xl border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono font-bold text-xs text-slate-900 dark:text-white"
          />
          {sandboxEmailFeedback && (
            <div className={`text-[11px] font-bold ${sandboxEmailFeedback.type === 'success' ? 'text-emerald-700 dark:text-emerald-300' : 'text-rose-700 dark:text-rose-300'}`}>
              {sandboxEmailFeedback.message}
            </div>
          )}
        </div>

        {/* Configurable Global Test Mode TO & CC Distribution (isolated key: test_email_recipients) */}
        <div className="p-3.5 rounded-2xl bg-amber-50/40 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/70 space-y-3 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-black text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                <Mail className="w-4 h-4 text-amber-600" />
                <span>Test Mode Global Fallback Recipients (TO &amp; CC)</span>
              </div>
              <p className="text-[11px] text-amber-900/80 dark:text-amber-300/80 mt-0.5">
                Used across all Test Mode emails unless overridden in the per-email workflow profiles above (isolated from Live recipients).
              </p>
            </div>
            <div className="flex items-center gap-1.5">
              <button
                type="button"
                onClick={handleResetTestGlobalFallback}
                disabled={isSavingTestGlobal}
                className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 border border-amber-300 dark:border-amber-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RotateCcw className="w-3 h-3" />
                <span>Reset Test Fallback</span>
              </button>
              <button
                type="button"
                onClick={handleSaveTestGlobalRecipients}
                disabled={isSavingTestGlobal}
                className="px-3 py-1 rounded-lg bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                <span>{isSavingTestGlobal ? 'Saving...' : 'Save Test Fallback'}</span>
              </button>
            </div>
          </div>

          {testGlobalFeedback && (
            <div className={`px-3 py-2 rounded-xl border text-[11px] font-bold ${
              testGlobalFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200'
            }`}>
              {testGlobalFeedback.message}
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            {/* Test Mode TO List */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                Test Mode Global TO ({(testGlobalRecipients?.toList || []).length})
              </span>
              <div className="p-2 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 rounded-xl flex flex-wrap gap-1.5 min-h-[36px]">
                {(testGlobalRecipients?.toList || []).map((em) => (
                  <span key={em} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-amber-100 dark:bg-amber-900/50 text-amber-950 dark:text-amber-100 font-mono text-[11px] font-bold">
                    <span>{em}</span>
                    <button
                      type="button"
                      onClick={() => setTestGlobalRecipients((prev) => ({
                        ...prev,
                        toList: (prev?.toList || []).filter((x) => x.toLowerCase() !== em.toLowerCase())
                      }))}
                      className="text-amber-700 hover:text-rose-600 cursor-pointer"
                      aria-label={`Remove Test TO ${em}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="email"
                  value={newTestToInput}
                  onChange={(e) => setNewTestToInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const clean = newTestToInput.trim().toLowerCase();
                      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return;
                      setTestGlobalRecipients((prev) => ({
                        ...prev,
                        toList: Array.from(new Set([...(prev?.toList || []), clean]))
                      }));
                      setNewTestToInput('');
                    }
                  }}
                  placeholder="Add Test Mode Global TO email..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 text-[11px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = newTestToInput.trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return;
                    setTestGlobalRecipients((prev) => ({
                      ...prev,
                      toList: Array.from(new Set([...(prev?.toList || []), clean]))
                    }));
                    setNewTestToInput('');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  Add Test TO
                </button>
              </div>
            </div>

            {/* Test Mode CC List */}
            <div className="space-y-1.5">
              <span className="text-[11px] font-black uppercase tracking-wider text-amber-900 dark:text-amber-300">
                Test Mode Global CC ({(testGlobalRecipients?.baseCcList || []).length})
              </span>
              <div className="p-2 bg-white dark:bg-slate-900 border border-amber-200 dark:border-amber-800/70 rounded-xl flex flex-wrap gap-1.5 min-h-[36px]">
                {(testGlobalRecipients?.baseCcList || []).length === 0 ? (
                  <span className="text-[11px] text-slate-400 italic">No Test Mode CC added.</span>
                ) : (testGlobalRecipients?.baseCcList || []).map((em) => (
                  <span key={em} className="inline-flex items-center gap-1 px-2 py-0.5 rounded-lg bg-slate-100 dark:bg-slate-800 text-slate-800 dark:text-slate-200 font-mono text-[11px] font-bold">
                    <span>{em}</span>
                    <button
                      type="button"
                      onClick={() => setTestGlobalRecipients((prev) => ({
                        ...prev,
                        baseCcList: (prev?.baseCcList || []).filter((x) => x.toLowerCase() !== em.toLowerCase())
                      }))}
                      className="text-slate-500 hover:text-rose-600 cursor-pointer"
                      aria-label={`Remove Test CC ${em}`}
                    >
                      <X className="w-3 h-3" />
                    </button>
                  </span>
                ))}
              </div>
              <div className="flex gap-1.5">
                <input
                  type="email"
                  value={newTestCcInput}
                  onChange={(e) => setNewTestCcInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      const clean = newTestCcInput.trim().toLowerCase();
                      if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return;
                      setTestGlobalRecipients((prev) => ({
                        ...prev,
                        baseCcList: Array.from(new Set([...(prev?.baseCcList || []), clean]))
                      }));
                      setNewTestCcInput('');
                    }
                  }}
                  placeholder="Add Test Mode Global CC email..."
                  className="flex-1 px-2.5 py-1.5 rounded-lg border border-amber-300 dark:border-amber-800 bg-white dark:bg-slate-900 text-[11px] font-mono"
                />
                <button
                  type="button"
                  onClick={() => {
                    const clean = newTestCcInput.trim().toLowerCase();
                    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(clean)) return;
                    setTestGlobalRecipients((prev) => ({
                      ...prev,
                      baseCcList: Array.from(new Set([...(prev?.baseCcList || []), clean]))
                    }));
                    setNewTestCcInput('');
                  }}
                  className="px-2.5 py-1.5 rounded-lg bg-slate-900 dark:bg-slate-700 text-white text-[11px] font-bold cursor-pointer"
                >
                  Add Test CC
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* Supabase Connection Status Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex items-center justify-between border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <Database className="w-5 h-5 text-brand-600 dark:text-brand-400" />
            <h2 className="text-base font-bold text-slate-900 dark:text-white">Supabase Backend Connection</h2>
          </div>

          <button
            onClick={handleCheckConnection}
            disabled={connectionStatus.loading}
            className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-300 text-xs font-medium rounded-xl border border-slate-200 dark:border-slate-700 flex items-center space-x-1.5 transition-colors"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${connectionStatus.loading ? 'animate-spin' : ''}`} />
            <span>{connectionStatus.loading ? 'Testing...' : 'Test Connection'}</span>
          </button>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans">ENDPOINT (VITE_SUPABASE_URL)</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5">{supabaseUrl}</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans">ANON KEY (VITE_SUPABASE_ANON_KEY)</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5">
              {supabaseKey.slice(0, 14)}...{supabaseKey.slice(-6)}
            </span>
          </div>
        </div>

        {/* Connection Result Badge */}
        <div className={`p-4 rounded-2xl border flex items-center space-x-3 text-xs ${
          connectionStatus.connected 
            ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300' 
            : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-500/40 text-amber-800 dark:text-amber-300'
        }`}>
          {connectionStatus.connected ? (
            <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
          ) : (
            <AlertCircle className="w-5 h-5 text-amber-500 shrink-0" />
          )}
          <div>
            <div className="font-bold text-sm">
              {connectionStatus.connected ? 'Supabase Backend Connected' : 'Offline / Mock Redundancy Mode'}
            </div>
            <div className="text-[11px] opacity-90 mt-0.5">
              {connectionStatus.message || 'Ready'}
            </div>
          </div>
        </div>
      </div>

      {/* Google SMTP Email Dispatch Service Card */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-3">
          <div className="flex items-center space-x-2.5">
            <Mail className="w-5 h-5 text-indigo-600 dark:text-indigo-400" />
            <div>
              <h2 className="text-base font-bold text-slate-900 dark:text-white">Google SMTP Notification Service</h2>
              <span className="text-xs text-slate-500 dark:text-slate-400">
                Automated intake alerts &amp; Daily {formatTime12hFromHhmm(matrixConfig.autoSendTimePht || '13:00')} PHT Overall RMA Matrix (.xlsx) dispatcher
              </span>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleSendDailyMatrixNow}
              disabled={dailyMatrixStatus.loading}
              className="px-3.5 py-1.5 bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-bold rounded-xl flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs disabled:opacity-60"
            >
              {dailyMatrixStatus.loading ? (
                <RefreshCw className="w-3.5 h-3.5 animate-spin" />
              ) : (
                <FileSpreadsheet className="w-3.5 h-3.5" />
              )}
              <span>{dailyMatrixStatus.loading ? 'Dispatching Matrix...' : 'Send Manual Matrix Email Now'}</span>
            </button>

            <button
              type="button"
              onClick={handleTestSmtp}
              disabled={smtpStatus.loading}
              className="px-3.5 py-1.5 bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/70 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 text-xs font-bold rounded-xl border border-indigo-200 dark:border-indigo-800 flex items-center space-x-1.5 transition-colors cursor-pointer shadow-2xs"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${smtpStatus.loading ? 'animate-spin' : ''}`} />
              <span>{smtpStatus.loading ? 'Authenticating...' : 'Test SMTP Credentials'}</span>
            </button>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-2 px-3.5 py-2.5 rounded-2xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-900/50 text-xs">
          <div className="flex items-center gap-2 text-emerald-900 dark:text-emerald-200 font-semibold">
            <Send className="w-3.5 h-3.5 text-emerald-600 dark:text-emerald-400 shrink-0" />
            <span>
              <strong>Daily Auto-Email Schedule:</strong> {formatTime12hFromHhmm(matrixConfig.autoSendTimePht || '13:00')} PHT (<code className="font-mono">Asia/Manila</code>) {matrixConfig.autoEnabled !== false ? '— Enabled' : '— Paused'} — Sends Overall RMA Matrix (<code className="font-mono">.xlsx</code>) using configured schedules &amp; recipients.
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 text-xs font-mono">
          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans font-semibold">SENDER ACCOUNT (GMAIL_USER)</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5 font-bold">finance2@keysysincorporated.com</span>
          </div>

          <div className="bg-slate-50 dark:bg-slate-950 p-3 rounded-2xl border border-slate-200 dark:border-slate-800">
            <span className="text-slate-400 text-[10px] block font-sans font-semibold">GMAIL APP PASSWORD STATUS</span>
            <span className="text-slate-800 dark:text-slate-200 truncate block mt-0.5 font-bold">
              {smtpStatus.checked ? (smtpStatus.success ? '✓ 16-character key authenticated' : `Detected: ${smtpStatus.passLength || 0} chars`) : 'Configured in Vercel'}
            </span>
          </div>
        </div>

        {dailyMatrixStatus.done && (
          <div className={`p-3.5 rounded-2xl border text-xs space-y-1 animate-in fade-in ${
            dailyMatrixStatus.success
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-700 text-emerald-900 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-700 text-rose-900 dark:text-rose-200'
          }`}>
            <div className="font-bold flex items-center gap-2">
              {dailyMatrixStatus.success ? (
                <CheckCircle2 className="w-4 h-4 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-4 h-4 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <span>{dailyMatrixStatus.message}</span>
            </div>
            {dailyMatrixStatus.detail && (
              <div className="text-[11px] font-mono opacity-85 pl-6">{dailyMatrixStatus.detail}</div>
            )}
          </div>
        )}

        {smtpStatus.checked && (
          <div className={`p-4 rounded-2xl border space-y-2 text-xs animate-in fade-in ${
            smtpStatus.success
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-500/40 text-emerald-800 dark:text-emerald-300'
              : 'bg-rose-50 dark:bg-rose-950/60 border-rose-200 dark:border-rose-500/40 text-rose-800 dark:text-rose-300'
          }`}>
            <div className="flex items-center space-x-2.5">
              {smtpStatus.success ? (
                <CheckCircle2 className="w-5 h-5 text-emerald-600 dark:text-emerald-400 shrink-0" />
              ) : (
                <AlertCircle className="w-5 h-5 text-rose-600 dark:text-rose-400 shrink-0" />
              )}
              <div className="font-bold text-sm">
                {smtpStatus.success ? 'Google SMTP Verified & Operational' : 'SMTP Authentication Error (Bad Credentials)'}
              </div>
            </div>
            <div className="text-[11px] leading-relaxed font-mono">
              {smtpStatus.message}
            </div>
            {smtpStatus.diagnostic && (
              <div className="mt-2 p-2.5 bg-rose-100/80 dark:bg-rose-900/40 rounded-xl text-[11px] font-sans text-rose-900 dark:text-rose-200 border border-rose-200 dark:border-rose-800/60">
                <strong>💡 Troubleshooting Guide:</strong> {smtpStatus.diagnostic}
              </div>
            )}
            {smtpStatus.hadSpaces && (
              <div className="text-[11px] text-amber-700 dark:text-amber-300 font-sans font-semibold">
                ℹ️ Note: Your App Password in Vercel contained spaces. The system has automatically stripped them for pure 16-character authentication.
              </div>
            )}
          </div>
        )}
      </div>
      </>
      )}

      {showSchedulesTab && (
      <div className="space-y-5">
        {/* Configurable Auto Daily Matrix & Manual Matrix Schedule Controls */}
        <div className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <span className="font-black uppercase tracking-wider text-slate-700 dark:text-slate-200">
              Auto Daily ({formatTime12hFromHhmm(matrixConfig.autoSendTimePht || '13:00')} PHT) &amp; Manual Overall Matrix Settings
            </span>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={handleSyncAutoAndManualMatrixRecipients}
                className="px-2.5 py-1 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-[11px] font-bold cursor-pointer"
              >
                Sync Recipients Between Auto &amp; Manual
              </button>
              <button
                type="button"
                onClick={handleSaveMatrixConfig}
                disabled={isSavingMatrixConfig}
                className="px-3 py-1 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                <span>{isSavingMatrixConfig ? 'Saving...' : 'Save Matrix Config'}</span>
              </button>
            </div>
          </div>

          {matrixConfigFeedback && (
            <div className={`p-2.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 ${
              matrixConfigFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200'
            }`}>
              {matrixConfigFeedback.type === 'success' ? <CheckCircle2 className="w-3.5 h-3.5 shrink-0" /> : <AlertCircle className="w-3.5 h-3.5 shrink-0" />}
              <span>{matrixConfigFeedback.message}</span>
            </div>
          )}

          {/* Include All Records (Start to Finish) — Default ON */}
          <div className="p-3 rounded-xl bg-emerald-50/70 dark:bg-emerald-950/30 border border-emerald-200 dark:border-emerald-800/70 space-y-1">
            <label className="flex items-center gap-2 text-xs font-black text-emerald-950 dark:text-emerald-200 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Include All Records (Start to Finish)"
                checked={matrixConfig.includeAllRecords !== false}
                onChange={(e) => setMatrixConfig((p) => ({ ...p, includeAllRecords: e.target.checked }))}
                className="rounded border-emerald-400 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Include All Records (Start to Finish)</span>
              {matrixConfig.includeAllRecords !== false && (
                <span className="px-2 py-0.5 rounded-full text-[10px] font-black bg-emerald-600 text-white uppercase">
                  All-Time Default ON
                </span>
              )}
            </label>
            <p className="text-[11px] text-emerald-800/85 dark:text-emerald-300/85 pl-6">
              {matrixConfig.includeAllRecords !== false
                ? 'Auto-emailed Daily Overall Matrix includes every record from start to finish through today. Uncheck to filter by Rolling Days or Custom Date Range below.'
                : 'Filtered mode active: Matrix emails will use the Rolling Days or Custom Date Range configured below.'}
            </p>
          </div>

          {/* Range Mode + Scope */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">
                Date Window Mode {matrixConfig.includeAllRecords !== false ? '(Used When Unchecked)' : ''}
              </span>
              <div className="flex flex-wrap items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setMatrixConfig((p) => ({ ...p, rangeMode: 'rolling' }))}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black border cursor-pointer ${
                    matrixConfig.rangeMode === 'rolling'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  Rolling Days
                </button>
                <button
                  type="button"
                  onClick={() => setMatrixConfig((p) => ({ ...p, rangeMode: 'custom' }))}
                  className={`px-3 py-1.5 rounded-xl text-[11px] font-black border cursor-pointer ${
                    matrixConfig.rangeMode === 'custom'
                      ? 'bg-emerald-600 text-white border-emerald-600'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  Custom Date Range
                </button>
              </div>
            </div>

            <div className="space-y-1.5">
              <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">Report Scope</span>
              <select
                aria-label="Matrix Scope"
                value={matrixConfig.stream}
                onChange={(e) => setMatrixConfig((p) => ({ ...p, stream: e.target.value }))}
                className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white"
              >
                <option value="overall">Overall RMA (Customer Hub + Supplier RTV)</option>
                <option value="customer_inbound">Customer Hub Only</option>
                <option value="supplier_outbound">Supplier RTV Only</option>
              </select>
            </div>
          </div>

          {matrixConfig.rangeMode === 'rolling' ? (
            <div className="flex flex-wrap items-center gap-2">
              <span className="text-[11px] font-bold text-slate-500">Rolling Window:</span>
              {[7, 14, 30].map((d) => (
                <button
                  key={d}
                  type="button"
                  onClick={() => setMatrixConfig((p) => ({ ...p, rollingDays: d }))}
                  className={`px-2.5 py-1 rounded-lg text-[11px] font-bold border cursor-pointer ${
                    Number(matrixConfig.rollingDays) === d
                      ? 'bg-slate-900 text-white border-slate-900 dark:bg-blue-600 dark:border-blue-500'
                      : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-slate-300 dark:border-slate-700'
                  }`}
                >
                  {d} Days
                </button>
              ))}
              <label className="flex items-center gap-1 text-[11px] font-mono">
                <span>Custom Days:</span>
                <input
                  type="number"
                  min={1}
                  max={365}
                  value={matrixConfig.rollingDays}
                  onChange={(e) => setMatrixConfig((p) => ({ ...p, rollingDays: Math.max(1, Math.min(365, parseInt(e.target.value, 10) || 14)) }))}
                  className="w-16 px-2 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 font-bold text-center"
                />
              </label>
            </div>
          ) : (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">Start Date</span>
                <input
                  type="date"
                  aria-label="Matrix Start Date"
                  value={matrixConfig.startDate || ''}
                  max={matrixConfig.endDate || undefined}
                  onChange={(e) => setMatrixConfig((p) => ({ ...p, startDate: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold"
                />
              </label>
              <label className="space-y-1">
                <span className="text-[11px] font-bold text-slate-600 dark:text-slate-300 block">End Date</span>
                <input
                  type="date"
                  aria-label="Matrix End Date"
                  value={matrixConfig.endDate || ''}
                  min={matrixConfig.startDate || undefined}
                  onChange={(e) => setMatrixConfig((p) => ({ ...p, endDate: e.target.value }))}
                  className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold"
                />
              </label>
            </div>
          )}

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Auto Daily Matrix Email Enabled"
                checked={matrixConfig.autoEnabled !== false}
                onChange={(e) => setMatrixConfig((p) => ({ ...p, autoEnabled: e.target.checked }))}
                className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
              />
              <span>Auto-Email Matrix Daily at Scheduled Time</span>
            </label>
            <label className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-slate-200">
              <span className="flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-emerald-600" /> Auto-Send Time (Asia/Manila):</span>
              <input
                type="time"
                aria-label="Matrix Auto-Send Time (Asia/Manila HH:mm)"
                value={matrixConfig.autoSendTimePht || '13:00'}
                onChange={(e) => setMatrixConfig((p) => ({ ...p, autoSendTimePht: e.target.value || '13:00' }))}
                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold text-xs text-slate-900 dark:text-white"
              />
            </label>
          </div>

          <label className="flex items-center gap-2 text-[11px] font-semibold text-slate-700 dark:text-slate-200 cursor-pointer">
            <input
              type="checkbox"
              checked={Boolean(matrixConfig.includeZeroCatalogSkus)}
              onChange={(e) => setMatrixConfig((p) => ({ ...p, includeZeroCatalogSkus: e.target.checked }))}
              className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
            />
            <span>Include 0-return catalog SKUs inside scheduled / manual Matrix exports</span>
          </label>

          <EmailRecipientsEditor
            emailType="daily_matrix_auto"
            compact={true}
            defaultExpanded={false}
            isTestMode={isTestMode}
            title={`Auto Daily ${formatTime12hFromHhmm(matrixConfig.autoSendTimePht || '13:00')} PHT Matrix Recipients`}
          />
        </div>

        {/* 10-Calendar-Day Pickup Follow-Up Schedule (Automated Backend Scheduler) */}
        <div className="p-4 rounded-2xl bg-amber-50/50 dark:bg-amber-950/20 border border-amber-200 dark:border-amber-800/70 space-y-3.5 text-xs">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <span className="font-black uppercase tracking-wider text-amber-950 dark:text-amber-200 flex items-center gap-1.5">
                <Clock className="w-4 h-4 text-amber-600" />
                <span>10-Calendar-Day Pickup Follow-Up Schedule ({formatTime12hFromHhmm(followUpConfig.autoSendTimePht || '13:00')} PHT)</span>
              </span>
              <p className="text-[11px] text-amber-900/80 dark:text-amber-300/80 mt-0.5">
                Automated backend scheduler sends daily pickup reminders up to Day 10, stops on pickup/case close, and auto-scraps overdue unclaimed items after Day 10.
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                onClick={() => setIsDirectoryOpen(true)}
                className="px-3 py-1.5 rounded-xl bg-slate-900 hover:bg-slate-800 text-white text-[11px] font-black flex items-center gap-1.5 cursor-pointer"
              >
                <BookOpen className="w-3 h-3 text-amber-400" />
                <span>📒 Supplier Emails Directory</span>
              </button>
              <button
                type="button"
                onClick={handleSaveFollowUpConfig}
                disabled={isSavingFollowUpConfig}
                className="px-3 py-1.5 rounded-xl bg-blue-600 hover:bg-blue-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3 h-3" />
                <span>{isSavingFollowUpConfig ? 'Saving...' : 'Save Follow-Up SLA'}</span>
              </button>
            </div>
          </div>

          {followUpConfigFeedback && (
            <div className={`p-2.5 rounded-xl border text-[11px] font-bold flex items-center gap-1.5 ${
              followUpConfigFeedback.type === 'success'
                ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
                : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200'
            }`}>
              <CheckCircle2 className="w-3.5 h-3.5 shrink-0" />
              <span>{followUpConfigFeedback.message}</span>
            </div>
          )}

          <div className="grid grid-cols-1 md:grid-cols-3 gap-3 p-3 rounded-xl bg-white dark:bg-slate-900 border border-amber-200/80 dark:border-slate-800">
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Auto Daily Follow-Up Enabled"
                checked={followUpConfig.autoEnabled !== false}
                onChange={(e) => {
                  followUpDirtyRef.current = true;
                  setFollowUpConfig((p) => ({ ...p, autoEnabled: e.target.checked }));
                }}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span>Auto-Send Daily Follow-Ups (10-Day SLA)</span>
            </label>
            <label className="flex items-center gap-2 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer">
              <input
                type="checkbox"
                aria-label="Customer Hub Default Follow-Up Enabled"
                checked={Boolean(followUpConfig.customerFollowUpDefaultEnabled)}
                onChange={(e) => {
                  followUpDirtyRef.current = true;
                  setFollowUpConfig((p) => ({ ...p, customerFollowUpDefaultEnabled: e.target.checked }));
                }}
                className="rounded border-slate-300 text-amber-600 focus:ring-amber-500"
              />
              <span>Default Follow-Up ON for Customer Hub RMAs</span>
            </label>
            <label className="flex items-center justify-between gap-2 text-[11px] font-bold text-slate-700 dark:text-slate-200">
              <span>Auto-Send Time (Asia/Manila):</span>
              <input
                type="time"
                aria-label="Follow-Up Auto-Send Time (Asia/Manila HH:mm)"
                value={followUpConfig.autoSendTimePht || '13:00'}
                onChange={(e) => {
                  followUpDirtyRef.current = true;
                  setFollowUpConfig((p) => ({ ...p, autoSendTimePht: e.target.value || '13:00' }));
                }}
                className="px-2.5 py-1 rounded-lg border border-slate-300 dark:border-slate-700 bg-slate-50 dark:bg-slate-950 font-mono font-bold text-xs text-slate-900 dark:text-white"
              />
            </label>
          </div>

          <EmailRecipientsEditor
            emailType="supplier_followup"
            allowEmptyTo={true}
            compact={true}
            defaultExpanded={false}
            isTestMode={isTestMode}
            title="Supplier Follow-Up Extra Internal CCs"
          />

          {/* TEST MODE SANDBOX ACCELERATED 10-DAY SLA TIMER (STRICTLY ISOLATED TO TEST SANDBOX) */}
          <div
            data-testid="test-sla-acceleration-card"
            className="p-4 rounded-2xl bg-amber-100/60 dark:bg-amber-950/40 border-2 border-amber-300 dark:border-amber-700 space-y-3 text-xs"
          >
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <div className="font-black uppercase tracking-wider text-amber-950 dark:text-amber-100 flex items-center gap-1.5">
                  <Zap className="w-4 h-4 text-amber-600 shrink-0" />
                  <span>Test Mode SLA Speed / Step Interval (Sandbox Only)</span>
                  <span className="px-2 py-0.5 rounded-full text-[9.5px] font-black bg-amber-500 text-slate-950 uppercase">
                    {Number(followUpConfig.testStepIntervalSeconds || 0) > 0
                      ? `1 Day = ${formatDurationCompact(followUpConfig.testStepIntervalSeconds)}`
                      : 'Normal (1 Day)'}
                  </span>
                </div>
                <p className="text-[11px] text-amber-900/90 dark:text-amber-300/90 mt-0.5">
                  Accelerate simulated &ldquo;days&rdquo; into seconds/minutes so you can test Day 1 → Day 10 follow-up emails and Day 10 Auto-Dispose end-to-end in minutes. <strong>Strictly isolated to Test Mode Sandbox RMAs only — Live Production RMAs NEVER accelerate.</strong>
                </p>
              </div>
              <button
                type="button"
                onClick={handleSaveFollowUpConfig}
                disabled={isSavingFollowUpConfig}
                className="px-3.5 py-1.5 rounded-xl bg-amber-600 hover:bg-amber-700 text-white text-[11px] font-black flex items-center gap-1.5 shadow-xs cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingFollowUpConfig ? 'Saving...' : 'Save Test Speed'}</span>
              </button>
            </div>

            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-[11px] font-bold text-amber-950 dark:text-amber-200 mr-1">Speed Presets:</span>
              {[
                { label: 'Normal (1 Manila Day)', sec: 0 },
                { label: '2 min / day', sec: 120 },
                { label: '1 min / day', sec: 60 },
                { label: '30 sec / day', sec: 30 }
              ].map((preset) => {
                const isSelected = Number(followUpConfig.testStepIntervalSeconds || 0) === preset.sec;
                return (
                  <button
                    key={preset.sec}
                    type="button"
                    onClick={() => {
                      followUpDirtyRef.current = true;
                      setFollowUpConfig((p) => ({ ...p, testStepIntervalSeconds: preset.sec }));
                    }}
                    className={`px-2.5 py-1 rounded-lg text-[11px] font-black border cursor-pointer transition-all ${
                      isSelected
                        ? 'bg-slate-900 text-white border-slate-900 dark:bg-amber-500 dark:text-slate-950 dark:border-amber-400 shadow-2xs'
                        : 'bg-white dark:bg-slate-900 text-slate-700 dark:text-slate-300 border-amber-300 dark:border-amber-800 hover:bg-amber-50'
                    }`}
                  >
                    {preset.label}
                  </button>
                );
              })}

              <label className="flex items-center gap-1.5 text-[11px] font-bold text-amber-950 dark:text-amber-200 ml-1">
                <Timer className="w-3.5 h-3.5 text-amber-700 dark:text-amber-400" />
                <span>Custom (sec):</span>
                <input
                  type="number"
                  min={0}
                  max={86400}
                  aria-label="Test Mode Simulated Day Interval Seconds"
                  value={Number(followUpConfig.testStepIntervalSeconds || 0)}
                  onChange={(e) => {
                    followUpDirtyRef.current = true;
                    const rawVal = parseInt(e.target.value, 10);
                    setFollowUpConfig((p) => ({
                      ...p,
                      testStepIntervalSeconds: !rawVal || rawVal <= 0 ? 0 : normalizeTestStepIntervalSeconds(rawVal)
                    }));
                  }}
                  className="w-20 px-2 py-1 rounded-lg border border-amber-300 dark:border-amber-700 bg-white dark:bg-slate-900 font-mono font-bold text-center text-slate-900 dark:text-white"
                  placeholder="0"
                />
              </label>
            </div>

            <div className="p-2.5 rounded-xl bg-white/90 dark:bg-slate-900/90 border border-amber-200 dark:border-amber-800 flex flex-wrap items-center justify-between gap-2">
              <label className="flex items-center gap-2 text-[11px] font-bold text-slate-800 dark:text-slate-200 cursor-pointer">
                <input
                  type="checkbox"
                  aria-label="Test Mode Automated Cron Sweep Enabled"
                  checked={Boolean(followUpConfig.testAutoCronEnabled)}
                  onChange={(e) => {
                    followUpDirtyRef.current = true;
                    setFollowUpConfig((p) => ({ ...p, testAutoCronEnabled: e.target.checked }));
                  }}
                  className="rounded border-amber-400 text-amber-600 focus:ring-amber-500"
                />
                <span>Allow Automated 1-Minute Cron to Advance Test Mode Sandbox RMAs (bypasses 1:00 PM PHT gate for Sandbox only)</span>
              </label>
            </div>
          </div>
        </div>

        {/* 2-Way Email Reply Sync (IMAP) Health & Persistent Logs */}
        <div
          data-testid="reply-sync-diagnostics-panel"
          className="p-5 sm:p-6 rounded-3xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 shadow-sm space-y-3 text-xs"
        >
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <div className="font-black uppercase tracking-wider text-slate-800 dark:text-slate-100 flex items-center gap-1.5">
                <RefreshCw className={`w-3.5 h-3.5 text-indigo-600 ${replySyncDiagnostics.runningSync ? 'animate-spin' : ''}`} />
                <span>2-Way Email Reply Sync (IMAP) Health &amp; Logs</span>
              </div>
              <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-0.5">
                Monitors automatic background Gmail IMAP syncs, unauthorized sender skips, and TLS/auth failures (failed &amp; unauthorized replies are never burned).
              </p>
            </div>
            <div className="flex flex-wrap items-center gap-1.5">
              <button
                type="button"
                onClick={() => loadReplySyncLogs(true)}
                disabled={replySyncDiagnostics.loading}
                className="px-2.5 py-1 rounded-xl bg-white hover:bg-slate-100 dark:bg-slate-900 dark:hover:bg-slate-800 text-slate-700 dark:text-slate-200 border border-slate-300 dark:border-slate-700 text-[11px] font-bold flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${replySyncDiagnostics.loading ? 'animate-spin' : ''}`} />
                <span>Refresh Logs</span>
              </button>
              <button
                type="button"
                onClick={handleRunDiagnosticReplySync}
                disabled={replySyncDiagnostics.runningSync}
                className="px-3 py-1 rounded-xl bg-indigo-600 hover:bg-indigo-700 text-white text-[11px] font-black flex items-center gap-1 cursor-pointer disabled:opacity-50"
              >
                <RefreshCw className={`w-3 h-3 ${replySyncDiagnostics.runningSync ? 'animate-spin' : ''}`} />
                <span>{replySyncDiagnostics.runningSync ? 'Syncing IMAP...' : 'Test IMAP Sync Now'}</span>
              </button>
            </div>
          </div>

          {replySyncDiagnostics.error && (
            <div className="p-2.5 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-800 dark:text-rose-200 text-[11px] font-semibold">
              {replySyncDiagnostics.error}
            </div>
          )}

          {replySyncDiagnostics.statusSummary && (
            <div className="grid grid-cols-1 sm:grid-cols-4 gap-2 text-[11px]">
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] font-bold uppercase text-slate-400">Last Sync Run</div>
                <div className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                  {replySyncDiagnostics.statusSummary.lastRunAt
                    ? formatDateTimeYmdHm(replySyncDiagnostics.statusSummary.lastRunAt)
                    : 'Never'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5 truncate">
                  Source: {replySyncDiagnostics.statusSummary.lastTriggerSource || '—'}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] font-bold uppercase text-slate-400">Latest Status</div>
                <div className="mt-0.5">
                  <span className={`inline-block px-2 py-0.5 rounded-full text-[10px] font-black uppercase ${
                    replySyncDiagnostics.statusSummary.lastStatus === 'error'
                      ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                      : replySyncDiagnostics.statusSummary.lastStatus === 'unauthorized' || replySyncDiagnostics.statusSummary.lastStatus === 'partial'
                        ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                        : replySyncDiagnostics.statusSummary.lastStatus === 'skipped_non_rma' || replySyncDiagnostics.statusSummary.lastStatus === 'idle'
                          ? 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          : 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                  }`}>
                    {replySyncDiagnostics.statusSummary.lastStatus || 'idle'}
                  </span>
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Processed IDs: {replySyncDiagnostics.processedMessageIdCount}
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] font-bold uppercase text-slate-400">Last Success</div>
                <div className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                  {replySyncDiagnostics.statusSummary.lastSuccessAt
                    ? formatDateTimeYmdHm(replySyncDiagnostics.statusSummary.lastSuccessAt)
                    : 'None yet'}
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Duration: {replySyncDiagnostics.statusSummary.durationMs || 0} ms
                </div>
              </div>
              <div className="p-2.5 rounded-xl bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800">
                <div className="text-[10px] font-bold uppercase text-slate-400">Last Scan Stats</div>
                <div className="font-mono font-bold text-slate-800 dark:text-slate-100 mt-0.5">
                  {replySyncDiagnostics.statusSummary.lastStats?.scannedRecentMessages ?? 0} msgs / {replySyncDiagnostics.statusSummary.lastStats?.updatedCount ?? 0} updated
                </div>
                <div className="text-[10px] text-slate-500 mt-0.5">
                  Unauth: {replySyncDiagnostics.statusSummary.lastStats?.unauthorizedCount ?? 0} • Err: {replySyncDiagnostics.statusSummary.lastStats?.errorCount ?? 0}
                </div>
              </div>
            </div>
          )}

          {replySyncDiagnostics.statusSummary?.lastErrorMessage && (
            <div className="p-3 rounded-xl border border-rose-200 dark:border-rose-800 bg-rose-50 dark:bg-rose-950/50 text-rose-900 dark:text-rose-200 text-[11px] space-y-1">
              <div className="font-bold">
                Latest IMAP Error ({replySyncDiagnostics.statusSummary.lastErrorCode || 'ERROR'}): {replySyncDiagnostics.statusSummary.lastErrorMessage}
              </div>
              {replySyncDiagnostics.statusSummary.lastDiagnosticHint && (
                <div>💡 {replySyncDiagnostics.statusSummary.lastDiagnosticHint}</div>
              )}
            </div>
          )}

          <div className="max-h-56 overflow-y-auto rounded-xl border border-slate-200 dark:border-slate-800 bg-white dark:bg-slate-900">
            {replySyncDiagnostics.logs.length === 0 ? (
              <div className="p-3 text-[11px] text-slate-500 italic text-center">
                No notable sync events recorded yet (updated replies, unauthorized skips, and errors are logged here automatically).
              </div>
            ) : (
              <table className="w-full text-left border-collapse text-[11px]">
                <thead>
                  <tr className="bg-slate-100 dark:bg-slate-800/70 text-[10px] font-black uppercase text-slate-500 border-b border-slate-200 dark:border-slate-800">
                    <th className="px-2.5 py-1.5">Time (PHT)</th>
                    <th className="px-2.5 py-1.5">Trigger</th>
                    <th className="px-2.5 py-1.5">Status</th>
                    <th className="px-2.5 py-1.5">Details / Errors</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100 dark:divide-slate-800">
                  {replySyncDiagnostics.logs.slice(0, 25).map((entry) => {
                    const detailSummary = Array.isArray(entry.details) && entry.details.length > 0
                      ? entry.details.map((d) => `${d.rmaNumber || d.filename || 'item'} (${d.from || 'unknown'}: ${d.status}${d.changedFields?.length ? ` [${d.changedFields.join(', ')}]` : ''}${d.reason ? ` - ${d.reason}` : ''}${d.error ? ` - ${d.error}` : ''})`).join('; ')
                      : (entry.error || `${entry.scannedRecentMessages || 0} recent messages scanned`);
                    return (
                      <tr key={entry.id || entry.timestamp} className="align-top">
                        <td className="px-2.5 py-1.5 font-mono whitespace-nowrap text-slate-700 dark:text-slate-300">
                          {formatDateTimeYmdHm(entry.lastSeenAt || entry.timestamp)}
                          {Number(entry.attemptCount) > 1 ? ` (×${entry.attemptCount})` : ''}
                        </td>
                        <td className="px-2.5 py-1.5 font-mono text-slate-600 dark:text-slate-400 whitespace-nowrap">
                          {entry.triggerSource || '—'}
                        </td>
                        <td className="px-2.5 py-1.5 whitespace-nowrap">
                          <span className={`px-1.5 py-0.5 rounded font-black text-[10px] uppercase ${
                            entry.status === 'error'
                              ? 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300'
                              : entry.status === 'unauthorized' || entry.status === 'partial'
                                ? 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300'
                                : entry.status === 'updated'
                                  ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300'
                                  : 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300'
                          }`}>
                            {entry.status}
                          </span>
                        </td>
                        <td className="px-2.5 py-1.5 text-slate-700 dark:text-slate-200 break-words">
                          {detailSummary}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        </div>
      </div>
      )}

      {showConnectionsTab && (
      <>
      {/* 3. Public Reporting Portal Access QR & Dock Posters */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20">
              <QrCode className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 dark:text-white text-base">Public Reporting Portal Access QR</h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">Generate high-res QR codes and printable posters for receiving docks & store repackers</p>
            </div>
          </div>

          {onOpenPortalQr && (
            <button
              type="button"
              onClick={onOpenPortalQr}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-bold flex items-center gap-1.5 transition-colors shadow-sm cursor-pointer self-start sm:self-auto"
            >
              <QrCode className="w-4 h-4" />
              <span>View & Download Poster</span>
            </button>
          )}
        </div>

        <p className="text-xs text-slate-600 dark:text-slate-400 leading-relaxed">
          Users who report products do not need login credentials. They simply scan the QR code posted at your receiving docks or return desks to launch the portal, scan the retail barcode, attach photos of damaged items, and print box verification stickers.
        </p>
      </div>
      </>
      )}

      {showApiKeysView && (
      <>
      {/* Standalone Enterprise Page Header: API Keys & Webhooks */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row sm:items-center justify-between gap-3">
        <div>
          <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-indigo-50 dark:bg-indigo-500/20 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-500/40">
            Access &amp; Integrations
          </span>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
            <KeyRound className="w-6 h-6 text-indigo-600 dark:text-indigo-400" />
            <span>API Keys &amp; Webhooks</span>
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Manage SHA-256 external system API keys, ERP/WMS integrations, Live Catalog API key, and OpenAPI Swagger documentation.
          </p>
        </div>
      </div>

      {/* 4. Live Product Catalog API Integration (EXTERNAL_API_KEY_DANILO) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 sm:p-7 shadow-sm space-y-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 border-b border-slate-100 dark:border-slate-800 pb-4">
          <div className="flex items-center space-x-3">
            <div className="p-2.5 rounded-2xl bg-indigo-50 dark:bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 border border-indigo-200 dark:border-indigo-500/20">
              <KeyRound className="w-5 h-5" />
            </div>
            <div>
              <h2 className="font-extrabold text-slate-900 dark:text-white text-base flex items-center gap-2">
                <span>Live Product Catalog API (SKU Auto-Suggestions)</span>
                <span className="text-[10px] px-2 py-0.5 rounded-full bg-indigo-100 dark:bg-indigo-950 text-indigo-800 dark:text-indigo-300 font-mono font-bold">
                  EXTERNAL_API_KEY_DANILO
                </span>
              </h2>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Direct integration with Enterprise Laravel Cloud product catalog (5,793+ SKUs in erply_products)
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={handleCheckPoApi}
              disabled={poApiStatus.loading}
              className="px-3 py-1.5 bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 rounded-xl text-xs font-bold flex items-center space-x-1.5 transition-colors disabled:opacity-50 cursor-pointer"
            >
              <RefreshCw className={`w-3.5 h-3.5 ${poApiStatus.loading ? 'animate-spin text-blue-600' : ''}`} />
              <span>{poApiStatus.loading ? 'Testing...' : 'Test Connection'}</span>
            </button>
          </div>
        </div>

        {/* Status result strip */}
        {poApiStatus.checked && (
          <div className={`p-3.5 rounded-2xl border text-xs flex items-center gap-2.5 ${
            poApiStatus.connected
              ? 'bg-emerald-50 dark:bg-emerald-950/60 border-emerald-200 dark:border-emerald-800 text-emerald-800 dark:text-emerald-300'
              : 'bg-amber-50 dark:bg-amber-950/60 border-amber-200 dark:border-amber-800 text-amber-900 dark:text-amber-200'
          }`}>
            {poApiStatus.connected ? (
              <CheckCircle2 className="w-4 h-4 text-emerald-600 shrink-0" />
            ) : (
              <AlertCircle className="w-4 h-4 text-amber-600 shrink-0" />
            )}
            <span className="font-semibold">{poApiStatus.message}</span>
          </div>
        )}

        <div className="space-y-3">
          <div>
            <label className="block text-xs font-bold text-slate-700 dark:text-slate-300 mb-1">
              API Base URL
            </label>
            <div className="p-2.5 bg-slate-50 dark:bg-slate-950 rounded-xl font-mono text-xs text-slate-700 dark:text-slate-300 border border-slate-200 dark:border-slate-800">
              https://purchase-order-db-production-ff1oho.laravel.cloud/api/v1
            </div>
          </div>

          <div>
            <div className="flex items-center justify-between mb-1">
              <label className="text-xs font-bold text-slate-700 dark:text-slate-300">
                Danilo's Private API Key (Header: <code className="font-mono">X-API-Key</code>)
              </label>
              {poKeyFeedback && (
                <span className={`text-[11px] font-bold ${poKeyFeedback.type === 'success' ? 'text-emerald-600' : 'text-rose-600'}`}>
                  {poKeyFeedback.message}
                </span>
              )}
            </div>

            <div className="flex items-center gap-2">
              <input
                type="text"
                value={poApiKey}
                onChange={(e) => setPoApiKey(e.target.value)}
                placeholder="Paste EXTERNAL_API_KEY_DANILO private key here..."
                className="flex-1 px-3 py-2 bg-slate-50 dark:bg-slate-950 border border-slate-300 dark:border-slate-700 rounded-xl text-xs font-mono text-slate-900 dark:text-white focus:outline-none focus:border-indigo-600"
              />
              <button
                type="button"
                onClick={handleSavePoKey}
                disabled={isSavingPoKey}
                className="px-4 py-2 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-1.5 shadow-sm transition-all cursor-pointer disabled:opacity-50"
              >
                <Save className="w-3.5 h-3.5" />
                <span>{isSavingPoKey ? 'Saving...' : 'Save Key'}</span>
              </button>
            </div>
            <p className="text-[11px] text-slate-500 dark:text-slate-400 mt-1">
              When assigning SKUs in Admin or Quick Process, typing into SKU or Product Name automatically suggests and auto-populates product details.
            </p>
          </div>
        </div>
      </div>

      {/* 6. MULTI-SYSTEM REST API KEYS & INTEGRATION (SHA-256 HASHED) */}
      <ApiKeysManagementSection />
      </>
      )}

      {showWarehouseLocationsView && (
      <>
      {/* Standalone Enterprise Page Header: Warehouse Locations & GPS */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm">
        <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-blue-50 dark:bg-blue-500/20 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-500/40">
          Directory &amp; Locations
        </span>
        <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
          <MapPin className="w-6 h-6 text-blue-600 dark:text-blue-400" />
          <span>Warehouse Locations &amp; GPS Anchors</span>
        </h1>
        <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
          Configure standard rack/bin staging locations and verified warehouse GPS geofence anchors for accurate watermark pins.
        </p>
      </div>

      {/* 5. WAREHOUSE LOCATIONS MANAGEMENT (CUSTOMIZABLE DROPDOWN) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs space-y-4">
        <div className="flex items-center justify-between pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-blue-100 dark:bg-blue-950/70 text-blue-700 dark:text-blue-300 rounded-2xl shadow-inner">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Standard Warehouse Locations
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Customizable rack, bin, and staging areas used across triage, coworker queues, and label printing.
              </p>
            </div>
          </div>
          <button
            type="button"
            onClick={() => setIsLocationsModalOpen(true)}
            className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-extrabold flex items-center gap-2 shadow-sm transition-all cursor-pointer"
          >
            <span>⚙️ Manage Locations</span>
          </button>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
          {locationsList.map((loc, idx) => (
            <div
              key={loc}
              className="p-3 bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 rounded-2xl flex items-center gap-2.5"
            >
              <span className="w-6 h-6 rounded-lg bg-blue-100 dark:bg-blue-900/60 text-blue-800 dark:text-blue-300 font-mono text-[10px] font-black flex items-center justify-center shrink-0">
                #{idx + 1}
              </span>
              <span className="text-xs font-bold text-slate-800 dark:text-slate-200 truncate font-mono">
                {loc}
              </span>
            </div>
          ))}
        </div>
      </div>

      {/* 5b. KNOWN WAREHOUSE / DOCK GPS ANCHORS (GEOFENCED ADDRESS + MAPS PIN OVERRIDE) */}
      <div
        data-testid="known-gps-anchors-card"
        className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-6 shadow-xs space-y-4"
      >
        <div className="flex flex-wrap items-center justify-between gap-3 pb-4 border-b border-slate-100 dark:border-slate-800">
          <div className="flex items-center gap-3">
            <div className="p-3 bg-emerald-100 dark:bg-emerald-950/70 text-emerald-700 dark:text-emerald-300 rounded-2xl shadow-inner">
              <MapPin className="w-6 h-6" />
            </div>
            <div>
              <h3 className="text-base font-black text-slate-900 dark:text-white">
                Known Warehouse / Dock GPS Anchors
              </h3>
              <p className="text-xs text-slate-500 dark:text-slate-400">
                Priority-1 geofence override for reverse geocoding &amp; Google Maps pins (default: Pingcon Warehouse, 64 Mendez Rd, Baesa, Quezon City 1106).
              </p>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={handleResetDefaultGpsAnchors}
              className="px-3 py-2 rounded-xl bg-slate-100 hover:bg-slate-200 dark:bg-slate-800 dark:hover:bg-slate-700 text-slate-700 dark:text-slate-200 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <RotateCcw className="w-3.5 h-3.5" />
              <span>Reset Default</span>
            </button>
            <button
              type="button"
              onClick={handleAddGpsAnchor}
              className="px-3 py-2 rounded-xl bg-indigo-50 hover:bg-indigo-100 dark:bg-indigo-950/60 dark:hover:bg-indigo-900 text-indigo-700 dark:text-indigo-300 border border-indigo-200 dark:border-indigo-800 text-xs font-bold flex items-center gap-1.5 cursor-pointer"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Anchor</span>
            </button>
            <button
              type="button"
              onClick={handleSaveGpsAnchors}
              disabled={isSavingGpsAnchors}
              className="px-4 py-2 rounded-xl bg-emerald-600 hover:bg-emerald-700 text-white text-xs font-black flex items-center gap-1.5 shadow-sm cursor-pointer disabled:opacity-50"
            >
              <Save className="w-3.5 h-3.5" />
              <span>{isSavingGpsAnchors ? 'Saving...' : 'Save GPS Anchors'}</span>
            </button>
          </div>
        </div>

        {gpsAnchorsFeedback && (
          <div className={`px-3 py-2 rounded-xl border text-xs font-bold flex items-center gap-1.5 ${
            gpsAnchorsFeedback.type === 'success'
              ? 'bg-emerald-50 dark:bg-emerald-950/50 border-emerald-200 dark:border-emerald-700 text-emerald-800 dark:text-emerald-200'
              : 'bg-rose-50 dark:bg-rose-950/50 border-rose-200 dark:border-rose-700 text-rose-800 dark:text-rose-200'
          }`}>
            {gpsAnchorsFeedback.type === 'success' ? <CheckCircle2 className="w-4 h-4 shrink-0" /> : <AlertCircle className="w-4 h-4 shrink-0" />}
            <span>{gpsAnchorsFeedback.message}</span>
          </div>
        )}

        <div className="space-y-3">
          {knownGpsAnchors.map((anchor, idx) => {
            const previewUrl = getGpsMapUrl({
              gps_address: anchor.formatted || formatGpsAddressParts(anchor),
              gps_latitude: anchor.lat,
              gps_longitude: anchor.lon
            });
            return (
              <div
                key={`gps-anchor-${idx}`}
                className="p-4 rounded-2xl bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-800 space-y-3"
              >
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="text-xs font-black text-slate-800 dark:text-slate-100">
                    Anchor #{idx + 1}: {anchor.name || 'Unnamed Dock'}
                  </span>
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      onClick={() => handleCaptureCurrentGpsForAnchor(idx)}
                      className="px-2.5 py-1 rounded-lg bg-white hover:bg-slate-100 dark:bg-slate-800 dark:hover:bg-slate-700 border border-slate-300 dark:border-slate-700 text-[11px] font-bold text-slate-700 dark:text-slate-200 cursor-pointer"
                    >
                      Use My Current GPS
                    </button>
                    {previewUrl && (
                      <a
                        href={previewUrl}
                        target="_blank"
                        rel="noreferrer"
                        className="px-2.5 py-1 rounded-lg bg-blue-50 hover:bg-blue-100 dark:bg-blue-950/50 text-blue-700 dark:text-blue-300 border border-blue-200 dark:border-blue-800 text-[11px] font-bold flex items-center gap-1"
                      >
                        <span>Verify Map Pin</span>
                        <ExternalLink className="w-3 h-3" />
                      </a>
                    )}
                    {knownGpsAnchors.length > 1 && (
                      <button
                        type="button"
                        onClick={() => handleRemoveGpsAnchor(idx)}
                        className="p-1.5 rounded-lg text-slate-400 hover:text-rose-600 hover:bg-rose-50 dark:hover:bg-rose-950/50 cursor-pointer"
                        title="Remove Anchor"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-2.5 text-xs">
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Anchor Name</label>
                    <input
                      type="text"
                      value={anchor.name || ''}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'name', e.target.value)}
                      placeholder="Pingcon Warehouse"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-bold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Street / No.</label>
                    <input
                      type="text"
                      value={anchor.street || ''}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'street', e.target.value)}
                      placeholder="64 Mendez Rd"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Barangay / District</label>
                    <input
                      type="text"
                      value={anchor.barangay || ''}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'barangay', e.target.value)}
                      placeholder="Baesa"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">City</label>
                    <input
                      type="text"
                      value={anchor.city || ''}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'city', e.target.value)}
                      placeholder="Quezon City"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Region &amp; ZIP</label>
                    <div className="grid grid-cols-2 gap-1.5">
                      <input
                        type="text"
                        value={anchor.region || ''}
                        onChange={(e) => handleUpdateGpsAnchor(idx, 'region', e.target.value)}
                        placeholder="Metro Manila"
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                      />
                      <input
                        type="text"
                        value={anchor.zip || ''}
                        onChange={(e) => handleUpdateGpsAnchor(idx, 'zip', e.target.value)}
                        placeholder="1106"
                        className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-bold text-slate-900 dark:text-white"
                      />
                    </div>
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Latitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={anchor.lat ?? ''}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'lat', e.target.value)}
                      placeholder="14.6683"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Longitude</label>
                    <input
                      type="number"
                      step="0.000001"
                      value={anchor.lon ?? ''}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'lon', e.target.value)}
                      placeholder="121.0114"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Radius (Meters)</label>
                    <input
                      type="number"
                      min="25"
                      max="5000"
                      value={anchor.radiusMeters ?? 250}
                      onChange={(e) => handleUpdateGpsAnchor(idx, 'radiusMeters', e.target.value)}
                      placeholder="250"
                      className="w-full px-2.5 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-mono font-semibold text-slate-900 dark:text-white"
                    />
                  </div>
                </div>

                <div>
                  <label className="block text-[10px] font-bold text-slate-500 uppercase mb-1">Formatted Watermark &amp; Display Address</label>
                  <input
                    type="text"
                    value={anchor.formatted || ''}
                    onChange={(e) => handleUpdateGpsAnchor(idx, 'formatted', e.target.value)}
                    placeholder="64 Mendez Rd, Baesa, Quezon City, Metro Manila 1106"
                    className="w-full px-3 py-1.5 rounded-xl border border-slate-300 dark:border-slate-700 bg-white dark:bg-slate-900 text-xs font-semibold text-slate-900 dark:text-white"
                  />
                </div>
              </div>
            );
          })}
        </div>
      </div>

      {/* 6. MULTI-SYSTEM REST API KEYS & INTEGRATION (SHA-256 HASHED) */}
      {/* (Rendered under showApiKeysView above) */}
      </>
      )}

      {/* Warehouse Locations Modal */}
      <WarehouseLocationsModal
        isOpen={isLocationsModalOpen}
        onClose={() => {
          setIsLocationsModalOpen(false);
          setLocationsList(getWarehouseLocations());
        }}
        onLocationsUpdated={(newLocs) => setLocationsList(newLocs)}
      />

      {/* Persistent Supplier Emails Directory Modal */}
      <SupplierDirectoryModal
        isOpen={isDirectoryOpen}
        onClose={() => setIsDirectoryOpen(false)}
      />

    </div>
  );
}

/**
 * AUTOMATED RMA RETURN NOTIFICATION SERVICE
 * 
 * Senders & Recipients Routing:
 * 1. Pingcon / Bonita Products:
 *    - Sender: finance@pingconmarketing.com
 *    - TO: azgodev@gmail.com
 *    - CC: [Customer AE Company Email, mgan@pingconmarketing.com, marketing@pingconmarketing.com, azgan@pingconmarketing.com, jaezelle.benito@pingconmarketing.com]
 * 
 * 2. A2Z2GO / Keysys Products:
 *    - Sender: finance2@a2z2go.net
 *    - TO: azgodev@gmail.com
 *    - CC: [Customer AE Company Email, mgan@pingconmarketing.com, marketing@a2z2go.net, azgan@a2z2go.net, jaezelle.benito@pingconmarketing.com]
 */
import { supabase } from '../supabaseClient';
import { authService } from './authService';
import { inviteService } from './inviteService';
import {
  DEFAULT_SANDBOX_EMAIL,
  DEFAULT_FOLLOWUP_CONFIG,
  DEFAULT_MATRIX_SEND_TIME_PHT,
  normalizeSandboxEmail,
  normalizeTimeHhmm,
  computeFourStepWorkflow,
  renderWorkflowStepsHtml
} from '../utils/followUpWorkflow';
import {
  isTestRecord,
  formatDateYmd,
  formatDateTimeYmdHm,
  formatTestEmailSubject,
  getRealPhotos,
  getConsolidatedPickupItems,
  formatPeso,
  cleanExplanationText,
  normalizePhotoUrlArray,
  getGpsAddressDisplay,
  getGpsMapUrl,
  isRealSupplierName
} from '../utils/rmaHelpers';
import { generatePickupFormPdfAttachment } from '../utils/pickupFormPdf';
import { buildRmaAlertXlsxAttachment } from '../utils/rmaAlertXlsx';

const splitEmailList = (raw) => {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/);
  const seen = new Set();
  for (const entry of arr) {
    const clean = String(entry || '').trim().toLowerCase();
    if (clean && clean.includes('@') && clean.includes('.') && !clean.endsWith('.test')) {
      seen.add(clean);
    }
  }
  return Array.from(seen);
};

export const EMAIL_PROFILE_TYPES = [
  { id: 'new_rma', label: 'New RMA Return Report Alert', badge: 'Intake', description: 'Dispatched immediately when any new Customer or Supplier RMA report is filed.' },
  { id: 'pickup_debit_claim', label: 'Driver Pickup — Debit Claim', badge: 'Pickup + PDF', description: 'Vendor pickup verification with signed Debit Claim PDF attachment & photos.' },
  { id: 'pickup_replacement', label: 'Driver Pickup — Replacement', badge: 'Pickup + PDF', description: 'Vendor exchange verification with signed Replacement Form PDF & photos.' },
  { id: 'rma_scrapped', label: 'RMA Scrapped / Disposed', badge: 'Lifecycle', description: 'Triggered when an item is marked Scrapped / Disposed (with Re-Order YES/NO).' },
  { id: 'rma_restocked', label: 'RMA Restocked to Good Stock', badge: 'Lifecycle', description: 'Triggered when an item is returned undamaged to Good Stock Shelf.' },
  { id: 'daily_matrix_auto', label: 'Auto Daily PHT Overall Matrix', badge: 'Cron (.xlsx)', description: 'Scheduled daily Asia/Manila (.xlsx) report recipients, window & HH:mm time (default 1:00 PM PHT).' },
  { id: 'manual_matrix', label: 'Manual Overall Matrix Email', badge: 'Manual (.xlsx)', description: 'On-demand Overall/Hub Matrix (.xlsx) email dispatch recipients.' },
  { id: 'supplier_followup', label: 'Daily 10-Day Pickup Follow-Up Extra CCs', badge: '10-Day SLA', description: 'Optional internal CCs added on daily supplier/customer pickup follow-up emails (default 1:00 PM PHT).' },
  { id: 'product_update', label: 'Catalog Product Update', badge: 'Catalog', description: 'Dispatched when verified catalog product details or pricing are updated.' },
  { id: 'invite_email', label: 'Portal / RMA Editor Invite Extra CCs', badge: 'Invites', description: 'Optional extra recipients CC’d automatically on generated portal/editor invites.' }
];

const EMAIL_PROFILES_STORAGE_KEY = 'rma_portal_email_recipients_by_type';
const TEST_EMAIL_PROFILES_STORAGE_KEY = 'rma_portal_test_email_recipients_by_type';
const MATRIX_CONFIG_STORAGE_KEY = 'rma_portal_daily_matrix_config';
const FOLLOWUP_CONFIG_STORAGE_KEY = 'rma_portal_daily_followup_config';
const SANDBOX_EMAIL_STORAGE_KEY = 'rma_portal_test_sandbox_email';
const EMAIL_RECIPIENTS_STORAGE_KEY = 'rma_portal_email_recipients';
const TEST_EMAIL_RECIPIENTS_STORAGE_KEY = 'rma_portal_test_email_recipients';

const escapeEmailHtml = (val) => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const DEFAULT_RECIPIENTS = {
  toEmail: 'azgodev@gmail.com',
  toList: ['azgodev@gmail.com'],
  baseCcList: [
    'mgan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'azgan@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com'
  ]
};

function resolveEmailProfileKey(emailType) {
  const key = String(emailType || '').trim();
  if (key === 'scrapped') return 'rma_scrapped';
  if (key === 'restocked') return 'rma_restocked';
  return key || 'new_rma';
}

function getDefaultMatrixDates(rollingDays = 14) {
  const end = formatDateYmd(new Date()) || new Date().toISOString().slice(0, 10);
  const days = Math.max(1, Math.min(365, parseInt(rollingDays, 10) || 14));
  const [y, m, d] = end.split('-').map(Number);
  const utc = new Date(Date.UTC(y, m - 1, d));
  utc.setUTCDate(utc.getUTCDate() - (days - 1));
  return {
    startDate: utc.toISOString().slice(0, 10),
    endDate: end
  };
}

function broadcastSettingsSync(payload = {}) {
  if (typeof window === 'undefined') return;
  window.dispatchEvent(new CustomEvent('rma-settings-changed', { detail: payload }));
  window.dispatchEvent(new Event('storage'));
  try {
    if (window.BroadcastChannel) {
      const ch = new BroadcastChannel('rma_portal_sync_bus');
      ch.postMessage({ type: 'email-settings-updated', ...payload });
    }
  } catch {}
}

const MAX_REMOTE_IMAGE_ATTACHMENTS = 15;

const PICKUP_PHOTO_CATEGORY_SLOTS = [
  { keys: ['driver_license_front', 'id_license'], label: 'Driver Valid Gov’t / Legal ID — FRONT' },
  { keys: ['driver_license_back'], label: 'Driver Valid Gov’t / Legal ID — BACK' },
  { keys: ['truck_plate'], label: 'Delivery Truck Plate Number' },
  { keys: ['driver_handover', 'driver_face'], label: 'Driver / Co-Worker Photo' },
  { keys: ['pickup_items', 'loaded_items', 'signed_form'], label: 'Damaged Item(s) Picked Up' }
];

function collectUniqueExplanations(effectiveReports = [], itemsTable = []) {
  const seen = new Set();
  const pushClean = (raw) => {
    const cleaned = cleanExplanationText(raw);
    if (cleaned) seen.add(cleaned);
  };
  (effectiveReports || []).forEach((r) => {
    pushClean(r?.explanation);
    pushClean(r?.ai_document_metadata?.explanation);
  });
  (itemsTable || []).forEach((it) => {
    const cleaned = cleanExplanationText(it?.explanation);
    if (cleaned) {
      cleaned.split(/\s*\|\s*/).forEach(pushClean);
    }
  });
  return Array.from(seen).join(' | ') || 'No explanation provided';
}

function collectPickupPhotoGroupsFromReports(effectiveReports = []) {
  const groupMap = new Map();
  PICKUP_PHOTO_CATEGORY_SLOTS.forEach((slot) => {
    groupMap.set(slot.label, { key: slot.keys[0], label: slot.label, urls: [], urlSet: new Set() });
  });

  (effectiveReports || []).forEach((r) => {
    const pObj = r?.ai_document_metadata?.supplier_pickup?.photos;
    if (!pObj || typeof pObj !== 'object') return;
    PICKUP_PHOTO_CATEGORY_SLOTS.forEach((slot) => {
      const grp = groupMap.get(slot.label);
      slot.keys.forEach((k) => {
        normalizePhotoUrlArray(pObj[k]).forEach((url) => {
          if (!grp.urlSet.has(url)) {
            grp.urlSet.add(url);
            grp.urls.push(url);
          }
        });
      });
    });
  });

  return Array.from(groupMap.values())
    .filter((g) => g.urls.length > 0)
    .map(({ key, label, urls }) => ({ key, label, urls }));
}

function normalizePickupPhotoGroupsInput(pickupPhotoGroups = [], pickupPhotoEntries = []) {
  const map = new Map();
  const addUrl = (label, url) => {
    const cleanLabel = String(label || 'Pickup Verification Photo').trim();
    if (!map.has(cleanLabel)) {
      map.set(cleanLabel, { label: cleanLabel, urls: [], urlSet: new Set() });
    }
    const grp = map.get(cleanLabel);
    if (!grp.urlSet.has(url)) {
      grp.urlSet.add(url);
      grp.urls.push(url);
    }
  };

  if (Array.isArray(pickupPhotoGroups) && pickupPhotoGroups.length > 0) {
    pickupPhotoGroups.forEach((g) => {
      normalizePhotoUrlArray(g?.urls ?? g?.url).forEach((u) => addUrl(g?.label, u));
    });
  } else if (Array.isArray(pickupPhotoEntries) && pickupPhotoEntries.length > 0) {
    pickupPhotoEntries.forEach((e) => {
      normalizePhotoUrlArray(e?.urls ?? e?.url).forEach((u) => addUrl(e?.label, u));
    });
  }

  return Array.from(map.values()).map(({ label, urls }) => ({ label, urls }));
}

export const notificationService = {
  /**
   * Get configured RMA email recipients (strictly separated for Live vs Test Mode)
   */
  getEmailSettings(isTestMode = false) {
    if (isTestMode) {
      const sandboxFallback = this.getTestSandboxEmail();
      try {
        if (typeof window !== 'undefined') {
          const savedTest = localStorage.getItem(TEST_EMAIL_RECIPIENTS_STORAGE_KEY);
          if (savedTest) {
            const parsed = JSON.parse(savedTest);
            const toList = splitEmailList(parsed?.toList ?? parsed?.toEmail);
            if (toList.length > 0) {
              const ccSource = parsed?.baseCcList ?? parsed?.ccList ?? [];
              return {
                toEmail: toList.join(', '),
                toList,
                baseCcList: Array.isArray(ccSource) ? splitEmailList(ccSource) : []
              };
            }
          }
        }
      } catch {}
      return {
        toEmail: sandboxFallback,
        toList: [sandboxFallback],
        baseCcList: []
      };
    }

    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem(EMAIL_RECIPIENTS_STORAGE_KEY);
        if (saved) {
          const parsed = JSON.parse(saved);
          const toList = splitEmailList(parsed?.toList ?? parsed?.toEmail);
          if (toList.length > 0) {
            return {
              toEmail: toList.join(', '),
              toList,
              baseCcList: Array.isArray(parsed.baseCcList) ? splitEmailList(parsed.baseCcList) : [...DEFAULT_RECIPIENTS.baseCcList]
            };
          }
        }
      }
    } catch (e) {}
    return {
      toEmail: DEFAULT_RECIPIENTS.toEmail,
      toList: [...DEFAULT_RECIPIENTS.toList],
      baseCcList: [...DEFAULT_RECIPIENTS.baseCcList]
    };
  },

  /**
   * Load email recipients from Supabase rma_settings table (if table exists)
   */
  async loadEmailSettingsFromDb() {
    try {
      const { globalSettings } = await this.loadAllEmailProfilesFromDb();
      return globalSettings || this.getEmailSettings();
    } catch (e) {
      return this.getEmailSettings();
    }
  },

  /**
   * Super Admin action: Save updated Global Corporate or Global Test Mode TO & CC recipients
   */
  async saveEmailSettings({ toEmail, toList, baseCcList }, isTestMode = false) {
    const cleanToList = splitEmailList(toList ?? toEmail);
    if (cleanToList.length === 0) {
      throw new Error('At least one valid Primary TO recipient email is required.');
    }

    const cleanToSet = new Set(cleanToList);
    const cleanCcList = splitEmailList(baseCcList).filter((e) => !cleanToSet.has(e));
    const newSettings = {
      toEmail: cleanToList.join(', '),
      toList: cleanToList,
      baseCcList: cleanCcList
    };

    const storageKey = isTestMode ? TEST_EMAIL_RECIPIENTS_STORAGE_KEY : EMAIL_RECIPIENTS_STORAGE_KEY;
    const dbKey = isTestMode ? 'test_email_recipients' : 'email_recipients';

    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(newSettings));
      broadcastSettingsSync(isTestMode ? { testSettings: newSettings, isTestMode: true } : { settings: newSettings });
    }

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: dbKey,
          value: newSettings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn(`Notice: rma_settings (${dbKey}) sync deferred. Local storage active.`);
    }

    return { success: true, settings: newSettings };
  },

  /**
   * Read raw saved per-type profile overrides map from localStorage (isolated Live vs Test)
   */
  _readSavedProfilesMap(isTestMode = false) {
    try {
      if (typeof window !== 'undefined') {
        const storageKey = isTestMode ? TEST_EMAIL_PROFILES_STORAGE_KEY : EMAIL_PROFILES_STORAGE_KEY;
        const raw = localStorage.getItem(storageKey);
        if (raw) {
          const parsed = JSON.parse(raw);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            return parsed;
          }
        }
      }
    } catch {}
    return {};
  },

  /**
   * Get effective recipient profile for a specific emailType and mode, falling back strictly within that mode
   * (except invite_email / supplier_followup which default to empty optional extras).
   */
  getEmailProfile(emailType = 'new_rma', isTestMode = false) {
    const key = resolveEmailProfileKey(emailType);
    const global = this.getEmailSettings(Boolean(isTestMode));
    const map = this._readSavedProfilesMap(Boolean(isTestMode));
    const saved = map[key];

    const allowEmptyTo = key === 'invite_email' || key === 'supplier_followup';
    if (saved && typeof saved === 'object') {
      const savedToList = splitEmailList(saved.toList ?? saved.toEmail);
      const savedCcList = splitEmailList(saved.ccList);
      if (allowEmptyTo || savedToList.length > 0 || saved.allowCustom === true) {
        const finalToList = savedToList.length > 0
          ? savedToList
          : (allowEmptyTo ? [] : [...global.toList]);
        return {
          emailType: key,
          toList: finalToList,
          toEmail: finalToList.join(', '),
          ccList: savedCcList,
          isCustom: true
        };
      }
    }

    if (allowEmptyTo) {
      return {
        emailType: key,
        toList: [],
        toEmail: '',
        ccList: [],
        isCustom: false
      };
    }

    const fallbackTo = isTestMode
      ? [...(global.toList || [this.getTestSandboxEmail()])]
      : [...(global.toList || [DEFAULT_RECIPIENTS.toEmail])];
    const fallbackCc = isTestMode
      ? [...(global.baseCcList || [])]
      : [...(global.baseCcList || DEFAULT_RECIPIENTS.baseCcList)];
    return {
      emailType: key,
      toList: fallbackTo,
      toEmail: fallbackTo.join(', '),
      ccList: fallbackCc,
      isCustom: false
    };
  },

  /**
   * Return map of all configured profiles keyed by emailType id
   */
  getAllEmailProfiles(isTestMode = false) {
    const result = {};
    EMAIL_PROFILE_TYPES.forEach(({ id }) => {
      result[id] = this.getEmailProfile(id, Boolean(isTestMode));
    });
    return result;
  },

  /**
   * Persist per-email-type recipient configuration under rma_settings (email_recipients_by_type or test_email_recipients_by_type)
   */
  async saveEmailProfile(emailType, { toList, toEmail, ccList } = {}, isTestMode = false) {
    const key = resolveEmailProfileKey(emailType);
    const cleanTo = splitEmailList(toList ?? toEmail);
    const allowEmptyTo = key === 'invite_email' || key === 'supplier_followup';
    if (!allowEmptyTo && cleanTo.length === 0) {
      throw new Error('At least one valid Primary TO recipient email is required.');
    }
    const cleanToSet = new Set(cleanTo);
    const cleanCc = splitEmailList(ccList).filter((e) => !cleanToSet.has(e));

    const currentMap = { ...this._readSavedProfilesMap(Boolean(isTestMode)) };
    currentMap[key] = {
      toList: cleanTo,
      toEmail: cleanTo.join(', '),
      ccList: cleanCc,
      allowCustom: true,
      updatedAt: new Date().toISOString()
    };

    const storageKey = isTestMode ? TEST_EMAIL_PROFILES_STORAGE_KEY : EMAIL_PROFILES_STORAGE_KEY;
    const dbKey = isTestMode ? 'test_email_recipients_by_type' : 'email_recipients_by_type';

    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(currentMap));
      broadcastSettingsSync({
        emailType: key,
        isTestMode: Boolean(isTestMode),
        ...(isTestMode ? { testProfilesByType: currentMap } : { profilesByType: currentMap })
      });
    }

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: dbKey,
          value: currentMap,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn(`Notice saving ${dbKey}:`, e?.message || e);
    }

    // Keep Live daily_matrix_config recipients synced when Live auto matrix profile is explicitly saved
    if (!isTestMode && key === 'daily_matrix_auto') {
      const cfg = this.getDailyMatrixConfig();
      await this.saveDailyMatrixConfig({ ...cfg, toList: cleanTo, ccList: cleanCc }, { skipProfileSync: true }).catch(() => {});
    }

    return {
      emailType: key,
      toList: cleanTo,
      toEmail: cleanTo.join(', '),
      ccList: cleanCc,
      isCustom: true
    };
  },

  /**
   * Reset a single emailType back to its mode defaults
   */
  async resetEmailProfileToDefaults(emailType, isTestMode = false) {
    const key = resolveEmailProfileKey(emailType);
    const currentMap = { ...this._readSavedProfilesMap(Boolean(isTestMode)) };
    delete currentMap[key];

    const storageKey = isTestMode ? TEST_EMAIL_PROFILES_STORAGE_KEY : EMAIL_PROFILES_STORAGE_KEY;
    const dbKey = isTestMode ? 'test_email_recipients_by_type' : 'email_recipients_by_type';

    if (typeof window !== 'undefined') {
      localStorage.setItem(storageKey, JSON.stringify(currentMap));
      broadcastSettingsSync({
        emailType: key,
        isTestMode: Boolean(isTestMode),
        ...(isTestMode ? { testProfilesByType: currentMap } : { profilesByType: currentMap })
      });
    }

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: dbKey,
          value: currentMap,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn(`Notice resetting ${dbKey}:`, e?.message || e);
    }

    return this.getEmailProfile(key, Boolean(isTestMode));
  },

  /**
   * Read Overall Matrix cron schedule & default window config
   */
  getDailyMatrixConfig() {
    const defaultsWindow = getDefaultMatrixDates(14);
    const autoProfile = this.getEmailProfile('daily_matrix_auto');
    let saved = null;
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(MATRIX_CONFIG_STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
      }
    } catch {}

    const rollingDays = Math.max(1, Math.min(365, parseInt(saved?.rollingDays, 10) || 14));
    const rangeDates = getDefaultMatrixDates(rollingDays);
    const toList = autoProfile.isCustom
      ? autoProfile.toList
      : (splitEmailList(saved?.toList ?? saved?.toEmail).length > 0
        ? splitEmailList(saved?.toList ?? saved?.toEmail)
        : autoProfile.toList);
    const ccList = autoProfile.isCustom
      ? autoProfile.ccList
      : (Array.isArray(saved?.ccList) ? splitEmailList(saved.ccList) : autoProfile.ccList);

    const validStream = ['overall', 'customer_inbound', 'supplier_outbound'].includes(saved?.stream)
      ? saved.stream
      : 'overall';

    return {
      toList,
      ccList,
      rangeMode: saved?.rangeMode === 'custom' ? 'custom' : 'rolling',
      rollingDays,
      startDate: saved?.rangeMode === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(String(saved?.startDate || ''))
        ? saved.startDate
        : (rangeDates.startDate || defaultsWindow.startDate),
      endDate: saved?.rangeMode === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(String(saved?.endDate || ''))
        ? saved.endDate
        : (rangeDates.endDate || defaultsWindow.endDate),
      stream: validStream,
      includeZeroCatalogSkus: Boolean(saved?.includeZeroCatalogSkus),
      autoEnabled: saved?.autoEnabled !== false,
      autoSendTimePht: normalizeTimeHhmm(saved?.autoSendTimePht, DEFAULT_MATRIX_SEND_TIME_PHT)
    };
  },

  /**
   * Persist Overall Matrix cron schedule & default range under rma_settings.daily_matrix_config
   */
  async saveDailyMatrixConfig(cfg = {}, { skipProfileSync = false } = {}) {
    const prev = this.getDailyMatrixConfig();
    const rollingDays = Math.max(1, Math.min(365, parseInt(cfg.rollingDays ?? prev.rollingDays, 10) || 14));
    const rollingWindow = getDefaultMatrixDates(rollingDays);
    const rangeMode = cfg.rangeMode === 'custom' ? 'custom' : 'rolling';
    const startDate = rangeMode === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.startDate || ''))
      ? cfg.startDate
      : (cfg.startDate && rangeMode === 'custom' ? cfg.startDate : rollingWindow.startDate);
    const endDate = rangeMode === 'custom' && /^\d{4}-\d{2}-\d{2}$/.test(String(cfg.endDate || ''))
      ? cfg.endDate
      : (cfg.endDate && rangeMode === 'custom' ? cfg.endDate : rollingWindow.endDate);
    const stream = ['overall', 'customer_inbound', 'supplier_outbound'].includes(cfg.stream)
      ? cfg.stream
      : prev.stream;
    const toList = splitEmailList(cfg.toList ?? cfg.toEmail ?? prev.toList);
    const finalTo = toList.length > 0 ? toList : [...DEFAULT_RECIPIENTS.toList];
    const finalToSet = new Set(finalTo);
    const ccList = splitEmailList(cfg.ccList !== undefined ? cfg.ccList : prev.ccList).filter((e) => !finalToSet.has(e));

    const nextCfg = {
      toList: finalTo,
      ccList,
      rangeMode,
      rollingDays,
      startDate,
      endDate,
      stream,
      includeZeroCatalogSkus: cfg.includeZeroCatalogSkus !== undefined
        ? Boolean(cfg.includeZeroCatalogSkus)
        : Boolean(prev.includeZeroCatalogSkus),
      autoEnabled: cfg.autoEnabled !== undefined ? Boolean(cfg.autoEnabled) : prev.autoEnabled !== false,
      autoSendTimePht: normalizeTimeHhmm(cfg.autoSendTimePht ?? prev.autoSendTimePht, DEFAULT_MATRIX_SEND_TIME_PHT),
      updatedAt: new Date().toISOString()
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem(MATRIX_CONFIG_STORAGE_KEY, JSON.stringify(nextCfg));
      broadcastSettingsSync({ dailyMatrixConfig: nextCfg });
    }

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: 'daily_matrix_config',
          value: nextCfg,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn('Notice saving daily_matrix_config:', e?.message || e);
    }

    if (!skipProfileSync) {
      const autoProfile = this.getEmailProfile('daily_matrix_auto');
      if (autoProfile.isCustom || cfg.toList || cfg.ccList) {
        const currentMap = { ...this._readSavedProfilesMap() };
        currentMap.daily_matrix_auto = {
          toList: finalTo,
          toEmail: finalTo.join(', '),
          ccList,
          allowCustom: true,
          updatedAt: new Date().toISOString()
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem(EMAIL_PROFILES_STORAGE_KEY, JSON.stringify(currentMap));
        }
        try {
          await supabase
            .from('rma_settings')
            .upsert({
              key: 'email_recipients_by_type',
              value: currentMap,
              updated_at: new Date().toISOString()
            }, { onConflict: 'key' });
        } catch {}
      }
    }

    return nextCfg;
  },

  /**
   * Read configured Test Mode Sandbox Override email (default mgan@pingconmarketing.com)
   */
  getTestSandboxEmail() {
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(SANDBOX_EMAIL_STORAGE_KEY);
        if (raw) {
          const parsed = raw.startsWith('"') ? JSON.parse(raw) : raw;
          return normalizeSandboxEmail(parsed);
        }
      }
    } catch {}
    return DEFAULT_SANDBOX_EMAIL;
  },

  async saveTestSandboxEmail(rawEmail) {
    const clean = normalizeSandboxEmail(rawEmail);
    if (typeof window !== 'undefined') {
      localStorage.setItem(SANDBOX_EMAIL_STORAGE_KEY, clean);
      broadcastSettingsSync({ testSandboxEmail: clean });
    }
    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: 'test_sandbox_email',
          value: clean,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn('Notice saving test_sandbox_email:', e?.message || e);
    }
    return clean;
  },

  /**
   * Read 10-Calendar-Day Pickup Follow-Up schedule & Customer Hub default toggle
   */
  getDailyFollowUpConfig() {
    let saved = null;
    try {
      if (typeof window !== 'undefined') {
        const raw = localStorage.getItem(FOLLOWUP_CONFIG_STORAGE_KEY);
        if (raw) saved = JSON.parse(raw);
      }
    } catch {}
    return {
      autoEnabled: saved?.autoEnabled !== false,
      autoSendTimePht: normalizeTimeHhmm(saved?.autoSendTimePht, DEFAULT_FOLLOWUP_CONFIG.autoSendTimePht),
      customerFollowUpDefaultEnabled: Boolean(saved?.customerFollowUpDefaultEnabled)
    };
  },

  async saveDailyFollowUpConfig(cfg = {}) {
    const prev = this.getDailyFollowUpConfig();
    const nextCfg = {
      autoEnabled: cfg.autoEnabled !== undefined ? Boolean(cfg.autoEnabled) : prev.autoEnabled !== false,
      autoSendTimePht: normalizeTimeHhmm(cfg.autoSendTimePht ?? prev.autoSendTimePht, DEFAULT_FOLLOWUP_CONFIG.autoSendTimePht),
      customerFollowUpDefaultEnabled: cfg.customerFollowUpDefaultEnabled !== undefined
        ? Boolean(cfg.customerFollowUpDefaultEnabled)
        : Boolean(prev.customerFollowUpDefaultEnabled),
      updatedAt: new Date().toISOString()
    };
    if (typeof window !== 'undefined') {
      localStorage.setItem(FOLLOWUP_CONFIG_STORAGE_KEY, JSON.stringify(nextCfg));
      broadcastSettingsSync({ dailyFollowUpConfig: nextCfg });
    }
    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: 'daily_followup_config',
          value: nextCfg,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn('Notice saving daily_followup_config:', e?.message || e);
    }
    return nextCfg;
  },

  /**
   * Load Global recipients, per-email profiles, Daily Matrix, Follow-Up & Sandbox config from Supabase
   */
  async loadAllEmailProfilesFromDb() {
    try {
      const { data, error } = await supabase
        .from('rma_settings')
        .select('key, value')
        .in('key', [
          'email_recipients',
          'email_recipients_by_type',
          'test_email_recipients',
          'test_email_recipients_by_type',
          'daily_matrix_config',
          'daily_followup_config',
          'test_sandbox_email'
        ]);

      if (!error && Array.isArray(data)) {
        const map = new Map(data.map((r) => [r.key, r.value]));

        const globalRaw = map.get('email_recipients');
        if (globalRaw && (globalRaw.toEmail || Array.isArray(globalRaw.toList))) {
          const toList = splitEmailList(globalRaw.toList ?? globalRaw.toEmail);
          const normalizedGlobal = {
            toEmail: (toList.length > 0 ? toList : DEFAULT_RECIPIENTS.toList).join(', '),
            toList: toList.length > 0 ? toList : [...DEFAULT_RECIPIENTS.toList],
            baseCcList: Array.isArray(globalRaw.baseCcList)
              ? splitEmailList(globalRaw.baseCcList)
              : [...DEFAULT_RECIPIENTS.baseCcList]
          };
          if (typeof window !== 'undefined') {
            localStorage.setItem(EMAIL_RECIPIENTS_STORAGE_KEY, JSON.stringify(normalizedGlobal));
          }
        }

        const byTypeRaw = map.get('email_recipients_by_type');
        if (byTypeRaw && typeof byTypeRaw === 'object' && !Array.isArray(byTypeRaw)) {
          if (typeof window !== 'undefined') {
            localStorage.setItem(EMAIL_PROFILES_STORAGE_KEY, JSON.stringify(byTypeRaw));
          }
        }

        const testGlobalRaw = map.get('test_email_recipients');
        if (testGlobalRaw && typeof testGlobalRaw === 'object' && (testGlobalRaw.toEmail || Array.isArray(testGlobalRaw.toList))) {
          const tToList = splitEmailList(testGlobalRaw.toList ?? testGlobalRaw.toEmail);
          if (tToList.length > 0 && typeof window !== 'undefined') {
            const ccSource = testGlobalRaw.baseCcList ?? testGlobalRaw.ccList ?? [];
            localStorage.setItem(TEST_EMAIL_RECIPIENTS_STORAGE_KEY, JSON.stringify({
              toEmail: tToList.join(', '),
              toList: tToList,
              baseCcList: Array.isArray(ccSource) ? splitEmailList(ccSource) : []
            }));
          }
        }

        const testByTypeRaw = map.get('test_email_recipients_by_type');
        if (testByTypeRaw && typeof testByTypeRaw === 'object' && !Array.isArray(testByTypeRaw)) {
          if (typeof window !== 'undefined') {
            localStorage.setItem(TEST_EMAIL_PROFILES_STORAGE_KEY, JSON.stringify(testByTypeRaw));
          }
        }

        const matrixRaw = map.get('daily_matrix_config');
        if (matrixRaw && typeof matrixRaw === 'object') {
          if (typeof window !== 'undefined') {
            localStorage.setItem(MATRIX_CONFIG_STORAGE_KEY, JSON.stringify(matrixRaw));
          }
        }

        const followUpRaw = map.get('daily_followup_config');
        if (followUpRaw && typeof followUpRaw === 'object') {
          if (typeof window !== 'undefined') {
            localStorage.setItem(FOLLOWUP_CONFIG_STORAGE_KEY, JSON.stringify(followUpRaw));
          }
        }

        const sandboxRaw = map.get('test_sandbox_email');
        if (sandboxRaw) {
          if (typeof window !== 'undefined') {
            localStorage.setItem(SANDBOX_EMAIL_STORAGE_KEY, normalizeSandboxEmail(sandboxRaw));
          }
        }

        if (typeof window !== 'undefined') {
          broadcastSettingsSync({ loadedFromDb: true });
        }
      }
    } catch (e) {
      // rma_settings may be temporarily unavailable; fallback cleanly to localStorage
    }

    return {
      globalSettings: this.getEmailSettings(false),
      profilesByType: this.getAllEmailProfiles(false),
      testSettings: this.getEmailSettings(true),
      testProfilesByType: this.getAllEmailProfiles(true),
      dailyMatrixConfig: this.getDailyMatrixConfig(),
      dailyFollowUpConfig: this.getDailyFollowUpConfig(),
      testSandboxEmail: this.getTestSandboxEmail()
    };
  },

  /**
   * Determine company configuration with user-configurable recipients (isolated Live vs Test)
   */
  resolveCompanyConfig(report, emailType = null, isTestMode = false) {
    const testActive = Boolean(isTestMode);
    const settings = emailType ? this.getEmailProfile(emailType, testActive) : this.getEmailSettings(testActive);
    const toList = splitEmailList(settings.toList ?? settings.toEmail);
    const finalToList = toList.length > 0
      ? toList
      : (testActive ? [this.getTestSandboxEmail()] : [...DEFAULT_RECIPIENTS.toList]);
    const rawCc = emailType ? settings.ccList : settings.baseCcList;
    const defaultCc = testActive ? [] : [...DEFAULT_RECIPIENTS.baseCcList];
    return {
      companyName: 'Pingcon RMA Returns',
      senderEmail: 'finance2@keysysincorporated.com',
      senderName: 'Pingcon RMA Finance Portal',
      toList: finalToList,
      toEmail: finalToList.join(', '),
      baseCcList: Array.isArray(rawCc) ? rawCc : defaultCc
    };
  },

  /**
   * Determine if Test Mode Sandbox delivery must be enforced for a record or current session
   */
  resolveTestModeActive(record, explicitIsTestMode = false) {
    const currentUser = typeof window !== 'undefined' ? authService.getCurrentUser() : null;
    const isSuperAdmin = currentUser?.role === 'super_admin';
    let hasActiveTestInvite = false;
    try {
      const rawGate = typeof window !== 'undefined' ? localStorage.getItem('rma_portal_gate_session') : null;
      if (rawGate) {
        const parsedGate = JSON.parse(rawGate);
        if (parsedGate?.is_test === true && (!parsedGate.expires_at || new Date(parsedGate.expires_at) > new Date())) {
          hasActiveTestInvite = true;
        }
      }
    } catch {}

    return Boolean(
      isTestRecord(record) ||
      hasActiveTestInvite ||
      (isSuperAdmin && (
        explicitIsTestMode ||
        (typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true')
      ))
    );
  },

  /**
   * Format single or multi-item expiry dates strictly as (YYYY-MM-DD) for email HTML and plain-text fallbacks
   */
  formatExpiryForEmail(report) {
    if (Array.isArray(report?.items) && report.items.length > 1) {
      const entries = report.items.map((it, idx) => {
        const label = it.name || it.productName || it.barcode || `Item ${idx + 1}`;
        const exp = formatDateYmd(it.expiry_date || it.ai_document_metadata?.expiry_date) || 'Not specified';
        return { label, exp };
      });
      return {
        html: entries.map(e => `${escapeEmailHtml(e.label)}: <strong>${escapeEmailHtml(e.exp)}</strong>`).join('<br/>'),
        text: entries.map(e => `${e.label}: ${e.exp}`).join('; ')
      };
    }

    const rawExpiry =
      report?.expiry_date ||
      report?.ai_document_metadata?.expiry_date ||
      (Array.isArray(report?.items) ? report.items[0]?.expiry_date : '') ||
      '';
    const formatted = formatDateYmd(rawExpiry) || 'Not specified';
    return {
      html: escapeEmailHtml(formatted),
      text: formatted
    };
  },

  /**
   * Build clean, modern HTML email notification body
   */
  generateEmailHtml(report, config, isTestMode = false, editorContext = null) {
    const rmaNumber = report.rma_number || 'RMA-PENDING';
    const itemName = report.name || `Unidentified Item (${report.barcode})`;
    const reporter = report.reporter_name || report.reported_by || 'Warehouse Staff';
    const contact = report.reporter_contact || 'N/A';
    const aeName = report.ae_name || 'Unassigned';
    const aeEmail = report.ae_email || '';
    const expiryInfo = this.formatExpiryForEmail(report);
    const photos = Array.isArray(report.photos) 
      ? report.photos 
      : (typeof report.photos === 'string' ? JSON.parse(report.photos || '[]') : []);
    const manifestItems = Array.isArray(report.items) ? report.items : [];

    const gpsAddress = getGpsAddressDisplay(report);
    const mapUrl = getGpsMapUrl(report);
    const hasGps = Boolean(mapUrl || gpsAddress);
    const gpsAccNote = report.gps_accuracy ? ` (${Number(report.gps_accuracy).toFixed(0)}m accuracy)` : '';
    const editUrl = editorContext?.editUrl || '';
    const editorAuthorizedEmail = editorContext?.editorAuthorizedEmail || '';
    const editorAuthorizedEmails = Array.isArray(editorContext?.editorAuthorizedEmails) && editorContext.editorAuthorizedEmails.length > 0
      ? editorContext.editorAuthorizedEmails
      : (editorAuthorizedEmail ? [editorAuthorizedEmail] : [config.toEmail]);

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { background: #1e3a8a; padding: 24px 28px; color: #ffffff; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: #3b82f6; color: #ffffff; margin-bottom: 8px; }
          .title { margin: 0; font-size: 20px; font-weight: 800; line-height: 1.3; }
          .content { padding: 28px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
          .grid { display: table; width: 100%; border-collapse: collapse; }
          .row { display: table-row; }
          .col-label { display: table-cell; width: 35%; padding: 6px 0; font-size: 12px; color: #64748b; font-weight: 600; }
          .col-val { display: table-cell; padding: 6px 0; font-size: 13px; color: #0f172a; font-weight: 700; }
          .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; margin: 20px 0 10px; border-bottom: 2px solid #f1f5f9; padding-bottom: 6px; }
          .reason-box { background: #fff1f2; border: 1px solid #fecdd3; color: #be123c; border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 13px; font-weight: 700; }
          .footer { background: #f1f5f9; padding: 16px 28px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">${isTestMode ? `[TEST] ${config.companyName}` : config.companyName}</span>
            <h1 class="title">${isTestMode ? '[TEST] ' : ''}New RMA Return Report: ${rmaNumber}</h1>
            <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Automated Warehouse Intake Notification</div>
          </div>
          
          <div class="content">
            ${isTestMode ? `
            <div style="background: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 12px 16px; border-radius: 12px; margin-bottom: 20px; font-weight: 700; font-size: 13px;">
              🧪 TEST MODE ACTIVE: Safe Sandbox Delivery. Live delivery to real staff and customers was safely bypassed.
            </div>
            ` : ''}

            <div class="reason-box">
              🚨 Return Defect: ${report.reason || 'Damaged / Defective'}
              ${report.explanation ? `<div style="font-weight: 400; font-size: 12px; margin-top: 4px; color: #9f1239;">${report.explanation}</div>` : ''}
            </div>

            <div class="section-title">Item Details</div>
            <div class="card">
              <div class="grid">
                <div class="row">
                  <div class="col-label">RMA Number:</div>
                  <div class="col-val" style="font-family: monospace; font-size: 14px; font-weight: 800; color: #1e3a8a;">${rmaNumber}</div>
                </div>
                <div class="row">
                  <div class="col-label">Product Name:</div>
                  <div class="col-val">${itemName}</div>
                </div>
                <div class="row">
                  <div class="col-label">Barcode / QR:</div>
                  <div class="col-val" style="font-family: monospace;">${report.barcode}</div>
                </div>
                ${report.code ? `
                <div class="row">
                  <div class="col-label">SKU / Item Code:</div>
                  <div class="col-val" style="font-family: monospace;">${report.code}</div>
                </div>` : ''}
                <div class="row">
                  <div class="col-label">Return Quantity:</div>
                  <div class="col-val" style="font-size: 14px; font-weight: 800; color: #0f172a;">${report.quantity || 1} ${report.unit_name || report.unit || 'pc'}</div>
                </div>
                <div class="row">
                  <div class="col-label">Expiry Date (YYYY-MM-DD):</div>
                  <div class="col-val">${expiryInfo.html}</div>
                </div>
                <div class="row">
                  <div class="col-label">Supplier / Brand:</div>
                  <div class="col-val">${report.supplier_name || report.supplierName || 'Savemore'}</div>
                </div>
                ${(report.ae_name || report.ae_email) ? `
                <div class="row">
                  <div class="col-label">Customer AE:</div>
                  <div class="col-val" style="color: #1e40af; font-weight: 800;">
                    ${report.ae_name || 'Assigned AE'} ${report.ae_email ? `<span style="font-family: monospace; font-size: 11px; font-weight: 600; color: #475569;">(${report.ae_email})</span>` : ''}
                  </div>
                </div>` : `
                <div class="row">
                  <div class="col-label">Customer AE:</div>
                  <div class="col-val" style="color: #94a3b8; font-style: italic;">Pending Admin Assignment (1st Intake)</div>
                </div>`}
              </div>
            </div>

            <div class="section-title">Reporter Information</div>
            <div class="card">
              <div class="grid">
                <div class="row">
                  <div class="col-label">Reported By:</div>
                  <div class="col-val">${reporter}</div>
                </div>
                <div class="row">
                  <div class="col-label">Contact Number/Email:</div>
                  <div class="col-val" style="font-family: monospace;">${contact}</div>
                </div>
                <div class="row">
                  <div class="col-label">Submission Date (YYYY-MM-DD HH:mm):</div>
                  <div class="col-val">${formatDateTimeYmdHm(report.created_at || new Date())}</div>
                </div>
                ${hasGps ? `
                <div class="row">
                  <div class="col-label">GPS Location:</div>
                  <div class="col-val">
                    ${mapUrl
                      ? `<a href="${mapUrl}" target="_blank" style="color: #2563eb; text-decoration: underline;">📍 ${escapeEmailHtml(gpsAddress || 'View on Google Maps')}${escapeEmailHtml(gpsAccNote)} ↗</a>`
                      : `<span>📍 ${escapeEmailHtml(gpsAddress)}${escapeEmailHtml(gpsAccNote)}</span>`
                    }
                  </div>
                </div>` : ''}
              </div>
            </div>

            ${manifestItems.length > 1 ? `
            <div class="section-title">Manifest Items Breakdown (${manifestItems.length} Lines)</div>
            <div class="card" style="padding: 12px;">
              ${manifestItems.map((it, idx) => {
                const itSup = it.supplier_name || it.supplierName || it.supplier || '';
                const supBadge = isRealSupplierName(itSup) ? ` • Supplier: ${escapeEmailHtml(itSup)}` : '';
                return `
                <div style="padding: 6px 0; ${idx > 0 ? 'border-top: 1px solid #e2e8f0;' : ''} font-size: 12px;">
                  <strong>${idx + 1}. ${escapeEmailHtml(it.name || it.productName || it.barcode || 'Item')}</strong>
                  <span style="color: #64748b; font-family: monospace;"> • Qty: ${Number(it.quantity) || 1} ${escapeEmailHtml(it.unit_name || it.unit || 'pc')}${supBadge} • Exp (YYYY-MM-DD): ${escapeEmailHtml(formatDateYmd(it.expiry_date) || 'N/A')}</span>
                </div>`;
              }).join('')}
            </div>` : ''}

            ${editUrl ? `
            <div style="text-align: center; margin: 22px 0 18px; padding: 18px; background: #eff6ff; border: 1px solid #bfdbfe; border-radius: 12px;">
              <div style="font-size: 11px; font-weight: 800; color: #1e40af; text-transform: uppercase; letter-spacing: 0.05em; margin-bottom: 10px;">
                Update Supplier, Pricing, Expiry Date, or Commercial Documents (SI / DR / PO)
              </div>
              <a href="${escapeEmailHtml(editUrl)}" target="_blank" style="display: inline-block; padding: 12px 24px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 800; box-shadow: 0 3px 10px rgba(37,99,235,0.25);">
                ✏️ Edit RMA Details &amp; Documents
              </a>
              <div style="font-size: 11px; color: #475569; margin-top: 10px; line-height: 1.4;">
                🔒 Protected by Pingcon Google Identity Lock for ${
                  editorAuthorizedEmails.length > 1
                    ? `all authorized To &amp; CC recipients (<strong style="font-family: monospace; color: #0f172a;">${escapeEmailHtml(editorAuthorizedEmails.join(', '))}</strong>)`
                    : `<strong style="font-family: monospace; color: #0f172a;">${escapeEmailHtml(editorAuthorizedEmails[0] || config.toEmail)}</strong>`
                } • No expiry (revocable anytime by Admin)
              </div>
            </div>` : ''}

            ${photos.length > 0 ? `
            <div class="section-title">Proof Photos (${photos.length})</div>
            <div style="margin-top: 14px;">
              ${photos.map((p, idx) => `
                <div style="margin-bottom: 18px; text-align: center;">
                  <img 
                    src="${p}" 
                    alt="Proof Photo ${idx + 1}" 
                    style="max-width: 100%; max-height: 420px; width: auto; height: auto; border-radius: 12px; border: 1px solid #cbd5e1; display: inline-block; box-shadow: 0 4px 10px rgba(0,0,0,0.06);" 
                  />
                  <div style="font-size: 11px; color: #64748b; margin-top: 6px; font-weight: 700;">
                    Photo ${idx + 1} of ${photos.length}
                  </div>
                </div>
              `).join('')}
            </div>` : ''}
          </div>

          <div class="footer">
            This automated alert was dispatched by the Pingcon RMA Return Portal.<br>
            Sender: ${config.senderEmail} • Intended Recipient: ${config.toEmail}
          </div>
        </div>
      </body>
      </html>
    `;
  },

  /**
   * Dispatch email notification for a newly submitted RMA report
   */
  async sendRMANotification(report, isTestMode = false, options = {}) {
    if (!report) return { success: false, error: 'No report data provided' };

    const currentUser = typeof window !== 'undefined' ? authService.getCurrentUser() : null;
    const isSuperAdmin = currentUser?.role === 'super_admin';
    let hasActiveTestInvite = false;
    try {
      const rawGate = typeof window !== 'undefined' ? localStorage.getItem('rma_portal_gate_session') : null;
      if (rawGate) {
        const parsedGate = JSON.parse(rawGate);
        if (parsedGate?.is_test === true && (!parsedGate.expires_at || new Date(parsedGate.expires_at) > new Date())) {
          hasActiveTestInvite = true;
        }
      }
    } catch {}

    const testActive = Boolean(
      isTestRecord(report) ||
      hasActiveTestInvite ||
      (isSuperAdmin && (
        isTestMode ||
        (typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true')
      ))
    );

    try {
      const config = this.resolveCompanyConfig(report, 'new_rma', testActive);
      const customRecipients = options?.customRecipients || report?.customRecipients || null;
      const sandboxEmail = this.getTestSandboxEmail();

      const resolvedToList = customRecipients && (Array.isArray(customRecipients.toList) || customRecipients.toEmail)
        ? splitEmailList(customRecipients.toList ?? customRecipients.toEmail)
        : config.toList;
      const toList = resolvedToList.length > 0
        ? resolvedToList
        : (testActive ? [sandboxEmail] : [...DEFAULT_RECIPIENTS.toList]);
      const toEmail = toList.join(', ');

      const resolvedBaseCc = customRecipients && Array.isArray(customRecipients.ccList)
        ? splitEmailList(customRecipients.ccList)
        : config.baseCcList;

      // Assemble CC list: NEVER merge Live Customer AE email into Test Mode recipients!
      const toSet = new Set(toList);
      const ccSet = new Set(resolvedBaseCc.filter((e) => !toSet.has(e)));
      if (!testActive && report.ae_email && report.ae_email.includes('@')) {
        const cleanAe = report.ae_email.trim().toLowerCase();
        if (!toSet.has(cleanAe)) ccSet.add(cleanAe);
      }
      const finalCcList = Array.from(ccSet);

      const editorAuthorizedEmails = Array.from(new Set(
        [...toList, ...finalCcList]
          .map((e) => String(e || '').trim().toLowerCase())
          .filter((e) => e.includes('@'))
      ));
      if (testActive && editorAuthorizedEmails.length === 0 && sandboxEmail) {
        editorAuthorizedEmails.push(sandboxEmail);
      }
      const editorAuthorizedEmail = editorAuthorizedEmails[0] || (testActive ? sandboxEmail : toList[0]);

      let editUrl = '';
      if (report.rma_number && editorAuthorizedEmails.length > 0) {
        try {
          const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://rma-portal-pingconmarketing.vercel.app';
          const editorInvite = await inviteService.createInvite({
            streamType: 'rma_editor',
            authorizedEmail: editorAuthorizedEmail,
            authorizedEmails: editorAuthorizedEmails,
            rmaNumber: report.rma_number,
            entityName: report.rma_number,
            noExpiry: true,
            durationUnit: 'permanent',
            createdBy: 'Automated New RMA Alert',
            isTest: testActive
          });
          if (editorInvite?.token) {
            editUrl = `${baseUrl}/intake?token=${encodeURIComponent(editorInvite.token)}&editRma=${encodeURIComponent(report.rma_number)}${testActive ? '&mode=test' : ''}`;
          }
        } catch (invErr) {
          console.warn('Non-blocking notice generating RMA editor email link:', invErr?.message || invErr);
        }
      }

      const rawSubject = `[RMA Alert] ${report.rma_number || 'New Return'}: ${report.name || report.barcode} (${report.reason || 'Damaged'})`;
      const subject = formatTestEmailSubject(rawSubject, testActive);

      const htmlBody = this.generateEmailHtml(report, config, testActive, { editUrl, editorAuthorizedEmail, editorAuthorizedEmails });

      const photos = Array.isArray(report.photos) 
        ? report.photos 
        : (typeof report.photos === 'string' ? JSON.parse(report.photos || '[]') : []);

      // Attach mirror .xlsx worksheet + proof images so recipients can inspect or reply with edits
      const photoAttachments = photos.map((p, idx) => ({
        filename: `proof_photo_${idx + 1}.jpg`,
        path: p
      }));
      let xlsxMirrorAttachment = null;
      try {
        xlsxMirrorAttachment = buildRmaAlertXlsxAttachment(report, {
          subject,
          editUrl,
          resolvedRecipients: { toList, ccList: finalCcList }
        });
      } catch (xlsxErr) {
        console.warn('Notice generating RMA alert mirror .xlsx attachment:', xlsxErr?.message || xlsxErr);
      }
      const attachments = xlsxMirrorAttachment
        ? [xlsxMirrorAttachment, ...photoAttachments]
        : photoAttachments;

      console.log(`[RMA Email Dispatch] (TestMode: ${testActive}) Sending from "${config.senderEmail}" to "${toEmail}", CC: [${finalCcList.join(', ')}] with ${attachments.length} attachments`);

      const expiryInfo = this.formatExpiryForEmail(report);

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: config.senderEmail,
          replyTo: config.senderEmail,
          fromName: testActive ? `[TEST] ${config.senderName}` : config.senderName,
          to: toEmail,
          cc: finalCcList,
          subject,
          html: htmlBody,
          isTestMode: testActive,
          isTestModeExplicitRecipients: testActive,
          emailType: 'new_rma',
          sandboxEmail,
          attachments,
          text: `${testActive ? '[TEST] ' : ''}New RMA Return: ${report.rma_number} for ${report.name || report.barcode}. Reason: ${report.reason}. Expiry Date (YYYY-MM-DD): ${expiryInfo.text}. Reported by: ${report.reporter_name || report.reported_by}. Customer AE: ${report.ae_name || 'N/A'}${editUrl ? `\n\nEdit RMA Details & Documents (${editorAuthorizedEmails.join(', ')} • No Expiry): ${editUrl}` : ''}`
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn('send-email response was not ok:', res.status, errorText);
        return { success: false, error: errorText };
      }

      const result = await res.json();
      console.log('Email notification dispatch result:', result);
      return result;
    } catch (err) {
      console.warn('Non-blocking error dispatching RMA email notification:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Build clean, modern HTML email notification for product catalog update
   */
  generateProductEmailHtml(product, config, isNew, editorName, isTestMode = false) {
    const title = isNew ? 'New Catalog Product Added' : 'Product Details Updated';
    const badgeText = isNew ? 'NEW PRODUCT' : 'CATALOG UPDATE';
    const hasPhoto = Boolean(product.imageUrl || product.image_url);
    const photoSrc = product.imageUrl || product.image_url;

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 620px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { background: #0f172a; padding: 24px 28px; color: #ffffff; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: #3b82f6; color: #ffffff; margin-bottom: 8px; }
          .title { margin: 0; font-size: 20px; font-weight: 800; line-height: 1.3; }
          .content { padding: 28px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 20px; }
          .grid { display: table; width: 100%; border-collapse: collapse; }
          .row { display: table-row; }
          .col-label { display: table-cell; width: 35%; padding: 6px 0; font-size: 12px; color: #64748b; font-weight: 600; }
          .col-val { display: table-cell; padding: 6px 0; font-size: 13px; color: #0f172a; font-weight: 700; }
          .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; margin: 20px 0 10px; border-bottom: 2px solid #f1f5f9; padding-bottom: 6px; }
          .ae-box { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 13px; }
          .photo-box { text-align: center; margin: 16px 0; }
          .photo-box img { max-width: 240px; max-height: 240px; object-fit: contain; border-radius: 12px; border: 1px solid #cbd5e1; }
          .btn { display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 800; margin-top: 14px; }
          .footer { background: #f1f5f9; padding: 16px 28px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">${isTestMode ? `[TEST] ${badgeText}` : badgeText}</span>
            <h1 class="title">${isTestMode ? '[TEST] ' : ''}${title}: ${product.name}</h1>
            <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Verified Catalog Master Record Update</div>
          </div>
          
          <div class="content">
            ${isTestMode ? `
            <div style="background: #fef3c7; border: 2px dashed #f59e0b; color: #92400e; padding: 12px 16px; border-radius: 12px; margin-bottom: 20px; font-weight: 700; font-size: 13px;">
              🧪 TEST MODE ACTIVE: Safe Sandbox Delivery. Live delivery was safely bypassed.
            </div>
            ` : ''}

            <div class="section-title">Product Information</div>
            <div class="card">
              <div class="grid">
                <div class="row">
                  <div class="col-label">Product Name:</div>
                  <div class="col-val">${product.name}</div>
                </div>
                <div class="row">
                  <div class="col-label">Barcode / QR:</div>
                  <div class="col-val" style="font-family: monospace;">${product.barcode}</div>
                </div>
                ${product.code ? `
                <div class="row">
                  <div class="col-label">SKU / Item Code:</div>
                  <div class="col-val" style="font-family: monospace;">${product.code}</div>
                </div>` : ''}
                <div class="row">
                  <div class="col-label">Net Price:</div>
                  <div class="col-val">₱${Number(product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                <div class="row">
                  <div class="col-label">Price w/ VAT:</div>
                  <div class="col-val" style="color: #059669;">₱${Number(product.priceWithVat || product.price_with_vat || product.price || 0).toLocaleString('en-US', { minimumFractionDigits: 2 })}</div>
                </div>
                <div class="row">
                  <div class="col-label">Supplier:</div>
                  <div class="col-val">${product.supplierName || product.supplier_name || 'Savemore'}</div>
                </div>
                <div class="row">
                  <div class="col-label">Unit:</div>
                  <div class="col-val">${product.unitName || product.unit_name || 'pc'}</div>
                </div>
              </div>
            </div>

            ${hasPhoto ? `
            <div class="section-title">Reference Product Photo</div>
            <div class="photo-box">
              <img src="${photoSrc}" alt="${product.name}" />
            </div>` : ''}

            <div style="font-size: 12px; color: #64748b; margin-top: 16px;">
              Modified by: <strong>${escapeEmailHtml(editorName || 'Admin')}</strong> on ${formatDateTimeYmdHm(new Date())} (YYYY-MM-DD HH:mm)
            </div>
          </div>

          <div class="footer">
            Sender: ${config.senderEmail} • Dispatched by Pingcon RMA Portal
          </div>
        </div>
      </body>
      </html>
    `;
  },

  /**
   * Dispatch email notification after a product is edited, created, or verified
   */
  async sendProductUpdateNotification({ product, isNew = false, editorName = 'Admin', customRecipients = null }, isTestMode = false) {
    if (!product) return { success: false, error: 'No product data' };

    const currentUser = typeof window !== 'undefined' ? authService.getCurrentUser() : null;
    const isSuperAdmin = currentUser?.role === 'super_admin';
    let hasActiveTestInvite = false;
    try {
      const rawGate = typeof window !== 'undefined' ? localStorage.getItem('rma_portal_gate_session') : null;
      if (rawGate) {
        const parsedGate = JSON.parse(rawGate);
        if (parsedGate?.is_test === true && (!parsedGate.expires_at || new Date(parsedGate.expires_at) > new Date())) {
          hasActiveTestInvite = true;
        }
      }
    } catch {}

    const testActive = Boolean(
      isTestRecord(product) ||
      hasActiveTestInvite ||
      (isSuperAdmin && (
        isTestMode ||
        (typeof window !== 'undefined' && localStorage.getItem('rma_portal_test_mode') === 'true')
      ))
    );

    try {
      const config = this.resolveCompanyConfig(product, 'product_update', testActive);
      const sandboxEmail = this.getTestSandboxEmail();
      const resolvedToList = customRecipients && (Array.isArray(customRecipients.toList) || customRecipients.toEmail)
        ? splitEmailList(customRecipients.toList ?? customRecipients.toEmail)
        : config.toList;
      const toList = resolvedToList.length > 0
        ? resolvedToList
        : (testActive ? [sandboxEmail] : [...DEFAULT_RECIPIENTS.toList]);
      const toEmail = toList.join(', ');

      const resolvedBaseCc = customRecipients && Array.isArray(customRecipients.ccList)
        ? splitEmailList(customRecipients.ccList)
        : config.baseCcList;

      // Assemble CC list: NEVER merge Live Customer AE email when Test Mode is active
      const toSet = new Set(toList);
      const ccSet = new Set(resolvedBaseCc.filter((e) => !toSet.has(e)));
      const aeEmail = product.aeEmail || product.ae_email;
      if (!testActive && aeEmail && aeEmail.includes('@')) {
        const cleanAe = aeEmail.trim().toLowerCase();
        if (!toSet.has(cleanAe)) ccSet.add(cleanAe);
      }
      const finalCcList = Array.from(ccSet);

      const rawSubject = `[Product Catalog] ${isNew ? 'New Product Added' : 'Product Details Updated'}: ${product.name} (${product.barcode})`;
      const subject = formatTestEmailSubject(rawSubject, testActive);

      const htmlBody = this.generateProductEmailHtml(product, config, isNew, editorName, testActive);

      console.log(`[Product Update Email] (TestMode: ${testActive}) Dispatching from "${config.senderEmail}" to "${toEmail}", CC: [${finalCcList.join(', ')}]`);

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.senderEmail,
          fromName: testActive ? `[TEST] ${config.senderName}` : config.senderName,
          to: toEmail,
          cc: finalCcList,
          subject,
          html: htmlBody,
          isTestMode: testActive,
          isTestModeExplicitRecipients: testActive,
          emailType: 'product_update',
          sandboxEmail,
          text: `${testActive ? '[TEST] ' : ''}Product ${isNew ? 'Added' : 'Updated'}: ${product.name} (${product.barcode}). SKU: ${product.code || 'N/A'}. AE: ${product.aeName || product.ae_name || 'N/A'}`
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn('send-email response was not ok:', res.status, errorText);
        return { success: false, error: errorText };
      }

      const result = await res.json();
      return result;
    } catch (err) {
      console.warn('Non-blocking error dispatching product email notification:', err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Build HTML body for the 4 lifecycle events:
   * - 'scrapped' | 'restocked' | 'pickup_debit_claim' | 'pickup_replacement'
   */
  generateLifecycleEmailHtml({
    eventType,
    report,
    reports = [],
    allReports = [],
    catalogProducts = [],
    config,
    actorName = '',
    isTestMode = false,
    pickupPhotoGroups = [],
    pickupPhotoEntries = [],
    intakePhotos = [],
    pdfAttachedFilename = null
  }) {
    const effectiveReports = Array.isArray(reports) && reports.length > 0 ? reports : (report ? [report] : []);
    const primaryReport = report || effectiveReports[0] || {};
    const isBatch = effectiveReports.length > 1;
    const isDebitClaimEvent = eventType === 'pickup_debit_claim';
    const isCustomerStream = primaryReport.rma_type !== 'supplier_outbound';
    const rmaNumbersList = Array.from(new Set(
      effectiveReports.map((r) => r.rma_number || r.rmaNumber || String(r.id || '')).filter(Boolean)
    ));
    const rmaNumber = primaryReport.rma_number || primaryReport.rmaNumber || primaryReport.id || 'RMA-PENDING';
    const meta = (primaryReport.ai_document_metadata && typeof primaryReport.ai_document_metadata === 'object')
      ? primaryReport.ai_document_metadata
      : {};
    const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
      ? meta.supplier_pickup
      : {};
    const effectiveActor = String(actorName || pickup.processed_by || meta.simple_rtv_updated_by || '').trim();
    const claimNo = pickup.claim_number || (String(primaryReport.notes || '').match(/\[(?:RTV|BUF):\s*([^\]]+)\]/i)?.[1]?.trim()) || '';
    const refHeadline = isBatch
      ? `${effectiveReports.length} Consolidated RMAs (${claimNo || rmaNumber})`
      : rmaNumber;

    const eventMetaMap = {
      scrapped: {
        badge: isBatch ? `BATCH RMA SCRAPPED (${effectiveReports.length} RMAs)` : 'RMA SCRAPPED / DISPOSED',
        title: `RMA Scrapped / Disposed: ${refHeadline}`,
        headerBg: '#9f1239',
        subtitle: 'Warehouse Disposal & Scrap Confirmation'
      },
      restocked: {
        badge: isBatch ? `BATCH RMA RESTOCKED (${effectiveReports.length} RMAs)` : 'RMA RESTOCKED TO GOOD INVENTORY',
        title: `RMA Restocked: ${refHeadline}`,
        headerBg: '#0f766e',
        subtitle: 'Good Stock Restock & ERP Inventory Verification'
      },
      pickup_debit_claim: {
        badge: isCustomerStream
          ? (isBatch ? `CONSOLIDATED CUSTOMER HANDOVER — CREDIT / RETURN (${effectiveReports.length} RMAs)` : 'CUSTOMER HANDOVER — CREDIT / RETURN')
          : (isBatch ? `CONSOLIDATED DRIVER PICKUP — DEBIT CLAIM (${effectiveReports.length} RMAs)` : 'DRIVER PICKUP — DEBIT CLAIM'),
        title: `Driver Picked Up for Debit Claim: ${refHeadline}`,
        headerBg: '#1e3a8a',
        subtitle: isCustomerStream
          ? 'Customer Return Handover • Credit Return Form PDF Attached'
          : 'Supplier Return Picked Up • Debit Claim Form PDF Attached'
      },
      pickup_replacement: {
        badge: isCustomerStream
          ? (isBatch ? `CONSOLIDATED CUSTOMER BUFFER REPLACEMENT (${effectiveReports.length} RMAs)` : 'CUSTOMER BUFFER REPLACEMENT / EXCHANGE')
          : (isBatch ? `CONSOLIDATED DRIVER PICKUP — REPLACEMENT (${effectiveReports.length} RMAs)` : 'DRIVER PICKUP — REPLACEMENT / EXCHANGE'),
        title: `Driver Picked Up for Replacement: ${refHeadline}`,
        headerBg: '#4338ca',
        subtitle: isCustomerStream
          ? 'Customer Buffer Replacement Completed • Buffer Replacement Form PDF Attached'
          : 'Supplier Replacement / Exchange Picked Up • Replacement Form PDF Attached'
      }
    };
    const ev = eventMetaMap[eventType] || eventMetaMap.scrapped;
    const isPickupEvent = eventType === 'pickup_debit_claim' || eventType === 'pickup_replacement';

    const { items: itemsTable } = getConsolidatedPickupItems({
      report: primaryReport,
      reports: effectiveReports,
      allReports,
      catalogProducts,
      combineIdentical: isPickupEvent
    });

    const grandPieces = itemsTable.reduce((s, it) => s + it.totalPieces, 0);
    const grandValue = itemsTable.reduce((s, it) => s + it.lineTotal, 0);
    const explanationSummary = collectUniqueExplanations(effectiveReports, itemsTable);
    const normalizedPhotoGroups = normalizePickupPhotoGroupsInput(pickupPhotoGroups, pickupPhotoEntries);
    const totalPickupPhotosCount = normalizedPhotoGroups.reduce((sum, grp) => sum + grp.urls.length, 0);

    const partyDisplayName = isCustomerStream
      ? (pickup.customer_name || pickup.supplier_name || primaryReport.store_branch || primaryReport.reporter_name || 'Wholesale Customer')
      : (pickup.supplier_name || primaryReport.supplier_name || primaryReport.supplierName || 'Pending Assignment');
    const eventTimeStr = formatDateTimeYmdHm(
      (isPickupEvent && pickup.picked_up_at) ||
      meta.resolved_at ||
      meta.simple_rtv_updated_at ||
      new Date()
    );
    const driveUrl = primaryReport.google_drive_folder_url || pickup.drive_folder_url || '';
    const needsReorderFlag = primaryReport.needs_reorder === true || meta.needs_reorder === true || String(primaryReport.notes || '').includes('[REORDER: YES]');
    const hubLabel = primaryReport.rma_type === 'supplier_outbound' ? 'Supplier RTV' : 'Customer Hub';
    const branchSummary = Array.from(new Set(
      effectiveReports.map((r) => String(r.store_branch || '').trim()).filter(Boolean)
    )).join(', ') || 'Warehouse / N/A';
    const aeSummary = Array.from(new Set(
      effectiveReports
        .map((r) => r.ae_name ? `${r.ae_name}${r.ae_email ? ` (${r.ae_email})` : ''}` : (r.ae_email || ''))
        .filter(Boolean)
    )).join(', ');

    return `
      <!DOCTYPE html>
      <html>
      <head>
        <meta charset="utf-8">
        <style>
          body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
          .container { max-width: 680px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
          .header { background: ${ev.headerBg}; padding: 24px 28px; color: #ffffff; }
          .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: rgba(255,255,255,0.2); color: #ffffff; margin-bottom: 8px; }
          .title { margin: 0; font-size: 20px; font-weight: 800; line-height: 1.3; }
          .content { padding: 26px; }
          .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin-bottom: 18px; }
          .grid { display: table; width: 100%; border-collapse: collapse; }
          .row { display: table-row; }
          .col-label { display: table-cell; width: 38%; padding: 6px 8px 6px 0; font-size: 12px; color: #64748b; font-weight: 600; vertical-align: top; }
          .col-val { display: table-cell; padding: 6px 0; font-size: 13px; color: #0f172a; font-weight: 700; }
          .section-title { font-size: 13px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; color: #475569; margin: 20px 0 10px; border-bottom: 2px solid #f1f5f9; padding-bottom: 6px; }
          table.items { width: 100%; border-collapse: collapse; margin-top: 8px; font-size: 12px; }
          table.items th { background: #0f172a; color: #ffffff; text-align: left; padding: 8px; font-size: 11px; text-transform: uppercase; }
          table.items td { border-bottom: 1px solid #e2e8f0; padding: 8px; vertical-align: top; }
          .footer { background: #f1f5f9; padding: 16px 28px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">${isTestMode ? `[TEST] ${ev.badge}` : ev.badge}</span>
            <h1 class="title">${isTestMode ? '[TEST] ' : ''}${escapeEmailHtml(ev.title)}</h1>
            <div style="font-size: 12px; opacity: 0.9; margin-top: 4px;">${escapeEmailHtml(ev.subtitle)}</div>
          </div>

          <div class="content">
            ${pdfAttachedFilename ? `
            <div style="background: #eef2ff; border: 1px solid #c7d2fe; color: #1e3a8a; padding: 12px 16px; border-radius: 10px; margin-bottom: 16px; font-size: 13px; font-weight: 700;">
              📎 Attached Official PDF Form: <span style="font-family: monospace;">${escapeEmailHtml(pdfAttachedFilename)}</span>
            </div>` : ''}

            <div class="section-title">RMA &amp; Outcome Summary</div>
            <div class="card">
              <div class="grid">
                <div class="row">
                  <div class="col-label">${isBatch ? `Bundled RMA Numbers (${rmaNumbersList.length}):` : 'RMA Number:'}</div>
                  <div class="col-val" style="font-family: monospace; font-size: 13px; color: #1e3a8a;">${escapeEmailHtml(isBatch ? rmaNumbersList.join(', ') : rmaNumber)}</div>
                </div>
                <div class="row">
                  <div class="col-label">Stream / Hub:</div>
                  <div class="col-val">${escapeEmailHtml(hubLabel)}</div>
                </div>
                ${claimNo ? `
                <div class="row">
                  <div class="col-label">${eventType === 'pickup_replacement' ? (isCustomerStream ? 'Buffer Ref #:' : 'Replacement Ref #:') : (isCustomerStream ? 'Ref / CM #:' : 'Debit Claim #:')}</div>
                  <div class="col-val" style="font-family: monospace; color: #4338ca;">${escapeEmailHtml(claimNo)}</div>
                </div>` : ''}
                <div class="row">
                  <div class="col-label">${isCustomerStream && isPickupEvent ? 'Customer / Outlet:' : 'Supplier / Vendor:'}</div>
                  <div class="col-val">${escapeEmailHtml(partyDisplayName)}</div>
                </div>
                ${(!isDebitClaimEvent && primaryReport.rma_type !== 'supplier_outbound') ? `
                <div class="row">
                  <div class="col-label">Store / Branch:</div>
                  <div class="col-val">${escapeEmailHtml(branchSummary)}</div>
                </div>` : ''}
                <div class="row">
                  <div class="col-label">Defect / Return Reason:</div>
                  <div class="col-val">${escapeEmailHtml(primaryReport.reason || 'Damaged / Defective')}</div>
                </div>
                ${isDebitClaimEvent ? `
                <div class="row">
                  <div class="col-label">Explanation / Defect Notes:</div>
                  <div class="col-val">${escapeEmailHtml(explanationSummary)}</div>
                </div>` : `
                <div class="row">
                  <div class="col-label">Warehouse Location:</div>
                  <div class="col-val">${escapeEmailHtml(primaryReport.warehouse_location || 'Receiving / Warehouse')}</div>
                </div>`}
                ${eventType === 'scrapped' ? `
                <div class="row">
                  <div class="col-label">Re-Order Requested?:</div>
                  <div class="col-val">${needsReorderFlag ? 'YES — Purchase Re-Order Requested' : 'NO — Scrap Write-Off Only'}</div>
                </div>` : ''}
                <div class="row">
                  <div class="col-label">${isPickupEvent ? 'Pickup Date &amp; Time (YYYY-MM-DD HH:mm):' : 'Action Date &amp; Time (YYYY-MM-DD HH:mm):'}</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(eventTimeStr)}</div>
                </div>
                <div class="row">
                  <div class="col-label">Processed By:</div>
                  <div class="col-val">${escapeEmailHtml(effectiveActor || 'Not specified')}</div>
                </div>
                ${aeSummary ? `
                <div class="row">
                  <div class="col-label">Customer AE:</div>
                  <div class="col-val">${escapeEmailHtml(aeSummary)}</div>
                </div>` : ''}
                ${driveUrl ? `
                <div class="row">
                  <div class="col-label">Google Drive Folder:</div>
                  <div class="col-val"><a href="${escapeEmailHtml(driveUrl)}" target="_blank" style="color: #2563eb; text-decoration: underline;">Open RMA Drive Folder</a></div>
                </div>` : ''}
              </div>
            </div>

            ${isPickupEvent ? `
            <div class="section-title">${isCustomerStream ? 'Customer / Receiving Driver &amp; Pickup Details' : 'Supplier Driver &amp; Pickup Details'}</div>
            <div class="card">
              <div class="grid">
                <div class="row">
                  <div class="col-label">Driver Name:</div>
                  <div class="col-val">${escapeEmailHtml(pickup.driver_name || 'Not specified')}</div>
                </div>
                <div class="row">
                  <div class="col-label">Driver Valid Gov’t / Legal ID${pickup.driver_id_type ? ` (${escapeEmailHtml(pickup.driver_id_type)})` : ''} #:</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.driver_license_no || 'Not specified')}</div>
                </div>
                <div class="row">
                  <div class="col-label">Truck Plate #:</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.truck_plate || 'Not specified')}</div>
                </div>
                ${pickup.supplier_email_to ? `
                <div class="row">
                  <div class="col-label">${isCustomerStream ? 'Customer Email TO:' : 'Supplier Email TO:'}</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.supplier_email_to)}</div>
                </div>` : ''}
                ${pickup.supplier_email_cc ? `
                <div class="row">
                  <div class="col-label">${isCustomerStream ? 'Customer Email CC:' : 'Supplier Email CC:'}</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.supplier_email_cc)}</div>
                </div>` : ''}
              </div>
            </div>` : ''}

            <div class="section-title">Full 4-Step &amp; 10-Calendar-Day Pickup Timeline</div>
            <div class="card" style="padding: 12px 14px;">
              ${renderWorkflowStepsHtml(computeFourStepWorkflow(primaryReport, catalogProducts))}
            </div>

            <div class="section-title">Itemized Return Breakdown (${itemsTable.length} line${itemsTable.length > 1 ? 's' : ''})</div>
            <table class="items">
              <thead>
                <tr>
                  <th>#</th>
                  <th>Item Description / SKU</th>
                  <th>Expiry Date (YYYY-MM-DD)</th>
                  <th style="text-align:right;">Qty (Pcs)</th>
                  <th style="text-align:right;">Unit Price</th>
                  <th style="text-align:right;">Line Total</th>
                </tr>
              </thead>
              <tbody>
                ${itemsTable.map((it) => `
                <tr>
                  <td style="font-family: monospace;">${it.idx}</td>
                  <td>
                    <strong>${escapeEmailHtml(it.name)}</strong><br/>
                    <span style="font-size: 11px; color: #64748b; font-family: monospace;">SKU: ${escapeEmailHtml(it.sku)}</span>
                    ${isDebitClaimEvent && it.explanation ? `<br/><span style="font-size: 11px; color: #334155;">Explanation: ${escapeEmailHtml(it.explanation)}</span>` : ''}
                    ${(isBatch || (it.rmaNumbers && it.rmaNumbers.length > 1)) ? `<br/><span style="font-size: 10px; color: #1e3a8a; font-family: monospace; font-weight: 700;">RMAs: ${escapeEmailHtml(it.rmaNumbers.join(', '))}</span>` : ''}
                  </td>
                  <td style="font-family: monospace; white-space: nowrap;">${escapeEmailHtml(it.expiry)}</td>
                  <td style="text-align:right; font-family: monospace; font-weight: 700; white-space: nowrap;">
                    ${it.isCaseUnit && it.piecesPerCase > 1
                      ? `${it.totalPieces.toLocaleString()} pcs (${it.rawQty} ${escapeEmailHtml(it.unitName)} × ${it.piecesPerCase})`
                      : `${it.totalPieces.toLocaleString()} pcs`}
                  </td>
                  <td style="text-align:right; font-family: monospace; white-space: nowrap;">${escapeEmailHtml(formatPeso(it.isCaseUnit && it.piecesPerCase > 1 ? it.pricePerPiece : it.recordedUnitPrice))}</td>
                  <td style="text-align:right; font-family: monospace; font-weight: 700; white-space: nowrap;">${escapeEmailHtml(formatPeso(it.lineTotal))}</td>
                </tr>`).join('')}
                <tr style="background: #f8fafc; font-weight: 800;">
                  <td colspan="3" style="text-align:right;">TOTAL SUMMARY:</td>
                  <td style="text-align:right; font-family: monospace;">${grandPieces.toLocaleString()} pcs</td>
                  <td style="text-align:right;">Total Value:</td>
                  <td style="text-align:right; font-family: monospace; color: #0f172a;">${escapeEmailHtml(formatPeso(grandValue))}</td>
                </tr>
              </tbody>
            </table>

            ${normalizedPhotoGroups.length > 0 ? `
            <div class="section-title">Driver Pickup Verification Photos (${normalizedPhotoGroups.length}/5 categories • ${totalPickupPhotosCount} photo${totalPickupPhotosCount === 1 ? '' : 's'})</div>
            <div style="margin-top: 12px;">
              ${normalizedPhotoGroups.map((grp, grpIdx) => `
              <div style="margin-bottom: 16px; padding: 12px; background: #f8fafc; border: 1px solid #cbd5e1; border-radius: 10px;">
                <div style="font-size: 12px; font-weight: 800; color: #0f172a; margin-bottom: 8px;">
                  ${grpIdx + 1}. ${escapeEmailHtml(grp.label)} (${grp.urls.length} photo${grp.urls.length === 1 ? '' : 's'})
                </div>
                ${grp.urls.map((imgUrl, photoIdx) => `
                <div style="margin-bottom: 10px; text-align: center;">
                  ${grp.urls.length > 1 ? `<div style="font-size: 11px; font-weight: 700; color: #64748b; margin-bottom: 4px;">Photo ${photoIdx + 1} of ${grp.urls.length}</div>` : ''}
                  <img src="${escapeEmailHtml(imgUrl)}" alt="${escapeEmailHtml(grp.label)} #${photoIdx + 1}" style="max-width: 100%; max-height: 360px; width: auto; height: auto; border-radius: 10px; border: 1px solid #cbd5e1;" />
                </div>`).join('')}
              </div>`).join('')}
            </div>` : ''}

            ${intakePhotos.length > 0 ? `
            <div class="section-title">Uploaded RMA Intake Photos (${intakePhotos.length})</div>
            <div style="margin-top: 12px;">
              ${intakePhotos.map((url, idx) => `
              <div style="margin-bottom: 16px; text-align: center;">
                <img src="${escapeEmailHtml(url)}" alt="RMA Intake Photo ${idx + 1}" style="max-width: 100%; max-height: 360px; width: auto; height: auto; border-radius: 10px; border: 1px solid #cbd5e1;" />
                <div style="font-size: 11px; color: #64748b; margin-top: 4px; font-weight: 700;">Intake Photo ${idx + 1} of ${intakePhotos.length}</div>
              </div>`).join('')}
            </div>` : ''}
          </div>

          <div class="footer">
            Automated RMA Lifecycle Notification — Pingcon Marketing Corp. RMA Portal<br/>
            Sender: ${escapeEmailHtml(config.senderEmail)} • Event Time (YYYY-MM-DD HH:mm): ${escapeEmailHtml(eventTimeStr)}
          </div>
        </div>
      </body>
      </html>
    `;
  },

  /**
   * Dispatch lifecycle email for:
   * - 'scrapped' | 'restocked' | 'pickup_debit_claim' | 'pickup_replacement'
   */
  async sendRmaLifecycleNotification({
    eventType,
    report = null,
    reports = [],
    allReports = [],
    catalogProducts = [],
    actorName = '',
    isTestMode = false,
    customRecipients = null
  }) {
    const effectiveReports = Array.isArray(reports) && reports.length > 0
      ? reports
      : (report ? [report] : []);
    const primaryReport = report || effectiveReports[0];
    if (!primaryReport || !eventType) return { success: false, error: 'Missing report or eventType' };

    const testActive = Boolean(
      this.resolveTestModeActive(primaryReport, isTestMode) ||
      effectiveReports.some((r) => isTestRecord(r))
    );

    try {
      const profileKey = resolveEmailProfileKey(eventType);
      const config = this.resolveCompanyConfig(primaryReport, profileKey, testActive);
      const sandboxEmail = this.getTestSandboxEmail();
      const isBatch = effectiveReports.length > 1;
      const isDebitClaimEvent = eventType === 'pickup_debit_claim';
      const isCustomerStream = primaryReport.rma_type !== 'supplier_outbound';
      const rmaNumber = primaryReport.rma_number || primaryReport.rmaNumber || primaryReport.id || 'RMA';
      const meta = (primaryReport.ai_document_metadata && typeof primaryReport.ai_document_metadata === 'object')
        ? primaryReport.ai_document_metadata
        : {};
      const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
        ? meta.supplier_pickup
        : {};
      const effectiveActor = String(actorName || pickup.processed_by || meta.simple_rtv_updated_by || '').trim();
      const claimNo = pickup.claim_number || (String(primaryReport.notes || '').match(/\[(?:RTV|BUF):\s*([^\]]+)\]/i)?.[1]?.trim()) || '';

      const isPickupEvent = isDebitClaimEvent || eventType === 'pickup_replacement';
      const supplierToList = isPickupEvent ? splitEmailList(pickup.supplier_email_to) : [];
      const supplierCcList = isPickupEvent ? splitEmailList(pickup.supplier_email_cc) : [];

      const baseToList = customRecipients && (Array.isArray(customRecipients.toList) || customRecipients.toEmail)
        ? splitEmailList(customRecipients.toList ?? customRecipients.toEmail)
        : config.toList;
      const baseCcList = customRecipients && Array.isArray(customRecipients.ccList)
        ? splitEmailList(customRecipients.ccList)
        : config.baseCcList;

      const mergedTo = Array.from(new Set([
        ...baseToList,
        ...supplierToList
      ]));
      const toList = mergedTo.length > 0
        ? mergedTo
        : (testActive ? [sandboxEmail] : [...DEFAULT_RECIPIENTS.toList]);
      const toEmail = toList.join(', ') || config.toEmail;

      const toSet = new Set(toList);
      const ccSet = new Set([
        ...baseCcList,
        ...supplierCcList
      ].filter((e) => !toSet.has(e)));
      if (!testActive) {
        effectiveReports.forEach((r) => {
          if (r?.ae_email && String(r.ae_email).includes('@')) {
            const cleanAe = String(r.ae_email).trim().toLowerCase();
            if (!toSet.has(cleanAe)) ccSet.add(cleanAe);
          }
        });
      }
      const finalCcList = Array.from(ccSet);

      const savedTestMap = testActive ? this._readSavedProfilesMap(true) : {};
      const hasCustomTestProfileOrGlobal = testActive && Boolean(
        savedTestMap[profileKey] ||
        (typeof window !== 'undefined' && localStorage.getItem(TEST_EMAIL_RECIPIENTS_STORAGE_KEY)) ||
        (customRecipients && (
          splitEmailList(customRecipients.toList ?? customRecipients.toEmail).join(',') !== sandboxEmail ||
          splitEmailList(customRecipients.ccList).length > 0
        ))
      );

      const batchTag = isBatch ? `Consolidated (${effectiveReports.length} RMAs) — ` : '';
      const subjectLabelMap = {
        scrapped: `[RMA Scrapped] ${batchTag}${claimNo || rmaNumber}: ${primaryReport.name || primaryReport.barcode || 'Items'}`,
        restocked: `[RMA Restocked] ${batchTag}${claimNo || rmaNumber}: ${primaryReport.name || primaryReport.barcode || 'Items'}`,
        pickup_debit_claim: `[Driver Picked Up - Debit Claim] ${batchTag}${claimNo || rmaNumber}: ${pickup.supplier_name || primaryReport.supplier_name || 'Supplier'}`,
        pickup_replacement: `[Driver Picked Up - Replacement] ${batchTag}${claimNo || rmaNumber}: ${pickup.supplier_name || primaryReport.supplier_name || 'Supplier'}`
      };
      const baseSubject = subjectLabelMap[eventType] || `[RMA Update] ${batchTag}${rmaNumber}`;
      const subject = formatTestEmailSubject(baseSubject, testActive);

      // Collect pickup verification photos (normalizing string | string[]) + RMA intake photos across all bundled RMAs
      const pickupPhotoGroups = collectPickupPhotoGroupsFromReports(effectiveReports);
      const pickupPhotoEntries = pickupPhotoGroups.flatMap((grp) =>
        grp.urls.map((url) => ({ label: grp.label, url }))
      );

      const pickupUrlSet = new Set(pickupPhotoEntries.map((e) => e.url));
      const intakePhotoSet = new Set();
      effectiveReports.forEach((r) => {
        getRealPhotos(r).forEach((u) => {
          if (u && !pickupUrlSet.has(u)) intakePhotoSet.add(u);
        });
      });
      const allIntakePhotos = Array.from(intakePhotoSet);

      const attachments = [];
      let pdfAttachedFilename = null;
      if (isPickupEvent) {
        const pdfAttachment = generatePickupFormPdfAttachment({
          report: primaryReport,
          reports: effectiveReports,
          allReports,
          catalogProducts,
          preparedByOverride: pickup.processed_by || effectiveActor || '',
          combineIdentical: true
        });
        if (pdfAttachment) {
          attachments.push({
            filename: pdfAttachment.filename,
            content: pdfAttachment.content,
            encoding: 'base64',
            contentType: 'application/pdf'
          });
          pdfAttachedFilename = pdfAttachment.filename;
        }
      }

      // Attach remote HTTPS image links up to safe Gmail/Vercel cap (first cover at least 1 photo per pickup category,
      // then remaining pickup photos, then intake photos; all photos remain embedded in HTML).
      const attachedUrls = new Set();
      let remoteImgCount = 0;
      const tryPushRemoteImage = (url, filename) => {
        if (remoteImgCount >= MAX_REMOTE_IMAGE_ATTACHMENTS) return;
        const cleanUrl = String(url || '').trim();
        if (!/^https?:\/\//i.test(cleanUrl) || attachedUrls.has(cleanUrl)) return;
        attachedUrls.add(cleanUrl);
        remoteImgCount += 1;
        attachments.push({ filename, path: cleanUrl });
      };

      if (isPickupEvent) {
        // Pass 1: 1 representative photo per category
        pickupPhotoGroups.forEach((grp) => {
          if (grp.urls[0]) {
            tryPushRemoteImage(grp.urls[0], `${grp.key || 'pickup'}_1.jpg`);
          }
        });
        // Pass 2: remaining multi-photo uploads per category up to cap
        pickupPhotoGroups.forEach((grp) => {
          grp.urls.slice(1).forEach((url, idx) => {
            tryPushRemoteImage(url, `${grp.key || 'pickup'}_${idx + 2}.jpg`);
          });
        });
        // Pass 3: intake photos up to cap
        allIntakePhotos.forEach((url, idx) => {
          tryPushRemoteImage(url, `rma_intake_photo_${idx + 1}.jpg`);
        });
      }

      const { items: itemsTable } = getConsolidatedPickupItems({
        report: primaryReport,
        reports: effectiveReports,
        allReports,
        catalogProducts,
        combineIdentical: isPickupEvent
      });
      const explanationSummary = collectUniqueExplanations(effectiveReports, itemsTable);

      const htmlBody = this.generateLifecycleEmailHtml({
        eventType,
        report: primaryReport,
        reports: effectiveReports,
        allReports,
        catalogProducts,
        config,
        actorName: effectiveActor,
        isTestMode: testActive,
        pickupPhotoGroups: isPickupEvent ? pickupPhotoGroups : [],
        pickupPhotoEntries: isPickupEvent ? pickupPhotoEntries : [],
        intakePhotos: isPickupEvent ? allIntakePhotos : [],
        pdfAttachedFilename
      });

      const eventTimeStr = formatDateTimeYmdHm(new Date());
      const partyDisplay = isCustomerStream && isPickupEvent
        ? (pickup.customer_name || pickup.supplier_name || primaryReport.store_branch || primaryReport.reporter_name || 'Wholesale Customer')
        : (pickup.supplier_name || primaryReport.supplier_name || primaryReport.supplierName || 'Pending Assignment');
      const branchSummaryText = Array.from(new Set(
        effectiveReports.map((r) => String(r.store_branch || '').trim()).filter(Boolean)
      )).join(', ') || 'Warehouse / N/A';

      const wfForText = computeFourStepWorkflow(primaryReport, catalogProducts);
      const plainTextLines = [
        `${testActive ? '[TEST] ' : ''}${baseSubject}`,
        `${isCustomerStream && isPickupEvent ? 'Customer / Outlet' : 'Supplier / Vendor'}: ${partyDisplay}`,
        ...(isDebitClaimEvent
          ? [
              `Defect / Return Reason: ${primaryReport.reason || 'Damaged / Defective'}`,
              `Explanation / Defect Notes: ${explanationSummary}`
            ]
          : [
              ...(primaryReport.rma_type !== 'supplier_outbound' ? [`Store / Branch: ${branchSummaryText}`] : []),
              `Defect / Return Reason: ${primaryReport.reason || 'Damaged / Defective'}`,
              `Warehouse Location: ${primaryReport.warehouse_location || 'Receiving / Warehouse'}`
            ]),
        `Workflow Timeline: Step 1 Report=${wfForText.step1.dateDisplay} | Step 2=${wfForText.step2.text} | Step 3 Picked Up=${wfForText.step3.dateDisplay} | Step 4=${wfForText.step4.dateDisplay}`,
        ...(Array.isArray(wfForText.timelineDays)
          ? wfForText.timelineDays.map((d) => (
              d.day === 0
                ? `  - Day 0 (Report Date): ${d.dateLabel} => ${d.statusText}`
                : `  - Day ${d.day} (${d.dateLabel}) => ${d.statusText}`
            ))
          : []),
        ...(itemsTable.length > 0
          ? [
              `Items (${itemsTable.length} line${itemsTable.length > 1 ? 's' : ''}):`,
              ...itemsTable.map((it) => {
                const expSuffix = isDebitClaimEvent && it.explanation ? ` | Explanation: ${it.explanation}` : '';
                return `- ${it.name} (SKU: ${it.sku}) • Qty: ${it.totalPieces} pcs${expSuffix}`;
              })
            ]
          : []),
        `Processed By: ${effectiveActor || 'Not specified'}`,
        `Event Time (YYYY-MM-DD HH:mm): ${eventTimeStr}`
      ];

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: config.senderEmail,
          fromName: testActive ? `[TEST] ${config.senderName}` : config.senderName,
          to: toEmail,
          cc: finalCcList,
          subject,
          html: htmlBody,
          isTestMode: testActive,
          isTestModeExplicitRecipients: testActive && !isPickupEvent,
          ...(testActive && isPickupEvent ? {
            hasCustomTestRecipients: hasCustomTestProfileOrGlobal,
            testToList: baseToList,
            testCcList: baseCcList
          } : {}),
          emailType: profileKey,
          sandboxEmail,
          attachments,
          text: plainTextLines.join('\n')
        })
      });

      if (!res.ok) {
        const errorText = await res.text();
        console.warn(`Lifecycle email (${eventType}) response not ok:`, res.status, errorText);
        return { success: false, error: errorText };
      }

      return await res.json();
    } catch (err) {
      console.warn(`Non-blocking error sending lifecycle email (${eventType}):`, err.message);
      return { success: false, error: err.message };
    }
  },

  /**
   * Manually trigger the Overall RMA Matrix (.xlsx) email dispatch
   */
  async sendDailyMatrixEmailNow({
    startDate,
    endDate,
    stream,
    includeZeroCatalogSkus,
    to,
    toList,
    cc,
    ccList,
    isTestMode = false,
    force = true,
    dryRun = false,
    respectSchedule = false
  } = {}) {
    try {
      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch {}

      const headers = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const payload = {
        action: 'daily-matrix',
        isTestMode: Boolean(isTestMode),
        sandboxEmail: this.getTestSandboxEmail(),
        force: Boolean(force),
        dryRun: Boolean(dryRun),
        ...(respectSchedule ? { respectSchedule: true } : {})
      };
      if (startDate) payload.startDate = startDate;
      if (endDate) payload.endDate = endDate;
      if (stream) payload.stream = stream;
      if (includeZeroCatalogSkus !== undefined) {
        payload.includeZeroCatalogSkus = Boolean(includeZeroCatalogSkus);
      }
      if (toList !== undefined || to !== undefined) {
        payload.to = to ?? toList;
        payload.toList = Array.isArray(toList) ? toList : splitEmailList(to);
        if (isTestMode && payload.toList.length > 0) {
          payload.isTestModeExplicitRecipients = true;
        }
      }
      if (ccList !== undefined || cc !== undefined) {
        payload.cc = ccList ?? cc;
        payload.ccList = Array.isArray(ccList) ? ccList : splitEmailList(cc);
        if (isTestMode) {
          payload.isTestModeExplicitRecipients = true;
        }
      }

      const res = await fetch('/api/send-email?action=daily-matrix', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: data?.message || data?.error || `HTTP ${res.status}`
        };
      }
      return data || { success: false, error: 'Empty response from server.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Manually trigger or dry-run the 10-Calendar-Day Pickup Follow-Up & Auto-Dispose Check
   */
  async runDailyFollowUpNow({
    isTestMode = false,
    force = false,
    dryRun = false,
    rmaNumber = '',
    operation = 'run_all',
    respectSchedule = false,
    overrideToEmail = ''
  } = {}) {
    try {
      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch {}

      const headers = { 'Content-Type': 'application/json' };
      if (accessToken) {
        headers.Authorization = `Bearer ${accessToken}`;
      }

      const payload = {
        action: 'daily-followup',
        operation,
        isTestMode: Boolean(isTestMode),
        sandboxEmail: this.getTestSandboxEmail(),
        force: Boolean(force),
        dryRun: Boolean(dryRun),
        respectSchedule: Boolean(respectSchedule),
        ...(rmaNumber ? { rmaNumber } : {}),
        ...(overrideToEmail ? { overrideToEmail } : {})
      };

      const res = await fetch('/api/send-email?action=daily-followup', {
        method: 'POST',
        headers,
        body: JSON.stringify(payload)
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: data?.message || data?.error || `HTTP ${res.status}`
        };
      }
      return data || { success: false, error: 'Empty response from server.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Poll Gmail IMAP replies with edited `.xlsx` attachments and apply RMA updates
   */
  async syncEmailRepliesNow({ source = 'admin_auto_poll', includeIdleLogs = false, strict = false } = {}) {
    try {
      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch {}

      const headers = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const qs = new URLSearchParams({ action: 'sync-email-replies', source });
      if (includeIdleLogs) qs.set('includeIdleLogs', '1');
      if (strict) qs.set('strict', '1');

      const res = await fetch(`/api/send-email?${qs.toString()}`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ action: 'sync-email-replies', source, includeIdleLogs })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          ...(data && typeof data === 'object' ? data : {}),
          success: false,
          status: res.status,
          error: data?.message || data?.error || `HTTP ${res.status}`
        };
      }
      return data || { success: false, error: 'Empty response from server.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Fetch persisted 2-way email reply sync health status & recent execution/error logs
   */
  async getEmailReplySyncLogs() {
    try {
      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch {}

      const headers = {};
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await fetch('/api/send-email?action=reply-sync-logs', {
        method: 'GET',
        headers
      });
      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: data?.message || data?.error || `HTTP ${res.status}`,
          statusSummary: null,
          logs: []
        };
      }
      return data || { success: false, error: 'Empty response from server.', statusSummary: null, logs: [] };
    } catch (err) {
      return { success: false, error: err.message, statusSummary: null, logs: [] };
    }
  },

  /**
   * Manually upload an edited New RMA Alert `.xlsx` workbook to update its matching RMA ticket
   */
  async ingestEditedRmaXlsx({ file, rmaNumber = '', actorName = 'Admin' } = {}) {
    if (!file) return { success: false, error: 'Please select a .xlsx file.' };
    try {
      const buf = await file.arrayBuffer();
      const bytes = new Uint8Array(buf);
      let binary = '';
      const chunk = 0x8000;
      for (let i = 0; i < bytes.length; i += chunk) {
        binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
      }
      const fileBase64 = btoa(binary);

      let accessToken = '';
      try {
        const { data: { session } } = await supabase.auth.getSession();
        accessToken = session?.access_token || '';
      } catch {}

      const headers = { 'Content-Type': 'application/json' };
      if (accessToken) headers.Authorization = `Bearer ${accessToken}`;

      const res = await fetch('/api/send-email?action=ingest-xlsx-reply', {
        method: 'POST',
        headers,
        body: JSON.stringify({
          action: 'ingest-xlsx-reply',
          fileBase64,
          filename: file.name || 'edited-rma.xlsx',
          rmaNumber,
          actorName
        })
      });

      const data = await res.json().catch(() => null);
      if (!res.ok) {
        return {
          success: false,
          status: res.status,
          error: data?.message || data?.error || `HTTP ${res.status}`
        };
      }
      return data || { success: false, error: 'Empty response from server.' };
    } catch (err) {
      return { success: false, error: err.message };
    }
  },

  /**
   * Diagnostic: Test Google SMTP connection and authentication credentials
   */
  async testSmtpConnection() {
    try {
      const res = await fetch('/api/send-email?action=test-connection', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ action: 'test-connection' })
      });
      if (!res.ok) {
        return { success: false, error: `HTTP ${res.status}: ${await res.text()}` };
      }
      return await res.json();
    } catch (err) {
      return { success: false, error: err.message };
    }
  }
};


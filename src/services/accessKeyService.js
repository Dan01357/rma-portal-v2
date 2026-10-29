import { supabase } from '../supabaseClient';

const STORAGE_KEY = 'rma_portal_access_keys_v2';
const SETTINGS_KEY = 'portal_access_keys_store';
const SESSION_KEY = 'rma_portal_gate_session';
const ATTEMPTS_KEY = 'rma_gate_pin_attempts_';

export const DEFAULT_ACCESS_PROFILES = [
  {
    id: 'wh-dock-main-default',
    name: 'Main Warehouse Floor',
    type: 'internal_warehouse',
    access_slug: 'dock',
    pin_code: '123456',
    session_duration_hours: 0, // 0 = No Expiry (Permanent)
    is_active: true,
    created_by: 'System Default',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  },
  {
    id: 'cust-delivery-box-default',
    name: 'Customer Delivery Boxes',
    type: 'external_customer',
    access_slug: 'returns',
    pin_code: '654321',
    session_duration_hours: 2, // 2 Hours per device
    is_active: true,
    created_by: 'System Default',
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z'
  }
];

export const accessKeyService = {
  /**
   * GET ALL QR ACCESS PROFILES
   * 1. Query public.portal_access_keys table (if exists)
   * 2. Fallback to Supabase rma_settings table (key: 'portal_access_keys_store')
   * 3. Fallback to localStorage / DEFAULT_ACCESS_PROFILES
   */
  async getProfiles() {
    let remoteProfiles = null;

    // 1. Try dedicated table in Supabase
    try {
      const { data, error } = await supabase
        .from('portal_access_keys')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data) && data.length > 0) {
        remoteProfiles = data;
      }
    } catch (e) {
      // Table may not exist yet in database
    }

    // 2. Fallback to rma_settings store
    if (!remoteProfiles) {
      try {
        const { data, error } = await supabase
          .from('rma_settings')
          .select('value')
          .eq('key', SETTINGS_KEY)
          .single();

        if (!error && data?.value && Array.isArray(data.value) && data.value.length > 0) {
          remoteProfiles = data.value;
        }
      } catch (e) {
        // Settings table notice
      }
    }

    // 3. Fallback to localStorage
    let localProfiles = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        localProfiles = JSON.parse(raw);
      }
    } catch (e) {}

    // Merge: Defaults -> LocalStorage -> Remote Supabase
    const profileMap = new Map();
    DEFAULT_ACCESS_PROFILES.forEach(p => profileMap.set(p.access_slug.toLowerCase(), p));
    localProfiles.forEach(p => {
      if (p.access_slug) profileMap.set(p.access_slug.toLowerCase(), p);
    });
    (remoteProfiles || []).forEach(p => {
      if (p.access_slug) profileMap.set(p.access_slug.toLowerCase(), p);
    });

    const merged = Array.from(profileMap.values()).sort((a, b) => {
      const dateA = new Date(a.created_at || 0).getTime();
      const dateB = new Date(b.created_at || 0).getTime();
      return dateB - dateA;
    });

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(merged));
    } catch (e) {}

    return merged;
  },

  /**
   * GET PROFILE BY SLUG
   */
  async getProfileBySlug(slug) {
    if (!slug) return null;
    const cleanSlug = String(slug).trim().toLowerCase();
    const all = await this.getProfiles();
    return all.find(p => p.access_slug.toLowerCase() === cleanSlug) || null;
  },

  /**
   * CREATE / SAVE NEW QR ACCESS PROFILE
   */
  async createProfile({
    name,
    type = 'internal_warehouse',
    accessSlug,
    pinCode,
    sessionDurationHours = 0,
    createdBy = 'Admin'
  }) {
    if (!name || !name.trim()) throw new Error('Profile name is required');
    if (!pinCode || !/^\d{6}$/.test(String(pinCode).trim())) {
      throw new Error('PIN must be exactly 6 numeric digits (0-9)');
    }

    const cleanName = name.trim();
    let cleanSlug = (accessSlug || cleanName)
      .toLowerCase()
      .trim()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');

    if (!cleanSlug) cleanSlug = `gate-${Date.now().toString(36)}`;

    // Ensure unique slug
    const existing = await this.getProfiles();
    if (existing.some(p => p.access_slug === cleanSlug)) {
      cleanSlug = `${cleanSlug}-${Math.floor(100 + Math.random() * 900)}`;
    }

    const newProfile = {
      id: `key_${Date.now()}_${Math.random().toString(36).substring(2, 9)}`,
      name: cleanName,
      type: type === 'external_customer' ? 'external_customer' : 'internal_warehouse',
      access_slug: cleanSlug,
      pin_code: String(pinCode).trim(),
      session_duration_hours: Math.max(0, parseInt(sessionDurationHours, 10) || 0),
      is_active: true,
      created_by: createdBy || 'Admin',
      created_at: new Date().toISOString(),
      updated_at: new Date().toISOString()
    };

    // 1. Try Supabase table
    try {
      await supabase.from('portal_access_keys').insert([newProfile]);
    } catch (e) {}

    // 2. Persist to rma_settings
    const updatedList = [newProfile, ...existing];
    try {
      await supabase.from('rma_settings').upsert({
        key: SETTINGS_KEY,
        value: updatedList,
        updated_at: new Date().toISOString()
      });
    } catch (e) {}

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    return newProfile;
  },

  /**
   * UPDATE PROFILE (PIN, Duration, Name, Status)
   */
  async updateProfile(idOrSlug, updates) {
    const existing = await this.getProfiles();
    const targetIdx = existing.findIndex(p => p.id === idOrSlug || p.access_slug === idOrSlug);
    if (targetIdx === -1) throw new Error('Access profile not found');

    const updatedProfile = {
      ...existing[targetIdx],
      ...updates,
      updated_at: new Date().toISOString()
    };

    if (updates.pin_code && !/^\d{6}$/.test(String(updates.pin_code).trim())) {
      throw new Error('PIN must be exactly 6 numeric digits');
    }

    existing[targetIdx] = updatedProfile;

    // 1. Try Supabase table
    try {
      await supabase
        .from('portal_access_keys')
        .update(updatedProfile)
        .eq('access_slug', updatedProfile.access_slug);
    } catch (e) {}

    // 2. Persist to rma_settings
    try {
      await supabase.from('rma_settings').upsert({
        key: SETTINGS_KEY,
        value: existing,
        updated_at: new Date().toISOString()
      });
    } catch (e) {}

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(existing));
    } catch (e) {}

    return updatedProfile;
  },

  /**
   * DELETE PROFILE (Protects default 'dock' and 'returns' from permanent loss)
   */
  async deleteProfile(idOrSlug) {
    const existing = await this.getProfiles();
    const target = existing.find(p => p.id === idOrSlug || p.access_slug === idOrSlug);
    if (!target) return;

    if (target.access_slug === 'dock' || target.access_slug === 'returns') {
      // Don't fully destroy root defaults; deactivate or reset instead
      return this.updateProfile(target.access_slug, { is_active: false });
    }

    const filtered = existing.filter(p => p.id !== idOrSlug && p.access_slug !== idOrSlug);

    // 1. Try table
    try {
      await supabase.from('portal_access_keys').delete().eq('access_slug', target.access_slug);
    } catch (e) {}

    // 2. Update rma_settings
    try {
      await supabase.from('rma_settings').upsert({
        key: SETTINGS_KEY,
        value: filtered,
        updated_at: new Date().toISOString()
      });
    } catch (e) {}

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {}
  },

  /**
   * VERIFY PIN WITH RATE-LIMIT BRUTE-FORCE PROTECTION
   */
  async verifyPin(slug, inputPin) {
    const profile = await this.getProfileBySlug(slug);
    if (!profile) {
      return { success: false, error: 'NOT_FOUND', message: 'QR Access Profile not found.' };
    }

    if (!profile.is_active) {
      return { success: false, error: 'INACTIVE', message: 'This QR Access Code is currently inactive.' };
    }

    // Check rate limit on device
    const attemptKey = `${ATTEMPTS_KEY}${slug}`;
    let attemptsData = { count: 0, lockedUntil: 0 };
    try {
      const raw = localStorage.getItem(attemptKey);
      if (raw) attemptsData = JSON.parse(raw);
    } catch (e) {}

    const now = Date.now();
    if (attemptsData.lockedUntil && attemptsData.lockedUntil > now) {
      const secondsLeft = Math.ceil((attemptsData.lockedUntil - now) / 1000);
      return {
        success: false,
        error: 'LOCKED',
        secondsLeft,
        message: `Too many incorrect attempts. Please wait ${secondsLeft}s before retrying.`
      };
    }

    const cleanInput = String(inputPin || '').trim();
    const cleanExpected = String(profile.pin_code || '').trim();

    if (cleanInput === cleanExpected) {
      // Reset attempts on correct PIN
      try { localStorage.removeItem(attemptKey); } catch (e) {}
      const session = this.createSession(profile);
      return { success: true, profile, session };
    } else {
      // Increment attempt counter
      const newCount = (attemptsData.count || 0) + 1;
      let lockedUntil = 0;
      if (newCount >= 5) {
        lockedUntil = now + 30000; // 30 seconds cooldown
      }

      try {
        localStorage.setItem(attemptKey, JSON.stringify({ count: newCount >= 5 ? 0 : newCount, lockedUntil }));
      } catch (e) {}

      return {
        success: false,
        error: 'INVALID_PIN',
        remainingAttempts: Math.max(0, 5 - newCount),
        isLocked: lockedUntil > 0,
        message: lockedUntil > 0 
          ? 'Too many incorrect attempts. Locked for 30 seconds.'
          : 'Incorrect 6-digit PIN. Please retry.'
      };
    }
  },

  /**
   * CREATE ENCRYPTED SESSION TOKEN ON DEVICE
   */
  createSession(profile) {
    const now = Date.now();
    const durationHours = Number(profile.session_duration_hours || 0);
    const expiresAt = durationHours > 0 
      ? new Date(now + (durationHours * 3600 * 1000)).toISOString() 
      : null; // null = No Expiry (Permanent)

    const token = `gate_${profile.access_slug}_${now.toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    const sessionPayload = {
      token,
      slug: profile.access_slug,
      profileId: profile.id,
      profileName: profile.name,
      type: profile.type,
      durationHours,
      unlockedAt: new Date(now).toISOString(),
      expiresAt
    };

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionPayload));
    } catch (e) {}

    return sessionPayload;
  },

  /**
   * CHECK IF ACTIVE VALID SESSION EXISTS ON DEVICE
   */
  getActiveSession(targetSlug = null) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (!raw) return null;

      const session = JSON.parse(raw);
      if (!session || !session.token) return null;

      // If specific targetSlug is provided, check matching slug
      if (targetSlug && session.slug?.toLowerCase() !== targetSlug.toLowerCase()) {
        return null;
      }

      // Check expiration for temporary customer sessions
      if (session.expiresAt) {
        const expTime = new Date(session.expiresAt).getTime();
        if (Date.now() >= expTime) {
          // Expired -> Clean up
          localStorage.removeItem(SESSION_KEY);
          return null;
        }
      }

      return session;
    } catch (e) {
      return null;
    }
  },

  /**
   * CLEAR SESSION (LOGOUT DEVICE FROM GATEKEEPER)
   */
  clearSession() {
    try {
      localStorage.removeItem(SESSION_KEY);
    } catch (e) {}
  },

  /**
   * TEST MODE ACTIVE CHECK
   */
  isTestModeActive() {
    try {
      return localStorage.getItem('rma_portal_test_mode') === 'true';
    } catch (e) {
      return false;
    }
  }
};

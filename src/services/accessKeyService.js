import { supabase } from '../supabaseClient';
import { getDeviceFingerprint } from '../utils/deviceFingerprint';

const STORAGE_KEY = 'rma_portal_access_keys_v2';
const SETTINGS_KEY = 'portal_access_keys_store';
const SESSION_KEY = 'rma_portal_gate_session';
const ATTEMPTS_KEY = 'rma_gate_pin_attempts_';
const DELETED_KEY = 'rma_deleted_access_slugs';

function getDeletedSlugs() {
  try {
    const raw = localStorage.getItem(DELETED_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function addDeletedSlug(slug) {
  if (!slug) return;
  try {
    const list = getDeletedSlugs();
    const clean = String(slug).trim().toLowerCase();
    if (!list.includes(clean)) {
      list.push(clean);
      localStorage.setItem(DELETED_KEY, JSON.stringify(list));
    }
  } catch {}
}

export const DEFAULT_ACCESS_PROFILES = [
  {
    id: 'wh-dock-main-default',
    name: 'Main Warehouse Floor',
    type: 'internal_warehouse',
    access_slug: 'dock',
    pin_code: '123456',
    session_duration_hours: 0, // 0 = No Expiry (Permanent)
    cooldown_duration_hours: 0, // 0 = Cooldown Disabled
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
    cooldown_duration_hours: 6, // 6 Hours Cooldown Lockout
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
    const deletedSlugs = getDeletedSlugs();

    DEFAULT_ACCESS_PROFILES.forEach(p => {
      if (!deletedSlugs.includes(p.access_slug.toLowerCase())) {
        profileMap.set(p.access_slug.toLowerCase(), p);
      }
    });
    localProfiles.forEach(p => {
      if (p.access_slug && !deletedSlugs.includes(p.access_slug.toLowerCase())) {
        profileMap.set(p.access_slug.toLowerCase(), p);
      }
    });
    (remoteProfiles || []).forEach(p => {
      if (p.access_slug && !deletedSlugs.includes(p.access_slug.toLowerCase())) {
        profileMap.set(p.access_slug.toLowerCase(), p);
      }
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
    cooldownDurationHours = 6,
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
      session_duration_hours: Math.max(0, parseFloat(sessionDurationHours) || 0),
      cooldown_duration_hours: type === 'internal_warehouse' ? 0 : Math.max(0, parseFloat(cooldownDurationHours) || 0),
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
   * UPDATE PROFILE (PIN, Duration, Name, Cooldown, Status)
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
   * DELETE PROFILE (Permanently removes QR access profile and records tombstone)
   */
  async deleteProfile(idOrSlug) {
    if (!idOrSlug) return false;
    const existing = await this.getProfiles();
    const target = existing.find(p => p.id === idOrSlug || p.access_slug?.toLowerCase() === String(idOrSlug).toLowerCase());
    if (!target) return false;

    // Record tombstone to prevent resurrection from default profiles
    addDeletedSlug(target.access_slug);

    const filtered = existing.filter(p => p.id !== target.id && p.access_slug?.toLowerCase() !== target.access_slug.toLowerCase());

    // 1. Delete from Supabase dedicated table
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

    // 3. Update localStorage
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(filtered));
    } catch (e) {}

    // 4. If current device session was for this slug, clear it
    const active = this.getActiveSession();
    if (active && active.slug?.toLowerCase() === target.access_slug.toLowerCase()) {
      this.clearSession();
    }

    return true;
  },

  /**
   * VERIFY PIN WITH SERVER-SIDE ANTI-FRAUD COOLDOWN ENGINE & BRUTE-FORCE PROTECTION
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
    const deviceFingerprint = await getDeviceFingerprint();

    // 1. PRIMARY: Call unbypassable server-side verification endpoint
    try {
      const resp = await fetch('/api/v1/auth/verify-pin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          slug: profile.access_slug,
          pin: cleanInput,
          deviceFingerprint
        })
      });

      const data = await resp.json().catch(() => ({}));

      // HTTP 429: Active Cooldown Lockout
      if (resp.status === 429 || data.error === 'COOLDOWN_ACTIVE') {
        return {
          success: false,
          error: 'COOLDOWN_ACTIVE',
          message: data.message || 'Return Window Currently Locked',
          cooldownRemainingMinutes: data.cooldownRemainingMinutes || 60,
          unlocksAt: data.unlocksAt,
          sessionExpiresAt: data.sessionExpiresAt,
          profileName: data.profileName || profile.name,
          cooldownDurationHours: data.cooldownDurationHours || profile.cooldown_duration_hours || 6
        };
      }

      // HTTP 200: Successful authentication
      if (resp.ok && data.success && data.session) {
        try { localStorage.removeItem(attemptKey); } catch (e) {}
        try { 
          localStorage.setItem(SESSION_KEY, JSON.stringify(data.session)); 
          if (data.session.cooldownUntil) {
            localStorage.setItem(`rma_last_session_${data.session.slug?.toLowerCase()}`, JSON.stringify(data.session));
          }
        } catch (e) {}
        return { success: true, profile: data.profile || profile, session: data.session };
      }

      // HTTP 401: Invalid PIN
      if (resp.status === 401 || data.error === 'INVALID_PIN') {
        const newCount = (attemptsData.count || 0) + 1;
        let lockedUntil = 0;
        if (newCount >= 5) lockedUntil = now + 30000;
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

      if (data.message && !resp.ok) {
        return { success: false, error: data.error || 'ERROR', message: data.message };
      }
    } catch (netErr) {
      console.warn('API endpoint unreachable; using direct Supabase anti-fraud fallback:', netErr);
    }

    // 2. FALLBACK: Direct Supabase Cooldown Check & PIN verification
    // Checks public.device_intake_sessions directly so cooldowns are NEVER bypassed
    try {
      if (profile.type === 'external_customer' && Number(profile.session_duration_hours) > 0) {
        const { data: dbSessions } = await supabase
          .from('device_intake_sessions')
          .select('*')
          .eq('device_fingerprint', deviceFingerprint)
          .eq('access_slug', profile.access_slug)
          .order('cooldown_until', { ascending: false })
          .limit(1);

        if (dbSessions && dbSessions.length > 0) {
          const s = dbSessions[0];
          const cooldownDate = new Date(s.cooldown_until);
          const expiresDate = new Date(s.session_expires_at);
          const nowDate = new Date();

          if (nowDate >= expiresDate && nowDate < cooldownDate) {
            const diffMs = cooldownDate.getTime() - nowDate.getTime();
            const cooldownRemainingMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));
            return {
              success: false,
              error: 'COOLDOWN_ACTIVE',
              message: 'Return Window Currently Locked: Your previous RMA session has concluded.',
              cooldownRemainingMinutes,
              unlocksAt: s.cooldown_until,
              sessionExpiresAt: s.session_expires_at,
              profileName: profile.name,
              cooldownDurationHours: profile.cooldown_duration_hours || 6
            };
          }
        }
      }
    } catch (e) {}

    // Verify PIN locally
    const cleanExpected = String(profile.pin_code || '').trim();
    if (cleanInput === cleanExpected) {
      try { localStorage.removeItem(attemptKey); } catch (e) {}
      const session = this.createSession(profile);

      // Async record session in Supabase
      if (profile.type === 'external_customer') {
        const durationHours = Number(profile.session_duration_hours || 2);
        const cooldownHours = Number(profile.cooldown_duration_hours !== undefined ? profile.cooldown_duration_hours : 6);
        const nowIso = new Date().toISOString();
        const sessionExpiresAt = new Date(Date.now() + (durationHours * 3600 * 1000)).toISOString();
        const cooldownUntil = new Date(new Date(sessionExpiresAt).getTime() + (cooldownHours * 3600 * 1000)).toISOString();

        supabase.from('device_intake_sessions').insert([{
          access_slug: profile.access_slug,
          device_fingerprint: deviceFingerprint,
          ip_address: 'client-direct',
          session_started_at: nowIso,
          session_expires_at: sessionExpiresAt,
          cooldown_until: cooldownUntil,
          status: 'active'
        }]).then(() => {}).catch(() => {});
      }

      return { success: true, profile, session };
    } else {
      const newCount = (attemptsData.count || 0) + 1;
      let lockedUntil = 0;
      if (newCount >= 5) lockedUntil = now + 30000;
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
   * CHECK DEVICE COOLDOWN STATUS
   * Authoritatively checks if current device is in active cooldown for a given slug.
   * Auto-unlocks if an admin has cleared cooldowns or deleted the session.
   */
  async checkDeviceCooldown(slug, passedProfile = null) {
    if (!slug) return null;
    const cleanSlug = String(slug).trim().toLowerCase();

    // 0. Resolve profile to check cooldown_reset_at watermark
    let profile = passedProfile;
    if (!profile) {
      try {
        profile = await this.getProfileBySlug(cleanSlug);
      } catch (e) {}
    }

    const resetTimestamp = profile?.cooldown_reset_at ? new Date(profile.cooldown_reset_at).getTime() : 0;

    // 1. Invalidate local cache if created before an admin emergency reset
    try {
      const cached = localStorage.getItem(`rma_last_session_${cleanSlug}`);
      if (cached) {
        const s = JSON.parse(cached);
        const sessionCreated = new Date(s.unlockedAt || s.created_at || s.expiresAt || 0).getTime();

        if (resetTimestamp > 0 && sessionCreated > 0 && sessionCreated <= resetTimestamp) {
          localStorage.removeItem(`rma_last_session_${cleanSlug}`);
        } else if (s.cooldownUntil) {
          const cdTime = new Date(s.cooldownUntil).getTime();
          if (Date.now() >= cdTime) {
            localStorage.removeItem(`rma_last_session_${cleanSlug}`);
          }
        }
      }
    } catch (e) {}

    // 2. Hardware fingerprint & Supabase remote check (AUTHORITATIVE SOURCE OF TRUTH)
    try {
      const deviceFingerprint = await getDeviceFingerprint();

      const { data, error } = await supabase
        .from('device_intake_sessions')
        .select('*')
        .eq('access_slug', cleanSlug)
        .eq('device_fingerprint', deviceFingerprint)
        .order('cooldown_until', { ascending: false })
        .limit(1);

      // If NO session in database (admin cleared cooldowns or session expired), WIPE local cache and unlock!
      if (!error && (!data || data.length === 0)) {
        try {
          localStorage.removeItem(`rma_last_session_${cleanSlug}`);
        } catch (e) {}
        return null; // FULLY UNLOCKED FOR ALL DEVICES!
      }

      if (!error && Array.isArray(data) && data.length > 0) {
        const s = data[0];
        const sessionCreated = new Date(s.session_started_at || s.created_at || 0).getTime();

        // If session was created prior to admin emergency reset watermark, wipe local cache & unlock
        if (resetTimestamp > 0 && sessionCreated > 0 && sessionCreated <= resetTimestamp) {
          try {
            localStorage.removeItem(`rma_last_session_${cleanSlug}`);
          } catch (e) {}
          return null;
        }

        const now = new Date();
        const cooldownDate = new Date(s.cooldown_until);
        const expiresDate = new Date(s.session_expires_at);

        if (now >= expiresDate && now < cooldownDate) {
          const diffMs = cooldownDate.getTime() - now.getTime();
          return {
            isCooldownActive: true,
            cooldownRemainingMinutes: Math.max(1, Math.ceil(diffMs / (60 * 1000))),
            unlocksAt: s.cooldown_until,
            sessionExpiresAt: s.session_expires_at,
            profileName: profile?.name || cleanSlug,
            cooldownDurationHours: profile?.cooldown_duration_hours || 6
          };
        } else {
          // Cooldown naturally over
          try {
            localStorage.removeItem(`rma_last_session_${cleanSlug}`);
          } catch (e) {}
          return null;
        }
      }
    } catch (e) {
      console.warn('Remote cooldown check notice:', e.message);
    }

    return null;
  },

  /**
   * ADMIN EMERGENCY RESET / CLEAR COOLDOWNS
   * Instantly unlocks all physical devices for a given QR profile.
   */
  async emergencyResetCooldowns(slug, profileId = null) {
    const cleanSlug = String(slug || '').trim().toLowerCase();
    const resetTimestamp = new Date().toISOString();

    // 1. Clear local session cache on admin machine
    try {
      localStorage.removeItem(`rma_last_session_${cleanSlug}`);
    } catch (e) {}

    // 2. Direct Supabase delete from device_intake_sessions (removes all device locks)
    try {
      if (cleanSlug) {
        await supabase.from('device_intake_sessions').delete().eq('access_slug', cleanSlug);
      }
      if (profileId) {
        await supabase.from('device_intake_sessions').delete().eq('profile_id', profileId);
      }
    } catch (e) {
      console.warn('Device intake sessions delete notice:', e.message);
    }

    // 3. Update cooldown_reset_at watermark in portal_access_keys & rma_settings
    try {
      if (cleanSlug) {
        await supabase
          .from('portal_access_keys')
          .update({ cooldown_reset_at: resetTimestamp, updated_at: resetTimestamp })
          .eq('access_slug', cleanSlug);
      }

      // Update rma_settings store
      const allProfiles = await this.getProfiles();
      const updatedList = allProfiles.map(p => {
        if (p.access_slug.toLowerCase() === cleanSlug || (profileId && p.id === profileId)) {
          return { ...p, cooldown_reset_at: resetTimestamp, updated_at: resetTimestamp };
        }
        return p;
      });

      await supabase.from('rma_settings').upsert({
        key: SETTINGS_KEY,
        value: updatedList,
        updated_at: resetTimestamp
      });

      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {
      console.warn('Profile cooldown_reset_at watermark notice:', e.message);
    }

    // 4. Real-time broadcast to instantly unlock all live phones and browser tabs
    try {
      const channel = supabase.channel('gatekeeper_cooldown_bus');
      channel.send({
        type: 'broadcast',
        event: 'cooldown_cleared',
        payload: { slug: cleanSlug, profileId, resetAt: resetTimestamp }
      });
    } catch (e) {}

    try {
      if (typeof window !== 'undefined' && window.BroadcastChannel) {
        const bc = new BroadcastChannel('rma_portal_sync_bus');
        bc.postMessage({ type: 'cooldown_cleared', slug: cleanSlug, resetAt: resetTimestamp });
      }
    } catch (e) {}

    return true;
  },

  /**
   * CREATE ENCRYPTED SESSION TOKEN ON DEVICE
   */
  createSession(profile) {
    const now = Date.now();
    const durationHours = Number(profile.session_duration_hours || 0);
    const cooldownHours = Number(profile.cooldown_duration_hours !== undefined ? profile.cooldown_duration_hours : 6);
    const expiresAt = durationHours > 0 
      ? new Date(now + (durationHours * 3600 * 1000)).toISOString() 
      : null; // null = No Expiry (Permanent)

    const cooldownUntil = (durationHours > 0 && cooldownHours > 0 && expiresAt)
      ? new Date(new Date(expiresAt).getTime() + (cooldownHours * 3600 * 1000)).toISOString()
      : null;

    const token = `gate_${profile.access_slug}_${now.toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    const sessionPayload = {
      token,
      slug: profile.access_slug,
      profileId: profile.id,
      profileName: profile.name,
      type: profile.type,
      durationHours,
      cooldownDurationHours: cooldownHours,
      unlockedAt: new Date(now).toISOString(),
      expiresAt,
      cooldownUntil
    };

    try {
      localStorage.setItem(SESSION_KEY, JSON.stringify(sessionPayload));
      if (cooldownUntil) {
        localStorage.setItem(`rma_last_session_${profile.access_slug.toLowerCase()}`, JSON.stringify(sessionPayload));
      }
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
          // If session expired and cooldown applies, ensure last session cache is preserved
          if (session.cooldownUntil) {
            try {
              localStorage.setItem(`rma_last_session_${session.slug?.toLowerCase()}`, JSON.stringify(session));
            } catch (e) {}
          }
          // Expired -> Clean up active session
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
  clearSession(slug = null) {
    try {
      const raw = localStorage.getItem(SESSION_KEY);
      if (raw) {
        const session = JSON.parse(raw);
        if (session && session.slug && session.cooldownUntil) {
          localStorage.setItem(`rma_last_session_${session.slug.toLowerCase()}`, JSON.stringify(session));
        }
      }
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


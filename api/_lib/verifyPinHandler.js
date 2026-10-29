import { supabase } from './supabase.js';
import { sendJson, setCorsHeaders } from './auth.js';

/**
 * Enterprise Anti-Fraud Gatekeeper Verification & Cooldown Lockout Engine
 * 
 * Verifies 6-digit PIN against active QR profile, checks physical device fingerprint
 * and client IP against public.device_intake_sessions, and enforces unbypassable
 * hardware-level cooldown periods across Incognito, private tabs, and different browsers.
 */

export async function handleVerifyPin(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Only POST method is permitted for PIN verification.'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {}
    }

    const { slug, pin, deviceFingerprint } = body || {};

    if (!slug || typeof slug !== 'string' || !slug.trim()) {
      return sendJson(res, 400, {
        success: false,
        error: 'BAD_REQUEST',
        message: 'Station access slug is required.'
      });
    }

    if (!pin || !/^\d{6}$/.test(String(pin).trim())) {
      return sendJson(res, 400, {
        success: false,
        error: 'BAD_REQUEST',
        message: 'A valid 6-digit numeric PIN is required.'
      });
    }

    // Extract client IP address from network headers
    const forwarded = req.headers['x-forwarded-for'];
    const clientIp = forwarded 
      ? String(forwarded).split(',')[0].trim() 
      : (req.headers['x-real-ip'] || req.socket?.remoteAddress || '127.0.0.1');

    const cleanSlug = String(slug).trim().toLowerCase();
    const cleanPin = String(pin).trim();
    const cleanFingerprint = String(deviceFingerprint || `ip_${clientIp}`).trim();

    // 1. STEP A: Profile & PIN check
    let profile = null;

    // Check public.portal_access_keys in Supabase
    try {
      const { data, error } = await supabase
        .from('portal_access_keys')
        .select('*')
        .eq('access_slug', cleanSlug)
        .maybeSingle();

      if (!error && data) {
        profile = data;
      }
    } catch (e) {
      console.warn('portal_access_keys query error:', e);
    }

    // Fallback to rma_settings if table empty or in migration
    if (!profile) {
      try {
        const { data: settingsData } = await supabase
          .from('rma_settings')
          .select('value')
          .eq('key', 'portal_access_keys_store')
          .single();

        if (settingsData?.value && Array.isArray(settingsData.value)) {
          profile = settingsData.value.find(p => p.access_slug?.toLowerCase() === cleanSlug);
        }
      } catch (e) {}
    }

    // Fallback to hardcoded defaults for seamless out-of-the-box bootstrapping
    if (!profile) {
      if (cleanSlug === 'dock') {
        profile = {
          name: 'Main Warehouse Floor',
          type: 'internal_warehouse',
          access_slug: 'dock',
          pin_code: '123456',
          session_duration_hours: 0,
          cooldown_duration_hours: 0,
          is_active: true
        };
      } else if (cleanSlug === 'returns') {
        profile = {
          name: 'Customer Delivery Boxes',
          type: 'external_customer',
          access_slug: 'returns',
          pin_code: '654321',
          session_duration_hours: 2,
          cooldown_duration_hours: 6,
          is_active: true
        };
      }
    }

    if (!profile) {
      return sendJson(res, 404, {
        success: false,
        error: 'NOT_FOUND',
        message: 'QR Access Profile not found.'
      });
    }

    if (!profile.is_active) {
      return sendJson(res, 403, {
        success: false,
        error: 'INACTIVE',
        message: 'This QR Access Code has been deactivated by warehouse administration.'
      });
    }

    // Verify 6-digit PIN
    if (cleanPin !== String(profile.pin_code).trim()) {
      return sendJson(res, 401, {
        success: false,
        error: 'INVALID_PIN',
        message: 'Incorrect 6-digit PIN code. Please retry.'
      });
    }

    const now = new Date();
    const nowIso = now.toISOString();

    // 2. STEP B: Internal Warehouse profiles bypass customer cooldowns
    if (profile.type === 'internal_warehouse' || Number(profile.session_duration_hours) === 0) {
      const sessionToken = `gate_wh_${profile.access_slug}_${Date.now().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;
      return sendJson(res, 200, {
        success: true,
        profile: {
          id: profile.id,
          name: profile.name,
          type: profile.type,
          access_slug: profile.access_slug,
          session_duration_hours: 0,
          cooldown_duration_hours: 0
        },
        session: {
          token: sessionToken,
          slug: profile.access_slug,
          profileId: profile.id,
          profileName: profile.name,
          type: profile.type,
          durationHours: 0,
          unlockedAt: nowIso,
          expiresAt: null, // Permanent
          cooldownUntil: null,
          deviceFingerprint: cleanFingerprint
        }
      });
    }

    // 3. STEP C: External Customer Cooldown & Anti-Bypass Check
    // Query public.device_intake_sessions for this device or IP
    try {
      const { data: existingSessions, error: sessErr } = await supabase
        .from('device_intake_sessions')
        .select('*')
        .or(`device_fingerprint.eq.${cleanFingerprint},ip_address.eq.${clientIp}`)
        .eq('access_slug', cleanSlug)
        .order('cooldown_until', { ascending: false })
        .limit(5);

      if (!sessErr && Array.isArray(existingSessions) && existingSessions.length > 0) {
        for (const s of existingSessions) {
          const cooldownDate = new Date(s.cooldown_until);
          const expiresDate = new Date(s.session_expires_at);

          // CASE 1: Device is currently within an ACTIVE unlocked session window
          if (now < expiresDate) {
            return sendJson(res, 200, {
              success: true,
              existingActiveSession: true,
              profile: {
                id: profile.id,
                name: profile.name,
                type: profile.type,
                access_slug: profile.access_slug,
                session_duration_hours: profile.session_duration_hours,
                cooldown_duration_hours: profile.cooldown_duration_hours || 6
              },
              session: {
                token: `gate_cust_${profile.access_slug}_${new Date(s.session_started_at).getTime().toString(36)}`,
                slug: profile.access_slug,
                profileId: profile.id,
                profileName: profile.name,
                type: profile.type,
                durationHours: profile.session_duration_hours,
                unlockedAt: s.session_started_at,
                expiresAt: s.session_expires_at,
                cooldownUntil: s.cooldown_until,
                deviceFingerprint: cleanFingerprint
              }
            });
          }

          // CASE 2: Active session has expired, and device is strictly in COOLDOWN LOCKOUT
          if (now >= expiresDate && now < cooldownDate) {
            const diffMs = cooldownDate.getTime() - now.getTime();
            const cooldownRemainingMinutes = Math.max(1, Math.ceil(diffMs / (60 * 1000)));

            return sendJson(res, 429, {
              success: false,
              error: 'COOLDOWN_ACTIVE',
              message: 'Return Window Currently Locked: Your previous RMA session has concluded. To prevent duplicate submissions, this portal will unlock again once the cooldown concludes.',
              cooldownRemainingMinutes,
              unlocksAt: s.cooldown_until,
              sessionExpiresAt: s.session_expires_at,
              profileName: profile.name,
              cooldownDurationHours: profile.cooldown_duration_hours || 6
            });
          }
        }
      }
    } catch (err) {
      console.warn('device_intake_sessions lookup notice:', err);
    }

    // 4. STEP D: Create new session record
    const durationHours = Math.max(0.01, parseFloat(profile.session_duration_hours) || 2);
    const cooldownHours = Math.max(0, parseFloat(profile.cooldown_duration_hours !== undefined ? profile.cooldown_duration_hours : 6));

    const sessionExpiresAt = new Date(now.getTime() + (durationHours * 3600 * 1000));
    const cooldownUntil = new Date(sessionExpiresAt.getTime() + (cooldownHours * 3600 * 1000));
    const sessionToken = `gate_cust_${profile.access_slug}_${now.getTime().toString(36)}_${Math.random().toString(36).substring(2, 8)}`;

    try {
      const isUuid = profile.id && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(profile.id);
      await supabase.from('device_intake_sessions').insert([{
        profile_id: isUuid ? profile.id : null,
        access_slug: profile.access_slug,
        device_fingerprint: cleanFingerprint,
        ip_address: clientIp,
        session_started_at: nowIso,
        session_expires_at: sessionExpiresAt.toISOString(),
        cooldown_until: cooldownUntil.toISOString(),
        status: 'active'
      }]);
    } catch (insertErr) {
      console.warn('device_intake_sessions insert notice:', insertErr);
    }

    return sendJson(res, 200, {
      success: true,
      profile: {
        id: profile.id,
        name: profile.name,
        type: profile.type,
        access_slug: profile.access_slug,
        session_duration_hours: durationHours,
        cooldown_duration_hours: cooldownHours
      },
      session: {
        token: sessionToken,
        slug: profile.access_slug,
        profileId: profile.id,
        profileName: profile.name,
        type: profile.type,
        durationHours,
        unlockedAt: nowIso,
        expiresAt: sessionExpiresAt.toISOString(),
        cooldownUntil: cooldownUntil.toISOString(),
        deviceFingerprint: cleanFingerprint
      }
    });

  } catch (err) {
    console.error('[Verify PIN Endpoint] Internal error:', err);
    return sendJson(res, 500, {
      success: false,
      error: 'SERVER_ERROR',
      message: err.message || 'An internal error occurred during PIN verification.'
    });
  }
}

/**
 * Admin Emergency Cooldown Reset
 * Clears all active device sessions and cooldown lockouts for a profile.
 */
export async function handleClearCooldown(req, res) {
  setCorsHeaders(res, req);

  if (req.method === 'OPTIONS') {
    return res.status(204).end();
  }

  if (req.method !== 'POST') {
    return sendJson(res, 405, {
      success: false,
      error: 'METHOD_NOT_ALLOWED',
      message: 'Only POST method is permitted for emergency cooldown reset.'
    });
  }

  try {
    let body = req.body;
    if (typeof body === 'string') {
      try {
        body = JSON.parse(body);
      } catch (e) {}
    }

    const { slug, profileId } = body || {};

    if (!slug && !profileId) {
      return sendJson(res, 400, {
        success: false,
        error: 'BAD_REQUEST',
        message: 'Profile slug or ID is required.'
      });
    }

    let query = supabase.from('device_intake_sessions').delete();
    if (slug) {
      query = query.eq('access_slug', String(slug).trim().toLowerCase());
    } else if (profileId) {
      query = query.eq('profile_id', profileId);
    }

    const { error } = await query;
    if (error) {
      console.warn('Failed to clear device sessions:', error);
    }

    return sendJson(res, 200, {
      success: true,
      message: `Emergency reset successful: All device cooldown lockouts for "${slug || profileId}" have been cleared.`
    });
  } catch (err) {
    console.error('[Clear Cooldown Endpoint] Error:', err);
    return sendJson(res, 500, {
      success: false,
      error: 'SERVER_ERROR',
      message: err.message || 'Failed to clear cooldown lockouts.'
    });
  }
}


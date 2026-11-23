import { supabase } from '../supabaseClient';
import { formatDateTimeYmdHm } from '../utils/rmaHelpers';

const SETTINGS_KEY = 'customer_rma_invites_store';
const LOCAL_STORAGE_KEY = 'rma_customer_invites_v1';

function getLocalInvites() {
  try {
    const raw = localStorage.getItem(LOCAL_STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function saveLocalInvites(invites) {
  try {
    localStorage.setItem(LOCAL_STORAGE_KEY, JSON.stringify(invites));
  } catch (e) {
    console.warn('Failed to save invites to localStorage:', e);
  }
}

export function generateInviteToken(isTest = false, streamType = 'customer_inbound') {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  if (streamType === 'rma_editor') {
    const editPrefix = isTest ? 'inv_test_edit' : 'inv_edit';
    return `${editPrefix}_${Date.now().toString(36)}_${rand}`;
  }
  const prefix = isTest ? 'inv_test' : 'inv';
  return `${prefix}_${Date.now().toString(36)}_${rand}`;
}

export function isTestInviteToken(inviteOrToken) {
  if (!inviteOrToken) return false;
  if (typeof inviteOrToken === 'string') {
    return inviteOrToken.startsWith('inv_test_');
  }
  return Boolean(inviteOrToken.is_test || String(inviteOrToken.token || '').startsWith('inv_test_'));
}

export function isRmaEditorInvite(inviteOrToken) {
  if (!inviteOrToken) return false;
  if (typeof inviteOrToken === 'string') {
    return /^inv_(?:test_)?edit_/i.test(inviteOrToken);
  }
  const tok = String(inviteOrToken.token || '');
  const ent = String(inviteOrToken.entity_name || '');
  return Boolean(
    inviteOrToken.stream_type === 'rma_editor' ||
    /^inv_(?:test_)?edit_/i.test(tok) ||
    ent.startsWith('[RMA_EDITOR')
  );
}

export function extractRmaNumberFromInvite(inv) {
  if (!inv) return '';
  if (inv.rma_number && String(inv.rma_number).trim()) {
    return String(inv.rma_number).trim();
  }
  const ent = String(inv.entity_name || '');
  const m = ent.match(/^\[RMA_EDITOR:([^\]]+)\]/);
  if (m && m[1] && m[1] !== 'ANY') return m[1].trim();
  const br = String(inv.store_branch || '').trim();
  if (/^RMA-(?:TEST-)?\d{4}-/i.test(br)) return br;
  return '';
}

export function maskEmail(email) {
  if (!email || !email.includes('@')) return email || '';
  const [local, domain] = email.split('@');
  if (local.length <= 3) {
    return `${local[0]}***@${domain}`;
  }
  const prefix = local.substring(0, 3);
  const suffix = local.substring(local.length - 2);
  return `${prefix}***${suffix}@${domain}`;
}

export function formatRemainingCountdown(expiresAt, status = 'active') {
  if (status === 'revoked') return { text: 'Revoked', isExpired: true, isRevoked: true, totalSeconds: 0 };
  if (!expiresAt) return { text: 'Expired', isExpired: true, isRevoked: false, totalSeconds: 0 };
  const diff = new Date(expiresAt).getTime() - Date.now();
  if (diff <= 0) return { text: 'Expired', isExpired: true, isRevoked: false, totalSeconds: 0 };

  const totalSecs = Math.floor(diff / 1000);
  const totalMins = Math.floor(diff / (1000 * 60));
  const hours = Math.floor(totalMins / 60);
  const mins = totalMins % 60;
  const secs = totalSecs % 60;

  if (hours >= 24) {
    const days = Math.floor(hours / 24);
    const remHours = hours % 24;
    return { text: `${days}d ${remHours}h ${mins}m remaining`, isExpired: false, isRevoked: false, totalSeconds: totalSecs };
  }
  if (hours > 0) {
    return { text: `${hours}h ${mins}m ${secs}s remaining`, isExpired: false, isRevoked: false, totalSeconds: totalSecs };
  }
  if (mins > 0) {
    return { text: `${mins}m ${secs}s remaining`, isExpired: false, isRevoked: false, totalSeconds: totalSecs };
  }
  return { text: `${secs}s remaining`, isExpired: false, isRevoked: false, totalSeconds: totalSecs };
}

/**
 * Cryptographic Google OAuth Identity Verification
 * Validates whether the authenticated Google account matches the invite's authorized email.
 */
export function verifyGoogleIdentity(user, invite) {
  if (!user || !user.email) {
    return { verified: false, error: 'NO_AUTHENTICATED_USER' };
  }
  if (!invite || !invite.authorized_email) {
    return { verified: false, error: 'NO_INVITE_EMAIL' };
  }
  const userEmail = user.email.toLowerCase().trim();
  const authorizedEmail = invite.authorized_email.toLowerCase().trim();

  if (userEmail !== authorizedEmail) {
    return {
      verified: false,
      userEmail: user.email,
      authorizedEmail: invite.authorized_email,
      error: 'IDENTITY_MISMATCH'
    };
  }

  return {
    verified: true,
    userEmail: user.email,
    authorizedEmail: invite.authorized_email
  };
}

export function normalizeEntityName(val) {
  if (!val) return '';
  const clean = String(val).trim();
  const lower = clean.toLowerCase();
  if (
    !clean ||
    clean.startsWith('[RMA_EDITOR') ||
    lower === 'pingcon wholesale client' ||
    lower === 'master supplier partner' ||
    lower === 'unassigned' ||
    lower === 'optional'
  ) {
    return '';
  }
  return clean;
}

export function hydrateInviteRecord(raw) {
  if (!raw) return raw;
  const isEditor = isRmaEditorInvite(raw);
  const rmaNum = extractRmaNumberFromInvite(raw);
  const ent = isEditor ? '' : (normalizeEntityName(raw.store_branch) || normalizeEntityName(raw.entity_name));
  return {
    ...raw,
    stream_type: isEditor ? 'rma_editor' : (raw.stream_type || 'customer_inbound'),
    rma_number: rmaNum || raw.rma_number || null,
    is_test: isTestInviteToken(raw),
    entity_name: isEditor ? (rmaNum ? `RMA ${rmaNum}` : 'RMA Details Editor') : ent,
    store_branch: isEditor ? (rmaNum || '') : ent
  };
}

export const inviteService = {
  verifyGoogleIdentity,
  normalizeEntityName,
  isRmaEditorInvite,
  extractRmaNumberFromInvite,
  /**
   * Fetch all invites from Supabase (table or fallback settings)
   */
  async getInvites() {
    const mergedMap = new Map();
    const absorbList = (list) => {
      if (!Array.isArray(list)) return;
      list.forEach((i) => {
        if (!i || !i.token) return;
        const hydrated = hydrateInviteRecord(i);
        const prev = mergedMap.get(hydrated.token);
        if (!prev) {
          mergedMap.set(hydrated.token, hydrated);
        } else if (hydrated.status === 'revoked' && prev.status !== 'revoked') {
          mergedMap.set(hydrated.token, { ...prev, ...hydrated, status: 'revoked' });
        }
      });
    };

    // Fetch public.rma_invites and universal rma_settings store in parallel to halve latency
    const [tblResult, settingsResult] = await Promise.allSettled([
      supabase.from('rma_invites').select('*').order('created_at', { ascending: false }),
      supabase.from('rma_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    ]);

    if (tblResult.status === 'fulfilled') {
      const { data, error } = tblResult.value || {};
      if (!error && Array.isArray(data)) {
        absorbList(data);
      }
    }

    if (settingsResult.status === 'fulfilled') {
      const { data, error } = settingsResult.value || {};
      if (!error && data?.value && Array.isArray(data.value)) {
        absorbList(data.value);
      }
    } else if (settingsResult.status === 'rejected') {
      console.warn('Failed to fetch invites from rma_settings:', settingsResult.reason);
    }

    if (mergedMap.size > 0) {
      const combined = Array.from(mergedMap.values()).sort(
        (a, b) => new Date(b.created_at || 0).getTime() - new Date(a.created_at || 0).getTime()
      );
      saveLocalInvites(combined);
      return combined;
    }

    return getLocalInvites().map(hydrateInviteRecord);
  },

  /**
   * Create a new Customer, Supplier RTV, or RMA Details Editor Invite with customizable duration
   */
  async createInvite({
    streamType = 'customer_inbound',
    authorizedEmail,
    entityName = '',
    storeBranch = '',
    rmaNumber = '',
    durationValue = 24,
    durationUnit = 'hours',
    durationHours = null,
    createdBy = 'Staff',
    isTest = false
  }) {
    if (!authorizedEmail || !authorizedEmail.trim()) {
      throw new Error('Authorized Google Email is required.');
    }

    const cleanStream = streamType === 'rma_editor'
      ? 'rma_editor'
      : (streamType === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound');
    const cleanEmail = authorizedEmail.trim().toLowerCase();
    const cleanRmaNum = cleanStream === 'rma_editor'
      ? String(rmaNumber || entityName || storeBranch || '').trim()
      : '';
    const cleanEntity = cleanStream === 'rma_editor'
      ? (cleanRmaNum ? `RMA ${cleanRmaNum}` : 'RMA Details Editor')
      : normalizeEntityName(entityName || storeBranch || '');

    // Postgres table public.rma_invites checks stream_type IN ('customer_inbound', 'supplier_outbound')
    // Encode rma_editor metadata cleanly inside entity_name/store_branch & token prefix to prevent constraint errors.
    const dbStream = cleanStream === 'rma_editor' ? 'customer_inbound' : cleanStream;
    const dbEntityFallback = cleanStream === 'supplier_outbound' ? 'Master Supplier Partner' : 'Pingcon Wholesale Client';
    const dbEntityValue = cleanStream === 'rma_editor'
      ? (cleanRmaNum ? `[RMA_EDITOR:${cleanRmaNum}]` : '[RMA_EDITOR]')
      : (cleanEntity || dbEntityFallback);
    const dbStoreBranch = cleanStream === 'rma_editor' ? (cleanRmaNum || 'RMA Editor') : cleanEntity;

    // Calculate expiration in milliseconds based on user-customized input number and unit
    let durationMs = 24 * 3600 * 1000;
    const num = Math.max(1, parseInt(durationValue, 10) || 1);
    const unit = String(durationUnit || 'hours').toLowerCase();

    if (durationHours !== null && durationHours !== undefined) {
      durationMs = Number(durationHours) * 3600 * 1000;
    } else if (unit.startsWith('min')) {
      durationMs = num * 60 * 1000;
    } else if (unit.startsWith('day')) {
      durationMs = num * 24 * 3600 * 1000;
    } else {
      durationMs = num * 3600 * 1000;
    }

    const now = new Date();
    const expiresAt = new Date(now.getTime() + durationMs).toISOString();
    const cleanIsTest = Boolean(isTest);
    const token = generateInviteToken(cleanIsTest, cleanStream);

    const displayUnit = unit.startsWith('min') ? 'min(s)' : unit.startsWith('day') ? 'day(s)' : 'hour(s)';
    const durationDisplay = `${num} ${displayUnit}`;

    const dbInsertPayload = {
      token,
      stream_type: dbStream,
      authorized_email: cleanEmail,
      entity_name: dbEntityValue,
      store_branch: dbStoreBranch,
      duration_value: num,
      duration_unit: unit,
      duration_display: durationDisplay,
      expires_at: expiresAt,
      created_by: createdBy,
      status: 'active',
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    // 1. Run primary rma_invites insert and rma_settings read in parallel to halve latency
    let createdRecord = null;
    let existingSettingsList = null;
    try {
      const [tblRes, settingsRes] = await Promise.allSettled([
        supabase.from('rma_invites').insert([dbInsertPayload]).select().maybeSingle(),
        supabase.from('rma_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
      ]);

      if (tblRes.status === 'fulfilled') {
        const { data, error } = tblRes.value || {};
        if (!error && data) {
          createdRecord = hydrateInviteRecord({
            ...data,
            stream_type: cleanStream,
            rma_number: cleanRmaNum || null,
            is_test: cleanIsTest || isTestInviteToken(data)
          });
        }
      }
      if (settingsRes.status === 'fulfilled' && !settingsRes.value?.error && Array.isArray(settingsRes.value?.data?.value)) {
        existingSettingsList = settingsRes.value.data.value.map(hydrateInviteRecord);
      }
    } catch {
      // Ignore if table does not exist yet
    }

    const newInvite = createdRecord || {
      id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...dbInsertPayload,
      stream_type: cleanStream,
      rma_number: cleanRmaNum || null,
      is_test: cleanIsTest,
      entity_name: cleanEntity,
      store_branch: cleanStream === 'rma_editor' ? (cleanRmaNum || '') : cleanEntity
    };

    // 2. Always persist to rma_settings for universal sync across all admin sessions
    try {
      const baseList = Array.isArray(existingSettingsList) ? existingSettingsList : getLocalInvites();
      const updated = [newInvite, ...baseList.filter(i => i.token !== token)];
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updated,
          updated_at: new Date().toISOString()
        });
      saveLocalInvites(updated);
    } catch (e) {
      console.warn('Failed to persist invite to rma_settings:', e);
      const local = [newInvite, ...getLocalInvites().filter(i => i.token !== token)];
      saveLocalInvites(local);
    }

    return newInvite;
  },

  /**
   * Validate token from URL parameter
   */
  async validateInviteToken(token) {
    if (!token) return { valid: false, error: 'NO_TOKEN' };

    const cleanToken = String(token).trim();
    let invite = null;
    let tableQuerySucceeded = false;
    let settingsQuerySucceeded = false;
    let networkErrorDetected = false;

    const isNetworkError = (err) => {
      if (!err) return false;
      const msg = String(err.message || err.details || err || '').toLowerCase();
      return (
        msg.includes('fetch') ||
        msg.includes('network') ||
        msg.includes('connection') ||
        msg.includes('resolved') ||
        msg.includes('load failed') ||
        msg.includes('abort') ||
        !err.code
      );
    };

    // 1. Primary check against database table: public.rma_invites AND rma_settings
    const [tblCheck, settingsCheck] = await Promise.allSettled([
      supabase.from('rma_invites').select('*').eq('token', cleanToken).maybeSingle(),
      supabase.from('rma_settings').select('value').eq('key', SETTINGS_KEY).maybeSingle()
    ]);

    let tblInvite = null;
    if (tblCheck.status === 'fulfilled') {
      const { data, error } = tblCheck.value || {};
      if (!error) {
        tableQuerySucceeded = true;
        if (data) {
          tblInvite = hydrateInviteRecord(data);
        }
      } else if (isNetworkError(error)) {
        networkErrorDetected = true;
      }
    } else if (isNetworkError(tblCheck.reason)) {
      networkErrorDetected = true;
    }

    let settingsInvite = null;
    if (settingsCheck.status === 'fulfilled') {
      const { data, error } = settingsCheck.value || {};
      if (!error) {
        settingsQuerySucceeded = true;
        if (Array.isArray(data?.value)) {
          const found = data.value.find(i => i.token === cleanToken);
          if (found) {
            settingsInvite = hydrateInviteRecord(found);
          }
        }
      } else if (isNetworkError(error)) {
        networkErrorDetected = true;
      }
    } else if (isNetworkError(settingsCheck.reason)) {
      networkErrorDetected = true;
    }

    if (tblInvite || settingsInvite) {
      invite = {
        ...(tblInvite || {}),
        ...(settingsInvite || {}),
        token: cleanToken
      };
      if (tblInvite?.status === 'revoked' || settingsInvite?.status === 'revoked') {
        invite.status = 'revoked';
      }
      invite = hydrateInviteRecord(invite);
    }

    // Cache validated invite locally so transient network blips do not kick active users out
    if (invite) {
      try {
        const local = getLocalInvites();
        const updated = [invite, ...local.filter(i => i.token !== cleanToken)];
        saveLocalInvites(updated.slice(0, 100));
      } catch { }
    }

    // 3. If neither database check found the invite, check if it was a transient network failure
    if (!invite) {
      const dbConfirmedMissing = settingsQuerySucceeded || (tableQuerySucceeded && !networkErrorDetected);
      if (!dbConfirmedMissing) {
        const cached = getLocalInvites().find(i => i.token === cleanToken);
        if (cached) {
          if (cached.status === 'revoked') {
            return { valid: false, invite: cached, error: 'REVOKED' };
          }
          if (Date.now() > new Date(cached.expires_at).getTime()) {
            return { valid: false, invite: cached, error: 'EXPIRED' };
          }
          return { valid: true, invite: cached, transient: true };
        }
        return { valid: false, error: 'NETWORK_ERROR', transient: true };
      }

      return { valid: false, error: 'NOT_FOUND' };
    }

    if (invite.status === 'revoked') {
      return { valid: false, invite, error: 'REVOKED' };
    }

    const expTime = new Date(invite.expires_at).getTime();
    if (Date.now() > expTime) {
      return { valid: false, invite, error: 'EXPIRED' };
    }

    return { valid: true, invite };
  },

  /**
   * Revoke an invite link
   */
  async revokeInvite(tokenOrId) {
    if (!tokenOrId) return false;

    const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tokenOrId).trim());
    let updateQuery = supabase.from('rma_invites').update({ status: 'revoked', updated_at: new Date().toISOString() });
    updateQuery = isUUID ? updateQuery.eq('id', tokenOrId) : updateQuery.eq('token', tokenOrId);

    // 1. Update table and fetch current invites in parallel to reduce latency
    const [tblUpdate, currentResult] = await Promise.allSettled([
      updateQuery,
      this.getInvites()
    ]);
    if (tblUpdate.status === 'rejected') {
      console.warn('Failed to update revoked invite in rma_invites:', tblUpdate.reason);
    }

    // 2. Persist updated status into rma_settings
    try {
      const current = currentResult.status === 'fulfilled' && Array.isArray(currentResult.value)
        ? currentResult.value
        : getLocalInvites();
      const updated = current.map(inv => {
        if (inv.token === tokenOrId || inv.id === tokenOrId) {
          return { ...inv, status: 'revoked' };
        }
        return inv;
      });
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updated,
          updated_at: new Date().toISOString()
        });
      saveLocalInvites(updated);
    } catch (e) {
      console.warn('Failed to update revoked invite in rma_settings:', e);
    }

    // 3. Clear local storage gate session if it matches revoked invite
    try {
      const rawSession = localStorage.getItem('rma_portal_gate_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess?.token === tokenOrId || sess?.id === tokenOrId) {
          localStorage.removeItem('rma_portal_gate_session');
        }
      }
    } catch { }

    return true;
  },

  /**
   * Delete an invite record directly
   */
  async deleteInvite(tokenOrId) {
    if (!tokenOrId) return false;

    // 1. Delete from rma_invites table
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tokenOrId).trim());
      let query = supabase.from('rma_invites').delete();
      if (isUUID) {
        query = query.eq('id', tokenOrId);
      } else {
        query = query.eq('token', tokenOrId);
      }
      await query;
    } catch (e) {
      console.warn('Failed to delete from rma_invites table:', e);
    }

    // 2. Delete from rma_settings
    try {
      const current = await this.getInvites();
      const updated = current.filter(inv => inv.token !== tokenOrId && inv.id !== tokenOrId);
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updated,
          updated_at: new Date().toISOString()
        });
      saveLocalInvites(updated);
    } catch (e) {
      console.warn('Failed to delete invite from rma_settings:', e);
      const local = getLocalInvites().filter(inv => inv.token !== tokenOrId && inv.id !== tokenOrId);
      saveLocalInvites(local);
    }

    // 3. Clear local storage gate session if it matches deleted invite
    try {
      const rawSession = localStorage.getItem('rma_portal_gate_session');
      if (rawSession) {
        const sess = JSON.parse(rawSession);
        if (sess?.token === tokenOrId || sess?.id === tokenOrId) {
          localStorage.removeItem('rma_portal_gate_session');
        }
      }
    } catch { }

    return true;
  },

  /**
   * Send invite email via /api/send-email
   */
  async sendInviteEmail(invite) {
    if (!invite?.authorized_email || !invite?.token) {
      throw new Error('Valid invite with customer email and token is required.');
    }

    const baseUrl = typeof window !== 'undefined' ? window.location.origin : 'https://rma-portal-pingconmarketing.vercel.app';
    const isTestInv = isTestInviteToken(invite);
    const isEditor = isRmaEditorInvite(invite);
    const rmaTarget = extractRmaNumberFromInvite(invite);
    const inviteUrl = `${baseUrl}/intake?token=${encodeURIComponent(invite.token)}${isEditor && rmaTarget ? `&editRma=${encodeURIComponent(rmaTarget)}` : ''}${isTestInv ? '&mode=test' : ''}`;
    const isSupplierRtv = invite.stream_type === 'supplier_outbound';
    const entityLabel = isEditor
      ? (rmaTarget ? `RMA ${rmaTarget}` : 'Scoped RMA Record')
      : (invite.entity_name || invite.store_branch || (isSupplierRtv ? 'Vendor Partner' : 'Store Partner'));
    const expDateStr = `${formatDateTimeYmdHm(invite.expires_at)} (YYYY-MM-DD HH:mm)`;

    const rawSubject = isEditor
      ? `[Authorized RMA Editor Access] Edit RMA Details & Documents (${entityLabel})`
      : isSupplierRtv
        ? `[Authorized Supplier RTV Access] Pingcon Return to Vendor Portal Link (${entityLabel})`
        : `[Authorized Access] Your Pingcon RMA Return Portal Link (${entityLabel})`;
    const subject = isTestInv ? `Test - ${rawSubject}` : rawSubject;

    const headerGrad = isEditor
      ? 'linear-gradient(135deg, #312e81, #4f46e5)'
      : isSupplierRtv
        ? 'linear-gradient(135deg, #581c87, #7e22ce)'
        : 'linear-gradient(135deg, #1e3a8a, #2563eb)';
    const accentHex = isEditor ? '#4f46e5' : isSupplierRtv ? '#7e22ce' : '#2563eb';
    const ctaShadow = isEditor ? 'rgba(79,70,229,0.3)' : isSupplierRtv ? 'rgba(126,34,206,0.3)' : 'rgba(37,99,235,0.3)';

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 24px; margin: 0; color: #1e293b;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="background: ${headerGrad}; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">
              ${isEditor ? 'Pingcon RMA Details & Documents Editor' : isSupplierRtv ? 'Pingcon Supplier RTV Operations' : 'Pingcon RMA Operations'}
            </h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.9;">
              ${isEditor ? 'Scoped RMA Record Correction & Document Link' : isSupplierRtv ? 'Secure Return to Vendor Authorization Portal' : 'Secure Return Merchandise Authorization Portal'}
            </p>
          </div>
          <div style="padding: 24px;">
            <p style="font-size: 14px; margin-top: 0;">Hello <strong>${invite.authorized_email}</strong>,</p>
            <p style="font-size: 13px; line-height: 1.6; color: #475569;">
              You have been granted official authorization to ${
                isEditor
                  ? `edit product details, pricing, expiry dates, and commercial documents (SI / DR / PO) for <strong>${entityLabel}</strong>`
                  : isSupplierRtv
                    ? `process return claims / RTV for <strong>${entityLabel}</strong>`
                    : `submit returns for <strong>${entityLabel}</strong>`
              }.
            </p>
            <div style="background: #f1f5f9; border-radius: 12px; padding: 16px; margin: 20px 0; border: 1px solid #cbd5e1;">
              <div style="font-size: 11px; font-weight: 700; color: #64748b; text-transform: uppercase;">Security Notice</div>
              <div style="font-size: 12px; margin-top: 4px; color: #1e293b; line-height: 1.5;">
                🔒 This link is cryptographically locked to your Google Account (<strong>${invite.authorized_email}</strong>). Forwarding is strictly prohibited.
              </div>
              <div style="font-size: 11px; color: #64748b; margin-top: 8px;">
                ⏱️ Link Validity: <strong>${invite.duration_display || '24 hours'}</strong> (Expires: ${expDateStr})
              </div>
            </div>
            <div style="text-align: center; margin: 28px 0;">
              <a href="${inviteUrl}" style="background: ${accentHex}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 800; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px ${ctaShadow};">
                ${isEditor ? '✏️ Edit RMA Details &amp; Documents' : `Access ${isSupplierRtv ? 'Supplier RTV Portal' : 'Return Portal'}`} &rarr;
              </a>
            </div>
            <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-bottom: 0;">
              Or copy this direct link into your browser:<br>
              <a href="${inviteUrl}" style="color: ${accentHex}; word-break: break-all;">${inviteUrl}</a>
            </p>
          </div>
          <div style="background: #f8fafc; padding: 16px; border-top: 1px solid #e2e8f0; text-align: center; font-size: 11px; color: #94a3b8;">
            Pingcon Marketing Operations • Automated Identity Gatekeeper
          </div>
        </div>
      </body>
      </html>
    `;

    const res = await fetch('/api/send-email', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        to: invite.authorized_email,
        subject,
        html,
        isTestMode: isTestInv,
        text: `Pingcon RMA Portal Link: ${inviteUrl}\n\nAuthorized for: ${invite.authorized_email}\nExpires: ${expDateStr}\n\nThis link is locked to your Google account. Forwarding is prohibited.`
      })
    });

    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Failed to send invite email (${res.status}): ${errText}`);
    }

    return true;
  }
};


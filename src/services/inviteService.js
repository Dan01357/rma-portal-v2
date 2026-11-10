import { supabase } from '../supabaseClient';

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

export function generateInviteToken() {
  const chars = 'abcdefghijklmnopqrstuvwxyz0123456789';
  let rand = '';
  for (let i = 0; i < 16; i++) {
    rand += chars.charAt(Math.floor(Math.random() * chars.length));
  }
  return `inv_${Date.now().toString(36)}_${rand}`;
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
    lower === 'pingcon wholesale client' ||
    lower === 'master supplier partner' ||
    lower === 'unassigned' ||
    lower === 'optional'
  ) {
    return '';
  }
  return clean;
}

export const inviteService = {
  verifyGoogleIdentity,
  normalizeEntityName,
  /**
   * Fetch all invites from Supabase (table or fallback settings)
   */
  async getInvites() {
    // 1. Try public.rma_invites table
    try {
      const { data, error } = await supabase
        .from('rma_invites')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        const normalized = data.map(i => {
          const ent = normalizeEntityName(i.store_branch) || normalizeEntityName(i.entity_name);
          return {
            ...i,
            stream_type: i.stream_type || 'customer_inbound',
            entity_name: ent,
            store_branch: ent
          };
        });
        saveLocalInvites(normalized);
        return normalized;
      }
    } catch {
      // Table may not exist yet, fallback to rma_settings
    }

    // 2. Try public.rma_settings fallback
    try {
      const { data, error } = await supabase
        .from('rma_settings')
        .select('value')
        .eq('key', SETTINGS_KEY)
        .maybeSingle();

      if (!error && data?.value && Array.isArray(data.value)) {
        const normalized = data.value.map(i => {
          const ent = normalizeEntityName(i.store_branch) || normalizeEntityName(i.entity_name);
          return {
            ...i,
            stream_type: i.stream_type || 'customer_inbound',
            entity_name: ent,
            store_branch: ent
          };
        });
        saveLocalInvites(normalized);
        return normalized;
      }
    } catch (e) {
      console.warn('Failed to fetch invites from rma_settings:', e);
    }

    return getLocalInvites();
  },

  /**
   * Create a new Customer or Supplier RMA Invite with customizable duration (minutes, hours, days)
   */
  async createInvite({
    streamType = 'customer_inbound',
    authorizedEmail,
    entityName = '',
    storeBranch = '',
    durationValue = 24,
    durationUnit = 'hours',
    durationHours = null,
    createdBy = 'Staff'
  }) {
    if (!authorizedEmail || !authorizedEmail.trim()) {
      throw new Error('Authorized Google Email is required.');
    }

    const cleanStream = streamType === 'supplier_outbound' ? 'supplier_outbound' : 'customer_inbound';
    const cleanEmail = authorizedEmail.trim().toLowerCase();
    const cleanEntity = normalizeEntityName(entityName || storeBranch || '');
    // Database column entity_name has NOT NULL constraint in SQL, so pass placeholder for SQL only when blank
    const dbEntityFallback = cleanStream === 'supplier_outbound' ? 'Master Supplier Partner' : 'Pingcon Wholesale Client';
    const dbEntityValue = cleanEntity || dbEntityFallback;

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
    const token = generateInviteToken();

    const displayUnit = unit.startsWith('min') ? 'min(s)' : unit.startsWith('day') ? 'day(s)' : 'hour(s)';
    const durationDisplay = `${num} ${displayUnit}`;

    const insertPayload = {
      token,
      stream_type: cleanStream,
      authorized_email: cleanEmail,
      entity_name: dbEntityValue,
      store_branch: cleanEntity,
      duration_value: num,
      duration_unit: unit,
      duration_display: durationDisplay,
      expires_at: expiresAt,
      created_by: createdBy,
      status: 'active',
      created_at: now.toISOString(),
      updated_at: now.toISOString()
    };

    // 1. Try insert into rma_invites table
    let createdRecord = null;
    try {
      const { data, error } = await supabase
        .from('rma_invites')
        .insert([insertPayload])
        .select()
        .maybeSingle();

      if (!error && data) {
        createdRecord = {
          ...data,
          stream_type: data.stream_type || cleanStream,
          entity_name: cleanEntity,
          store_branch: cleanEntity
        };
      }
    } catch {
      // Ignore if table does not exist yet
    }

    const newInvite = createdRecord || {
      id: `inv_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
      ...insertPayload,
      entity_name: cleanEntity,
      store_branch: cleanEntity
    };

    // 2. Always persist to rma_settings for universal sync across all admin sessions
    try {
      const current = await this.getInvites();
      const updated = [newInvite, ...current.filter(i => i.token !== token)];
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

    // 1. Primary check against database table: public.rma_invites
    try {
      const { data, error } = await supabase
        .from('rma_invites')
        .select('*')
        .eq('token', cleanToken)
        .maybeSingle();

      if (!error) {
        tableQuerySucceeded = true;
        if (data) {
          const ent = normalizeEntityName(data.store_branch) || normalizeEntityName(data.entity_name);
          invite = {
            ...data,
            stream_type: data.stream_type || 'customer_inbound',
            entity_name: ent,
            store_branch: ent
          };
        }
      } else if (isNetworkError(error)) {
        networkErrorDetected = true;
      }
    } catch (err) {
      if (isNetworkError(err)) {
        networkErrorDetected = true;
      }
    }

    // 2. Secondary check against rma_settings (handles replication lag or single-store setups)
    if (!invite) {
      try {
        const { data, error } = await supabase
          .from('rma_settings')
          .select('value')
          .eq('key', SETTINGS_KEY)
          .maybeSingle();

        if (!error) {
          settingsQuerySucceeded = true;
          if (Array.isArray(data?.value)) {
            const found = data.value.find(i => i.token === cleanToken);
            if (found) {
              const ent = normalizeEntityName(found.store_branch) || normalizeEntityName(found.entity_name);
              invite = {
                ...found,
                stream_type: found.stream_type || 'customer_inbound',
                entity_name: ent,
                store_branch: ent
              };
            }
          }
        } else if (isNetworkError(error)) {
          networkErrorDetected = true;
        }
      } catch (e) {
        networkErrorDetected = true;
        console.warn('Fallback settings check failed:', e);
      }
    }

    // Cache validated invite locally so transient network blips do not kick active users out
    if (invite) {
      try {
        const local = getLocalInvites();
        const updated = [invite, ...local.filter(i => i.token !== cleanToken)];
        saveLocalInvites(updated.slice(0, 100));
      } catch {}
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

    // 1. Update in table
    try {
      const isUUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(String(tokenOrId).trim());
      let query = supabase.from('rma_invites').update({ status: 'revoked', updated_at: new Date().toISOString() });
      if (isUUID) {
        query = query.eq('id', tokenOrId);
      } else {
        query = query.eq('token', tokenOrId);
      }
      await query;
    } catch (e) {
      console.warn('Failed to update revoked invite in rma_invites:', e);
    }

    // 2. Update in rma_settings
    try {
      const current = await this.getInvites();
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
    } catch {}

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
    } catch {}

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
    const inviteUrl = `${baseUrl}/intake?token=${encodeURIComponent(invite.token)}`;
    const isSupplierRtv = invite.stream_type === 'supplier_outbound';
    const entityLabel = invite.entity_name || invite.store_branch || (isSupplierRtv ? 'Vendor Partner' : 'Store Partner');
    const expDateStr = new Date(invite.expires_at).toLocaleString();

    const subject = isSupplierRtv
      ? `[Authorized Supplier RTV Access] Pingcon Return to Vendor Portal Link (${entityLabel})`
      : `[Authorized Access] Your Pingcon RMA Return Portal Link (${entityLabel})`;

    const html = `
      <!DOCTYPE html>
      <html>
      <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; background: #f8fafc; padding: 24px; margin: 0; color: #1e293b;">
        <div style="max-width: 560px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 12px rgba(0,0,0,0.05);">
          <div style="background: ${isSupplierRtv ? 'linear-gradient(135deg, #581c87, #7e22ce)' : 'linear-gradient(135deg, #1e3a8a, #2563eb)'}; padding: 24px; text-align: center; color: #ffffff;">
            <h1 style="margin: 0; font-size: 20px; font-weight: 800; letter-spacing: -0.5px;">
              ${isSupplierRtv ? 'Pingcon Supplier RTV Operations' : 'Pingcon RMA Operations'}
            </h1>
            <p style="margin: 4px 0 0 0; font-size: 12px; opacity: 0.9;">
              ${isSupplierRtv ? 'Secure Return to Vendor Authorization Portal' : 'Secure Return Merchandise Authorization Portal'}
            </p>
          </div>
          <div style="padding: 24px;">
            <p style="font-size: 14px; margin-top: 0;">Hello <strong>${invite.authorized_email}</strong>,</p>
            <p style="font-size: 13px; line-height: 1.6; color: #475569;">
              You have been granted official authorization to ${isSupplierRtv ? 'process return claims / RTV' : 'submit returns'} for <strong>${entityLabel}</strong>.
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
              <a href="${inviteUrl}" style="background: ${isSupplierRtv ? '#7e22ce' : '#2563eb'}; color: #ffffff; text-decoration: none; padding: 14px 28px; border-radius: 12px; font-weight: 800; font-size: 14px; display: inline-block; box-shadow: 0 4px 12px ${isSupplierRtv ? 'rgba(126,34,206,0.3)' : 'rgba(37,99,235,0.3)'};">
                Access ${isSupplierRtv ? 'Supplier RTV Portal' : 'Return Portal'} &rarr;
              </a>
            </div>
            <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-bottom: 0;">
              Or copy this direct link into your browser:<br>
              <a href="${inviteUrl}" style="color: ${isSupplierRtv ? '#7e22ce' : '#2563eb'}; word-break: break-all;">${inviteUrl}</a>
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


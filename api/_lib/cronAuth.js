import { supabase } from './supabase.js';

const KNOWN_ADMIN_EMAILS = new Map([
  ['finance2@keysysincorporated.com', 'super_admin'],
  ['alleli.almaida@ph.keysys.com', 'admin'],
  ['finance@a2z2go.net', 'admin'],
  ['accountspayable@keysysincorporated.com', 'admin'],
  ['finance4@keysysincorporated.com', 'admin'],
  ['mark.aquino@a2z2go.net', 'admin'],
  ['ralph.alido@a2z2go.net', 'admin'],
  ['mgan@pingconmarketing.com', 'admin']
]);

/**
 * Shared authorization helper for automated Cron / GitHub Actions & Admin triggers
 * without adding extra Vercel serverless endpoints.
 */
export async function authorizeCronOrAdmin(req) {
  const cronSecret = String(process.env.CRON_SECRET || '').trim();
  const authHeader = String(req.headers['authorization'] || req.headers['Authorization'] || '').trim();
  const bearerToken = authHeader.startsWith('Bearer ') ? authHeader.slice(7).trim() : '';
  const xCronSecret = String(req.headers['x-cron-secret'] || '').trim();

  if (cronSecret && (xCronSecret === cronSecret || bearerToken === cronSecret)) {
    return { authorized: true, callerType: 'cron', actor: 'Scheduled Cron Runner', role: 'cron' };
  }

  // When CRON_SECRET env var is unset on Vercel, trust Vercel's internal edge-stripped cron header
  if (!cronSecret && req.headers['x-vercel-cron'] === '1' && process.env.VERCEL === '1') {
    return { authorized: true, callerType: 'cron', actor: 'Vercel Cron Scheduler', role: 'cron' };
  }

  if (!bearerToken) {
    return {
      authorized: false,
      status: 401,
      error: 'UNAUTHORIZED',
      message: 'Authentication required. Provide valid CRON_SECRET or Admin Bearer JWT.'
    };
  }

  const { data: userData, error: userErr } = await supabase.auth.getUser(bearerToken);
  const userEmail = String(userData?.user?.email || '').trim().toLowerCase();
  if (userErr || !userEmail) {
    return {
      authorized: false,
      status: 401,
      error: 'INVALID_SESSION',
      message: 'Session token is invalid or expired. Please sign in again.'
    };
  }

  let empRow = null;
  try {
    const { data } = await supabase
      .from('admin_users')
      .select('email, role, is_active')
      .eq('email', userEmail)
      .maybeSingle();
    empRow = data || null;
  } catch {}

  const role = empRow?.role || KNOWN_ADMIN_EMAILS.get(userEmail) || '';
  const isActive = empRow ? empRow.is_active !== false : KNOWN_ADMIN_EMAILS.has(userEmail);

  if (!isActive || !['super_admin', 'admin'].includes(role)) {
    return {
      authorized: false,
      status: 403,
      error: 'FORBIDDEN',
      message: `Admin or Super Admin privileges required. Account (${userEmail}) has role "${role || 'none'}".`
    };
  }

  return { authorized: true, callerType: 'admin', actor: userEmail, role };
}

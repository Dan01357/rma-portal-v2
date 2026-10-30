import { supabase } from '../supabaseClient';
import { notificationService } from './notificationService';

const STORAGE_KEY = 'rma_pin_requests_v2';
const SETTINGS_KEY = 'pin_requests_store';

function notifyPinRequestsChanged(record = null) {
  if (typeof window !== 'undefined') {
    window.dispatchEvent(new CustomEvent('rma-pin-requests-changed', { detail: { record } }));
    try {
      if (window.BroadcastChannel) {
        const ch = new BroadcastChannel('rma_portal_sync_bus');
        ch.postMessage({ type: 'pin-requests-changed', record });
      }
    } catch (e) {}
  }
}

export const pinRequestService = {
  /**
   * GET ALL PIN REQUESTS
   * Queries public.pin_requests table -> fallback to rma_settings -> fallback to localStorage
   */
  async getRequests() {
    let remoteRequests = null;

    // 1. Try dedicated table in Supabase
    try {
      const { data, error } = await supabase
        .from('pin_requests')
        .select('*')
        .order('created_at', { ascending: false });

      if (!error && Array.isArray(data)) {
        remoteRequests = data;
      }
    } catch (e) {
      // Table may not exist yet in database
    }

    // 2. Fallback to rma_settings store
    if (remoteRequests === null) {
      try {
        const { data, error } = await supabase
          .from('rma_settings')
          .select('value')
          .eq('key', SETTINGS_KEY)
          .single();

        if (!error && data?.value && Array.isArray(data.value)) {
          remoteRequests = data.value;
        }
      } catch (e) {
        // Settings fallback
      }
    }

    // 3. Fallback to localStorage
    let localRequests = [];
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (raw) {
        localRequests = JSON.parse(raw);
      }
    } catch (e) {
      localRequests = [];
    }

    const finalRequests = remoteRequests !== null ? remoteRequests : localRequests;

    // Keep localStorage in sync
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(finalRequests));
    } catch (e) {}

    return finalRequests;
  },

  /**
   * GET PENDING REQUESTS COUNT (for badges in header)
   */
  async getPendingCount() {
    const requests = await this.getRequests();
    return requests.filter(r => r.status === 'pending').length;
  },

  /**
   * SUBMIT NEW PIN REQUEST
   */
  async createPinRequest({
    accessSlug,
    accessKeyId = null,
    requesterEmail,
    requesterName,
    organizationName = '',
    notes = '',
    isTestMode = false
  }) {
    if (!accessSlug || !requesterEmail || !requesterName) {
      throw new Error('Please provide Access Slug, Email, and Name.');
    }

    const newRecord = {
      id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `req_${Date.now()}_${Math.random().toString(36).substring(2, 8)}`,
      access_slug: String(accessSlug).trim().toLowerCase(),
      access_key_id: accessKeyId || null,
      requester_email: String(requesterEmail).trim().toLowerCase(),
      requester_name: String(requesterName).trim(),
      organization_name: String(organizationName || '').trim(),
      notes: String(notes || '').trim(),
      status: 'pending',
      approved_by: null,
      reviewed_at: null,
      created_at: new Date().toISOString()
    };

    let insertedRemote = false;

    // 1. Try dedicated table
    try {
      const { data, error } = await supabase
        .from('pin_requests')
        .insert([newRecord])
        .select()
        .single();

      if (!error && data) {
        insertedRemote = true;
      }
    } catch (e) {
      // Table may not exist yet
    }

    // 2. Always update local storage & sync to rma_settings fallback
    const allRequests = await this.getRequests();
    const updatedRequests = [newRecord, ...allRequests.filter(r => r.id !== newRecord.id)];

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedRequests));
    } catch (e) {}

    if (!insertedRemote) {
      try {
        await supabase
          .from('rma_settings')
          .upsert({
            key: SETTINGS_KEY,
            value: updatedRequests,
            updated_at: new Date().toISOString()
          }, { onConflict: 'key' });
      } catch (e) {}
    }

    // 3. Dispatch automated alert email to Admin team (recipients same as RMA reports, strictly EXCLUDING AE email)
    this.sendPinRequestAlertEmail(newRecord, Boolean(isTestMode)).catch(err => {
      console.warn('Non-blocking PIN request email notification error:', err);
    });

    notifyPinRequestsChanged(newRecord);
    return { success: true, data: newRecord };
  },

  /**
   * DISPATCH ALERT EMAIL TO ADMINS ON NEW PIN REQUEST
   * Recipients: Same recipients as RMA reports, strictly EXCLUDING AE email.
   */
  async sendPinRequestAlertEmail(requestRecord, isTestMode = false) {
    try {
      const emailSettings = notificationService.getEmailSettings();
      const toEmail = String(emailSettings?.toEmail || 'azgodev@gmail.com').trim();
      const baseCcList = Array.isArray(emailSettings?.baseCcList) ? emailSettings.baseCcList : [
        'mgan@pingconmarketing.com',
        'marketing@pingconmarketing.com',
        'azgan@pingconmarketing.com',
        'jaezelle.benito@pingconmarketing.com'
      ];

      // Filter valid email addresses and ensure NO Account Executive email is included
      const cleanCcList = baseCcList.filter(e => typeof e === 'string' && e.includes('@'));

      const subject = isTestMode
        ? `Test - [Action Required] New Return PIN Authorization Request: ${requestRecord.requester_name} (${requestRecord.organization_name || requestRecord.access_slug})`
        : `[Action Required] New Return PIN Authorization Request: ${requestRecord.requester_name} (${requestRecord.organization_name || requestRecord.access_slug})`;

      const portalUrl = typeof window !== 'undefined' && window.location?.origin 
        ? `${window.location.origin}/admin` 
        : 'https://rma-portal-v2.vercel.app/admin';

      const htmlBody = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; background-color: #f8fafc; margin: 0; padding: 24px; color: #1e293b; }
            .container { max-width: 600px; margin: 0 auto; background: #ffffff; border-radius: 16px; border: 1px solid #e2e8f0; overflow: hidden; box-shadow: 0 4px 6px -1px rgba(0,0,0,0.05); }
            .header { background: #1e3a8a; padding: 24px 28px; color: #ffffff; }
            .badge { display: inline-block; padding: 4px 10px; border-radius: 999px; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 0.05em; background: #f59e0b; color: #78350f; margin-bottom: 8px; }
            .title { margin: 0; font-size: 20px; font-weight: 800; line-height: 1.3; }
            .content { padding: 28px; }
            .card { background: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 16px; margin: 18px 0; }
            .grid { display: table; width: 100%; border-collapse: collapse; }
            .row { display: table-row; }
            .col-label { display: table-cell; width: 35%; padding: 7px 0; font-size: 12px; color: #64748b; font-weight: 600; }
            .col-val { display: table-cell; padding: 7px 0; font-size: 13px; color: #0f172a; font-weight: 700; }
            .btn { display: inline-block; padding: 12px 24px; background-color: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 10px; font-weight: 800; font-size: 13px; margin-top: 14px; text-align: center; }
            .footer { background: #f1f5f9; padding: 16px 28px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
          </style>
        </head>
        <body>
          <div class="container">
            <div class="header">
              <span class="badge">Return Authorization Request</span>
              <h1 class="title">${isTestMode ? 'Test - ' : ''}New PIN Code Request Pending Review</h1>
              <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Wholesale RMA Return Gatekeeper</div>
            </div>
            <div class="content">
              <p style="font-size: 14px; line-height: 1.5; margin-top: 0; color: #334155;">
                A customer or warehouse staff member scanned the QR code at <strong>/${requestRecord.access_slug}</strong> and requested a 6-digit authorization PIN to unlock the return intake form.
              </p>
              <div class="card">
                <div class="grid">
                  <div class="row">
                    <div class="col-label">Requester Name:</div>
                    <div class="col-val">${requestRecord.requester_name}</div>
                  </div>
                  <div class="row">
                    <div class="col-label">Requester Email:</div>
                    <div class="col-val"><a href="mailto:${requestRecord.requester_email}" style="color: #2563eb;">${requestRecord.requester_email}</a></div>
                  </div>
                  <div class="row">
                    <div class="col-label">Store / Company:</div>
                    <div class="col-val">${requestRecord.organization_name || 'N/A'}</div>
                  </div>
                  <div class="row">
                    <div class="col-label">QR Access Station:</div>
                    <div class="col-val" style="font-family: monospace; color: #1e3a8a;">/${requestRecord.access_slug}</div>
                  </div>
                  <div class="row">
                    <div class="col-label">Reason / Notes:</div>
                    <div class="col-val" style="color: #475569; font-weight: 500;">${requestRecord.notes || 'No specific notes provided'}</div>
                  </div>
                  <div class="row">
                    <div class="col-label">Time Requested:</div>
                    <div class="col-val">${new Date(requestRecord.created_at).toLocaleString()}</div>
                  </div>
                </div>
              </div>
              <div style="text-align: center; margin-top: 24px;">
                <a href="${portalUrl}" class="btn" style="color: #ffffff;">Review & Approve PIN in Admin Portal</a>
              </div>
              <p style="font-size: 11px; color: #94a3b8; text-align: center; margin-top: 14px;">
                Once approved, the system will automatically email the 6-digit PIN directly to ${requestRecord.requester_email}.
              </p>
            </div>
            <div class="footer">
              Wholesale RMA Operations Portal • Automated Security & Intake System
            </div>
          </div>
        </body>
        </html>
      `;

      const textBody = `${isTestMode ? 'Test - ' : ''}New Return PIN Authorization Request:\n\nRequester: ${requestRecord.requester_name} (${requestRecord.requester_email})\nStore/Branch: ${requestRecord.organization_name || 'N/A'}\nStation: /${requestRecord.access_slug}\nNotes: ${requestRecord.notes || 'None'}\n\nPlease review and approve in Admin Portal: ${portalUrl}`;

      console.log(`[PIN Request Alert Dispatch] Sending alert to TO: "${toEmail}", CC: [${cleanCcList.join(', ')}], TestMode: ${isTestMode}`);

      await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          from: 'finance2@keysysincorporated.com',
          fromName: isTestMode ? '[TEST] Wholesale RMA Portal' : 'Wholesale RMA Portal',
          to: toEmail,
          cc: cleanCcList,
          subject,
          html: htmlBody,
          text: textBody,
          isTestMode
        })
      });
    } catch (err) {
      console.warn('Non-blocking error dispatching PIN request alert email:', err);
    }
  },

  /**
   * APPROVE REQUEST & DISPATCH OFFICIAL BRANDED EMAIL
   */
  async approveRequest({
    requestId,
    approvedBy = 'Admin',
    pinCode = '123456',
    profileName = 'RMA Station',
    accessSlug = 'dock',
    isTestMode = false
  }) {
    const allRequests = await this.getRequests();
    const target = allRequests.find(r => r.id === requestId);
    if (!target) {
      throw new Error('PIN request not found.');
    }

    const reviewedAt = new Date().toISOString();
    const updatedTarget = {
      ...target,
      status: 'approved',
      approved_by: approvedBy,
      reviewed_at: reviewedAt
    };

    // 1. Update in Supabase
    try {
      await supabase
        .from('pin_requests')
        .update({
          status: 'approved',
          approved_by: approvedBy,
          reviewed_at: reviewedAt
        })
        .eq('id', requestId);
    } catch (e) {}

    // 2. Sync to local state
    const updatedList = allRequests.map(r => r.id === requestId ? updatedTarget : r);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updatedList,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {}

    // 3. Dispatch Branded HTML Email via Google SMTP (/api/send-email)
    let emailResult = null;
    try {
      const portalUrl = typeof window !== 'undefined'
        ? `${window.location.origin}/intake/${accessSlug}`
        : `https://rma-portal-v2.vercel.app/intake/${accessSlug}`;

      const formattedPin = pinCode.split('').join(' ');

      const htmlContent = `
        <!DOCTYPE html>
        <html>
        <head>
          <meta charset="utf-8">
          <meta name="viewport" content="width=device-width, initial-scale=1.0">
          <title>Your Keysys / Pingcon Return Authorization PIN</title>
        </head>
        <body style="margin: 0; padding: 0; background-color: #f1f5f9; font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, Helvetica, Arial, sans-serif; color: #1e293b;">
          <table width="100%" cellpadding="0" cellspacing="0" style="background-color: #f1f5f9; padding: 32px 16px;">
            <tr>
              <td align="center">
                <table width="100%" max-width="600" cellpadding="0" cellspacing="0" style="max-width: 600px; background-color: #ffffff; border-radius: 20px; overflow: hidden; box-shadow: 0 10px 25px -5px rgba(0,0,0,0.08); border: 1px solid #e2e8f0;">
                  
                  <!-- Branded Header -->
                  <tr>
                    <td style="background: linear-gradient(135deg, #1e3a8a 0%, #2563eb 100%); padding: 32px 28px; text-align: center;">
                      <div style="display: inline-block; background-color: rgba(255,255,255,0.15); border: 1px solid rgba(255,255,255,0.3); border-radius: 12px; padding: 6px 14px; margin-bottom: 12px;">
                        <span style="color: #ffffff; font-size: 11px; font-weight: 800; text-transform: uppercase; letter-spacing: 1.5px;">Official Wholesale Logistics</span>
                      </div>
                      <h1 style="color: #ffffff; font-size: 24px; font-weight: 900; margin: 0; letter-spacing: -0.5px;">
                        Keysys &amp; Pingcon Operations
                      </h1>
                      <p style="color: #bfdbfe; font-size: 13px; margin: 6px 0 0 0; font-weight: 500;">
                        Return Authorization Gatekeeper Engine
                      </p>
                    </td>
                  </tr>

                  <!-- Main Content Body -->
                  <tr>
                    <td style="padding: 36px 32px;">
                      <p style="font-size: 16px; line-height: 24px; color: #334155; margin: 0 0 16px 0;">
                        Hello <strong>${target.requester_name}</strong>${target.organization_name ? ` (${target.organization_name})` : ''},
                      </p>

                      <div style="background-color: #f0fdf4; border-left: 4px solid #16a34a; padding: 14px 18px; border-radius: 8px; margin-bottom: 24px;">
                        <p style="margin: 0; color: #166534; font-size: 14px; font-weight: 600; line-height: 20px;">
                          ✓ Your request for Return Merchandise Authorization (RMA) access has been approved by <strong>${approvedBy}</strong> for station <em>"${profileName}"</em>.
                        </p>
                      </div>

                      <p style="font-size: 14px; line-height: 22px; color: #475569; margin: 0 0 20px 0;">
                        Below is your official 6-digit gatekeeper authorization PIN. You can use this PIN on your mobile device to immediately unlock the RMA return submission scanner:
                      </p>

                      <!-- Prominent 6-Digit PIN Box -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 24px;">
                        <tr>
                          <td align="center" style="background-color: #0f172a; border-radius: 16px; padding: 24px 16px; border: 2px solid #3b82f6;">
                            <div style="color: #94a3b8; font-size: 11px; font-weight: 700; text-transform: uppercase; letter-spacing: 2px; margin-bottom: 8px;">
                              Official 6-Digit Gatekeeper PIN
                            </div>
                            <div style="font-family: 'Courier New', Courier, monospace; font-size: 38px; font-weight: 900; color: #ffffff; letter-spacing: 10px; padding: 4px 0;">
                              ${formattedPin}
                            </div>
                            <div style="color: #38bdf8; font-size: 12px; font-weight: 600; margin-top: 8px;">
                              Station: /intake/${accessSlug}
                            </div>
                          </td>
                        </tr>
                      </table>

                      <!-- Action CTA Button -->
                      <table width="100%" cellpadding="0" cellspacing="0" style="margin-bottom: 28px;">
                        <tr>
                          <td align="center">
                            <a href="${portalUrl}" target="_blank" style="display: inline-block; background-color: #2563eb; color: #ffffff; font-size: 15px; font-weight: 800; text-decoration: none; padding: 14px 32px; border-radius: 12px; box-shadow: 0 4px 12px rgba(37,99,235,0.35);">
                              Open Return Portal Now &rarr;
                            </a>
                          </td>
                        </tr>
                      </table>

                      <!-- Instructions & Reuse Tip -->
                      <div style="background-color: #f8fafc; border: 1px solid #e2e8f0; border-radius: 12px; padding: 18px 20px; margin-bottom: 24px;">
                        <h4 style="margin: 0 0 8px 0; font-size: 13px; font-weight: 800; color: #1e293b; text-transform: uppercase; letter-spacing: 0.5px;">
                          📌 How to use and reuse your PIN:
                        </h4>
                        <ol style="margin: 0; padding-left: 20px; font-size: 13px; color: #475569; line-height: 22px;">
                          <li>Open Google Lens or your phone camera to scan the QR code on the delivery box or dock wall.</li>
                          <li>When prompted, enter your 6-digit authorization PIN (<strong>${pinCode}</strong>).</li>
                          <li><strong>Keep this PIN safe:</strong> You can reuse it for future damaged item reports under this QR profile without having to submit another request!</li>
                        </ol>
                      </div>

                      <p style="font-size: 12px; color: #94a3b8; line-height: 18px; margin: 0; text-align: center;">
                        If you did not request this authorization or have questions, please contact our warehouse dispatch team at <a href="mailto:finance2@keysysincorporated.com" style="color: #2563eb; text-decoration: none;">finance2@keysysincorporated.com</a>.
                      </p>
                    </td>
                  </tr>

                  <!-- Footer -->
                  <tr>
                    <td style="background-color: #f8fafc; border-top: 1px solid #e2e8f0; padding: 20px; text-align: center;">
                      <p style="margin: 0; font-size: 11px; color: #94a3b8; font-weight: 500;">
                        &copy; ${new Date().getFullYear()} Keysys &amp; Pingcon Wholesale Operations. All rights reserved.<br/>
                        Automated Gatekeeper Security Engine &bull; System Verified
                      </p>
                    </td>
                  </tr>

                </table>
              </td>
            </tr>
          </table>
        </body>
        </html>
      `;

      const textFallback = `Keysys & Pingcon Wholesale RMA Gatekeeper\n\nHello ${target.requester_name} (${target.organization_name || 'Valued Partner'}),\n\nYour request for Return Merchandise Authorization (RMA) access has been approved by ${approvedBy}.\n\nYour 6-digit PIN: ${pinCode}\nDirect Link: ${portalUrl}\n\nEnter this PIN after scanning the QR code on your product box. Keep this PIN safe—you can reuse it for future damaged item reports under this QR profile.`;

      const resp = await fetch('/api/send-email', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: target.requester_email,
          fromName: 'Keysys & Pingcon RMA Gatekeeper',
          subject: 'Your Keysys / Pingcon Return Authorization PIN',
          html: htmlContent,
          text: textFallback,
          isTestMode: Boolean(isTestMode)
        })
      });

      emailResult = await resp.json().catch(() => null);
    } catch (emailErr) {
      console.warn('Google SMTP dispatch warning:', emailErr);
      emailResult = { success: false, error: emailErr.message };
    }

    notifyPinRequestsChanged();
    return { success: true, request: updatedTarget, emailResult };
  },

  /**
   * REJECT REQUEST
   */
  async rejectRequest({ requestId, rejectedBy = 'Admin', reason = '' }) {
    const allRequests = await this.getRequests();
    const target = allRequests.find(r => r.id === requestId);
    if (!target) {
      throw new Error('PIN request not found.');
    }

    const reviewedAt = new Date().toISOString();
    const updatedTarget = {
      ...target,
      status: 'rejected',
      approved_by: rejectedBy,
      reviewed_at: reviewedAt,
      notes: reason ? `${target.notes ? `${target.notes} | ` : ''}[Rejection reason: ${reason}]` : target.notes
    };

    try {
      await supabase
        .from('pin_requests')
        .update({
          status: 'rejected',
          approved_by: rejectedBy,
          reviewed_at: reviewedAt,
          notes: updatedTarget.notes
        })
        .eq('id', requestId);
    } catch (e) {}

    const updatedList = allRequests.map(r => r.id === requestId ? updatedTarget : r);
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updatedList,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {}

    notifyPinRequestsChanged();
    return { success: true, request: updatedTarget };
  },

  /**
   * BATCH APPROVE REQUESTS
   */
  async approveBatch({ requestIds, approvedBy = 'Admin', getProfilePinFn, isTestMode = false }) {
    const results = [];
    for (const id of requestIds) {
      try {
        const pinInfo = getProfilePinFn ? await getProfilePinFn(id) : { pinCode: '123456', profileName: 'RMA Station', accessSlug: 'dock' };
        const res = await this.approveRequest({
          requestId: id,
          approvedBy,
          pinCode: pinInfo.pinCode,
          profileName: pinInfo.profileName,
          accessSlug: pinInfo.accessSlug,
          isTestMode
        });
        results.push(res);
      } catch (err) {
        console.error('Batch approval error for request', id, err);
      }
    }
    notifyPinRequestsChanged();
    return results;
  },

  /**
   * DELETE REQUEST
   */
  async deleteRequest(requestId) {
    try {
      await supabase
        .from('pin_requests')
        .delete()
        .eq('id', requestId);
    } catch (e) {}

    const allRequests = await this.getRequests();
    const updatedList = allRequests.filter(r => r.id !== requestId);

    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(updatedList));
    } catch (e) {}

    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: SETTINGS_KEY,
          value: updatedList,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {}

    notifyPinRequestsChanged();
    return { success: true };
  }
};


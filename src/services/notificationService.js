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
 *    - CC: [Customer AE Company Email, mgan@a2z2go.net, marketing@a2z2go.net, azgan@a2z2go.net, jaezelle.benito@pingconmarketing.com]
 */
import { supabase } from '../supabaseClient';
import { authService } from './authService';
import {
  isTestRecord,
  formatDateYmd,
  formatDateTimeYmdHm,
  getRealPhotos,
  getConsolidatedPickupItems,
  formatPeso
} from '../utils/rmaHelpers';
import { generatePickupFormPdfAttachment } from '../utils/pickupFormPdf';

const splitEmailList = (raw) => {
  if (!raw) return [];
  const arr = Array.isArray(raw) ? raw : String(raw).split(/[,;\s]+/);
  return Array.from(new Set(arr.map((e) => String(e || '').trim()).filter((e) => e.includes('@') && !e.endsWith('.test'))));
};

const escapeEmailHtml = (val) => String(val ?? '')
  .replace(/&/g, '&amp;')
  .replace(/</g, '&lt;')
  .replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;');

const DEFAULT_RECIPIENTS = {
  toEmail: 'azgodev@gmail.com',
  baseCcList: [
    'mgan@pingconmarketing.com',
    'marketing@pingconmarketing.com',
    'azgan@pingconmarketing.com',
    'jaezelle.benito@pingconmarketing.com'
  ]
};

export const notificationService = {
  /**
   * Get configured RMA email recipients (with local storage and corporate defaults)
   */
  getEmailSettings() {
    try {
      if (typeof window !== 'undefined') {
        const saved = localStorage.getItem('rma_portal_email_recipients');
        if (saved) {
          const parsed = JSON.parse(saved);
          if (parsed && parsed.toEmail) {
            return {
              toEmail: String(parsed.toEmail).trim(),
              baseCcList: Array.isArray(parsed.baseCcList) ? parsed.baseCcList : DEFAULT_RECIPIENTS.baseCcList
            };
          }
        }
      }
    } catch (e) {}
    return { ...DEFAULT_RECIPIENTS };
  },

  /**
   * Load email recipients from Supabase rma_settings table (if table exists)
   */
  async loadEmailSettingsFromDb() {
    try {
      const { data, error } = await supabase
        .from('rma_settings')
        .select('*')
        .eq('key', 'email_recipients')
        .maybeSingle();

      if (!error && data?.value?.toEmail) {
        const settings = {
          toEmail: String(data.value.toEmail).trim(),
          baseCcList: Array.isArray(data.value.baseCcList) ? data.value.baseCcList : DEFAULT_RECIPIENTS.baseCcList
        };
        if (typeof window !== 'undefined') {
          localStorage.setItem('rma_portal_email_recipients', JSON.stringify(settings));
        }
        return settings;
      }
    } catch (e) {
      // Supabase rma_settings table might not be created yet; fallback silently
    }
    return this.getEmailSettings();
  },

  /**
   * Super Admin action: Save updated TO and CC recipients for RMA notifications
   */
  async saveEmailSettings({ toEmail, baseCcList }) {
    const cleanTo = String(toEmail || '').trim();
    if (!cleanTo || !cleanTo.includes('@')) {
      throw new Error('A valid Primary TO recipient email is required.');
    }

    const cleanCcList = Array.isArray(baseCcList)
      ? Array.from(new Set(baseCcList.map(e => String(e).trim()).filter(e => e.includes('@'))))
      : [];

    const newSettings = {
      toEmail: cleanTo,
      baseCcList: cleanCcList
    };

    if (typeof window !== 'undefined') {
      localStorage.setItem('rma_portal_email_recipients', JSON.stringify(newSettings));
      window.dispatchEvent(new CustomEvent('rma-settings-changed', { detail: newSettings }));
      window.dispatchEvent(new Event('storage'));
      try {
        if (window.BroadcastChannel) {
          const ch = new BroadcastChannel('rma_portal_sync_bus');
          ch.postMessage({ type: 'email-settings-updated', settings: newSettings });
        }
      } catch (e) {}
    }

    // Try persisting to Supabase rma_settings table
    try {
      await supabase
        .from('rma_settings')
        .upsert({
          key: 'email_recipients',
          value: newSettings,
          updated_at: new Date().toISOString()
        }, { onConflict: 'key' });
    } catch (e) {
      console.warn('Notice: rma_settings table not created yet in Supabase. Local storage active.');
    }

    return { success: true, settings: newSettings };
  },

  /**
   * Determine company configuration with user-configurable recipients
   */
  resolveCompanyConfig(report) {
    const settings = this.getEmailSettings();
    return {
      companyName: 'Pingcon RMA Returns',
      senderEmail: 'finance2@keysysincorporated.com',
      senderName: 'Pingcon RMA Finance Portal',
      toEmail: settings.toEmail || DEFAULT_RECIPIENTS.toEmail,
      baseCcList: Array.isArray(settings.baseCcList) && settings.baseCcList.length > 0 
        ? settings.baseCcList 
        : DEFAULT_RECIPIENTS.baseCcList
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
  generateEmailHtml(report, config, isTestMode = false) {
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

    const hasGps = report.gps_latitude && report.gps_longitude;
    const mapUrl = hasGps ? `https://www.google.com/maps?q=${report.gps_latitude},${report.gps_longitude}` : null;

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
            <span class="badge">${isTestMode ? `[TEST MODE] ${config.companyName}` : config.companyName}</span>
            <h1 class="title">${isTestMode ? 'Test - ' : ''}New RMA Return Report: ${rmaNumber}</h1>
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
                    <a href="${mapUrl}" target="_blank" style="color: #2563eb; text-decoration: underline;">
                      📍 View on Google Maps (${Number(report.gps_accuracy || 0).toFixed(0)}m accuracy)
                    </a>
                  </div>
                </div>` : ''}
              </div>
            </div>

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
  async sendRMANotification(report, isTestMode = false) {
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
      const config = this.resolveCompanyConfig(report);

      // Assemble CC list: base company recipients + Customer AE email
      const ccSet = new Set(config.baseCcList);
      if (report.ae_email && report.ae_email.includes('@')) {
        ccSet.add(report.ae_email.trim());
      }
      const finalCcList = Array.from(ccSet);
      const toEmail = config.toEmail;

      let subject = `[RMA Alert] ${report.rma_number || 'New Return'}: ${report.name || report.barcode} (${report.reason || 'Damaged'})`;

      if (testActive) {
        // Subject email must have "Test - " as the first word
        subject = `Test - [RMA Alert] ${report.rma_number || 'New Return'}: ${report.name || report.barcode} (${report.reason || 'Damaged'})`;
      }

      const htmlBody = this.generateEmailHtml(report, config, testActive);

      const photos = Array.isArray(report.photos) 
        ? report.photos 
        : (typeof report.photos === 'string' ? JSON.parse(report.photos || '[]') : []);

      // Attach proof images so Gmail provides built-in native in-page lightbox viewer
      const attachments = photos.map((p, idx) => ({
        filename: `proof_photo_${idx + 1}.jpg`,
        path: p
      }));

      console.log(`[RMA Email Dispatch] (TestMode: ${testActive}) Sending from "${config.senderEmail}" to "${toEmail}", CC: [${finalCcList.join(', ')}] with ${attachments.length} attachments`);

      const expiryInfo = this.formatExpiryForEmail(report);

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: config.senderEmail,
          fromName: testActive ? `[TEST] ${config.senderName}` : config.senderName,
          to: toEmail,
          cc: finalCcList,
          subject,
          html: htmlBody,
          isTestMode: testActive,
          attachments,
          text: `${testActive ? 'Test - ' : ''}New RMA Return: ${report.rma_number} for ${report.name || report.barcode}. Reason: ${report.reason}. Expiry Date (YYYY-MM-DD): ${expiryInfo.text}. Reported by: ${report.reporter_name || report.reported_by}. Customer AE: ${report.ae_name || 'N/A'}`
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
            <h1 class="title">${isTestMode ? 'Test - ' : ''}${title}: ${product.name}</h1>
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
  async sendProductUpdateNotification({ product, isNew = false, editorName = 'Admin' }, isTestMode = false) {
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
      const config = this.resolveCompanyConfig(product);

      // Assemble CC list: base company recipients + Customer AE email
      const ccSet = new Set(config.baseCcList);
      const aeEmail = product.aeEmail || product.ae_email;
      if (aeEmail && aeEmail.includes('@')) {
        ccSet.add(aeEmail.trim());
      }
      const finalCcList = Array.from(ccSet);
      const toEmail = config.toEmail;

      let subject = `[Product Catalog] ${isNew ? 'New Product Added' : 'Product Details Updated'}: ${product.name} (${product.barcode})`;

      if (testActive) {
        subject = `Test - [Product Catalog] ${isNew ? 'New Product Added' : 'Product Details Updated'}: ${product.name} (${product.barcode})`;
      }

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
          text: `${testActive ? 'Test - ' : ''}Product ${isNew ? 'Added' : 'Updated'}: ${product.name} (${product.barcode}). SKU: ${product.code || 'N/A'}. AE: ${product.aeName || product.ae_name || 'N/A'}`
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
    actorName = 'Warehouse Staff',
    isTestMode = false,
    pickupPhotoEntries = [],
    intakePhotos = [],
    pdfAttachedFilename = null
  }) {
    const effectiveReports = Array.isArray(reports) && reports.length > 0 ? reports : (report ? [report] : []);
    const primaryReport = report || effectiveReports[0] || {};
    const isBatch = effectiveReports.length > 1;
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
    const claimNo = pickup.claim_number || (String(primaryReport.notes || '').match(/\[RTV:\s*([^\]]+)\]/i)?.[1]?.trim()) || '';
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
        badge: isBatch ? `CONSOLIDATED DRIVER PICKUP — DEBIT CLAIM (${effectiveReports.length} RMAs)` : 'DRIVER PICKUP — DEBIT CLAIM',
        title: `Driver Picked Up for Debit Claim: ${refHeadline}`,
        headerBg: '#1e3a8a',
        subtitle: 'Supplier Return Picked Up • Debit Claim Form PDF Attached'
      },
      pickup_replacement: {
        badge: isBatch ? `CONSOLIDATED DRIVER PICKUP — REPLACEMENT (${effectiveReports.length} RMAs)` : 'DRIVER PICKUP — REPLACEMENT / EXCHANGE',
        title: `Driver Picked Up for Replacement: ${refHeadline}`,
        headerBg: '#4338ca',
        subtitle: 'Supplier Replacement / Exchange Picked Up • Replacement Form PDF Attached'
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

    const supplierName = pickup.supplier_name || primaryReport.supplier_name || primaryReport.supplierName || 'Pending Assignment';
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
            <span class="badge">${isTestMode ? `[TEST MODE] ${ev.badge}` : ev.badge}</span>
            <h1 class="title">${isTestMode ? 'Test - ' : ''}${escapeEmailHtml(ev.title)}</h1>
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
                  <div class="col-label">${eventType === 'pickup_replacement' ? 'Replacement Ref #:' : 'Debit Claim #:'}</div>
                  <div class="col-val" style="font-family: monospace; color: #4338ca;">${escapeEmailHtml(claimNo)}</div>
                </div>` : ''}
                <div class="row">
                  <div class="col-label">Supplier / Vendor:</div>
                  <div class="col-val">${escapeEmailHtml(supplierName)}</div>
                </div>
                <div class="row">
                  <div class="col-label">Store / Branch:</div>
                  <div class="col-val">${escapeEmailHtml(branchSummary)}</div>
                </div>
                <div class="row">
                  <div class="col-label">Defect / Return Reason:</div>
                  <div class="col-val">${escapeEmailHtml(primaryReport.reason || 'Damaged / Defective')}</div>
                </div>
                <div class="row">
                  <div class="col-label">Warehouse Location:</div>
                  <div class="col-val">${escapeEmailHtml(primaryReport.warehouse_location || 'Receiving / Warehouse')}</div>
                </div>
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
                  <div class="col-val">${escapeEmailHtml(actorName || pickup.processed_by || 'Warehouse Staff')}</div>
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
            <div class="section-title">Supplier Driver &amp; Pickup Details</div>
            <div class="card">
              <div class="grid">
                <div class="row">
                  <div class="col-label">Driver Name:</div>
                  <div class="col-val">${escapeEmailHtml(pickup.driver_name || 'Not specified')}</div>
                </div>
                <div class="row">
                  <div class="col-label">Driver License / ID #:</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.driver_license_no || 'Not specified')}</div>
                </div>
                <div class="row">
                  <div class="col-label">Truck Plate #:</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.truck_plate || 'Not specified')}</div>
                </div>
                ${pickup.supplier_email_to ? `
                <div class="row">
                  <div class="col-label">Supplier Email TO:</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.supplier_email_to)}</div>
                </div>` : ''}
                ${pickup.supplier_email_cc ? `
                <div class="row">
                  <div class="col-label">Supplier Email CC:</div>
                  <div class="col-val" style="font-family: monospace;">${escapeEmailHtml(pickup.supplier_email_cc)}</div>
                </div>` : ''}
              </div>
            </div>` : ''}

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

            ${pickupPhotoEntries.length > 0 ? `
            <div class="section-title">Driver Pickup Verification Photos (${pickupPhotoEntries.length}/5)</div>
            <div style="margin-top: 12px;">
              ${pickupPhotoEntries.map((entry, idx) => `
              <div style="margin-bottom: 16px; text-align: center;">
                <div style="font-size: 12px; font-weight: 800; color: #1e293b; margin-bottom: 6px;">${idx + 1}. ${escapeEmailHtml(entry.label)}</div>
                <img src="${escapeEmailHtml(entry.url)}" alt="${escapeEmailHtml(entry.label)}" style="max-width: 100%; max-height: 360px; width: auto; height: auto; border-radius: 10px; border: 1px solid #cbd5e1;" />
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
    actorName = 'Warehouse Staff',
    isTestMode = false
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
      const config = this.resolveCompanyConfig(primaryReport);
      const isBatch = effectiveReports.length > 1;
      const rmaNumber = primaryReport.rma_number || primaryReport.rmaNumber || primaryReport.id || 'RMA';
      const meta = (primaryReport.ai_document_metadata && typeof primaryReport.ai_document_metadata === 'object')
        ? primaryReport.ai_document_metadata
        : {};
      const pickup = (meta.supplier_pickup && typeof meta.supplier_pickup === 'object')
        ? meta.supplier_pickup
        : {};
      const claimNo = pickup.claim_number || (String(primaryReport.notes || '').match(/\[RTV:\s*([^\]]+)\]/i)?.[1]?.trim()) || '';

      const isPickupEvent = eventType === 'pickup_debit_claim' || eventType === 'pickup_replacement';
      const supplierToList = isPickupEvent ? splitEmailList(pickup.supplier_email_to) : [];
      const supplierCcList = isPickupEvent ? splitEmailList(pickup.supplier_email_cc) : [];

      const toList = Array.from(new Set([
        ...splitEmailList(config.toEmail),
        ...supplierToList
      ]));
      const toEmail = toList.join(', ') || config.toEmail;

      const ccSet = new Set([
        ...(Array.isArray(config.baseCcList) ? config.baseCcList : []),
        ...supplierCcList
      ]);
      effectiveReports.forEach((r) => {
        if (r?.ae_email && String(r.ae_email).includes('@')) {
          ccSet.add(String(r.ae_email).trim());
        }
      });
      const finalCcList = Array.from(ccSet);

      const batchTag = isBatch ? `Consolidated (${effectiveReports.length} RMAs) — ` : '';
      const subjectLabelMap = {
        scrapped: `[RMA Scrapped] ${batchTag}${claimNo || rmaNumber}: ${primaryReport.name || primaryReport.barcode || 'Items'}`,
        restocked: `[RMA Restocked] ${batchTag}${claimNo || rmaNumber}: ${primaryReport.name || primaryReport.barcode || 'Items'}`,
        pickup_debit_claim: `[Driver Picked Up - Debit Claim] ${batchTag}${claimNo || rmaNumber}: ${pickup.supplier_name || primaryReport.supplier_name || 'Supplier'}`,
        pickup_replacement: `[Driver Picked Up - Replacement] ${batchTag}${claimNo || rmaNumber}: ${pickup.supplier_name || primaryReport.supplier_name || 'Supplier'}`
      };
      const baseSubject = subjectLabelMap[eventType] || `[RMA Update] ${batchTag}${rmaNumber}`;
      const subject = testActive ? `Test - ${baseSubject}` : baseSubject;

      // Collect pickup verification photos + RMA intake photos across all bundled RMAs
      const pickupPhotoLabels = [
        { key: 'id_license', label: 'Driver License / ID' },
        { key: 'driver_face', label: 'Driver Face / Selfie' },
        { key: 'truck_plate', label: 'Truck Plate Number' },
        { key: 'loaded_items', label: 'Loaded RMA Items' },
        { key: 'signed_form', label: 'Signed Form Photo' }
      ];
      const pickupPhotoObj = (pickup.photos && typeof pickup.photos === 'object') ? pickup.photos : {};
      const pickupPhotoEntries = pickupPhotoLabels
        .map((slot) => ({ label: slot.label, url: pickupPhotoObj[slot.key] }))
        .filter((e) => Boolean(e.url));

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
          preparedByOverride: actorName,
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

      // Attach remote HTTPS image links (so Nodemailer fetches without bloating POST payload)
      const attachedUrls = new Set();
      pickupPhotoEntries.forEach((entry, idx) => {
        if (/^https?:\/\//i.test(entry.url) && !attachedUrls.has(entry.url)) {
          attachedUrls.add(entry.url);
          attachments.push({
            filename: `pickup_photo_${idx + 1}.jpg`,
            path: entry.url
          });
        }
      });
      allIntakePhotos.forEach((url, idx) => {
        if (/^https?:\/\//i.test(url) && !attachedUrls.has(url)) {
          attachedUrls.add(url);
          attachments.push({
            filename: `rma_intake_photo_${idx + 1}.jpg`,
            path: url
          });
        }
      });

      const htmlBody = this.generateLifecycleEmailHtml({
        eventType,
        report: primaryReport,
        reports: effectiveReports,
        allReports,
        catalogProducts,
        config,
        actorName,
        isTestMode: testActive,
        pickupPhotoEntries: isPickupEvent ? pickupPhotoEntries : [],
        intakePhotos: isPickupEvent ? allIntakePhotos : [],
        pdfAttachedFilename
      });

      const eventTimeStr = formatDateTimeYmdHm(new Date());
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
          attachments,
          text: `${testActive ? 'Test - ' : ''}${baseSubject} • Processed by ${actorName} at ${eventTimeStr} (YYYY-MM-DD HH:mm).`
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


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

export const notificationService = {
  /**
   * Determine company division from product / report details
   */
  resolveCompanyConfig(report) {
    const rawCompany = String(report.company || '').toLowerCase();
    const rawSupplier = String(report.supplier_name || report.supplierName || '').toLowerCase();
    const rawName = String(report.name || '').toLowerCase();
    const rawBrand = String(report.brand_name || report.brand || '').toLowerCase();

    const isA2ZOrKeysys = (
      rawCompany.includes('a2z') || 
      rawCompany.includes('keysys') ||
      rawSupplier.includes('a2z') || 
      rawSupplier.includes('keysys') ||
      rawBrand.includes('keysys') ||
      rawName.includes('a2z') ||
      rawName.includes('keysys')
    );

    if (isA2ZOrKeysys) {
      return {
        companyName: 'A2Z2GO / Keysys',
        senderEmail: 'finance2@a2z2go.net',
        senderName: 'A2Z2GO Finance (RMA Portal)',
        toEmail: 'azgodev@gmail.com',
        baseCcList: [
          'mgan@a2z2go.net',
          'marketing@a2z2go.net',
          'azgan@a2z2go.net',
          'jaezelle.benito@pingconmarketing.com'
        ]
      };
    }

    // Default: Pingcon / Bonita
    return {
      companyName: 'Pingcon / Bonita',
      senderEmail: 'finance@pingconmarketing.com',
      senderName: 'Pingcon Finance (RMA Portal)',
      toEmail: 'azgodev@gmail.com',
      baseCcList: [
        'mgan@pingconmarketing.com',
        'marketing@pingconmarketing.com',
        'azgan@pingconmarketing.com',
        'jaezelle.benito@pingconmarketing.com'
      ]
    };
  },

  /**
   * Build clean, modern HTML email notification body
   */
  generateEmailHtml(report, config) {
    const rmaNumber = report.rma_number || 'RMA-PENDING';
    const itemName = report.name || `Unidentified Item (${report.barcode})`;
    const reporter = report.reporter_name || report.reported_by || 'Warehouse Staff';
    const contact = report.reporter_contact || 'N/A';
    const aeName = report.ae_name || 'Unassigned';
    const aeEmail = report.ae_email || '';
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
          .ae-box { background: #eff6ff; border: 1px solid #bfdbfe; color: #1e40af; border-radius: 10px; padding: 12px 16px; margin: 12px 0; font-size: 13px; }
          .photo-grid { margin-top: 10px; }
          .photo-thumb { display: inline-block; width: 90px; height: 90px; border-radius: 10px; overflow: hidden; border: 1px solid #cbd5e1; margin-right: 8px; margin-bottom: 8px; vertical-align: top; }
          .photo-thumb img { width: 100%; height: 100%; object-fit: cover; }
          .btn { display: inline-block; padding: 10px 20px; background: #2563eb; color: #ffffff !important; text-decoration: none; border-radius: 10px; font-size: 13px; font-weight: 800; margin-top: 14px; }
          .footer { background: #f1f5f9; padding: 16px 28px; font-size: 11px; color: #64748b; text-align: center; border-top: 1px solid #e2e8f0; }
        </style>
      </head>
      <body>
        <div class="container">
          <div class="header">
            <span class="badge">${config.companyName}</span>
            <h1 class="title">New RMA Return Report: ${rmaNumber}</h1>
            <div style="font-size: 12px; opacity: 0.85; margin-top: 4px;">Automated Warehouse Intake Notification</div>
          </div>
          
          <div class="content">
            <div class="reason-box">
              🚨 Return Defect: ${report.reason || 'Damaged / Defective'}
              ${report.explanation ? `<div style="font-weight: 400; font-size: 12px; margin-top: 4px; color: #9f1239;">${report.explanation}</div>` : ''}
            </div>

            <div class="section-title">Item Details</div>
            <div class="card">
              <div class="grid">
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
                  <div class="col-val">${report.quantity || 1} ${report.unit_name || 'pc'}</div>
                </div>
                <div class="row">
                  <div class="col-label">Supplier / Brand:</div>
                  <div class="col-val">${report.supplier_name || 'Savemore'}</div>
                </div>
              </div>
            </div>

            <div class="section-title">Customer Account Executive (AE)</div>
            <div class="ae-box">
              <strong>${aeName}</strong>
              ${aeEmail ? `<br><a href="mailto:${aeEmail}" style="color: #2563eb; font-family: monospace; font-size: 12px;">${aeEmail}</a>` : '<br><span style="color: #dc2626; font-size: 12px;">(No AE email assigned to product)</span>'}
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
                  <div class="col-label">Submission Date:</div>
                  <div class="col-val">${new Date().toLocaleString()}</div>
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
            <div class="photo-grid">
              ${photos.map((p, idx) => `
                <div class="photo-thumb">
                  <a href="${p}" target="_blank"><img src="${p}" alt="Proof ${idx + 1}" /></a>
                </div>
              `).join('')}
            </div>` : ''}

            <div style="text-align: center; margin-top: 24px;">
              <a href="https://rma-portal-v2.vercel.app" class="btn">Open RMA Portal Dashboard →</a>
            </div>
          </div>

          <div class="footer">
            This automated alert was dispatched by the Wholesale RMA Return Portal.<br>
            Sender: ${config.senderEmail} • Main Recipient: ${config.toEmail}
          </div>
        </div>
      </body>
      </html>
    `;
  },

  /**
   * Dispatch email notification for a newly submitted RMA report
   */
  async sendRMANotification(report) {
    if (!report) return { success: false, error: 'No report data provided' };

    try {
      const config = this.resolveCompanyConfig(report);

      // Assemble CC list: base company recipients + Customer AE email
      const ccSet = new Set(config.baseCcList);
      if (report.ae_email && report.ae_email.includes('@')) {
        ccSet.add(report.ae_email.trim());
      }
      const finalCcList = Array.from(ccSet);

      const subject = `[RMA Alert] ${report.rma_number || 'New Return'}: ${report.name || report.barcode} (${report.reason || 'Damaged'})`;
      const htmlBody = this.generateEmailHtml(report, config);

      console.log(`[RMA Email Dispatch] Sending from "${config.senderEmail}" to "${config.toEmail}", CC: [${finalCcList.join(', ')}]`);

      const res = await fetch('/api/send-email', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({
          from: config.senderEmail,
          fromName: config.senderName,
          to: config.toEmail,
          cc: finalCcList,
          subject,
          html: htmlBody,
          text: `New RMA Return: ${report.rma_number} for ${report.name || report.barcode}. Reason: ${report.reason}. Reported by: ${report.reporter_name || report.reported_by}. Customer AE: ${report.ae_name || 'N/A'}`
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
  }
};

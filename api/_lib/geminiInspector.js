/**
 * Shared image normalization helper for Google Gemini Flash inspection calls.
 */
async function prepareGeminiImagePayload({ fileData, imageUrl, mimeType = 'image/jpeg' }) {
  let cleanMimeType = mimeType || 'image/jpeg';
  let base64String = '';

  if (fileData) {
    if (fileData.includes(';base64,')) {
      const parts = fileData.split(';base64,');
      cleanMimeType = parts[0].replace('data:', '') || cleanMimeType;
      base64String = parts[1];
    } else if (fileData.includes(',')) {
      base64String = fileData.split(',')[1];
    } else {
      base64String = fileData;
    }
  } else if (imageUrl) {
    const imgRes = await fetch(imageUrl);
    if (!imgRes.ok) {
      throw new Error(`Failed to fetch image from URL: ${imgRes.statusText}`);
    }
    const arrayBuf = await imgRes.arrayBuffer();
    cleanMimeType = imgRes.headers.get('content-type') || cleanMimeType;
    base64String = Buffer.from(arrayBuf).toString('base64');
  } else {
    throw new Error('Either fileData (Base64) or imageUrl must be provided.');
  }

  return { cleanMimeType, base64String };
}

/**
 * Shared Gemini Flash Vision REST runner with model cascade fallback.
 */
async function invokeGeminiVisionJson({ apiKey, promptText, cleanMimeType, base64String }) {
  const configuredModel = process.env.GEMINI_MODEL;
  const modelsToTry = [
    configuredModel || 'gemini-3.5-flash-lite',
    'gemini-2.5-flash-lite',
    'gemini-2.5-flash',
    'gemini-flash-latest'
  ].filter(Boolean);

  let lastError = null;

  for (const modelName of modelsToTry) {
    try {
      const endpoint = `https://generativelanguage.googleapis.com/v1beta/models/${modelName}:generateContent?key=${apiKey}`;

      const apiRes = await fetch(endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          contents: [
            {
              role: 'user',
              parts: [
                { text: promptText },
                {
                  inlineData: {
                    mimeType: cleanMimeType,
                    data: base64String
                  }
                }
              ]
            }
          ],
          generationConfig: {
            responseMimeType: 'application/json',
            temperature: 0.1
          }
        })
      });

      if (!apiRes.ok) {
        const errBody = await apiRes.text();
        throw new Error(`Google API ${apiRes.status} on model ${modelName}: ${errBody}`);
      }

      const resData = await apiRes.json();
      const partText = resData?.candidates?.[0]?.content?.parts?.[0]?.text?.trim() || '';
      if (!partText) {
        throw new Error(`Empty response from model ${modelName}`);
      }

      const jsonStart = partText.indexOf('{');
      const jsonEnd = partText.lastIndexOf('}');
      if (jsonStart !== -1 && jsonEnd !== -1) {
        return JSON.parse(partText.substring(jsonStart, jsonEnd + 1));
      }

      throw new Error(`Invalid JSON format from model ${modelName}`);
    } catch (err) {
      console.warn(`[Gemini Flash] Model ${modelName} attempt notice:`, err.message);
      lastError = err;
    }
  }

  throw new Error(`Gemini inspection failed: ${lastError?.message || 'Unknown error'}`);
}

/**
 * Validates and inspects paperwork photo using Google Gemini Flash
 * Extracts DR/SI number, store branch, vendor, and document type.
 * Rejects photos that are not official logistics paperwork with clear reasons.
 */
export async function inspectPaperworkWithGemini({ fileData, imageUrl, mimeType = 'image/jpeg' }) {
  const apiKey = process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;

  const { cleanMimeType, base64String } = await prepareGeminiImagePayload({ fileData, imageUrl, mimeType });

  // If API Key is missing, reject document validation with clear notice (NEVER create fake numbers!)
  if (!apiKey) {
    console.warn('[Gemini Flash Inspector] GEMINI_API_KEY environment variable is not configured.');
    return {
      is_valid_document: false,
      document_type: 'Unknown / Unverified',
      confidence: 0.0,
      si_number: null,
      dr_number: null,
      po_number: null,
      invoice_dr_number: null,
      store_branch: null,
      detected_date: null,
      vendor_name: null,
      error: 'MISSING_GEMINI_API_KEY',
      rejection_reason: 'Google AI Studio API key (GEMINI_API_KEY) is not configured in Vercel Environment Variables. Please configure the key to enable AI verification, or enter SI#, DR#, and PO# manually.'
    };
  }

  const promptText = `
You are a strict Wholesale Commercial Logistics Auditor and High-Accuracy Document OCR Specialist.
Your task is to examine the provided photo and determine if it is an authentic wholesale logistics paper document:
- Sales Invoice (SI)
- Delivery Receipt (DR)
- Purchase Order (PO)
- Official Pull-Out Slip / Credit Slip

CRITICAL REJECTION RULES (Return is_valid_document: false):
1. If the photo does NOT depict an authentic commercial/logistics paper document:
   You MUST reject it with a specific rejection_reason explaining what was detected instead:
   - For a person or face: "Photo shows a person or selfie instead of a commercial delivery document."
   - For merchandise or snack packaging: "Photo shows product packaging only, not the official Delivery Receipt, Invoice, or PO paperwork."
   - For an empty desk, floor, or room: "Photo shows a surface or room with no readable paperwork."
   - For a casual retail grocery receipt or cafe bill: "Photo appears to be a casual retail receipt rather than an official wholesale Delivery Receipt (DR), Sales Invoice (SI), or Purchase Order (PO)."
2. If it is a photo of paper, but NO identifying document numbers (Sales Invoice #, Delivery Receipt #, or Purchase Order #) are legible:
   You MUST reject it with: "Paperwork detected, but document numbers (Sales Invoice #, DR #, or PO #) are blurry, dark, or cropped. Please retake a clear, well-lit close-up."
3. If the image is blurry, out of focus, or glare blocks the text:
   You MUST reject it with: "Image is too blurry or has excessive glare to read document numbers. Please retake under clear lighting."

CRITICAL EXTRACTION RULES (When is_valid_document: true):
- Extract whatever numbers are present on the document:
  - "si_number": Exact Sales Invoice # (e.g. "SI-2026-9021", "SI# 10482"), or null if not an invoice or not present.
  - "dr_number": Exact Delivery Receipt # (e.g. "DR-2026-8812", "DR# 99421"), or null if not a DR or not present.
  - "po_number": Exact Purchase Order # (e.g. "PO-2026-4401", "PO# 3318"), or null if not a PO or not present.
  - "invoice_dr_number": The primary tracking number (prefer SI# > DR# > PO#).
  - "store_branch": Store, supermarket branch, or customer recipient name printed on the document.
  - "vendor_name": Vendor, distributor, or company name printed on the document.
  - "detected_date": Date found on document (YYYY-MM-DD format if possible).
  - "document_type": "Sales Invoice" | "Delivery Receipt" | "Purchase Order" | "Official Pull-Out Slip" | "Commercial Paperwork"

NEVER invent, guess, or synthesize fake numbers! If a field is not visibly written on the page, return null.

Return ONLY valid JSON matching this schema:
{
  "is_valid_document": boolean,
  "document_type": string,
  "confidence": number,
  "si_number": string | null,
  "dr_number": string | null,
  "po_number": string | null,
  "invoice_dr_number": string | null,
  "store_branch": string | null,
  "detected_date": string | null,
  "vendor_name": string | null,
  "rejection_reason": string | null
}
`;

  const parsed = await invokeGeminiVisionJson({ apiKey, promptText, cleanMimeType, base64String });
  const isValid = Boolean(parsed.is_valid_document);
  const siNum = parsed.si_number ? String(parsed.si_number).trim() : null;
  const drNum = parsed.dr_number ? String(parsed.dr_number).trim() : null;
  const poNum = parsed.po_number ? String(parsed.po_number).trim() : null;
  const fallbackPrimary = parsed.invoice_dr_number ? String(parsed.invoice_dr_number).trim() : null;
  const primaryDocNum = siNum || drNum || poNum || fallbackPrimary;

  return {
    is_valid_document: isValid,
    document_type: parsed.document_type || (isValid ? 'Commercial Logistics Paperwork' : 'Non-Document / Rejected'),
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (isValid ? 0.95 : 0.0),
    si_number: siNum,
    dr_number: drNum,
    po_number: poNum,
    invoice_dr_number: primaryDocNum,
    store_branch: parsed.store_branch ? String(parsed.store_branch).trim() : null,
    detected_date: parsed.detected_date || null,
    vendor_name: parsed.vendor_name ? String(parsed.vendor_name).trim() : null,
    rejection_reason: isValid ? null : (parsed.rejection_reason || 'Photo does not appear to be an authentic Sales Invoice, DR, or PO, or document numbers are unreadable.')
  };
}

/**
 * Inspects a Driver's License or ID card using Gemini Flash to auto-populate pickup forms.
 * Extracts driver full name, license/ID number, and expiration date without fabricating missing fields.
 */
export async function inspectDriverLicenseWithGemini({ fileData, imageUrl, mimeType = 'image/jpeg' }) {
  const apiKey = process.env.GEMINI_API_KEY ||
    process.env.GOOGLE_AI_KEY ||
    process.env.GOOGLE_API_KEY ||
    process.env.GOOGLE_GENAI_API_KEY;

  const { cleanMimeType, base64String } = await prepareGeminiImagePayload({ fileData, imageUrl, mimeType });

  if (!apiKey) {
    return {
      is_valid_id: false,
      id_type: 'Unknown',
      driver_name: null,
      license_number: null,
      expiry_date: null,
      confidence: 0,
      error: 'MISSING_GEMINI_API_KEY',
      rejection_reason: 'AI key is not configured. Please type Driver Name and License # manually.'
    };
  }

  const promptText = `
You are a Logistics Gate Security ID Reader specializing in Philippine LTO Driver's Licenses and Government/Company IDs.
Examine the uploaded ID photo and extract ONLY clearly legible fields:
- "is_valid_id": true if the photo shows a physical or printed Driver's License, UMID, National ID, or Company ID card. False if it shows random objects, blurry text with no readable name/ID, or a product box.
- "id_type": "Driver's License" | "Government ID" | "Company ID" | "Unknown"
- "driver_name": The cardholder's full name formatted cleanly in normal First Middle Last order if recognizable (e.g. from "DELA CRUZ, JUAN SANTOS" return "Juan Santos Dela Cruz" or exact printed full name), or null if unreadable.
- "license_number": The exact License No. / ID No. printed on the card (e.g. "N01-23-456789"), or null if unreadable.
- "expiry_date": Expiration date on the ID in YYYY-MM-DD format if visible, else null.
- "confidence": 0.0 to 1.0
- "rejection_reason": Short explanation if is_valid_id is false, else null.

NEVER guess or make up a name or license number. Return ONLY valid JSON:
{
  "is_valid_id": boolean,
  "id_type": string,
  "driver_name": string | null,
  "license_number": string | null,
  "expiry_date": string | null,
  "confidence": number,
  "rejection_reason": string | null
}
`;

  const parsed = await invokeGeminiVisionJson({ apiKey, promptText, cleanMimeType, base64String });
  const isValid = Boolean(parsed.is_valid_id);
  return {
    is_valid_id: isValid,
    id_type: parsed.id_type || (isValid ? "Driver's License" : 'Unknown'),
    driver_name: parsed.driver_name ? String(parsed.driver_name).trim() : null,
    license_number: parsed.license_number ? String(parsed.license_number).trim() : null,
    expiry_date: parsed.expiry_date || null,
    confidence: typeof parsed.confidence === 'number' ? parsed.confidence : (isValid ? 0.92 : 0),
    rejection_reason: isValid ? null : (parsed.rejection_reason || 'Could not clearly read ID details. Please type Driver Name and License # manually.')
  };
}


# Wholesale Return Merchandise Authorization (RMA) Portal v2

Enterprise wholesale return merchandise authorization and warehouse intake platform for **Pingcon Marketing**, **Bonita Tissue**, **Keysys Tech Corp**, and **A2Z2Go**.

---

## 🚀 Key Modules & Architecture

### 1. In-Browser Scanner & Intake (Submit RMA)
- **Camera Barcode & QR Scanner**: Real-time camera viewfinder powered by `html5-qrcode`.
- **GTIN / Box Barcode Auto-Population**: Matches retail packaging barcodes with product catalog (`BON-FT-200`, `PC-JRT-500`, etc.).
- **Uncatalogued Manual Input**: Seamless fallback to type description manually if barcode is unlisted.
- **Re-scan Increment**: Re-scanning the same box automatically increments quantity `+1`.
- **Direct Volume Controls**: Big `[ - ]` and `[ + ]` buttons plus editable numeric box (type large quantities e.g. `20` immediately).
- **One-Click AI Defect Detection**: Generates structured technical defect diagnosis statements based on failure categories.
- **GPS Dock Location Grabber**: Captures verified receiving dock coordinates via `navigator.geolocation`.
- **Defect Photo Uploader**: Direct mobile camera or photo upload to Supabase bucket `rma-defect-photos`.

### 2. Automated Smart AE Routing & Outbound Dispatch
- **Group 1 (KEYSYS & A2Z2GO)**:
  - **Sender**: `finance2@a2z2go.net`
  - **To**: `azgodev@gmail.com`
  - **CC**: `mgan@a2z2go.net`, `AZGan@a2z2go.net`, `marketing@a2z2go.net`, `jaezelle.benito@pingconmarketing.com` + Assigned AE + Supervisor
- **Group 2 (PINGCON & BONITA TISSUE)**:
  - **Sender**: `finance@pingconmarketing.com`
  - **To**: `azgodev@gmail.com`
  - **CC**: `mgan@pingconmarketing.com`, `AZGan@pingconmarketing.com`, `marketing@pingconmarketing.com`, `jaezelle.benito@pingconmarketing.com` + Assigned AE + Supervisor
- **Simulation / Test Mode**: Safety toggle that automatically appends `.test` to all destination emails during testing.

### 3. Tickets Vault (Audit Archive)
- Complete history of all submitted return tickets with Ticket ID format: `RMA-2026-####-[4 alphanumeric chars]`.
- Multi-attribute search and status filtering (*Pending Inspection, Approved, In Transit, Buffer Replacement, Credit Memo Issued, Rejected*).
- Printable return QR code labels formatted for thermal sticker printers.
- Export to CSV for audit and reporting.

### 4. Finance Credit Memo Workstation
- Pull-out verification checkbox for logistics confirmation.
- Direct entry of official Credit Memo number (e.g. `CM-2026-0145`) and Credit Amount (₱).
- General Ledger integration (GL-4010) and finance officer authorization stamps.

### 5. Purchasing & Inventory Buffer Control
- Consolidated defective lot grouping by manufacturer/supplier (Bonita Mills, Pingcon Paper, Keysys Tech, A2Z Innovations).
- 7-Day Vendor Buffer Replacement SLA countdown timer with overdue indicators.
- One-click vendor replacement PO generation (`PO-RET-2026-###`).
- Immediate inventory buffer stock dispatch to customer accounts.

### 6. Print SKU Barcodes
- Printable A4 sheet grid for Pingcon, Bonita, and Keysys SKU barcodes for warehouse repackers labeling unlabelled cartons.

---

## 🛠️ Tech Stack
- **Framework**: React 18 + Vite 6
- **Styling**: Tailwind CSS + PostCSS
- **Icons**: Lucide React (`lucide-react`)
- **Scanner**: `html5-qrcode`
- **QR Code Engine**: `qrcode.react`
- **Backend / Database**: Supabase (`@supabase/supabase-js`) with automatic offline mock redundancy

---

## 🏃 Running Locally

```powershell
# Install dependencies
npm install

# Start development server
npm run dev
```

Open `http://localhost:5173` in your browser.

---

## 🛡️ Free-Tier Architecture & Safety Controls

1. **Vercel Hobby 12-Function Hard Cap**: Strictly limited to 12 serverless functions in `api/`.
2. **Aggressive Client WebP Compression**: Photos are downscaled to $\le$ 1280px at 0.7 quality in-browser via Canvas API (~80–180KB), eliminating Vercel 10s execution timeouts.
3. **Google Workspace Drive Hybrid Photo Storage**: RMA proof photos upload directly to dedicated company Google Drive (`Wholesale RMA Photos/YYYY-MM/`) via service account OAuth2 JWT, conserving Supabase 1 GB storage.
4. **Graceful Multi-Tier Redundancy**: Seamless automatic fallback to Supabase Storage `rma-photos` bucket and offline Base64 data URLs.
5. **Database Indexing**: All query columns indexed via `optimize_free_tier_indexes.sql` to protect Supabase 500 MB quota and prevent connection spikes.

---

## 📜 Architectural Development Rule: "LIVING DOCUMENTATION CONTRACT"

> [!IMPORTANT]
> **Single Source of Truth**: [`docs/MANUAL_QA_TESTING_CHECKLIST.md`](file:///c:/Users/Danilo.Alvaro/Desktop/Finance%20Systems/rma-portal-v2/docs/MANUAL_QA_TESTING_CHECKLIST.md) is our binding Quality Assurance testing contract.
> **Enforcement Rule**: WHENEVER any developer or AI assistant modifies, adds, or removes any UI button, modal, form input, or API endpoint in this project, they **MUST simultaneously update** `docs/MANUAL_QA_TESTING_CHECKLIST.md` with the new test cases and checkboxes `[ ]`.


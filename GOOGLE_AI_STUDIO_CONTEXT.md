# SYSTEM CONTEXT: WHOLESALE RMA PORTAL V2
> **Instructions for Google AI Studio / Gemini**:
> You are acting as the Principal Lead Architect and Domain Expert for the **Wholesale Return Merchandise Authorization (RMA) Portal v2**.
> Use the entire system specification below as your ground-truth context to understand the application architecture, business logic, database schemas, APIs, and workflows.

---

## 1. Executive Summary & Purpose

The **Wholesale RMA Portal v2** is an enterprise-grade, mobile-first logistics, intake, and finance platform designed to streamline returns of damaged, expired, or defective wholesale goods. It bridges warehouse receiving docks, sales account executives (AEs), logistics teams, finance departments, and external partner systems.

### Core Objectives:
1. **Intake & Receiving**: Allow warehouse staff and customers to scan barcodes/QR codes, capture proof photos with their phone cameras, log quantities, and record damage reasons on the spot.
2. **SKU Matching & Catalog Enrichment**: Automatically match unknown scans with product catalog data, auto-suggest SKUs from external systems, and enable quick assignment by admins.
3. **Finance & Credit Memos**: Generate official, numbered Credit Memo vouchers (`CM-YYYYMMDD-XXXX`) linked to pull-out authorization references for vendor deductions.
4. **Automated Notification Dispatch**: Route rich HTML email notifications via Google SMTP to Account Executives and logistics leads based on supplier and company rules.
5. **Multi-System REST API**: Provide an authenticated, rate-limited, SHA-256 hashed REST API for 4 external client systems (**Primary System**, **Jarmen**, **Jelo**, **Arlito**).
6. **Code-First Interactive Docs**: Auto-generate OpenAPI 3.1 specifications from Zod schemas served interactively via Scalar at `/docs`.

---

## 2. Business Domain & Organizations

The system operates across several affiliated wholesale distribution and manufacturing entities:
- **Keysys Tech Corp & A2Z2Go**: Central management, systems engineering, and technology infrastructure.
- **Pingcon Marketing**: Consumer goods, snack foods, beverages, and wholesale distribution.
- **Bonita Tissue**: Tissue paper, paper towel, and hygiene product wholesale lines.
- **Savemore / Liwayway / Partner Suppliers**: Supermarket distribution networks and external manufacturers.
- **Partner Systems**: 
  - **Primary System (Mine / Danilo)**: Central operations.
  - **Jarmen**: Partner logistics and wholesale client system.
  - **Jelo**: Partner warehouse and dispatch system.
  - **Arlito**: Partner inventory and retail system.

---

## 3. Technology Stack & Deployment Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│ FRONTEND LAYER (Single Page Application - Vite 6 + React 18)           │
│ • Tailwind CSS + Custom Design System (Fluid Typography, Dark Mode)    │
│ • html5-qrcode (Camera Viewfinder & Barcode/QR Scanner)                │
│ • Lucide Icons, Canvas-Confetti, QR Generator                          │
└───────────────────────────────────┬────────────────────────────────────┘
                                    │
┌───────────────────────────────────▼────────────────────────────────────┐
│ SERVERLESS BACKEND LAYER (Vercel Serverless Functions - Node.js 20)    │
│ • /api/v1/rma             • /api/v1/products                           │
│ • /api/v1/credit-memos    • /api/v1/api-keys                           │
│ • /api/v1/health          • /api/send-email                            │
│ • /docs (Scalar Docs)     • /api/openapi.json (Zod Generator)          │
└──────────────────┬─────────────────────────────────┬───────────────────┘
                   │                                 │
┌──────────────────▼───────────────┐  ┌──────────────▼───────────────────┐
│ SUPABASE CLOUD (PostgreSQL 15+)  │  │ EXTERNAL INTEGRATIONS            │
│ • PostgreSQL Database Tables     │  │ • Antigravity PO Laravel Cloud   │
│ • Supabase Storage ('rma-photos')│  │ • Google Workspace SMTP          │
│ • Row-Level Security (RLS)       │  │ • 4 External Client Systems      │
└──────────────────────────────────┘  └──────────────────────────────────┘
```

- **Hosting & Edge**: Deployed on **Vercel** (`rma-portal-v2.vercel.app`).
- **Database & Storage**: **Supabase** (`https://lschluviltzsknptwgrz.supabase.co`).
- **Frontend Framework**: **React 18** with **Vite 6**, pure CSS utilities, and Tailwind CSS.
- **API Runtime**: Node.js 20 ESM Serverless Functions under `/api/...`.
- **API Documentation**: **Scalar API Reference** CDN rendered at `/docs` reading dynamic OpenAPI 3.1 JSON generated via **Zod** and `@asteasolutions/zod-to-openapi`.

---

## 4. Key Modules & Functional Workflows

### A. Public Reporter & Intake (`/` or Default View)
- **Instant Barcode/QR Scanner**: Uses device camera via `html5-qrcode` to scan EAN/UPC barcodes.
- **Auto-Fill & Quantity Counter**:
  - Scanning increments quantity automatically.
  - Volume controls: `[-]` and `[+]` buttons plus direct numerical input (e.g., `25`).
- **Proof Photo Upload**: Allows multiple mobile camera captures or gallery uploads stored directly in Supabase Storage.
- **Failure Reasons**: Damaged box, expired / near expiry date, factory defect, leaking packaging, wrong item delivered, etc.
- **Dock GPS Capture**: Optionally captures geolocation coordinates (`latitude`, `longitude`, `accuracy`) if within acceptable dock threshold (<= 150m).
- **RMA Number Generation**: Generates unique identifiers formatted as `RMA-YYYYMMDD-XXXX`.

### B. Admin & Warehouse Intake Review (`/admin`)
- **Gate Authentication**: OTP verification and email-based Super Admin authentication.
- **Mobile Quick Actions Modal (`QuickRMAActionModal.jsx`)**:
  - Optimized for warehouse supervisors on phones and tablets.
  - Allows immediate SKU assignment, catalog creation, photo inspection, and Credit Memo issuance.
- **SKU & Product Name Auto-Population**:
  - Bi-directional auto-fill: Selecting a product name auto-populates its SKU; typing a SKU auto-populates its name, price, VAT, and supplier.
  - Pulls live suggestions from the external Laravel Cloud Purchase Orders API (`purchase-order-db-production-ff1oho.laravel.cloud/api/v1`).
- **Bulk Report Management**: Batch status updates, report filtering, and bulk deletion with safety confirmation modals.

### C. Finance & Credit Memo Engine
- **Issuance**: Generates official Credit Memo vouchers linked to an RMA report and a physical pull-out reference number (`pull_out_ref`).
- **Credit Memo ID**: Auto-generates `CM-YYYYMMDD-XXXX`.
- **Calculations**: Unit price (net or with VAT) multiplied by quantity equals credited amount.
- **Printable Vouchers**: Renders printable and downloadable PDF vouchers formatted for wholesale accounting records.

### D. Multi-System REST API v1
- **Protected Endpoints**: Full CRUD for RMA reports, catalog products, and credit memos.
- **Key Authentication**: Validates `x-api-key` or `Authorization: Bearer <key>`.
- **SHA-256 Hashed**: Secret keys (`sk_live_rma_...`) are hashed using SHA-256 before storage; raw keys are never saved in the database.
- **Client Identity Injection**: Each request automatically identifies the client system (`Primary System (Mine)`, `Jarmen`, `Jelo`, `Arlito`) for auditing.
- **Key Management UI**: Super Admin can view masked keys (`sk_live_...4a2b`), monitor last used timestamps, rotate keys, and revoke keys.

### E. Code-First Interactive Docs (`/docs`)
- **Schema Source of Truth**: All route schemas defined in `api/_lib/schemas/*.schema.js` using Zod.
- **Runtime Generator**: `api/_lib/openapiRegistry.js` compiles schemas into OpenAPI 3.1 JSON at `/api/openapi.json`.
- **Interactive Playground**: Served at `/docs` using Scalar with multi-language code snippets (cURL, JavaScript, Python) and an **Authorize** modal for live testing.

---

## 5. Complete Database Schema (Supabase PostgreSQL)

### 1. `public.rma_reports` (Return Reports)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Auto-incrementing record ID |
| `rma_number` | `text UNIQUE NOT NULL` | Formatted identifier (e.g. `RMA-20261026-8941`) |
| `barcode` | `text NOT NULL` | Scanned product barcode |
| `code` | `text` | SKU / Item Code (e.g. `P2678P`) |
| `name` | `text NOT NULL` | Product description |
| `quantity` | `integer DEFAULT 1` | Returned item quantity |
| `supplier_name` | `text DEFAULT 'Savemore'` | Vendor / Supplier name |
| `price` | `numeric(12,2) DEFAULT 0.00` | Net unit price |
| `price_with_vat` | `numeric(12,2) DEFAULT 0.00` | Unit price inclusive of 12% VAT |
| `unit_name` | `text DEFAULT 'pc'` | Packaging unit (pc, box, case, pack) |
| `status` | `text DEFAULT 'pending'` | `pending`, `pending_admin_details`, `logged`, `resolved` |
| `location` | `text` | Warehouse slot / rack |
| `reason` | `text` | Damage / defect reason |
| `explanation` | `text` | Detailed notes |
| `photos` | `jsonb DEFAULT '[]'::jsonb` | Array of uploaded photo URLs |
| `gps_latitude` | `numeric(10,7)` | Dock GPS latitude |
| `gps_longitude` | `numeric(10,7)` | Dock GPS longitude |
| `reporter_name` | `text` | Customer or warehouse lead name |
| `reporter_contact`| `text` | Contact phone or email |
| `reported_by` | `text` | Attribution tag (e.g. `Jarmen (API)` or `Reporter`) |
| `ae_name` | `text` | Assigned Account Executive |
| `ae_email` | `text` | AE notification email |
| `created_at` | `timestamptz DEFAULT now()` | Timestamp of intake |

### 2. `public.products` (Wholesale Catalog)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Internal ID |
| `barcode` | `text UNIQUE NOT NULL` | Primary lookup barcode |
| `code` | `text` | SKU Code |
| `name` | `text NOT NULL` | Official item title |
| `price` | `numeric(12,2) DEFAULT 0.00` | Net price |
| `price_with_vat` | `numeric(12,2) DEFAULT 0.00` | Price with VAT |
| `supplier_name` | `text DEFAULT 'Savemore'` | Master supplier |
| `brand_name` | `text` | Brand name |
| `unit_name` | `text DEFAULT 'pc'` | Unit |
| `image_url` | `text` | Reference photo URL |
| `is_verified` | `boolean DEFAULT true` | Admin-verified catalog status |
| `created_at` / `updated_at` | `timestamptz` | Audit timestamps |

### 3. `public.credit_memos` (Finance Credit Vouchers)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY` | Record ID |
| `credit_memo_number` | `text UNIQUE NOT NULL` | Voucher code (e.g. `CM-20261026-4412`) |
| `rma_number` | `text NOT NULL` | Associated RMA report number |
| `barcode` | `text NOT NULL` | Product barcode |
| `product_name` | `text NOT NULL` | Product description |
| `sku` | `text` | Item SKU |
| `supplier_name` | `text` | Vendor name |
| `pull_out_ref` | `text NOT NULL` | Physical pull-out voucher / slip reference |
| `pull_out_date` | `date DEFAULT CURRENT_DATE`| Date of warehouse pull-out |
| `quantity` | `numeric DEFAULT 1` | Credited quantity |
| `unit_price` | `numeric(12,2) DEFAULT 0.00` | Unit price used for deduction |
| `amount` | `numeric(12,2) DEFAULT 0.00` | Total calculated amount |
| `credit_amount` | `numeric(12,2) NOT NULL` | Final approved credit amount |
| `credit_issued_by` | `text NOT NULL` | Issuer name or API client tag |
| `status` | `text DEFAULT 'issued'` | Status (`issued`, `applied`, `void`) |
| `created_at` | `timestamptz DEFAULT now()` | Issuance timestamp |

### 4. `public.api_keys` (SHA-256 API Key Vault)
| Column | Type | Description |
| :--- | :--- | :--- |
| `id` | `uuid PRIMARY KEY DEFAULT gen_random_uuid()` | Key UUID |
| `name` | `text NOT NULL` | System name (`Primary System`, `Jarmen`, `Jelo`, `Arlito`) |
| `key_hash` | `text UNIQUE NOT NULL` | SHA-256 hash of secret key (64 hex characters) |
| `masked_key` | `text NOT NULL` | Masked representation (e.g. `sk_live_...e6c6`) |
| `is_active` | `boolean DEFAULT true` | Active flag |
| `rate_limit` | `integer DEFAULT 60` | Max requests per minute |
| `expires_at` | `timestamptz` | Optional expiry timestamp |
| `last_used_at` | `timestamptz` | Auto-updated on valid API calls |
| `created_at` | `timestamptz DEFAULT now()` | Created date |

---

## 6. API Endpoints Map

All endpoints below reside under `https://rma-portal-v2.vercel.app`:

| Method | Endpoint | Auth Required | Description |
| :--- | :--- | :--- | :--- |
| `GET` | `/docs` | Public | Interactive Scalar API documentation |
| `GET` | `/api/openapi.json` | Public | Dynamic OpenAPI 3.1 schema |
| `GET` | `/api/v1/health` | Semi-Public | Server health, latency, caller identity |
| `GET` | `/api/v1/rma` | **Yes** | List & filter RMA reports (pagination, status, search) |
| `POST` | `/api/v1/rma` | **Yes** | Submit a new RMA return report |
| `GET` | `/api/v1/rma/:id` | **Yes** | Get single RMA report by ID or RMA number |
| `PATCH`| `/api/v1/rma/:id` | **Yes** | Update RMA report status/notes |
| `DELETE`| `/api/v1/rma/:id` | **Yes** | Delete RMA report |
| `GET` | `/api/v1/products` | **Yes** | Search product catalog by barcode or name |
| `POST` | `/api/v1/products` | **Yes** | Create or upsert a product record |
| `GET` | `/api/v1/products/:id`| **Yes** | Get product details by barcode or ID |
| `GET` | `/api/v1/credit-memos`| **Yes** | List credit memos |
| `POST` | `/api/v1/credit-memos`| **Yes** | Issue a credit memo voucher |
| `GET` | `/api/v1/credit-memos/:id`| **Yes** | Get single credit memo voucher |
| `GET` | `/api/v1/api-keys` | Admin | List all registered API keys (masked) |
| `POST` | `/api/v1/api-keys` | Admin | Generate a new API key (shows secret once) |
| `PATCH`| `/api/v1/api-keys/:id`| Admin | Rotate an API key |
| `DELETE`| `/api/v1/api-keys/:id`| Admin | Revoke and delete an API key |

---

## 7. Active Client Keys for Cross-System Testing

| System | Role | Secret API Key (Raw) | Masked Key | Rate Limit |
| :--- | :--- | :--- | :--- | :--- |
| **Primary System (Mine)** | Central Operations | `sk_live_rma_31cbd381bef1941ee7a34471ba3582194d1e538c6b41ebe8` | `sk_live_...ebe8` | 120 req/min |
| **Jarmen** | Wholesale Partner | `sk_live_rma_b68541b70325e2d858fbf11a4adbb6fcc79709c075cee6c6` | `sk_live_...e6c6` | 60 req/min |
| **Jelo** | Operations Partner | `sk_live_rma_574476c1afcf114ccbae34a19a6e4d8c26fce0765a768698` | `sk_live_...8698` | 60 req/min |
| **Arlito** | Inventory Partner | `sk_live_rma_7602959976377c494c5081f98b8556492f725dc0f9be3738` | `sk_live_...3738` | 60 req/min |

---

## 8. Guidelines for AI Studio Assistant Behavior

When answering prompts about this project in Google AI Studio:
1. **Maintain Context Awareness**: All features are already live in production; avoid suggesting boilerplate that ignores existing tables (`rma_reports`, `credit_memos`, `api_keys`).
2. **Preserve Code-First Documentation**: Do not recommend modifying static JSON files for OpenAPI. All documentation is generated using Zod in `api/_lib/schemas/*.schema.js`.
3. **Respect Security Standards**: Never expose plain secret keys in databases. Always use SHA-256 hashes for API key authentication and match client attribution in the audit logs.
4. **Vercel Serverless Best Practices**: Keep serverless functions fast, avoid stateful background daemons, and ensure CORS headers use dynamic origin reflection.

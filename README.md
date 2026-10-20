# Wholesale Return Merchandise Authorization (RMA) System

A complete, production-ready, mobile-responsive web application for Wholesale Distributors and Warehouses handling warranty claims, return merchandise authorizations, and automated QR sticker generation.

---

## 🚀 Key Modules & Architecture

### 1. Pre-Delivery QR Sticker Studio (Warehouse View)
- **Multi-Brand Support**: Selector for **PINGCON**, **KEYSYS**, **BONITA TISSUE**, and **A2Z2GO**.
- **Catalog & Custom SKU**: Searchable dropdown of preloaded wholesale catalog items or manual entry for custom products.
- **Packaging Units**: Per Piece (`PC`), Per Dozen (`DZ`), Per Case (`CS`), Per Box (`BOX`).
- **Delivery Document Ref**: DR # or SI # with quick randomizer.
- **Consignee Customer Selection**: Preloaded enterprise customers or custom customer names.
- **Live Printable Label**: High-resolution QR code generator (`qrcode.react`) formatted with CSS `@media print` for standard 4x4 or 4x6 label printers.
- **Encrypted Parameter Query**: QR encodes `?sku=[SKU]&item=[ItemName]&pkg=[Packaging]&ref=[DR]&cust=[Customer]&company=[Company]` pointing directly to the Zero-Login Customer Portal.

### 2. Zero-Login Customer Return Portal (Mobile-First Public View)
- **100% Public Access**: No login, no password, no account required.
- **Pre-filled Data**: Product Name, SKU, Packaging Type, Delivery Ref, and Consignee Name are automatically parsed from the scanned QR code and locked in place with **zero typing required**.
- **Mandatory Defect Photo**: Smartphone camera direct trigger (`capture="environment"`) or desktop file picker. Submission is strictly blocked without proof of defect.
- **Defect Classification**: Categorized dropdown (*Damaged on Arrival*, *Cracked Screen / Casing*, *Leaked Packaging*, *Wrong Item*, *Factory Defect*, etc.) + description.
- **Official Tracking ID Formula**: 
  ```
  RMA-[Year]-[4-Digit Sequential Number]-[4-Character Random Alphanumeric]
  Example: RMA-2026-0001-T21R
  ```
- **Live Confirmation Card**: Green status card with tracking ID, one-click copy, and return instructions.

### 3. Returns Management Dashboard (Supervisor View)
- **Real-time Supabase Queries**: Direct connection to table `rma_tickets_vault`.
- **KPI Metrics**: Real-time counts of Total Returns, Pending Inspection, Replacement Approved, Credit Memo Issued, and Rejected.
- **Filtering & Search**: Multi-attribute search by RMA ID, Customer, Item, SKU, or DR, filtered by Company and Status.
- **Defect Proof Inspector**: High-resolution modal viewer for submitted defect photos.
- **Supervisor Status Actions**: One-click modal to update status and record resolution/accounting notes.
- **CSV Data Export**: Generate comprehensive audit spreadsheets for accounting and warehouse management.

---

## 🛠️ Tech Stack
- **Framework**: React 18 + Vite
- **Styling**: Tailwind CSS + PostCSS
- **Icons**: Lucide React (`lucide-react`)
- **QR Code Engine**: `qrcode.react`
- **Database**: `@supabase/supabase-js` targeting table `rma_tickets_vault`

---

## ⚙️ Supabase Setup & Environment Configuration

### 1. Configure `.env`
Ensure your `.env` file contains your Supabase project credentials:
```env
VITE_SUPABASE_URL=https://your-project-id.supabase.co
VITE_SUPABASE_ANON_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.your-anon-key-here
```
> **Note**: `.env` is already added to `.gitignore` so your keys are never committed to version control.

### 2. Run Database Migration
Open your Supabase Project Dashboard -> **SQL Editor**, and run the provided script in [`supabase_schema.sql`](file:///c:/Users/Danilo.Alvaro/Desktop/Finance%20Systems/RMA_System/supabase_schema.sql):
- Creates `public.rma_tickets_vault`
- Configures indexes for fast queries
- Configures Row Level Security (RLS) policies allowing public anonymous submissions and supervisor management.

---

## 🏃 Running the Application

1. **Development Server**:
   ```powershell
   npm run dev
   ```
2. Open `http://localhost:5173` in your browser.
3. Test the QR scanner simulation by clicking **Test QR Link** on any generated label in the Warehouse Studio or navigating using the top navbar.

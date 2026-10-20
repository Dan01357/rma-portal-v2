export const COMPANIES = [
  {
    id: 'PINGCON',
    name: 'PINGCON Marketing & Distribution',
    short: 'PINGCON',
    tagline: 'Consumer Electronics & Hardware Supplies',
    badgeColor: 'bg-blue-600 text-white',
    ringColor: 'ring-blue-500',
    logoLetter: 'P'
  },
  {
    id: 'KEYSYS',
    name: 'KEYSYS Digital Systems & IT',
    short: 'KEYSYS',
    tagline: 'Enterprise Peripherals & Networking',
    badgeColor: 'bg-emerald-600 text-white',
    ringColor: 'ring-emerald-500',
    logoLetter: 'K'
  },
  {
    id: 'BONITA TISSUE',
    name: 'BONITA TISSUE Paper Mills Inc.',
    short: 'BONITA TISSUE',
    tagline: 'Commercial & Institutional Paper Products',
    badgeColor: 'bg-amber-600 text-white',
    ringColor: 'ring-amber-500',
    logoLetter: 'B'
  },
  {
    id: 'A2Z2GO',
    name: 'A2Z2GO Logistics & Fast-Moving Goods',
    short: 'A2Z2GO',
    tagline: 'Wholesale FMCG & Retail Logistics',
    badgeColor: 'bg-purple-600 text-white',
    ringColor: 'ring-purple-500',
    logoLetter: 'A'
  }
];

export const PACKAGING_UNITS = [
  { id: 'PC', label: 'Per Piece (PC)', code: 'PC', description: 'Single unit package' },
  { id: 'DZ', label: 'Per Dozen (DZ)', code: 'DZ', description: 'Bundle of 12 units' },
  { id: 'CS', label: 'Per Case (CS)', code: 'CS', description: 'Master shipping case' },
  { id: 'BOX', label: 'Per Box (BOX)', code: 'BOX', description: 'Inner carton box' }
];

export const DEFECT_CATEGORIES = [
  'Damaged on Arrival (DOA)',
  'Cracked Screen / Casing',
  'Leaked Packaging / Moisture Damage',
  'Wrong Item / Mismatched SKU',
  'Factory Defect / Non-functional',
  'Missing Parts or Accessories',
  'Expired / Quality Deterioration',
  'Other Return Reason'
];

export const RMA_STATUSES = [
  { id: 'Pending Inspection', label: 'Pending Inspection', color: 'amber', bg: 'bg-amber-500/10 text-amber-400 border-amber-500/30' },
  { id: 'Approved for Replacement', label: 'Approved for Replacement', color: 'blue', bg: 'bg-blue-500/10 text-blue-400 border-blue-500/30' },
  { id: 'Credit Memo Issued', label: 'Credit Memo Issued', color: 'emerald', bg: 'bg-emerald-500/10 text-emerald-400 border-emerald-500/30' },
  { id: 'Rejected', label: 'Rejected', color: 'rose', bg: 'bg-rose-500/10 text-rose-400 border-rose-500/30' }
];

export const CATALOG_PRODUCTS = [
  // PINGCON
  { company: 'PINGCON', sku: 'PNG-LED-32F', name: 'PINGCON 32" HD Commercial Display Panel', category: 'Displays', defaultPkg: 'PC' },
  { company: 'PINGCON', sku: 'PNG-POW-850', name: 'PINGCON Industrial 850W Modular Power Supply', category: 'Power', defaultPkg: 'BOX' },
  { company: 'PINGCON', sku: 'PNG-HDMI-4K', name: 'PINGCON Braided 4K 60Hz Ultra HDMI Cable 3M', category: 'Cables', defaultPkg: 'DZ' },
  { company: 'PINGCON', sku: 'PNG-CCTV-08', name: 'PINGCON 8-Channel PoE NVR Security System', category: 'Security', defaultPkg: 'CS' },
  
  // KEYSYS
  { company: 'KEYSYS', sku: 'KEY-SW-24POE', name: 'KEYSYS 24-Port Gigabit Managed PoE+ Switch', category: 'Networking', defaultPkg: 'PC' },
  { company: 'KEYSYS', sku: 'KEY-AP-WIFI6', name: 'KEYSYS Dual-Band AX3000 Ceiling Access Point', category: 'Networking', defaultPkg: 'BOX' },
  { company: 'KEYSYS', sku: 'KEY-SRV-RAM32', name: 'KEYSYS ECC Registered DDR5 32GB Server RAM', category: 'Components', defaultPkg: 'PC' },
  { company: 'KEYSYS', sku: 'KEY-CAT6-1000', name: 'KEYSYS 1000FT UTP Solid Copper CAT6 Bulk Cable', category: 'Bulk Cable', defaultPkg: 'CS' },

  // BONITA TISSUE
  { company: 'BONITA TISSUE', sku: 'BON-JRT-200', name: 'BONITA Jumbo Roll Bath Tissue 200M (12 Rolls)', category: 'Paper Goods', defaultPkg: 'CS' },
  { company: 'BONITA TISSUE', sku: 'BON-INT-150', name: 'BONITA Interfolded Pop-up Paper Towel 150s', category: 'Paper Goods', defaultPkg: 'CS' },
  { company: 'BONITA TISSUE', sku: 'BON-FAC-100', name: 'BONITA Premium 2-Ply Facial Tissue Box', category: 'Paper Goods', defaultPkg: 'BOX' },
  { company: 'BONITA TISSUE', sku: 'BON-NAP-500', name: 'BONITA Dispenser Table Napkins 500-pack', category: 'Paper Goods', defaultPkg: 'DZ' },

  // A2Z2GO
  { company: 'A2Z2GO', sku: 'A2Z-STR-500M', name: 'A2Z Industrial Heavy-Duty Stretch Film 500m', category: 'Packaging', defaultPkg: 'BOX' },
  { company: 'A2Z2GO', sku: 'A2Z-TP-CL24', name: 'A2Z Acrylic Packaging Tape 2-inch Clear (24s)', category: 'Packaging', defaultPkg: 'CS' },
  { company: 'A2Z2GO', sku: 'A2Z-BUB-100', name: 'A2Z Bubble Cushion Roll 40" x 100M Dual-Layer', category: 'Packaging', defaultPkg: 'PC' },
  { company: 'A2Z2GO', sku: 'A2Z-BAR-1000', name: 'A2Z Direct Thermal Barcode Labels 4x6 Roll', category: 'Consumables', defaultPkg: 'DZ' }
];

export const SAMPLE_CUSTOMERS = [
  'MegaMart Wholesale Hub',
  'Metro Commercial Supplies Co.',
  'Apex Hypermarket Quezon Ave',
  'Prime Hardware & Build Depot',
  'Pacific Retail Logistics Corp.',
  'St. Joseph General Medical Supply'
];

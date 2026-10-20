import React, { useState, useMemo } from 'react';
import { 
  COMPANIES, 
  PACKAGING_UNITS, 
  CATALOG_PRODUCTS, 
  SAMPLE_CUSTOMERS 
} from '../data/mockCatalog';
import { ACCOUNT_EXECUTIVES } from '../lib/emailRouting';
import PrintableLabel from './PrintableLabel';
import { 
  Building2, 
  Package, 
  Layers, 
  Hash, 
  User, 
  Users,
  Sparkles, 
  RefreshCw, 
  QrCode, 
  SlidersHorizontal,
  Check,
  Search,
  Plus
} from 'lucide-react';

export default function QRStickerStudio({ onOpenPortalSim }) {
  const [selectedCompany, setSelectedCompany] = useState(COMPANIES[0].id);
  const [productSearch, setProductSearch] = useState('');
  const [isCustomProduct, setIsCustomProduct] = useState(false);
  const [selectedProduct, setSelectedProduct] = useState(CATALOG_PRODUCTS[0]);
  
  // Custom Product Inputs if toggled
  const [customSku, setCustomSku] = useState('');
  const [customName, setCustomName] = useState('');

  const [packagingUnit, setPackagingUnit] = useState('PC');
  const [deliveryRef, setDeliveryRef] = useState('DR-88950');
  const [customerName, setCustomerName] = useState('Metro Commercial Supplies Co.');
  const [assignedAE, setAssignedAE] = useState('Rodrigo Galvez');

  // Dynamic QR Code Destination Base URL (defaults to active origin, editable for public domain)
  const activeOrigin = typeof window !== 'undefined' ? window.location.origin : 'http://localhost:5173';
  const defaultPublicUrl = import.meta.env.VITE_PUBLIC_APP_URL || activeOrigin;
  const [qrBaseUrl, setQrBaseUrl] = useState(defaultPublicUrl);

  // Filter catalog products for current company
  const companyProducts = useMemo(() => {
    return CATALOG_PRODUCTS.filter(p => p.company === selectedCompany);
  }, [selectedCompany]);

  // Filter products by search
  const filteredProducts = useMemo(() => {
    if (!productSearch) return companyProducts;
    const term = productSearch.toLowerCase();
    return companyProducts.filter(p => 
      p.name.toLowerCase().includes(term) || p.sku.toLowerCase().includes(term)
    );
  }, [companyProducts, productSearch]);

  // Handle company change
  const handleCompanyChange = (companyId) => {
    setSelectedCompany(companyId);
    const newCompanyProducts = CATALOG_PRODUCTS.filter(p => p.company === companyId);
    if (newCompanyProducts.length > 0) {
      setSelectedProduct(newCompanyProducts[0]);
      setPackagingUnit(newCompanyProducts[0].defaultPkg || 'PC');
      setIsCustomProduct(false);
    }
  };

  // Handle product selection
  const handleProductSelect = (prod) => {
    setSelectedProduct(prod);
    setIsCustomProduct(false);
    if (prod.defaultPkg) {
      setPackagingUnit(prod.defaultPkg);
    }
  };

  // Quick DR generator
  const handleGenerateDR = () => {
    const randomNum = Math.floor(10000 + Math.random() * 90000);
    setDeliveryRef(`DR-${randomNum}`);
  };

  // Determine current active item name and sku
  const activeSku = isCustomProduct ? (customSku.trim() || 'CUSTOM-SKU') : selectedProduct.sku;
  const activeItemName = isCustomProduct ? (customName.trim() || 'Custom Product Specification') : selectedProduct.name;

  // Construct target URL with pre-filled parameters:
  // ?sku=[SKU]&item=[ItemName]&pkg=[Packaging]&ref=[DR]&cust=[Customer]&company=[Company]
  const portalUrl = useMemo(() => {
    const cleanBase = (qrBaseUrl.trim() || activeOrigin).replace(/\/+$/, '');
    const params = new URLSearchParams({
      view: 'portal',
      sku: activeSku,
      item: activeItemName,
      pkg: packagingUnit,
      ref: deliveryRef.trim(),
      cust: customerName.trim(),
      company: selectedCompany,
      ae: assignedAE
    });
    return `${cleanBase}/?${params.toString()}`;
  }, [qrBaseUrl, activeOrigin, activeSku, activeItemName, packagingUnit, deliveryRef, customerName, selectedCompany, assignedAE]);

  return (
    <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8 py-8 animate-fade-in">
      {/* Page Title & Intro */}
      <div className="mb-8">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="inline-flex items-center gap-2 px-3 py-1 rounded-full bg-indigo-500/10 border border-indigo-500/20 text-indigo-400 text-xs font-semibold mb-2">
              <QrCode className="w-3.5 h-3.5" />
              <span>Module 1 • Warehouse Operations</span>
            </div>
            <h1 className="text-2xl sm:text-3xl font-extrabold text-white tracking-tight">
              Pre-Delivery QR Sticker Studio
            </h1>
            <p className="text-slate-400 text-sm mt-1">
              Generate standardized warranty QR stickers before outbound dispatch. Scanning automates returns with zero customer typing.
            </p>
          </div>

          <div className="flex items-center gap-3">
            <button
              type="button"
              onClick={handleGenerateDR}
              className="inline-flex items-center gap-1.5 px-3.5 py-2 rounded-xl bg-slate-800 hover:bg-slate-700 text-slate-200 border border-slate-700 text-xs font-semibold transition-all"
            >
              <RefreshCw className="w-3.5 h-3.5 text-indigo-400" />
              <span>Randomize DR #</span>
            </button>
          </div>
        </div>
      </div>

      {/* Main Grid: Left Controls (Warehouse Input), Right Live Print Preview */}
      <div className="grid grid-cols-1 lg:grid-cols-12 gap-8 items-start">
        
        {/* LEFT COLUMN: Input Configuration Form */}
        <div className="lg:col-span-7 bg-slate-800/60 backdrop-blur-md rounded-2xl border border-slate-700/80 p-6 shadow-xl space-y-6">
          
          {/* 1. Company Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Building2 className="w-4 h-4 text-indigo-400" />
              <span>1. Select Origin Company</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {COMPANIES.map((comp) => {
                const isSelected = selectedCompany === comp.id;
                return (
                  <button
                    key={comp.id}
                    type="button"
                    onClick={() => handleCompanyChange(comp.id)}
                    className={`relative p-3 rounded-xl border text-left transition-all flex flex-col justify-between ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-600/15 shadow-md shadow-indigo-500/10 ring-2 ring-indigo-500/40'
                        : 'border-slate-700 bg-slate-900/60 hover:border-slate-600 hover:bg-slate-800/60'
                    }`}
                  >
                    <div>
                      <span className="text-[10px] font-mono text-slate-400 block mb-0.5">
                        Brand
                      </span>
                      <p className="font-bold text-xs sm:text-sm text-white truncate">
                        {comp.short}
                      </p>
                    </div>
                    {isSelected && (
                      <span className="absolute top-2 right-2 w-2 h-2 rounded-full bg-indigo-400 animate-pulse"></span>
                    )}
                  </button>
                );
              })}
            </div>
          </div>

          {/* 2. Product Selector & SKU */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-400 flex items-center gap-1.5">
                <Package className="w-4 h-4 text-indigo-400" />
                <span>2. Product & SKU Selection</span>
              </label>
              <button
                type="button"
                onClick={() => setIsCustomProduct(!isCustomProduct)}
                className="text-xs text-indigo-400 hover:text-indigo-300 font-medium inline-flex items-center gap-1"
              >
                {isCustomProduct ? (
                  <span>Switch to Catalog Dropdown</span>
                ) : (
                  <>
                    <Plus className="w-3 h-3" />
                    <span>Enter Custom SKU</span>
                  </>
                )}
              </button>
            </div>

            {isCustomProduct ? (
              /* Custom Entry Form */
              <div className="p-4 rounded-xl bg-slate-900/80 border border-indigo-500/40 space-y-3">
                <div className="flex items-center gap-2 text-xs text-indigo-300 font-semibold mb-1">
                  <Sparkles className="w-3.5 h-3.5" />
                  <span>Manual Custom Product Input</span>
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-mono mb-1">Product Name / Description</label>
                  <input
                    type="text"
                    value={customName}
                    onChange={(e) => setCustomName(e.target.value)}
                    placeholder="e.g. Special Order Industrial Hydraulic Hose 5M"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>
                <div>
                  <label className="block text-[11px] text-slate-400 font-mono mb-1">SKU / Item Code</label>
                  <input
                    type="text"
                    value={customSku}
                    onChange={(e) => setCustomSku(e.target.value.toUpperCase())}
                    placeholder="e.g. CUST-HYD-500"
                    className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-sm font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500 uppercase"
                  />
                </div>
              </div>
            ) : (
              /* Searchable Catalog Dropdown */
              <div className="space-y-2">
                <div className="relative">
                  <Search className="w-4 h-4 text-slate-400 absolute left-3 top-2.5" />
                  <input
                    type="text"
                    value={productSearch}
                    onChange={(e) => setProductSearch(e.target.value)}
                    placeholder="Search by product name or SKU..."
                    className="w-full pl-9 pr-3 py-2 bg-slate-900 border border-slate-700 rounded-xl text-sm text-slate-200 placeholder-slate-500 focus:outline-none focus:border-indigo-500"
                  />
                </div>

                <div className="max-h-48 overflow-y-auto space-y-1.5 pr-1 rounded-xl">
                  {filteredProducts.map((prod) => {
                    const isCurrent = selectedProduct.sku === prod.sku;
                    return (
                      <div
                        key={prod.sku}
                        onClick={() => handleProductSelect(prod)}
                        className={`p-2.5 rounded-xl border cursor-pointer transition-all flex items-center justify-between ${
                          isCurrent
                            ? 'bg-indigo-600/20 border-indigo-500 text-white shadow-sm'
                            : 'bg-slate-900/50 border-slate-700/60 hover:border-slate-600 hover:bg-slate-900 text-slate-300'
                        }`}
                      >
                        <div className="min-w-0 pr-2">
                          <p className="text-xs sm:text-sm font-semibold truncate text-white">
                            {prod.name}
                          </p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-[11px] text-indigo-400 font-bold">
                              {prod.sku}
                            </span>
                            <span className="text-[10px] text-slate-400 bg-slate-800 px-1.5 py-0.5 rounded">
                              {prod.category}
                            </span>
                          </div>
                        </div>
                        {isCurrent && (
                          <div className="w-5 h-5 rounded-full bg-indigo-500 text-white flex items-center justify-center shrink-0">
                            <Check className="w-3 h-3" />
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            )}
          </div>

          {/* 3. Packaging Unit Selector */}
          <div>
            <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-2 flex items-center gap-1.5">
              <Layers className="w-4 h-4 text-indigo-400" />
              <span>3. Packaging Unit</span>
            </label>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-2.5">
              {PACKAGING_UNITS.map((unit) => {
                const isSelected = packagingUnit === unit.id;
                return (
                  <button
                    key={unit.id}
                    type="button"
                    onClick={() => setPackagingUnit(unit.id)}
                    className={`p-2.5 rounded-xl border text-center transition-all ${
                      isSelected
                        ? 'border-indigo-500 bg-indigo-600/20 text-white font-bold ring-1 ring-indigo-500'
                        : 'border-slate-700 bg-slate-900/60 text-slate-300 hover:border-slate-600'
                    }`}
                  >
                    <span className="block font-mono text-sm">{unit.code}</span>
                    <span className="text-[10px] text-slate-400 block mt-0.5">{unit.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* 4. Delivery Reference, Customer & Assigned AE */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {/* Delivery Reference */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Hash className="w-3.5 h-3.5 text-indigo-400" />
                <span>Delivery Ref (DR # / SI #)</span>
              </label>
              <div className="relative">
                <input
                  type="text"
                  value={deliveryRef}
                  onChange={(e) => setDeliveryRef(e.target.value)}
                  placeholder="e.g. DR-88902 or SI-4410"
                  className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm font-mono text-white focus:outline-none focus:border-indigo-500 uppercase"
                />
              </div>
            </div>

            {/* Customer Name */}
            <div>
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <User className="w-3.5 h-3.5 text-indigo-400" />
                <span>Customer / Consignee</span>
              </label>
              <input
                type="text"
                value={customerName}
                onChange={(e) => setCustomerName(e.target.value)}
                list="sample-customers"
                placeholder="Customer Account Name"
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              />
              <datalist id="sample-customers">
                {SAMPLE_CUSTOMERS.map((cust) => (
                  <option key={cust} value={cust} />
                ))}
              </datalist>
            </div>

            {/* Assigned Account Executive (AE) */}
            <div className="sm:col-span-2">
              <label className="block text-xs font-bold uppercase tracking-wider text-slate-400 mb-1.5 flex items-center gap-1.5">
                <Users className="w-3.5 h-3.5 text-indigo-400" />
                <span>Assigned Account Executive (AE)</span>
              </label>
              <select
                value={assignedAE}
                onChange={(e) => setAssignedAE(e.target.value)}
                className="w-full bg-slate-900 border border-slate-700 rounded-xl px-3.5 py-2.5 text-sm text-white focus:outline-none focus:border-indigo-500"
              >
                {ACCOUNT_EXECUTIVES.map((ae) => (
                  <option key={ae.id} value={ae.name}>
                    {ae.name} (AE)
                  </option>
                ))}
              </select>
            </div>
          </div>

          {/* 5. Dynamic QR Destination Domain / Production Base URL */}
          <div className="p-3.5 bg-slate-900/90 rounded-xl border border-slate-700/80 space-y-2">
            <div className="flex items-center justify-between">
              <label className="text-xs font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1.5">
                <SlidersHorizontal className="w-3.5 h-3.5 text-indigo-400" />
                <span>QR Destination Domain / Base URL</span>
              </label>
              <button
                type="button"
                onClick={() => setQrBaseUrl(activeOrigin)}
                className="text-[11px] text-indigo-400 hover:text-indigo-300 underline font-medium"
              >
                Reset to Current Origin
              </button>
            </div>
            <input
              type="url"
              value={qrBaseUrl}
              onChange={(e) => setQrBaseUrl(e.target.value)}
              placeholder="e.g. https://returns.yourcompany.com"
              className="w-full bg-slate-950 border border-slate-700 rounded-lg px-3 py-2 text-xs font-mono text-white placeholder-slate-500 focus:outline-none focus:border-indigo-500"
            />
            <p className="text-[11px] text-slate-400 leading-tight">
              Default is your active app origin (<span className="text-indigo-300 font-mono">{activeOrigin}</span>). Change this to your public domain if printing labels for customers scanning outside your local network.
            </p>
          </div>

          {/* Generated URL Breakdown Info */}
          <div className="p-3 bg-slate-900/90 rounded-xl border border-slate-700/80 text-xs">
            <span className="font-mono text-slate-400 block mb-1">
              Encrypted QR Target Parameters:
            </span>
            <code className="block p-2 bg-slate-950 rounded text-indigo-300 font-mono text-[11px] break-all border border-slate-800">
              ?sku={activeSku}&item={encodeURIComponent(activeItemName)}&pkg={packagingUnit}&ref={deliveryRef}&cust={encodeURIComponent(customerName)}&company={selectedCompany}
            </code>
          </div>
        </div>

        {/* RIGHT COLUMN: Live Printable Sticker Preview */}
        <div className="lg:col-span-5 flex flex-col items-center">
          <div className="w-full mb-3 flex items-center justify-between text-xs text-slate-400 px-1">
            <span className="font-bold uppercase tracking-wider text-slate-300 flex items-center gap-1">
              <QrCode className="w-3.5 h-3.5 text-indigo-400" /> Live Sticker Preview
            </span>
            <span className="text-[11px] bg-slate-800 px-2 py-0.5 rounded text-slate-300">
              Printable 4x4 / 4x6 Label
            </span>
          </div>

          <PrintableLabel
            company={selectedCompany}
            productName={activeItemName}
            sku={activeSku}
            packagingUnit={packagingUnit}
            deliveryRef={deliveryRef}
            customerName={customerName}
            assignedAE={assignedAE}
            portalUrl={portalUrl}
          />
        </div>

      </div>
    </div>
  );
}

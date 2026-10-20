import React, { useState } from 'react';
import { QRCodeSVG } from 'qrcode.react';
import { Printer, Barcode, Layers, Filter } from 'lucide-react';
import { formatPeso } from '../utils/rmaHelpers';

export default function PrintBarcodesTab({ catalog = [] }) {
  const [selectedBrand, setSelectedBrand] = useState('ALL');
  const [copiesPerItem, setCopiesPerItem] = useState(2);

  const filteredCatalog = catalog.filter(item => {
    if (selectedBrand === 'PINGCON') return item.sku.startsWith('PC-') || item.brand === 'Pingcon';
    if (selectedBrand === 'BONITA') return item.sku.startsWith('BON-') || item.brand === 'Bonita';
    if (selectedBrand === 'KEYSYS') return item.sku.startsWith('KS-') || item.sku.startsWith('A2Z-') || item.brand === 'Keysys' || item.brand === 'A2Z2Go';
    return true;
  });

  const handlePrint = () => {
    window.print();
  };

  return (
    <div className="space-y-6">
      
      {/* Top Banner (Hidden during print) */}
      <div className="bg-white dark:bg-slate-900 border border-slate-200 dark:border-slate-800 rounded-3xl p-5 sm:p-6 shadow-sm flex flex-col sm:flex-row items-start sm:items-center justify-between gap-4 no-print">
        <div>
          <div className="flex items-center space-x-2">
            <span className="px-2.5 py-0.5 rounded-full text-[11px] font-bold uppercase tracking-wider bg-brand-50 dark:bg-brand-500/20 text-brand-700 dark:text-brand-300 border border-brand-200 dark:border-brand-500/40">
              Warehouse Label Generator
            </span>
          </div>
          <h1 className="text-xl sm:text-2xl font-black text-slate-900 dark:text-white tracking-tight mt-1 flex items-center gap-2">
            <Barcode className="w-6 h-6 text-brand-600 dark:text-brand-400" />
            Print SKU Barcodes (A4 Sheet & Box Stickers)
          </h1>
          <p className="text-xs text-slate-500 dark:text-slate-400 mt-1">
            Printable sheet of Pingcon, Bonita & Keysys SKU barcodes for unlabelled wholesale boxes and repackers.
          </p>
        </div>

        <div className="flex items-center space-x-3">
          {/* Brand Filter */}
          <select
            value={selectedBrand}
            onChange={(e) => setSelectedBrand(e.target.value)}
            className="bg-slate-50 dark:bg-slate-950 border border-slate-200 dark:border-slate-700 rounded-xl px-3 py-2 text-xs text-slate-900 dark:text-slate-100 focus:outline-none focus:border-brand-500 font-medium"
          >
            <option value="ALL">All Product Lines</option>
            <option value="PINGCON">Pingcon Commercial Tissue</option>
            <option value="BONITA">Bonita Retail Tissue</option>
            <option value="KEYSYS">Keysys & A2Z2Go POS</option>
          </select>

          {/* Print Trigger Button */}
          <button
            onClick={handlePrint}
            className="px-5 py-2.5 bg-brand-600 hover:bg-brand-500 text-white font-bold text-xs rounded-xl shadow-md shadow-brand-600/20 flex items-center space-x-2 transition-all active:scale-95"
          >
            <Printer className="w-4 h-4" />
            <span>Print A4 Label Sheet</span>
          </button>
        </div>
      </div>

      {/* Printable Grid of Labels */}
      <div className="bg-slate-100 dark:bg-slate-950 p-4 sm:p-6 rounded-3xl border border-slate-200 dark:border-slate-800 shadow-inner">
        <div className="a4-print-sheet grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
          {filteredCatalog.flatMap((prod) => 
            Array.from({ length: copiesPerItem }).map((_, copyIndex) => (
              <div 
                key={`${prod.sku}-${copyIndex}`}
                className="barcode-sticker bg-white text-slate-900 border-2 border-dashed border-slate-300 rounded-2xl p-4 flex flex-col justify-between shadow-sm relative group hover:border-brand-500 transition-colors"
              >
                {/* Brand & Supplier Header */}
                <div className="flex items-center justify-between border-b border-slate-200 pb-2">
                  <span className="text-[11px] font-black uppercase tracking-wider text-slate-800">
                    {prod.brand ? `${prod.brand.toUpperCase()} WHOLESALE` : 'WHOLESALE PRODUCT'}
                  </span>
                  <span className="text-[10px] font-mono font-bold text-slate-500 bg-slate-100 px-1.5 py-0.5 rounded">
                    COPY {copyIndex + 1}
                  </span>
                </div>

                {/* Product Name */}
                <div className="py-2.5">
                  <h4 className="font-bold text-sm text-slate-900 leading-snug line-clamp-2">
                    {prod.name}
                  </h4>
                  <div className="flex items-center justify-between mt-1 text-[11px] text-slate-600">
                    <span className="font-semibold text-brand-700">SKU: {prod.sku}</span>
                    <span>{prod.case_pack || 'Carton Pack'}</span>
                  </div>
                </div>

                {/* QR and Barcode Graphic Container */}
                <div className="flex items-center justify-between bg-slate-50 border border-slate-200 rounded-xl p-2.5 my-1">
                  
                  {/* QR Code */}
                  <div className="shrink-0 bg-white p-1 rounded-lg border border-slate-200">
                    <QRCodeSVG
                      value={prod.barcode}
                      size={64}
                      level="M"
                    />
                  </div>

                  {/* Visual Barcode Bars Representation */}
                  <div className="flex-1 ml-3 flex flex-col items-center">
                    <div className="h-10 w-full flex items-stretch justify-center space-x-[2px] overflow-hidden">
                      {prod.barcode.split('').map((char, i) => {
                        const digit = parseInt(char, 10) || 1;
                        const widthClass = digit % 3 === 0 ? 'w-1 bg-black' : digit % 2 === 0 ? 'w-0.5 bg-black' : 'w-1.5 bg-black';
                        return (
                          <React.Fragment key={i}>
                            <span className={widthClass}></span>
                            <span className="w-0.5 bg-transparent"></span>
                          </React.Fragment>
                        );
                      })}
                    </div>
                    <span className="text-[11px] font-mono font-black tracking-widest text-slate-800 mt-1">
                      {prod.barcode}
                    </span>
                  </div>

                </div>

                {/* Footer Tag */}
                <div className="flex items-center justify-between pt-2 border-t border-slate-200 text-[10px] text-slate-500 font-mono">
                  <span>Standard Box Sticker</span>
                  <span>SRP: {formatPeso(prod.unit_price)}</span>
                </div>

              </div>
            ))
          )}
        </div>
      </div>

    </div>
  );
}

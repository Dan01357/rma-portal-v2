import React, { useState } from 'react';
import { Package, Search, Plus, Edit3, Trash2, CheckCircle, Image as ImageIcon, ExternalLink, X, RefreshCw } from 'lucide-react';

export default function SavedProductsTab({ 
  products = [], 
  isLoading = false,
  onAddProduct, 
  onEditProduct, 
  onDeleteProduct,
  currentUser 
}) {
  const [filterQuery, setFilterQuery] = useState('');
  const [selectedPhoto, setSelectedPhoto] = useState(null);

  const canEdit = currentUser?.role !== 'viewer';
  const canDelete = currentUser?.role === 'super_admin' || currentUser?.role === 'admin';

  const q = filterQuery.toLowerCase().trim();
  const filtered = products.filter(p => {
    if (!q) return true;
    return (
      (p.name || '').toLowerCase().includes(q) ||
      (p.barcode || '').toLowerCase().includes(q) ||
      (p.code || '').toLowerCase().includes(q) ||
      (p.supplier_name || p.supplierName || '').toLowerCase().includes(q)
    );
  });

  return (
    <div className="space-y-4">
      {/* Top Controls Bar */}
      <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-white border border-slate-200 rounded-3xl p-4 sm:p-5 shadow-sm">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-2xl bg-indigo-100 text-indigo-700 flex items-center justify-center shrink-0 shadow-inner">
            <Package className="w-5 h-5" />
          </div>
          <div>
            <div className="flex items-center gap-2">
              <h3 className="text-base font-black text-slate-900 tracking-tight">
                Verified Products Catalog
              </h3>
              <span className="px-2.5 py-0.5 rounded-full text-[11px] font-black bg-indigo-100 text-indigo-800">
                {products.length} Items in DB
              </span>
            </div>
            <p className="text-xs text-slate-500">
              Custom catalog items saved with verified barcodes & reference photos.
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2 self-end sm:self-auto">
          {canEdit && (
            <button
              type="button"
              onClick={onAddProduct}
              className="px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-xs font-black flex items-center gap-1.5 shadow-md shadow-blue-600/20 transition-all"
            >
              <Plus className="w-4 h-4" />
              <span>Add Product</span>
            </button>
          )}
        </div>
      </div>

      {/* Filter / Search within saved products */}
      <div className="relative">
        <Search className="w-4 h-4 text-slate-400 absolute left-3.5 top-3" />
        <input
          type="text"
          value={filterQuery}
          onChange={(e) => setFilterQuery(e.target.value)}
          placeholder="Filter saved products by name, barcode, SKU, or supplier..."
          className="w-full pl-10 pr-9 py-2.5 bg-white border border-slate-200 rounded-2xl text-xs font-semibold text-slate-900 placeholder-slate-400 focus:outline-none focus:border-indigo-500 focus:ring-2 focus:ring-indigo-100 shadow-sm transition-all"
        />
        {filterQuery && (
          <button
            onClick={() => setFilterQuery('')}
            className="absolute right-3 top-2.5 text-slate-400 hover:text-slate-600 p-0.5 rounded-full hover:bg-slate-100"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        )}
      </div>

      {/* Products Grid / Cards */}
      {isLoading ? (
        <div className="py-16 text-center text-slate-400 space-y-2 bg-white border border-slate-200 rounded-3xl p-6">
          <RefreshCw className="w-6 h-6 mx-auto animate-spin text-indigo-600" />
          <p className="text-xs font-bold text-slate-600">Loading custom catalog from Supabase...</p>
        </div>
      ) : filtered.length === 0 ? (
        <div className="py-14 text-center text-slate-400 space-y-2 bg-white border border-slate-200 rounded-3xl p-6 shadow-sm">
          <Package className="w-8 h-8 mx-auto text-slate-300" />
          <p className="text-xs font-bold text-slate-700">
            {filterQuery ? `No saved products found matching "${filterQuery}"` : 'No saved products in custom database yet'}
          </p>
          <p className="text-[11px] text-slate-400 max-w-sm mx-auto">
            When you verify pending barcodes or add items, they will appear here with instant edit and delete controls.
          </p>
          {canEdit && !filterQuery && (
            <button
              type="button"
              onClick={onAddProduct}
              className="mt-3 px-4 py-2 bg-indigo-50 hover:bg-indigo-100 text-indigo-700 font-bold rounded-xl text-xs inline-flex items-center gap-1.5 transition-colors"
            >
              <Plus className="w-3.5 h-3.5" />
              <span>Add Your First Product</span>
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3.5">
          {filtered.map(product => {
            const hasPhoto = Boolean(product.image_url || product.imageUrl);
            const photoSrc = product.image_url || product.imageUrl;

            return (
              <div
                key={product.id || product.barcode}
                className="bg-white border border-slate-200 hover:border-slate-300 rounded-3xl p-4 shadow-sm hover:shadow-md transition-all flex flex-col justify-between space-y-3 group"
              >
                <div>
                  {/* Top: Photo & Basic Details */}
                  <div className="flex items-start gap-3">
                    {hasPhoto ? (
                      <div 
                        onClick={() => setSelectedPhoto(photoSrc)}
                        className="w-16 h-16 rounded-2xl overflow-hidden border border-slate-200 bg-slate-50 shrink-0 cursor-pointer hover:opacity-90 relative"
                        title="Click to zoom reference photo"
                      >
                        <img src={photoSrc} alt={product.name} className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="w-16 h-16 rounded-2xl bg-indigo-50 text-indigo-400 flex items-center justify-center shrink-0 border border-indigo-100">
                        <ImageIcon className="w-6 h-6" />
                      </div>
                    )}

                    <div className="min-w-0 flex-1">
                      <div className="flex items-center gap-1.5 mb-0.5">
                        <span className="px-2 py-0.2 rounded-full text-[9px] font-black uppercase tracking-wider bg-emerald-100 text-emerald-800">
                          VERIFIED
                        </span>
                        {product.code && (
                          <span className="text-[10px] font-mono text-slate-500 font-bold truncate">
                            {product.code}
                          </span>
                        )}
                      </div>
                      
                      <h4 className="font-bold text-slate-900 text-xs sm:text-sm line-clamp-2 leading-tight">
                        {product.name}
                      </h4>
                      
                      <div className="text-[11px] font-mono text-slate-500 mt-1 truncate">
                        Barcode: <strong className="text-slate-800">{product.barcode}</strong>
                      </div>
                    </div>
                  </div>

                  {/* Metadata: Price & Supplier */}
                  <div className="mt-3 pt-2.5 border-t border-slate-100 flex items-center justify-between text-xs">
                    <div>
                      <span className="text-[10px] text-slate-400 block font-medium">Price (w/ VAT)</span>
                      <span className="font-black text-emerald-600 font-mono text-sm">
                        ₱{Number(product.price_with_vat || product.priceWithVat || product.price || 0).toFixed(2)}
                      </span>
                    </div>

                    <div className="text-right">
                      <span className="text-[10px] text-slate-400 block font-medium">Supplier</span>
                      <span className="font-bold text-slate-700 truncate max-w-[120px] block">
                        {product.supplier_name || product.supplierName || 'Savemore'}
                      </span>
                    </div>
                  </div>
                </div>

                {/* Actions: Edit & Delete */}
                <div className="pt-2 border-t border-slate-100 flex items-center justify-end gap-1.5">
                  {canEdit && (
                    <button
                      type="button"
                      onClick={() => onEditProduct(product)}
                      className="px-3 py-1.5 bg-slate-50 hover:bg-slate-100 text-slate-700 border border-slate-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                      title="Edit product details & photo"
                    >
                      <Edit3 className="w-3.5 h-3.5 text-blue-600" />
                      <span>Edit</span>
                    </button>
                  )}

                  {canDelete && (
                    <button
                      type="button"
                      onClick={() => onDeleteProduct(product)}
                      className="px-2.5 py-1.5 text-rose-600 hover:text-rose-700 hover:bg-rose-50 border border-transparent hover:border-rose-200 rounded-xl text-xs font-bold flex items-center gap-1 transition-colors"
                      title="Delete product from database"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                      <span>Delete</span>
                    </button>
                  )}
                </div>

              </div>
            );
          })}
        </div>
      )}

      {/* Photo Lightbox Modal */}
      {selectedPhoto && (
        <div 
          onClick={() => setSelectedPhoto(null)} 
          className="fixed inset-0 z-50 flex items-center justify-center p-4 bg-black/80 backdrop-blur-sm animate-in fade-in"
        >
          <div className="relative max-w-lg w-full bg-white rounded-3xl overflow-hidden shadow-2xl p-2" onClick={e => e.stopPropagation()}>
            <img src={selectedPhoto} alt="Product Reference" className="w-full h-auto max-h-[75vh] object-contain rounded-2xl" />
            <button
              onClick={() => setSelectedPhoto(null)}
              className="absolute top-4 right-4 p-2 bg-slate-900/70 hover:bg-slate-900 text-white rounded-full transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

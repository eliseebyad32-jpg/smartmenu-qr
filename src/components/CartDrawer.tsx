import React, { useState } from 'react';
import {
  Check,
  Copy,
  Info,
  Minus,
  Plus,
  ShoppingBag,
  Trash2,
  X,
} from 'lucide-react';
import { useCart } from '../context/CartContext';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import { Restaurant } from '../types/menu';
import { CulinaryImage } from './CulinaryImage';

interface CartDrawerProps {
  restaurant: Restaurant;
  isOpen: boolean;
  onClose: () => void;
}

export const CartDrawer: React.FC<CartDrawerProps> = ({
  restaurant,
  isOpen,
  onClose,
}) => {
  const { t, pick, formatFC } = useLanguage();
  const {
    getCart,
    updateQuantity,
    updateItemNote,
    removeFromCart,
    setOrderNotes,
    clearCart,
  } = useCart();
  const { showToast } = useToast();
  const [copiedSummary, setCopiedSummary] = useState(false);

  if (!isOpen) return null;

  const { items, orderNotes } = getCart(restaurant.id);
  const totalFC = items.reduce((sum, c) => sum + c.item.priceFC * c.quantity, 0);

  const buildOrderSummaryText = () => {
    const lines = [
      `${restaurant.name} — SMARTMENU QR`,
      '--------------------------------',
      ...items.map((c) => {
        const noteStr = c.note ? ` [${c.note}]` : '';
        return `${c.quantity}x ${pick(c.item.name)} — ${formatFC(c.item.priceFC * c.quantity)}${noteStr}`;
      }),
      '--------------------------------',
      `${t.cart.totalLabel}: ${formatFC(totalFC)}`,
    ];
    if (orderNotes.trim()) {
      lines.push(`${t.cart.orderNotesLabel}: ${orderNotes.trim()}`);
    }
    return lines.join('\n');
  };

  const handleCopySummary = async () => {
    try {
      await navigator.clipboard.writeText(buildOrderSummaryText());
      setCopiedSummary(true);
      showToast(t.cart.summaryCopied, 'info');
      window.setTimeout(() => setCopiedSummary(false), 2500);
    } catch {
      showToast(t.cart.summaryCopied, 'info');
    }
  };

  return (
    <div
      className="fixed inset-0 z-50 flex justify-end bg-black/75 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="cart-drawer-title"
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        className="w-full max-w-md bg-[#111115] border-l border-zinc-800 h-full flex flex-col shadow-2xl"
      >
        {/* Header */}
        <div className="px-5 py-4 border-b border-zinc-800 flex items-center justify-between gap-4">
          <div className="flex items-center gap-2.5">
            <ShoppingBag className="w-5 h-5 text-orange-400" aria-hidden="true" />
            <div>
              <h2 id="cart-drawer-title" className="font-display text-2xl font-bold text-white">
                {t.cart.title}
              </h2>
              <p className="text-xs text-zinc-400">{restaurant.name}</p>
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label={t.menu.close}
            className="min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-400 hover:text-white hover:bg-zinc-800 cursor-pointer"
          >
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Cart Items */}
        <div className="flex-1 overflow-y-auto p-5 space-y-4">
          {items.length === 0 ? (
            <div className="text-center py-16 px-4">
              <ShoppingBag className="w-10 h-10 text-zinc-600 mx-auto mb-3" aria-hidden="true" />
              <h3 className="text-lg font-semibold text-white">{t.cart.emptyTitle}</h3>
              <p className="mt-1.5 text-sm text-zinc-400">{t.cart.emptyBody}</p>
            </div>
          ) : (
            <>
              <div className="space-y-3">
                {items.map(({ item, quantity, note }) => (
                  <div
                    key={item.id}
                    className="rounded-xl bg-[#18181D] border border-zinc-800 p-3.5 space-y-3"
                  >
                    <div className="flex items-start gap-3">
                      <div className="w-16 h-12 rounded-lg overflow-hidden bg-zinc-900 shrink-0">
                        <CulinaryImage
                          src={item.image}
                          alt={pick(item.name)}
                          variant="thumb"
                          width={64}
                          height={48}
                          showEmptyText={false}
                        />
                      </div>
                      <div className="flex-1 min-w-0">
                        <div className="flex items-start justify-between gap-2">
                          <h3 className="text-sm font-semibold text-white leading-snug">
                            {pick(item.name)}
                          </h3>
                          <button
                            type="button"
                            onClick={() => removeFromCart(restaurant.id, item.id)}
                            aria-label={t.cart.remove}
                            className="text-zinc-500 hover:text-red-400 p-1 cursor-pointer"
                          >
                            <Trash2 className="w-4 h-4" />
                          </button>
                        </div>
                        <p className="mt-1 font-mono text-xs font-semibold text-orange-400 tabular-nums">
                          {formatFC(item.priceFC * quantity)}
                        </p>
                      </div>
                    </div>

                    <div className="flex items-center justify-between gap-3">
                      <div className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800">
                        <button
                          type="button"
                          onClick={() => updateQuantity(restaurant.id, item.id, -1)}
                          aria-label="Diminuer la quantité"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
                        >
                          <Minus className="w-3.5 h-3.5" />
                        </button>
                        <span className="px-3 font-mono text-sm font-semibold text-white tabular-nums">
                          {quantity}
                        </span>
                        <button
                          type="button"
                          onClick={() => updateQuantity(restaurant.id, item.id, 1)}
                          aria-label="Augmenter la quantité"
                          className="min-h-[38px] min-w-[38px] flex items-center justify-center text-zinc-300 hover:text-white cursor-pointer"
                        >
                          <Plus className="w-3.5 h-3.5" />
                        </button>
                      </div>

                      <input
                        type="text"
                        value={note || ''}
                        onChange={(e) => updateItemNote(restaurant.id, item.id, e.target.value)}
                        placeholder={t.menu.itemNotePlaceholder}
                        className="flex-1 min-w-0 min-h-[38px] px-2.5 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-zinc-200 placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                      />
                    </div>
                  </div>
                ))}
              </div>

              {/* General Order Remarks */}
              <div className="pt-3 border-t border-zinc-800/80">
                <label
                  htmlFor="order-remarks"
                  className="block text-xs font-semibold text-zinc-300 mb-1.5"
                >
                  {t.cart.orderNotesLabel}
                </label>
                <textarea
                  id="order-remarks"
                  rows={2}
                  value={orderNotes}
                  onChange={(e) => setOrderNotes(restaurant.id, e.target.value)}
                  placeholder={t.cart.orderNotesPlaceholder}
                  className="w-full p-3 rounded-xl bg-[#18181D] border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>

              {/* Honest No-Live-Receiver Notice */}
              <div className="rounded-xl bg-zinc-900/90 border border-orange-500/35 p-3.5 flex items-start gap-2.5 text-xs text-zinc-300 leading-relaxed">
                <Info className="w-4 h-4 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <p className="font-semibold text-orange-300">{t.cart.demoWarningTitle}</p>
                  <p className="mt-0.5 text-zinc-400">{t.cart.demoWarningBody}</p>
                </div>
              </div>
            </>
          )}
        </div>

        {/* Footer */}
        {items.length > 0 && (
          <div className="p-5 border-t border-zinc-800 bg-[#0D0D10] space-y-3">
            <div className="flex items-center justify-between">
              <span className="text-sm font-medium text-zinc-300">{t.cart.totalLabel}</span>
              <span className="font-mono text-2xl font-bold text-orange-400 tabular-nums">
                {formatFC(totalFC)}
              </span>
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <button
                type="button"
                onClick={() => clearCart(restaurant.id)}
                className="min-h-[44px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs sm:text-sm font-medium text-zinc-300 cursor-pointer"
              >
                {t.cart.clearCart}
              </button>

              <button
                type="button"
                onClick={handleCopySummary}
                style={{ backgroundColor: restaurant.primaryColor || '#DC2626' }}
                className="inline-flex items-center justify-center gap-2 min-h-[44px] px-3 rounded-lg text-xs sm:text-sm font-semibold text-white hover:opacity-90 transition-opacity cursor-pointer"
              >
                {copiedSummary ? (
                  <>
                    <Check className="w-4 h-4" aria-hidden="true" />
                    <span>{t.cart.summaryCopied}</span>
                  </>
                ) : (
                  <>
                    <Copy className="w-4 h-4" aria-hidden="true" />
                    <span>{t.cart.copySummary}</span>
                  </>
                )}
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

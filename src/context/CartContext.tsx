import React, { createContext, useContext, useEffect, useState } from 'react';
import { CartItem, MenuItem } from '../types/menu';

const CART_STORAGE_KEY = 'smartmenu_qr_carts_v1';

interface StoredCartData {
  items: CartItem[];
  orderNotes: string;
}

type CartMap = Record<string, StoredCartData>;

interface CartContextValue {
  getCart: (restaurantId: string) => StoredCartData;
  addToCart: (restaurantId: string, item: MenuItem, quantity?: number, note?: string) => void;
  updateQuantity: (restaurantId: string, itemId: string, delta: number) => void;
  updateItemNote: (restaurantId: string, itemId: string, note: string) => void;
  removeFromCart: (restaurantId: string, itemId: string) => void;
  setOrderNotes: (restaurantId: string, notes: string) => void;
  clearCart: (restaurantId: string) => void;
}

const CartContext = createContext<CartContextValue | undefined>(undefined);

function loadInitialCarts(): CartMap {
  if (typeof window === 'undefined') return {};
  try {
    const raw = window.localStorage.getItem(CART_STORAGE_KEY);
    if (raw) return JSON.parse(raw) as CartMap;
  } catch {
    // Ignore storage read issues
  }
  return {};
}

export const CartProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [carts, setCarts] = useState<CartMap>(loadInitialCarts);

  useEffect(() => {
    try {
      window.localStorage.setItem(CART_STORAGE_KEY, JSON.stringify(carts));
    } catch {
      // Ignore storage quota issues
    }
  }, [carts]);

  const getCart = (restaurantId: string): StoredCartData =>
    carts[restaurantId] ?? { items: [], orderNotes: '' };

  const addToCart = (
    restaurantId: string,
    item: MenuItem,
    quantity = 1,
    note?: string
  ) => {
    setCarts((prev) => {
      const current = prev[restaurantId] ?? { items: [], orderNotes: '' };
      const existingIndex = current.items.findIndex((c) => c.item.id === item.id);
      let nextItems: CartItem[];
      if (existingIndex >= 0) {
        nextItems = current.items.map((c, idx) =>
          idx === existingIndex
            ? {
                ...c,
                quantity: c.quantity + quantity,
                note: note !== undefined && note.trim() ? note.trim() : c.note,
              }
            : c
        );
      } else {
        nextItems = [
          ...current.items,
          { item, quantity, note: note?.trim() ? note.trim() : undefined },
        ];
      }
      return {
        ...prev,
        [restaurantId]: { ...current, items: nextItems },
      };
    });
  };

  const updateQuantity = (restaurantId: string, itemId: string, delta: number) => {
    setCarts((prev) => {
      const current = prev[restaurantId] ?? { items: [], orderNotes: '' };
      const nextItems = current.items
        .map((c) => (c.item.id === itemId ? { ...c, quantity: c.quantity + delta } : c))
        .filter((c) => c.quantity > 0);
      return {
        ...prev,
        [restaurantId]: { ...current, items: nextItems },
      };
    });
  };

  const updateItemNote = (restaurantId: string, itemId: string, note: string) => {
    setCarts((prev) => {
      const current = prev[restaurantId] ?? { items: [], orderNotes: '' };
      const nextItems = current.items.map((c) =>
        c.item.id === itemId ? { ...c, note } : c
      );
      return {
        ...prev,
        [restaurantId]: { ...current, items: nextItems },
      };
    });
  };

  const removeFromCart = (restaurantId: string, itemId: string) => {
    setCarts((prev) => {
      const current = prev[restaurantId] ?? { items: [], orderNotes: '' };
      return {
        ...prev,
        [restaurantId]: {
          ...current,
          items: current.items.filter((c) => c.item.id !== itemId),
        },
      };
    });
  };

  const setOrderNotes = (restaurantId: string, orderNotes: string) => {
    setCarts((prev) => {
      const current = prev[restaurantId] ?? { items: [], orderNotes: '' };
      return {
        ...prev,
        [restaurantId]: { ...current, orderNotes },
      };
    });
  };

  const clearCart = (restaurantId: string) => {
    setCarts((prev) => ({
      ...prev,
      [restaurantId]: { items: [], orderNotes: '' },
    }));
  };

  return (
    <CartContext.Provider
      value={{
        getCart,
        addToCart,
        updateQuantity,
        updateItemNote,
        removeFromCart,
        setOrderNotes,
        clearCart,
      }}
    >
      {children}
    </CartContext.Provider>
  );
};

export function useCart(): CartContextValue {
  const ctx = useContext(CartContext);
  if (!ctx) {
    throw new Error('useCart must be used within CartProvider');
  }
  return ctx;
}

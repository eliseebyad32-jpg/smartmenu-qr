import React, { useEffect, useRef, useState } from 'react';
import {
  Ban,
  CheckCircle2,
  ExternalLink,
  Pencil,
  Plus,
  QrCode,
  ShieldAlert,
  Store,
  UserPlus,
  Users,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { MenuItem, PlatformUser, Restaurant } from '../../types/menu';

interface AdminDashboardProps {
  restaurants: Restaurant[];
  menuItems: MenuItem[];
  users: PlatformUser[];
  onAddRestaurant: (payload: {
    name: string;
    city: string;
    phone: string;
    addressFr: string;
    addressEn: string;
    ownerName: string;
    ownerEmail: string;
    ownerPassword: string;
  }) => Promise<boolean> | boolean | void;
  onUpdateRestaurant: (restaurant: Restaurant) => void;
  onToggleRestaurantStatus: (restaurantId: string) => void;
  onCreateOwnerAccount: (payload: {
    name: string;
    email: string;
    password: string;
    restaurantId: string;
  }) => Promise<boolean> | boolean | void;
  onToggleUserActive: (userId: string) => void;
  onManageRestaurant: (restaurantId: string) => void;
  onOpenQr: (restaurant: Restaurant) => void;
  onOpenCustomerMenu: (restaurantId: string) => void;
}

export const AdminDashboard: React.FC<AdminDashboardProps> = ({
  restaurants,
  menuItems,
  users,
  onAddRestaurant,
  onUpdateRestaurant,
  onToggleRestaurantStatus,
  onCreateOwnerAccount,
  onToggleUserActive,
  onManageRestaurant,
  onOpenQr,
  onOpenCustomerMenu,
}) => {
  const { t, formatFC, pick } = useLanguage();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'restaurants' | 'accounts'>('restaurants');
  const [showAddRest, setShowAddRest] = useState(false);
  const [editingRest, setEditingRest] = useState<Restaurant | null>(null);

  // Add Restaurant form state
  const [rName, setRName] = useState('');
  const [rCity, setRCity] = useState('');
  const [rPhone, setRPhone] = useState('+243 ');
  const [rAddrFr, setRAddrFr] = useState('');
  const [rAddrEn, setRAddrEn] = useState('');
  const [oName, setOName] = useState('');
  const [oEmail, setOEmail] = useState('');
  const [oPass, setOPass] = useState('Demo2026!');

  // Add Owner Account form state
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerPass, setNewOwnerPass] = useState('Demo2026!');
  const [newOwnerRestId, setNewOwnerRestId] = useState(restaurants[0]?.id ?? '');
  const accountsSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (restaurants.length > 0 && !restaurants.some((r) => r.id === newOwnerRestId)) {
      setNewOwnerRestId(restaurants[0].id);
    }
  }, [restaurants, newOwnerRestId]);

  const openAccountsTab = (scrollIntoView = false) => {
    setTab('accounts');
    setShowAddRest(false);
    if (scrollIntoView) {
      window.requestAnimationFrame(() => {
        accountsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      });
    }
  };

  const activeRestaurantsCount = restaurants.filter((r) => r.isActive).length;
  const suspendedRestaurantsCount = restaurants.length - activeRestaurantsCount;
  const ownerAccounts = users.filter((u) => u.role === 'restaurateur');
  const avgPriceFC =
    menuItems.length > 0
      ? Math.round(menuItems.reduce((sum, i) => sum + i.priceFC, 0) / menuItems.length)
      : 0;

  const handleCreateRest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rName.trim() || !rCity.trim() || !oEmail.trim() || oPass.length < 6) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    const ok = await onAddRestaurant({
      name: rName.trim(),
      city: rCity.trim(),
      phone: rPhone.trim() || '+243 990 000 000',
      addressFr: rAddrFr.trim() || `${rCity.trim()}, RDC`,
      addressEn: rAddrEn.trim() || `${rCity.trim()}, DRC`,
      ownerName: oName.trim() || `Gérant ${rName.trim()}`,
      ownerEmail: oEmail.trim(),
      ownerPassword: oPass,
    });
    if (ok === false) return;
    setRName('');
    setRCity('');
    setRAddrFr('');
    setRAddrEn('');
    setOName('');
    setOEmail('');
    setShowAddRest(false);
    showToast(t.toast.restaurantAdded);
  };

  const handleSaveRestEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRest) return;
    onUpdateRestaurant(editingRest);
    setEditingRest(null);
    showToast(t.toast.restaurantUpdated);
  };

  const handleCreateOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!newOwnerName.trim() || !newOwnerEmail.trim() || !newOwnerRestId || newOwnerPass.length < 6) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    const ok = await onCreateOwnerAccount({
      name: newOwnerName.trim(),
      email: newOwnerEmail.trim(),
      password: newOwnerPass || 'Demo2026!',
      restaurantId: newOwnerRestId,
    });
    if (ok === false) return;
    setNewOwnerName('');
    setNewOwnerEmail('');
    setShowAddOwner(false);
    showToast(t.toast.accountCreated);
  };

  return (
    <div className="space-y-8">
      {/* General Platform Statistics */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <button
          type="button"
          onClick={() => {
            setTab('restaurants');
            setShowAddOwner(false);
          }}
          className={`rounded-2xl bg-[#141418] border p-5 text-left transition-colors cursor-pointer ${
            tab === 'restaurants'
              ? 'border-zinc-700 hover:border-orange-500/60'
              : 'border-zinc-800 hover:border-zinc-700'
          }`}
        >
          <p className="text-xs text-zinc-400">{t.pro.statsRestaurants}</p>
          <p className="mt-2 font-display text-3xl sm:text-4xl font-bold text-white tabular-nums">
            {restaurants.length}
          </p>
          <p className="mt-1 text-xs text-zinc-400 tabular-nums">
            {activeRestaurantsCount} {t.pro.statsActive} · {suspendedRestaurantsCount}{' '}
            {t.pro.statsSuspended}
          </p>
        </button>

        <button
          type="button"
          onClick={() => openAccountsTab(true)}
          className={`rounded-2xl bg-[#141418] border p-5 text-left transition-colors cursor-pointer ${
            tab === 'accounts'
              ? 'border-orange-500/60'
              : 'border-zinc-800 hover:border-orange-500/50'
          }`}
        >
          <p className="text-xs text-zinc-400">{t.pro.statsAccounts}</p>
          <p className="mt-2 font-display text-3xl sm:text-4xl font-bold text-white tabular-nums">
            {ownerAccounts.length}
          </p>
          <p className="mt-1 text-xs text-zinc-400">
            {ownerAccounts.filter((u) => u.isActive).length} {t.pro.statusActive}
          </p>
        </button>

        <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-5">
          <p className="text-xs text-zinc-400">{t.pro.statsProducts}</p>
          <p className="mt-2 font-display text-3xl sm:text-4xl font-bold text-white tabular-nums">
            {menuItems.length}
          </p>
          <p className="mt-1 text-xs text-zinc-400 tabular-nums">
            {menuItems.filter((i) => i.isAvailable).length} {t.menu.available}
          </p>
        </div>

        <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-5">
          <p className="text-xs text-zinc-400">{t.pro.statsAvgPrice}</p>
          <p className="mt-2 font-mono text-2xl sm:text-3xl font-bold text-orange-400 tabular-nums">
            {formatFC(avgPriceFC)}
          </p>
          <p className="mt-1 text-xs text-zinc-400">CDF / FC</p>
        </div>
      </div>

      {/* Admin Sub-tabs */}
      <div className="flex flex-wrap items-center justify-between gap-4 border-b border-zinc-800 pb-4">
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => setTab('restaurants')}
            className={`inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl text-sm font-medium cursor-pointer ${
              tab === 'restaurants'
                ? 'bg-red-600 text-white'
                : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white'
            }`}
          >
            <Store className="w-4 h-4" aria-hidden="true" />
            <span>{t.pro.tabRestaurants}</span>
          </button>

          <button
            type="button"
            onClick={() => openAccountsTab(false)}
            className={`inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl text-sm font-medium cursor-pointer ${
              tab === 'accounts'
                ? 'bg-red-600 text-white'
                : 'bg-[#141418] border border-zinc-800 text-zinc-300 hover:text-white'
            }`}
          >
            <Users className="w-4 h-4" aria-hidden="true" />
            <span>{t.pro.tabAccounts}</span>
          </button>
        </div>

        {tab === 'restaurants' ? (
          <button
            type="button"
            onClick={() => setShowAddRest((p) => !p)}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-sm font-semibold text-white cursor-pointer"
          >
            <Plus className="w-4 h-4" aria-hidden="true" />
            <span>{t.pro.addRestaurant}</span>
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setShowAddOwner((p) => !p)}
            className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-sm font-semibold text-white cursor-pointer"
          >
            <UserPlus className="w-4 h-4" aria-hidden="true" />
            <span>{t.pro.createOwnerTitle}</span>
          </button>
        )}
      </div>

      {tab === 'restaurants' && (
        <div className="space-y-6">
          {/* Create Restaurant Form */}
          {showAddRest && (
            <form
              onSubmit={handleCreateRest}
              className="rounded-2xl bg-[#141418] border border-orange-500/40 p-6 space-y-4"
            >
              <h3 className="font-display text-2xl font-bold text-white">{t.pro.addRestaurant}</h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                <input
                  type="text"
                  required
                  value={rName}
                  onChange={(e) => setRName(e.target.value)}
                  placeholder={t.pro.restaurantName}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  required
                  value={rCity}
                  onChange={(e) => setRCity(e.target.value)}
                  placeholder={t.pro.restaurantCity}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  value={rPhone}
                  onChange={(e) => setRPhone(e.target.value)}
                  placeholder={t.pro.restaurantPhone}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  value={rAddrFr}
                  onChange={(e) => setRAddrFr(e.target.value)}
                  placeholder={t.pro.restaurantAddressFr}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  value={rAddrEn}
                  onChange={(e) => setRAddrEn(e.target.value)}
                  placeholder={t.pro.restaurantAddressEn}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  value={oName}
                  onChange={(e) => setOName(e.target.value)}
                  placeholder={t.pro.ownerName}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="email"
                  required
                  value={oEmail}
                  onChange={(e) => setOEmail(e.target.value)}
                  placeholder={t.pro.ownerEmail}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  required
                  value={oPass}
                  onChange={(e) => setOPass(e.target.value)}
                  placeholder={t.pro.ownerPassword}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddRest(false)}
                  className="min-h-[40px] px-4 rounded-lg bg-zinc-800 text-sm text-zinc-200 cursor-pointer"
                >
                  {t.pro.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-5 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
                >
                  {t.pro.createRestaurant}
                </button>
              </div>
            </form>
          )}

          {/* Edit Restaurant Form */}
          {editingRest && (
            <form
              onSubmit={handleSaveRestEdit}
              className="rounded-2xl bg-[#141418] border border-orange-500/40 p-6 space-y-4"
            >
              <h3 className="font-display text-2xl font-bold text-white">
                {t.pro.editRestaurant} — {editingRest.name}
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">{t.pro.restaurantName}</label>
                  <input
                    type="text"
                    required
                    value={editingRest.name}
                    onChange={(e) => setEditingRest({ ...editingRest, name: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">{t.pro.restaurantCity}</label>
                  <input
                    type="text"
                    required
                    value={editingRest.city}
                    onChange={(e) => setEditingRest({ ...editingRest, city: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantAddressFr}
                  </label>
                  <input
                    type="text"
                    value={editingRest.address.fr}
                    onChange={(e) =>
                      setEditingRest({
                        ...editingRest,
                        address: { ...editingRest.address, fr: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantAddressEn}
                  </label>
                  <input
                    type="text"
                    value={editingRest.address.en}
                    onChange={(e) =>
                      setEditingRest({
                        ...editingRest,
                        address: { ...editingRest.address, en: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantTaglineFr}
                  </label>
                  <input
                    type="text"
                    value={editingRest.tagline.fr}
                    onChange={(e) =>
                      setEditingRest({
                        ...editingRest,
                        tagline: { ...editingRest.tagline, fr: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantTaglineEn}
                  </label>
                  <input
                    type="text"
                    value={editingRest.tagline.en}
                    onChange={(e) =>
                      setEditingRest({
                        ...editingRest,
                        tagline: { ...editingRest.tagline, en: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
              </div>
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setEditingRest(null)}
                  className="min-h-[40px] px-4 rounded-lg bg-zinc-800 text-sm text-zinc-200 cursor-pointer"
                >
                  {t.pro.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-5 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
                >
                  {t.pro.saveRestaurant}
                </button>
              </div>
            </form>
          )}

          {/* Restaurants List */}
          <div className="grid grid-cols-1 md:grid-cols-2 gap-5">
            {restaurants.map((rest) => {
              const count = menuItems.filter((m) => m.restaurantId === rest.id).length;
              const owner = users.find((u) => u.id === rest.ownerId);
              return (
                <div
                  key={rest.id}
                  className="rounded-2xl bg-[#141418] border border-zinc-800 p-5 flex flex-col justify-between gap-4"
                >
                  <div>
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-center gap-3 min-w-0">
                        {rest.logoUrl ? (
                          <img
                            src={rest.logoUrl}
                            alt={rest.name}
                            className="w-11 h-11 rounded-xl object-cover border border-zinc-700 shrink-0"
                          />
                        ) : (
                          <div
                            style={{ backgroundColor: rest.primaryColor || '#DC2626' }}
                            className="w-11 h-11 rounded-xl flex items-center justify-center font-display text-xl font-bold text-white shrink-0"
                          >
                            {rest.name.charAt(0)}
                          </div>
                        )}
                        <div className="min-w-0">
                          <h3 className="text-lg font-bold text-white truncate">{rest.name}</h3>
                          <p className="text-xs text-zinc-400 truncate">
                            {rest.city}, {pick(rest.country)} · {count} {t.hero.statDishes}
                          </p>
                        </div>
                      </div>

                      <span
                        className={`inline-flex items-center gap-1 text-xs font-medium shrink-0 ${
                          rest.isActive ? 'text-emerald-400' : 'text-red-400'
                        }`}
                      >
                        {rest.isActive ? (
                          <>
                            <CheckCircle2 className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{t.pro.statusActive}</span>
                          </>
                        ) : (
                          <>
                            <ShieldAlert className="w-3.5 h-3.5" aria-hidden="true" />
                            <span>{t.pro.statusSuspended}</span>
                          </>
                        )}
                      </span>
                    </div>

                    {owner && (
                      <p className="mt-3 text-xs text-zinc-400 font-mono truncate">
                        {owner.name} · {owner.email}
                      </p>
                    )}
                  </div>

                  <div className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center gap-2">
                    <button
                      type="button"
                      onClick={() => onManageRestaurant(rest.id)}
                      className="min-h-[38px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white cursor-pointer"
                    >
                      {t.pro.tabProducts}
                    </button>

                    <button
                      type="button"
                      onClick={() => setEditingRest(rest)}
                      aria-label={t.pro.editRestaurant}
                      className="min-h-[38px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-300 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Pencil className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.pro.editRestaurant}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => {
                        onToggleRestaurantStatus(rest.id);
                        showToast(t.toast.restaurantStatusChanged);
                      }}
                      className={`min-h-[38px] px-3 rounded-lg border text-xs font-medium inline-flex items-center gap-1.5 cursor-pointer ${
                        rest.isActive
                          ? 'bg-red-950/30 border-red-700/50 text-red-300 hover:bg-red-950/60'
                          : 'bg-emerald-950/30 border-emerald-700/50 text-emerald-300 hover:bg-emerald-950/60'
                      }`}
                    >
                      <Ban className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{rest.isActive ? t.pro.suspendBtn : t.pro.reactivateBtn}</span>
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenQr(rest)}
                      aria-label={t.hero.ctaQr}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-orange-400 cursor-pointer"
                    >
                      <QrCode className="w-4 h-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() => onOpenCustomerMenu(rest.id)}
                      aria-label={t.pro.viewCustomerMenu}
                      className="min-h-[38px] min-w-[38px] flex items-center justify-center rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-zinc-300 cursor-pointer"
                    >
                      <ExternalLink className="w-4 h-4" />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        </div>
      )}

      {tab === 'accounts' && (
        <div ref={accountsSectionRef} className="space-y-6">
          {showAddOwner && (
            <form
              onSubmit={handleCreateOwner}
              className="rounded-2xl bg-[#141418] border border-orange-500/40 p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 items-end"
            >
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.ownerName}</label>
                <input
                  type="text"
                  required
                  value={newOwnerName}
                  onChange={(e) => setNewOwnerName(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.ownerEmail}</label>
                <input
                  type="email"
                  required
                  value={newOwnerEmail}
                  onChange={(e) => setNewOwnerEmail(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.ownerPassword}</label>
                <input
                  type="text"
                  required
                  value={newOwnerPass}
                  onChange={(e) => setNewOwnerPass(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.assignedVenue}</label>
                <select
                  value={newOwnerRestId}
                  onChange={(e) => setNewOwnerRestId(e.target.value)}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                >
                  {restaurants.map((r) => (
                    <option key={r.id} value={r.id}>
                      {r.name}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2 lg:col-span-4 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setShowAddOwner(false)}
                  className="min-h-[40px] px-4 rounded-lg bg-zinc-800 text-sm text-zinc-200 cursor-pointer"
                >
                  {t.pro.cancel}
                </button>
                <button
                  type="submit"
                  className="min-h-[40px] px-5 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
                >
                  {t.pro.createOwnerBtn}
                </button>
              </div>
            </form>
          )}

          {ownerAccounts.length === 0 ? (
            <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-8 text-center space-y-3">
              <Users className="w-8 h-8 text-orange-400 mx-auto" aria-hidden="true" />
              <h3 className="text-base font-semibold text-white">{t.pro.noAccountsTitle}</h3>
              <p className="text-sm text-zinc-400 max-w-md mx-auto">{t.pro.noAccountsBody}</p>
              {!showAddOwner && (
                <button
                  type="button"
                  onClick={() => setShowAddOwner(true)}
                  className="inline-flex items-center gap-2 min-h-[42px] px-4 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 text-sm font-semibold text-white cursor-pointer"
                >
                  <UserPlus className="w-4 h-4" aria-hidden="true" />
                  <span>{t.pro.createOwnerTitle}</span>
                </button>
              )}
            </div>
          ) : (
            <div className="rounded-2xl bg-[#141418] border border-zinc-800 divide-y divide-zinc-800">
              {ownerAccounts.map((acc) => {
                const assigned = restaurants.find((r) => r.id === acc.assignedRestaurantId);
                return (
                  <div
                    key={acc.id}
                    className="p-4 sm:p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4"
                  >
                    <div>
                      <p className="text-sm font-semibold text-white">{acc.name}</p>
                      <p className="text-xs font-mono text-zinc-400 mt-0.5">
                        {acc.email} · {assigned ? assigned.name : '—'}
                      </p>
                    </div>

                    <button
                      type="button"
                      onClick={() => {
                        onToggleUserActive(acc.id);
                        showToast(t.toast.accountToggled);
                      }}
                      className={`min-h-[38px] px-3.5 rounded-lg border text-xs font-medium cursor-pointer ${
                        acc.isActive
                          ? 'bg-emerald-500/10 border-emerald-500/30 text-emerald-400'
                          : 'bg-red-500/10 border-red-500/30 text-red-300'
                      }`}
                    >
                      {acc.isActive ? t.pro.statusActive : t.pro.statusSuspended}
                    </button>
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}
    </div>
  );
};

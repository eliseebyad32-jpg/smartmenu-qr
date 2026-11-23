import React, { useEffect, useRef, useState } from 'react';
import {
  Ban,
  Check,
  CheckCircle2,
  Copy,
  Dices,
  ExternalLink,
  ImagePlus,
  KeyRound,
  Pencil,
  Plus,
  QrCode,
  ShieldAlert,
  Store,
  Trash2,
  UserPlus,
  Users,
  X,
} from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { isSupabaseConfigured } from '../../services/supabaseClient';
import { uploadAssetToSupabaseStorage } from '../../services/supabaseData';
import { uploadAssetToLocalServer } from '../../services/syncService';
import { MenuItem, PlatformUser, Restaurant } from '../../types/menu';
import { readAndOptimizeImageBlob } from '../../utils/imageUpload';

const COLOR_SWATCHES = ['#DC2626', '#EA580C', '#E11D48', '#D97706', '#059669', '#2563EB'];

function generateTemporaryPassword(length = 10): string {
  const charset = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
  const bytes = new Uint8Array(length);
  if (typeof window !== 'undefined' && window.crypto?.getRandomValues) {
    window.crypto.getRandomValues(bytes);
  } else {
    for (let i = 0; i < length; i += 1) {
      bytes[i] = Math.floor(Math.random() * 256);
    }
  }
  let out = '';
  for (let i = 0; i < length; i += 1) {
    out += charset[bytes[i] % charset.length];
  }
  return out;
}

const NEW_RESTAURANT_OPTION = '__NEW__';

interface CreatedCredentialsSummary {
  ownerName: string;
  restaurantName: string;
  email: string;
  username: string;
  password: string;
  isActive: boolean;
}

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
    ownerEmail?: string;
    ownerUsername: string;
    ownerPassword: string;
  }) => Promise<boolean> | boolean | void;
  onUpdateRestaurant: (restaurant: Restaurant) => void;
  onToggleRestaurantStatus: (restaurantId: string) => void;
  onDeleteRestaurant: (restaurantId: string) => Promise<boolean> | boolean | void;
  onCreateOwnerAccount: (payload: {
    name: string;
    email?: string;
    username: string;
    password: string;
    restaurantId: string;
  }) => Promise<boolean> | boolean | void;
  onUpdateOwnerProfile: (payload: {
    userId: string;
    username: string;
    name: string;
    email?: string;
    restaurantId: string | null;
  }) => Promise<PlatformUser | null>;
  onToggleUserActive: (userId: string) => void;
  onReassignOwner: (userId: string, restaurantId: string | null) => Promise<boolean> | boolean | void;
  onResetUserPassword: (userId: string, newPassword: string) => Promise<boolean>;
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
  onDeleteRestaurant,
  onCreateOwnerAccount,
  onUpdateOwnerProfile,
  onToggleUserActive,
  onReassignOwner,
  onResetUserPassword,
  onManageRestaurant,
  onOpenQr,
  onOpenCustomerMenu,
}) => {
  const { t, formatFC, pick } = useLanguage();
  const { showToast } = useToast();

  const [tab, setTab] = useState<'restaurants' | 'accounts'>('restaurants');
  const [showAddRest, setShowAddRest] = useState(false);
  const [editingRest, setEditingRest] = useState<Restaurant | null>(null);
  const [pendingDeleteRest, setPendingDeleteRest] = useState<Restaurant | null>(null);
  const [uploadingLogo, setUploadingLogo] = useState(false);

  // Add Restaurant form state
  const [rName, setRName] = useState('');
  const [rCity, setRCity] = useState('');
  const [rPhone, setRPhone] = useState('+243 ');
  const [rAddrFr, setRAddrFr] = useState('');
  const [rAddrEn, setRAddrEn] = useState('');
  const [oName, setOName] = useState('');
  const [oEmail, setOEmail] = useState('');
  const [oUsername, setOUsername] = useState('');
  const [oPass, setOPass] = useState('');

  // Add Owner Account form state
  const [showAddOwner, setShowAddOwner] = useState(false);
  const [newOwnerName, setNewOwnerName] = useState('');
  const [newOwnerEmail, setNewOwnerEmail] = useState('');
  const [newOwnerUsername, setNewOwnerUsername] = useState('');
  const [newOwnerPass, setNewOwnerPass] = useState('');
  const [newOwnerRestId, setNewOwnerRestId] = useState(
    restaurants[0]?.id ?? NEW_RESTAURANT_OPTION
  );
  const [newOwnerRestName, setNewOwnerRestName] = useState('');
  const [newOwnerRestCity, setNewOwnerRestCity] = useState('Lubumbashi');

  // Inline edit owner profile state
  const [editingUserId, setEditingUserId] = useState<string | null>(null);
  const [editUserName, setEditUserName] = useState('');
  const [editUserEmail, setEditUserEmail] = useState('');
  const [editUserUsername, setEditUserUsername] = useState('');
  const [editUserRestId, setEditUserRestId] = useState<string>('');
  const [editUserBusy, setEditUserBusy] = useState(false);

  // Password reset state per restaurateur account
  const [resetTargetUserId, setResetTargetUserId] = useState<string | null>(null);
  const [resetNewPass, setResetNewPass] = useState('');
  const [resetBusy, setResetBusy] = useState(false);

  // One-time credentials display modal state (held strictly in JS memory, cleared on close)
  const [credentialsSummary, setCredentialsSummary] = useState<CreatedCredentialsSummary | null>(
    null
  );
  const [copiedCreds, setCopiedCreds] = useState(false);

  const accountsSectionRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (
      newOwnerRestId !== NEW_RESTAURANT_OPTION &&
      restaurants.length > 0 &&
      !restaurants.some((r) => r.id === newOwnerRestId)
    ) {
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
  const unassignedRestaurants = restaurants.filter(
    (r) => !ownerAccounts.some((u) => u.assignedRestaurantId === r.id && u.isActive)
  );
  const avgPriceFC =
    menuItems.length > 0
      ? Math.round(menuItems.reduce((sum, i) => sum + i.priceFC, 0) / menuItems.length)
      : 0;

  const startCreateOwnerForRestaurant = (rest: Restaurant) => {
    const suggestedSlug = rest.slug || rest.id || 'restaurant';
    setTab('accounts');
    setShowAddOwner(true);
    setNewOwnerRestId(rest.id);
    setNewOwnerName(`Gérant ${rest.name}`);
    setNewOwnerUsername(suggestedSlug);
    setNewOwnerEmail('');
    setNewOwnerPass(generateTemporaryPassword());
    window.requestAnimationFrame(() => {
      accountsSectionRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
    });
  };

  const handleCreateRest = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!rName.trim() || !rCity.trim() || oUsername.trim().length < 2 || oPass.length < 4) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    const createdRestName = rName.trim();
    const createdOwnerName = oName.trim() || `Gérant ${createdRestName}`;
    const createdEmail = oEmail.trim();
    const createdUsername = oUsername.trim().toLowerCase();
    const createdPassword = oPass;

    if (createdEmail && !createdEmail.includes('@')) {
      showToast(t.toast.validationError, 'error');
      return;
    }

    const ok = await onAddRestaurant({
      name: createdRestName,
      city: rCity.trim(),
      phone: rPhone.trim() || '+243 990 000 000',
      addressFr: rAddrFr.trim() || `${rCity.trim()}, RDC`,
      addressEn: rAddrEn.trim() || `${rCity.trim()}, DRC`,
      ownerName: createdOwnerName,
      ownerEmail: createdEmail || undefined,
      ownerUsername: createdUsername,
      ownerPassword: createdPassword,
    });
    if (ok === false) return;
    setRName('');
    setRCity('');
    setRAddrFr('');
    setRAddrEn('');
    setOName('');
    setOEmail('');
    setOUsername('');
    setOPass('');
    setShowAddRest(false);
    setCopiedCreds(false);
    setCredentialsSummary({
      ownerName: createdOwnerName,
      restaurantName: createdRestName,
      email: createdEmail,
      username: createdUsername,
      password: createdPassword,
      isActive: true,
    });
    showToast(t.toast.restaurantAdded);
  };

  const handleSaveRestEdit = (e: React.FormEvent) => {
    e.preventDefault();
    if (!editingRest) return;
    onUpdateRestaurant(editingRest);
    setEditingRest(null);
    showToast(t.toast.restaurantUpdated);
  };

  const handleEditLogoFile = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file || !editingRest) return;
    setUploadingLogo(true);
    try {
      const optimized = await readAndOptimizeImageBlob(file, 400);
      if (isSupabaseConfigured() && navigator.onLine) {
        try {
          const publicUrl = await uploadAssetToSupabaseStorage(
            editingRest.id,
            'logos',
            `logo.${optimized.extension}`,
            optimized.blob,
            optimized.contentType
          );
          setEditingRest((prev) => (prev ? { ...prev, logoUrl: publicUrl } : prev));
          showToast(t.toast.uploadSuccess);
          return;
        } catch {
          // Fall through to local PC server or inline dataUrl
        }
      }
      const localUrl = await uploadAssetToLocalServer(
        editingRest.id,
        'logos',
        `logo.${optimized.extension}`,
        optimized.dataUrl
      );
      setEditingRest((prev) => (prev ? { ...prev, logoUrl: localUrl ?? optimized.dataUrl } : prev));
      showToast(t.toast.uploadLocalFallback);
    } catch {
      showToast(t.toast.validationError, 'error');
    } finally {
      setUploadingLogo(false);
    }
  };

  const handleConfirmDeleteRestaurant = async () => {
    if (!pendingDeleteRest) return;
    const ok = await onDeleteRestaurant(pendingDeleteRest.id);
    if (ok !== false) {
      if (editingRest?.id === pendingDeleteRest.id) {
        setEditingRest(null);
      }
      showToast(t.toast.restaurantDeleted);
    }
    setPendingDeleteRest(null);
  };

  const handleCreateOwner = async (e: React.FormEvent) => {
    e.preventDefault();
    const isCreatingNewVenue = newOwnerRestId === NEW_RESTAURANT_OPTION;
    const trimmedRestName = newOwnerRestName.trim();
    const trimmedRestCity = newOwnerRestCity.trim() || 'Lubumbashi';
    const createdOwnerName = newOwnerName.trim();
    const createdEmail = newOwnerEmail.trim();
    const createdUsername = newOwnerUsername.trim().toLowerCase();
    const createdPassword = newOwnerPass;

    if (
      !createdOwnerName ||
      createdUsername.length < 2 ||
      createdPassword.length < 4 ||
      (!isCreatingNewVenue && !newOwnerRestId) ||
      (isCreatingNewVenue && !trimmedRestName) ||
      (createdEmail && !createdEmail.includes('@'))
    ) {
      showToast(t.toast.validationError, 'error');
      return;
    }

    const assignedRestName = isCreatingNewVenue
      ? trimmedRestName
      : restaurants.find((r) => r.id === newOwnerRestId)?.name || newOwnerRestId;

    const ok = isCreatingNewVenue
      ? await onAddRestaurant({
          name: trimmedRestName,
          city: trimmedRestCity,
          phone: '+243 990 000 000',
          addressFr: `${trimmedRestCity}, RDC`,
          addressEn: `${trimmedRestCity}, DRC`,
          ownerName: createdOwnerName,
          ownerEmail: createdEmail || undefined,
          ownerUsername: createdUsername,
          ownerPassword: createdPassword,
        })
      : await onCreateOwnerAccount({
          name: createdOwnerName,
          email: createdEmail || undefined,
          username: createdUsername,
          password: createdPassword,
          restaurantId: newOwnerRestId,
        });
    if (ok === false) return;
    setNewOwnerName('');
    setNewOwnerEmail('');
    setNewOwnerUsername('');
    setNewOwnerPass('');
    setNewOwnerRestName('');
    setNewOwnerRestCity('Lubumbashi');
    setShowAddOwner(false);
    setCopiedCreds(false);
    setCredentialsSummary({
      ownerName: createdOwnerName,
      restaurantName: assignedRestName,
      email: createdEmail,
      username: createdUsername,
      password: createdPassword,
      isActive: true,
    });
    showToast(t.toast.accountCreated);
  };

  const handleSaveEditOwner = async (e: React.FormEvent, userId: string) => {
    e.preventDefault();
    const trimmedEmail = editUserEmail.trim();
    if (
      !editUserName.trim() ||
      editUserUsername.trim().length < 2 ||
      (trimmedEmail && !trimmedEmail.includes('@'))
    ) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    setEditUserBusy(true);
    try {
      const updated = await onUpdateOwnerProfile({
        userId,
        name: editUserName.trim(),
        email: trimmedEmail || undefined,
        username: editUserUsername.trim().toLowerCase(),
        restaurantId: editUserRestId || null,
      });
      if (updated) {
        setEditingUserId(null);
        showToast(t.toast.accountUpdated);
      }
    } finally {
      setEditUserBusy(false);
    }
  };

  const handleConfirmResetPassword = async (e: React.FormEvent, acc: PlatformUser) => {
    e.preventDefault();
    if (resetNewPass.length < 4) {
      showToast(t.auth.passwordTooShort, 'error');
      return;
    }
    const assignedRestName =
      restaurants.find((r) => r.id === acc.assignedRestaurantId)?.name || t.pro.unassignedVenue;
    const appliedPass = resetNewPass;
    setResetBusy(true);
    try {
      const ok = await onResetUserPassword(acc.id, appliedPass);
      if (ok) {
        setResetTargetUserId(null);
        setResetNewPass('');
        setCopiedCreds(false);
        setCredentialsSummary({
          ownerName: acc.name,
          restaurantName: assignedRestName,
          email: acc.email || '',
          username: acc.username || acc.email || '',
          password: appliedPass,
          isActive: acc.isActive,
        });
        showToast(t.toast.passwordReset);
      }
    } finally {
      setResetBusy(false);
    }
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
                  type="text"
                  value={oEmail}
                  onChange={(e) => setOEmail(e.target.value)}
                  placeholder={t.pro.ownerProEmail}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={50}
                  value={oUsername}
                  onChange={(e) => setOUsername(e.target.value)}
                  placeholder={`${t.pro.ownerEmail} (${t.pro.ownerUsernamePlaceholder})`}
                  className="min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={4}
                    value={oPass}
                    onChange={(e) => setOPass(e.target.value)}
                    placeholder={t.pro.ownerPassword}
                    className="flex-1 min-w-0 min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setOPass(generateTemporaryPassword())}
                    title={t.pro.generatePasswordBtn}
                    className="inline-flex items-center gap-1 min-h-[42px] px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-orange-300 shrink-0 cursor-pointer"
                  >
                    <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.pro.generatePasswordBtn}</span>
                  </button>
                </div>
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
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantPhone}
                  </label>
                  <input
                    type="text"
                    value={editingRest.phone}
                    onChange={(e) => setEditingRest({ ...editingRest, phone: e.target.value })}
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantHoursFr}
                  </label>
                  <input
                    type="text"
                    value={editingRest.hours.fr}
                    onChange={(e) =>
                      setEditingRest({
                        ...editingRest,
                        hours: { ...editingRest.hours, fr: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.restaurantHoursEn}
                  </label>
                  <input
                    type="text"
                    value={editingRest.hours.en}
                    onChange={(e) =>
                      setEditingRest({
                        ...editingRest,
                        hours: { ...editingRest.hours, en: e.target.value },
                      })
                    }
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
              </div>

              {/* Super Admin Branding Controls (Logo & Colors) */}
              <div className="pt-4 border-t border-zinc-800 space-y-4">
                <div>
                  <label className="block text-xs font-medium text-zinc-400 mb-2">
                    {t.pro.logoLabel}
                  </label>
                  <div className="flex flex-wrap items-center gap-4">
                    {editingRest.logoUrl ? (
                      <img
                        src={editingRest.logoUrl}
                        alt={editingRest.name}
                        className="w-14 h-14 rounded-xl object-cover border border-zinc-700"
                      />
                    ) : (
                      <div
                        style={{ backgroundColor: editingRest.primaryColor || '#DC2626' }}
                        className="w-14 h-14 rounded-xl flex items-center justify-center font-display text-xl font-bold text-white"
                      >
                        {editingRest.name.charAt(0)}
                      </div>
                    )}

                    <label className="inline-flex items-center gap-2 min-h-[40px] px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-white cursor-pointer">
                      <ImagePlus className="w-4 h-4 text-orange-400" aria-hidden="true" />
                      <span>{uploadingLogo ? t.pro.uploadingAsset : t.pro.uploadLogo}</span>
                      <input
                        type="file"
                        accept="image/*"
                        disabled={uploadingLogo}
                        onChange={handleEditLogoFile}
                        className="sr-only"
                      />
                    </label>

                    {editingRest.logoUrl && (
                      <button
                        type="button"
                        onClick={() => setEditingRest({ ...editingRest, logoUrl: '' })}
                        className="inline-flex items-center gap-1.5 min-h-[40px] px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-red-300 hover:text-red-200 cursor-pointer"
                      >
                        <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                        <span>{t.pro.removeLogo}</span>
                      </button>
                    )}
                  </div>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">
                      {t.pro.primaryColorLabel}
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {COLOR_SWATCHES.map((hex) => (
                        <button
                          key={hex}
                          type="button"
                          onClick={() => setEditingRest({ ...editingRest, primaryColor: hex })}
                          style={{ backgroundColor: hex }}
                          aria-label={hex}
                          className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                            editingRest.primaryColor.toUpperCase() === hex
                              ? 'border-white scale-110'
                              : 'border-transparent'
                          }`}
                        />
                      ))}
                      <input
                        type="color"
                        value={editingRest.primaryColor || '#DC2626'}
                        onChange={(e) =>
                          setEditingRest({ ...editingRest, primaryColor: e.target.value })
                        }
                        className="w-8 h-8 rounded bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>

                  <div>
                    <label className="block text-xs font-medium text-zinc-400 mb-2">
                      {t.pro.secondaryColorLabel}
                    </label>
                    <div className="flex items-center gap-2 flex-wrap">
                      {['#F97316', '#F59E0B', '#EC4899', '#10B981', '#38BDF8', '#FAFAFA'].map(
                        (hex) => (
                          <button
                            key={hex}
                            type="button"
                            onClick={() => setEditingRest({ ...editingRest, secondaryColor: hex })}
                            style={{ backgroundColor: hex }}
                            aria-label={hex}
                            className={`w-7 h-7 rounded-lg border-2 cursor-pointer ${
                              editingRest.secondaryColor.toUpperCase() === hex
                                ? 'border-white scale-110'
                                : 'border-transparent'
                            }`}
                          />
                        )
                      )}
                      <input
                        type="color"
                        value={editingRest.secondaryColor || '#F97316'}
                        onChange={(e) =>
                          setEditingRest({ ...editingRest, secondaryColor: e.target.value })
                        }
                        className="w-8 h-8 rounded bg-transparent cursor-pointer"
                      />
                    </div>
                  </div>
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
                        {owner.name} · {owner.username || owner.email}
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

                    <button
                      type="button"
                      onClick={() => setPendingDeleteRest(rest)}
                      aria-label={`${t.pro.deleteRestaurant} ${rest.name}`}
                      className="min-h-[38px] px-3 rounded-lg bg-zinc-900 hover:bg-red-950/60 border border-zinc-800 hover:border-red-700/60 text-xs text-zinc-400 hover:text-red-400 inline-flex items-center gap-1.5 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" aria-hidden="true" />
                      <span>{t.pro.deleteRestaurant}</span>
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
          {/* Prompt for existing restaurants without a Restaurateur account (e.g. RocoMamas Lubumbashi) */}
          {unassignedRestaurants.length > 0 && (
            <div className="rounded-2xl bg-[#141418] border border-orange-500/40 p-5 space-y-3">
              <div>
                <h3 className="text-sm font-bold text-orange-300">{t.pro.unassignedRestTitle}</h3>
                <p className="text-xs text-zinc-400 mt-0.5">{t.pro.unassignedRestBody}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {unassignedRestaurants.map((rest) => (
                  <button
                    key={rest.id}
                    type="button"
                    onClick={() => startCreateOwnerForRestaurant(rest)}
                    className="inline-flex items-center gap-2 min-h-[38px] px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-orange-500/40 text-xs font-medium text-white cursor-pointer"
                  >
                    <UserPlus className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                    <span>
                      {t.pro.createMissingOwnerBtn} · {rest.name}
                    </span>
                  </button>
                ))}
              </div>
            </div>
          )}

          {showAddOwner && (
            <form
              onSubmit={handleCreateOwner}
              className="rounded-2xl bg-[#141418] border border-orange-500/40 p-6 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4 items-end"
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
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.ownerProEmail}</label>
                <input
                  type="text"
                  value={newOwnerEmail}
                  onChange={(e) => setNewOwnerEmail(e.target.value)}
                  placeholder={t.pro.ownerProEmailPlaceholder}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.ownerEmail}</label>
                <input
                  type="text"
                  required
                  minLength={2}
                  maxLength={50}
                  value={newOwnerUsername}
                  onChange={(e) => setNewOwnerUsername(e.target.value)}
                  placeholder={t.pro.ownerUsernamePlaceholder}
                  className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                />
              </div>
              <div>
                <label className="block text-xs text-zinc-400 mb-1">{t.pro.ownerPassword}</label>
                <div className="flex gap-2">
                  <input
                    type="text"
                    required
                    minLength={4}
                    value={newOwnerPass}
                    onChange={(e) => setNewOwnerPass(e.target.value)}
                    className="flex-1 min-w-0 min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                  <button
                    type="button"
                    onClick={() => setNewOwnerPass(generateTemporaryPassword())}
                    className="inline-flex items-center gap-1 min-h-[42px] px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-orange-300 shrink-0 cursor-pointer"
                  >
                    <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                    <span>{t.pro.generatePasswordBtn}</span>
                  </button>
                </div>
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
                  <option value={NEW_RESTAURANT_OPTION}>{t.pro.createNewVenueOption}</option>
                </select>
              </div>
              {newOwnerRestId === NEW_RESTAURANT_OPTION && (
                <>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      {t.pro.newVenueNameLabel}
                    </label>
                    <input
                      type="text"
                      required
                      value={newOwnerRestName}
                      onChange={(e) => setNewOwnerRestName(e.target.value)}
                      placeholder={t.pro.newVenueNamePlaceholder}
                      className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                    />
                  </div>
                  <div>
                    <label className="block text-xs text-zinc-400 mb-1">
                      {t.pro.newVenueCityLabel}
                    </label>
                    <input
                      type="text"
                      value={newOwnerRestCity}
                      onChange={(e) => setNewOwnerRestCity(e.target.value)}
                      placeholder="Lubumbashi"
                      className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                    />
                  </div>
                </>
              )}
              <div className="sm:col-span-2 lg:col-span-3 flex justify-end gap-2">
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
                const isResetting = resetTargetUserId === acc.id;
                const isEditing = editingUserId === acc.id;
                return (
                  <div key={acc.id} className="p-4 sm:p-5 space-y-3">
                    <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
                      <div className="min-w-0">
                        <p className="text-sm font-semibold text-white truncate">{acc.name}</p>
                        <p className="text-xs font-mono text-zinc-400 mt-0.5 truncate">
                          {acc.username}
                          {acc.email ? ` · ${acc.email}` : ''} · {assigned ? assigned.name : '—'}
                        </p>
                      </div>

                      <div className="flex flex-wrap items-center gap-2.5">
                        <select
                          aria-label={t.pro.reassignVenue}
                          value={acc.assignedRestaurantId ?? ''}
                          onChange={async (e) => {
                            const nextId = e.target.value || null;
                            const ok = await onReassignOwner(acc.id, nextId);
                            if (ok !== false) {
                              showToast(t.toast.ownerReassigned);
                            }
                          }}
                          className="min-h-[38px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-zinc-200"
                        >
                          <option value="">{t.pro.unassignedVenue}</option>
                          {restaurants.map((r) => (
                            <option key={r.id} value={r.id}>
                              {r.name}
                            </option>
                          ))}
                        </select>

                        <button
                          type="button"
                          onClick={() => {
                            if (isEditing) {
                              setEditingUserId(null);
                            } else {
                              setEditingUserId(acc.id);
                              setEditUserName(acc.name);
                              setEditUserEmail(acc.email || '');
                              setEditUserUsername(acc.username || '');
                              setEditUserRestId(acc.assignedRestaurantId || '');
                              setResetTargetUserId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 cursor-pointer"
                        >
                          <Pencil className="w-3.5 h-3.5 text-zinc-400" aria-hidden="true" />
                          <span>{t.pro.editAccountBtn}</span>
                        </button>

                        <button
                          type="button"
                          onClick={() => {
                            if (isResetting) {
                              setResetTargetUserId(null);
                              setResetNewPass('');
                            } else {
                              setResetTargetUserId(acc.id);
                              setResetNewPass('');
                              setEditingUserId(null);
                            }
                          }}
                          className="inline-flex items-center gap-1.5 min-h-[38px] px-3 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs text-zinc-200 cursor-pointer"
                        >
                          <KeyRound className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                          <span>{t.pro.resetPasswordBtn}</span>
                        </button>

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
                    </div>

                    {isEditing && (
                      <form
                        onSubmit={(e) => handleSaveEditOwner(e, acc.id)}
                        className="pt-3 border-t border-zinc-800/80 grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 items-end"
                      >
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            {t.pro.ownerName}
                          </label>
                          <input
                            type="text"
                            required
                            value={editUserName}
                            onChange={(e) => setEditUserName(e.target.value)}
                            className="w-full min-h-[38px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            {t.pro.ownerProEmail}
                          </label>
                          <input
                            type="text"
                            value={editUserEmail}
                            onChange={(e) => setEditUserEmail(e.target.value)}
                            className="w-full min-h-[38px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            {t.pro.ownerEmail}
                          </label>
                          <input
                            type="text"
                            required
                            minLength={2}
                            maxLength={50}
                            value={editUserUsername}
                            onChange={(e) => setEditUserUsername(e.target.value)}
                            className="w-full min-h-[38px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                          />
                        </div>
                        <div>
                          <label className="block text-[11px] text-zinc-400 mb-1">
                            {t.pro.assignedVenue}
                          </label>
                          <select
                            value={editUserRestId}
                            onChange={(e) => setEditUserRestId(e.target.value)}
                            className="w-full min-h-[38px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                          >
                            <option value="">{t.pro.unassignedVenue}</option>
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
                            onClick={() => setEditingUserId(null)}
                            className="min-h-[36px] px-3 rounded-lg bg-zinc-800 text-xs text-zinc-300 cursor-pointer"
                          >
                            {t.pro.cancel}
                          </button>
                          <button
                            type="submit"
                            disabled={editUserBusy}
                            className="min-h-[36px] px-4 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-xs font-semibold text-white cursor-pointer"
                          >
                            {t.pro.saveAccountBtn}
                          </button>
                        </div>
                      </form>
                    )}

                    {isResetting && (
                      <form
                        onSubmit={(e) => handleConfirmResetPassword(e, acc)}
                        className="pt-3 border-t border-zinc-800/80 flex flex-wrap items-center gap-2"
                      >
                        <span className="text-xs text-zinc-400 mr-1">
                          {t.pro.resetPasswordTitle}{' '}
                          <strong className="text-white">{acc.username || acc.name}</strong> :
                        </span>
                        <input
                          type="text"
                          required
                          minLength={4}
                          value={resetNewPass}
                          onChange={(e) => setResetNewPass(e.target.value)}
                          placeholder={t.pro.newPasswordPlaceholder}
                          className="min-h-[38px] w-52 px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
                        />
                        <button
                          type="button"
                          onClick={() => setResetNewPass(generateTemporaryPassword())}
                          className="inline-flex items-center gap-1 min-h-[38px] px-3 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-medium text-orange-300 cursor-pointer"
                        >
                          <Dices className="w-3.5 h-3.5" aria-hidden="true" />
                          <span>{t.pro.generatePasswordBtn}</span>
                        </button>
                        <button
                          type="submit"
                          disabled={resetBusy}
                          className="min-h-[38px] px-3.5 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-xs font-semibold text-white cursor-pointer"
                        >
                          {t.pro.saveNewPasswordBtn}
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setResetTargetUserId(null);
                            setResetNewPass('');
                          }}
                          className="min-h-[38px] px-3 rounded-lg bg-zinc-800 text-xs text-zinc-300 cursor-pointer"
                        >
                          {t.pro.cancel}
                        </button>
                      </form>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>
      )}

      {/* One-Time Credentials Summary Modal (held in JS memory only, never persisted) */}
      {credentialsSummary && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="creds-summary-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-orange-500/40 p-6 shadow-2xl space-y-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2.5">
                <CheckCircle2 className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />
                <h3 id="creds-summary-title" className="font-display text-xl font-bold text-white">
                  {t.pro.credsModalTitle}
                </h3>
              </div>
              <button
                type="button"
                onClick={() => setCredentialsSummary(null)}
                aria-label={t.menu.close}
                className="text-zinc-400 hover:text-white p-1 cursor-pointer"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            <p className="text-xs text-zinc-400 leading-relaxed">{t.pro.credsModalSubtitle}</p>

            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-2.5 text-xs">
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">{t.pro.credsOwnerNameLabel}</span>
                <span className="font-semibold text-white text-right">
                  {credentialsSummary.ownerName || '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">{t.pro.credsRestaurantLabel}</span>
                <span className="font-semibold text-white text-right">
                  {credentialsSummary.restaurantName}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">{t.pro.credsEmailLabel}</span>
                <span className="font-mono text-zinc-200 text-right">
                  {credentialsSummary.email || '—'}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">{t.pro.credsUsernameLabel}</span>
                <span className="font-mono text-white text-right">
                  {credentialsSummary.username}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">{t.pro.credsTempPasswordLabel}</span>
                <span className="font-mono font-bold text-orange-300 text-right select-all">
                  {credentialsSummary.password}
                </span>
              </div>
              <div className="flex justify-between gap-3">
                <span className="text-zinc-400">{t.pro.credsStatusLabel}</span>
                <span
                  className={
                    credentialsSummary.isActive ? 'text-emerald-400 font-medium' : 'text-red-400'
                  }
                >
                  {credentialsSummary.isActive ? t.pro.statusActive : t.pro.statusSuspended}
                </span>
              </div>
            </div>

            <div className="flex justify-end gap-2.5 pt-1">
              <button
                type="button"
                onClick={async () => {
                  const lines = [
                    `SMARTMENU QR — ${credentialsSummary.restaurantName}`,
                    `${t.pro.credsOwnerNameLabel}: ${credentialsSummary.ownerName}`,
                    ...(credentialsSummary.email
                      ? [`${t.pro.credsEmailLabel}: ${credentialsSummary.email}`]
                      : []),
                    `${t.pro.credsUsernameLabel}: ${credentialsSummary.username}`,
                    `${t.pro.credsTempPasswordLabel}: ${credentialsSummary.password}`,
                    `${t.pro.credsStatusLabel}: ${
                      credentialsSummary.isActive ? t.pro.statusActive : t.pro.statusSuspended
                    }`,
                  ].join('\n');
                  try {
                    await navigator.clipboard.writeText(lines);
                    setCopiedCreds(true);
                    showToast(t.pro.credsCopied);
                  } catch {
                    // Clipboard permission fallback
                  }
                }}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-xs font-semibold text-white cursor-pointer"
              >
                {copiedCreds ? (
                  <Check className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                ) : (
                  <Copy className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                )}
                <span>{copiedCreds ? t.pro.credsCopied : t.pro.copyCredsBtn}</span>
              </button>
              <button
                type="button"
                onClick={() => setCredentialsSummary(null)}
                className="min-h-[40px] px-4 rounded-lg bg-red-600 hover:bg-red-500 text-xs font-semibold text-white cursor-pointer"
              >
                {t.menu.close}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Confirm Delete Restaurant Modal (Super Admin only) */}
      {pendingDeleteRest && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/80 backdrop-blur-sm p-4"
          role="dialog"
          aria-modal="true"
          aria-labelledby="confirm-delete-rest-title"
        >
          <div className="w-full max-w-md rounded-2xl bg-[#141418] border border-zinc-800 p-6 shadow-2xl space-y-4">
            <h3
              id="confirm-delete-rest-title"
              className="font-display text-2xl font-bold text-white"
            >
              {t.pro.confirmDeleteRestTitle}
            </h3>
            <p className="text-sm text-zinc-300 leading-relaxed">
              {t.pro.confirmDeleteRestBody}{' '}
              <span className="font-semibold text-white">({pendingDeleteRest.name})</span>
            </p>
            <div className="flex justify-end gap-3 pt-2">
              <button
                type="button"
                onClick={() => setPendingDeleteRest(null)}
                className="min-h-[42px] px-4 rounded-lg bg-zinc-800 hover:bg-zinc-700 text-sm font-medium text-zinc-200 cursor-pointer"
              >
                {t.pro.cancel}
              </button>
              <button
                type="button"
                onClick={handleConfirmDeleteRestaurant}
                className="min-h-[42px] px-4 rounded-lg bg-red-600 hover:bg-red-500 text-sm font-semibold text-white cursor-pointer"
              >
                {t.pro.confirmDeleteRestBtn}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

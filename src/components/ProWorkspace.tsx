import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Database,
  KeyRound,
  Lock,
  LogOut,
  RefreshCw,
  RotateCcw,
  ShieldCheck,
  Unlock,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import {
  getSupabaseClient,
  getSupabaseProjectHost,
  isSupabaseConfigured,
} from '../services/supabaseClient';
import { fetchCurrentSupabaseUser, signOutSupabase } from '../services/supabaseData';
import {
  fetchLocalAuthStatus,
  LocalAuthStatus,
  loginLocalServerWithPin,
  logoutLocalServer,
  setupLocalServerPin,
} from '../services/syncService';
import { Category, MenuItem, PlatformUser, Restaurant } from '../types/menu';
import { PWAInstallButton } from './PWAInstallButton';
import { AdminDashboard } from './pro/AdminDashboard';
import { ProAuthGate } from './pro/ProAuthGate';
import { RestaurateurDashboard } from './pro/RestaurateurDashboard';

const SESSION_KEY = 'smartmenu_qr_pro_user_id';
const ADMIN_MODE_KEY = 'smartmenu_qr_admin_mode_v1';

function readStoredAdminMode(): 'overview' | 'venue' | 'security' {
  if (typeof window === 'undefined') return 'overview';
  try {
    const raw = window.localStorage.getItem(ADMIN_MODE_KEY);
    return raw === 'venue' || raw === 'security' ? raw : 'overview';
  } catch {
    return 'overview';
  }
}

interface ProWorkspaceProps {
  restaurants: Restaurant[];
  categories: Category[];
  menuItems: MenuItem[];
  users: PlatformUser[];
  activeRestaurantId: string;
  onSelectRestaurant: (restaurantId: string) => void;
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
  onDeleteRestaurant: (restaurantId: string) => Promise<boolean> | boolean | void;
  onCreateOwnerAccount: (payload: {
    name: string;
    email: string;
    password: string;
    restaurantId: string;
  }) => Promise<boolean> | boolean | void;
  onToggleUserActive: (userId: string) => void;
  onReassignOwner: (userId: string, restaurantId: string | null) => Promise<boolean> | boolean | void;
  onSaveMenuItem: (item: MenuItem, isNew: boolean) => void;
  onDeleteMenuItem: (itemId: string) => void;
  onToggleAvailability: (itemId: string) => void;
  onAddCategory: (category: Category) => void;
  onUpdateCategory: (category: Category) => void;
  onDeleteCategory: (categoryId: string) => void;
  onOpenQr: (restaurant: Restaurant) => void;
  onOpenCustomerMenu: (restaurantId: string) => void;
  onResetDemo: () => void;
  onRefreshCloud?: () => Promise<void>;
  onAuthSessionChanged?: () => Promise<void>;
  localServerActive?: boolean;
  localAuthRequired?: boolean;
  onAuthUserChange?: (user: PlatformUser | null) => void;
  onLocalAuthSuccess?: () => Promise<void>;
}

export const ProWorkspace: React.FC<ProWorkspaceProps> = ({
  restaurants,
  categories,
  menuItems,
  users,
  activeRestaurantId,
  onSelectRestaurant,
  onAddRestaurant,
  onUpdateRestaurant,
  onToggleRestaurantStatus,
  onDeleteRestaurant,
  onCreateOwnerAccount,
  onToggleUserActive,
  onReassignOwner,
  onSaveMenuItem,
  onDeleteMenuItem,
  onToggleAvailability,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onOpenQr,
  onOpenCustomerMenu,
  onResetDemo,
  onRefreshCloud,
  onAuthSessionChanged,
  localServerActive = false,
  localAuthRequired = false,
  onAuthUserChange,
  onLocalAuthSuccess,
}) => {
  const { t, language } = useLanguage();
  const { showToast } = useToast();

  const supabaseReady = isSupabaseConfigured();
  const projectHost = getSupabaseProjectHost();

  const [currentUserId, setCurrentUserId] = useState<string | null>(() => {
    if (supabaseReady) return null;
    try {
      return window.localStorage.getItem(SESSION_KEY);
    } catch {
      return null;
    }
  });
  const [supabaseUser, setSupabaseUser] = useState<PlatformUser | null>(null);
  const [checkingSession, setCheckingSession] = useState<boolean>(supabaseReady);
  const [adminMode, setAdminMode] = useState<'overview' | 'venue' | 'security'>(() =>
    readStoredAdminMode()
  );
  const [localAuthStatus, setLocalAuthStatus] = useState<LocalAuthStatus | null>(null);
  const [localPinInput, setLocalPinInput] = useState('');
  const [localPinError, setLocalPinError] = useState('');
  const [localPinBusy, setLocalPinBusy] = useState(false);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_MODE_KEY, adminMode);
    } catch {
      // Ignore storage errors
    }
  }, [adminMode]);

  useEffect(() => {
    if (!supabaseReady) {
      setCheckingSession(false);
      return;
    }

    let mounted = true;
    fetchCurrentSupabaseUser()
      .then((user) => {
        if (!mounted) return;
        setSupabaseUser(user);
        if (user?.role === 'restaurateur' && user.assignedRestaurantId) {
          onSelectRestaurant(user.assignedRestaurantId);
        }
      })
      .finally(() => {
        if (mounted) setCheckingSession(false);
      });

    const supabase = getSupabaseClient();
    const { data: authSub } = supabase
      ? supabase.auth.onAuthStateChange((event, session) => {
          if (event === 'SIGNED_OUT' || !session) {
            setSupabaseUser(null);
            return;
          }
          fetchCurrentSupabaseUser().then((user) => {
            if (!mounted) return;
            setSupabaseUser((prev) => {
              if (user) return user;
              return prev && prev.id === session.user.id ? prev : null;
            });
          });
        })
      : { data: { subscription: null } };

    return () => {
      mounted = false;
      authSub.subscription?.unsubscribe();
    };
  }, [supabaseReady]);

  // Strict security: in browser-local mode (!supabaseReady), never resolve super_admin from IndexedDB/localStorage
  const currentUser = supabaseReady
    ? supabaseUser
    : users.find(
        (u) =>
          u.id === currentUserId &&
          u.isActive &&
          u.role === 'restaurateur' &&
          (u.password.length > 0 || u.id === 'user-roco-owner')
      ) ?? null;

  useEffect(() => {
    onAuthUserChange?.(currentUser);
  }, [currentUser, onAuthUserChange]);

  useEffect(() => {
    if (!localServerActive || !currentUser) {
      setLocalAuthStatus(null);
      return;
    }
    let mounted = true;
    fetchLocalAuthStatus().then((status) => {
      if (mounted) setLocalAuthStatus(status);
    });
    return () => {
      mounted = false;
    };
  }, [localServerActive, currentUser?.id, localAuthRequired]);

  useEffect(() => {
    if (supabaseReady) return;
    try {
      if (currentUserId) {
        window.localStorage.setItem(SESSION_KEY, currentUserId);
      } else {
        window.localStorage.removeItem(SESSION_KEY);
      }
    } catch {
      // Ignore storage errors
    }
  }, [currentUserId, supabaseReady]);

  const handleAuthenticated = async (user: PlatformUser) => {
    if (supabaseReady) {
      setSupabaseUser(user);
      if (user.role === 'restaurateur' && user.assignedRestaurantId) {
        onSelectRestaurant(user.assignedRestaurantId);
      }
      if (onAuthSessionChanged) {
        await onAuthSessionChanged();
      }
      return;
    }

    if (user.role !== 'restaurateur') return;
    setCurrentUserId(user.id);
    if (user.assignedRestaurantId) {
      onSelectRestaurant(user.assignedRestaurantId);
    }
  };

  const handleLogout = async () => {
    await logoutLocalServer();
    setLocalAuthStatus((prev) =>
      prev ? { ...prev, authenticated: false, role: null, expiresAt: null } : null
    );
    if (supabaseReady) {
      await signOutSupabase();
      setSupabaseUser(null);
      setAdminMode('overview');
      if (onAuthSessionChanged) {
        await onAuthSessionChanged();
      }
      return;
    }
    setCurrentUserId(null);
    setAdminMode('overview');
  };

  if (checkingSession) {
    return (
      <main className="min-h-[80vh] bg-[#09090B] flex items-center justify-center text-sm text-zinc-400">
        Loading...
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="min-h-[80vh] bg-[#09090B]">
        <ProAuthGate users={users} onAuthenticated={handleAuthenticated} />
      </main>
    );
  }

  // Strict isolation: Restaurateur can ONLY access their assigned restaurant
  const scopedRestaurant =
    currentUser.role === 'restaurateur'
      ? restaurants.find((r) => r.id === currentUser.assignedRestaurantId) ?? null
      : restaurants.find((r) => r.id === activeRestaurantId) ?? restaurants[0] ?? null;

  return (
    <main className="min-h-[80vh] bg-[#09090B] py-10 sm:py-14">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8 space-y-8">
        {/* Top Workspace Header */}
        <div className="flex flex-col lg:flex-row lg:items-end justify-between gap-5 pb-6 border-b border-zinc-800">
          <div>
            <button
              type="button"
              onClick={() =>
                onOpenCustomerMenu(scopedRestaurant?.id ?? activeRestaurantId)
              }
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white mb-3 cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.pro.backToMenu}</span>
            </button>

            <p className="text-xs sm:text-sm font-semibold text-orange-400 tracking-wide">
              {currentUser.role === 'super_admin' ? t.pro.adminNotice : t.pro.isolatedNotice}
            </p>
            <h1 className="mt-1 font-display text-3xl sm:text-5xl font-bold text-white tracking-tight">
              {t.pro.title}
            </h1>
            <p className="mt-2 text-sm text-zinc-400">
              {currentUser.name} ·{' '}
              <span className="font-mono text-zinc-300">{currentUser.email}</span>
            </p>
          </div>

          <div className="flex flex-wrap items-center gap-2.5">
            <PWAInstallButton />
            {currentUser.role === 'super_admin' && (
              <>
                <button
                  type="button"
                  onClick={() => setAdminMode('overview')}
                  className={`min-h-[42px] px-4 rounded-lg text-xs sm:text-sm font-medium cursor-pointer ${
                    adminMode === 'overview'
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white'
                  }`}
                >
                  {t.pro.tabOverview}
                </button>
                <button
                  type="button"
                  onClick={() => setAdminMode('security')}
                  className={`inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-lg text-xs sm:text-sm font-medium cursor-pointer ${
                    adminMode === 'security'
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white'
                  }`}
                >
                  <Database className="w-4 h-4" aria-hidden="true" />
                  <span>{t.pro.tabSecurity}</span>
                </button>
              </>
            )}

            {supabaseReady ? (
              <button
                type="button"
                onClick={async () => {
                  if (onRefreshCloud) {
                    await onRefreshCloud();
                    showToast(t.toast.cloudRefreshed);
                  }
                }}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 cursor-pointer"
              >
                <RefreshCw className="w-3.5 h-3.5 text-emerald-400" aria-hidden="true" />
                <span>{t.pro.refreshCloud}</span>
              </button>
            ) : (
              <button
                type="button"
                onClick={() => {
                  onResetDemo();
                  showToast(t.toast.demoReset);
                }}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-300 cursor-pointer"
              >
                <RotateCcw className="w-3.5 h-3.5" aria-hidden="true" />
                <span>{t.pro.resetDemo}</span>
              </button>
            )}

            <button
              type="button"
              onClick={handleLogout}
              className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 cursor-pointer"
            >
              <LogOut className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
              <span>{t.auth.logoutBtn}</span>
            </button>
          </div>
        </div>

        {/* Local Wi-Fi PC Server PIN Session Bar */}
        {localServerActive && (
          <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-4 flex flex-col lg:flex-row lg:items-center justify-between gap-4">
            <div className="flex items-start gap-3">
              {localAuthStatus?.authenticated ? (
                <Unlock className="w-5 h-5 text-emerald-400 shrink-0 mt-0.5" aria-hidden="true" />
              ) : (
                <KeyRound className="w-5 h-5 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
              )}
              <div className="space-y-0.5">
                <p className="text-xs font-semibold text-white">{t.pro.localPinTitle}</p>
                <p className="text-xs text-zinc-400">
                  {localAuthStatus?.authenticated
                    ? t.pro.localPinUnlocked
                    : !localAuthStatus?.pinConfigured && localAuthStatus?.localhostSetupAllowed
                    ? t.pro.localPinSetupNote
                    : t.pro.localPinLocked}
                </p>
                {localPinError && (
                  <p role="alert" className="text-xs font-medium text-red-400 pt-0.5">
                    {localPinError}
                  </p>
                )}
              </div>
            </div>

            {localAuthStatus?.authenticated ? (
              <button
                type="button"
                disabled={localPinBusy}
                onClick={async () => {
                  setLocalPinBusy(true);
                  await logoutLocalServer();
                  const status = await fetchLocalAuthStatus();
                  setLocalAuthStatus(status);
                  setLocalPinBusy(false);
                }}
                className="inline-flex items-center gap-1.5 min-h-[40px] px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-200 self-start lg:self-auto cursor-pointer"
              >
                <Lock className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                <span>{t.pro.localPinLockBtn}</span>
              </button>
            ) : (
              <form
                onSubmit={async (e) => {
                  e.preventDefault();
                  setLocalPinError('');
                  const trimmedPin = localPinInput.trim();
                  if (trimmedPin.length < 4) {
                    setLocalPinError(t.toast.validationError);
                    return;
                  }
                  setLocalPinBusy(true);
                  try {
                    const targetRestId = scopedRestaurant?.id;
                    if (!localAuthStatus?.pinConfigured && localAuthStatus?.localhostSetupAllowed) {
                      const setupRes = await setupLocalServerPin(
                        trimmedPin,
                        undefined,
                        targetRestId
                      );
                      if (!setupRes.ok) {
                        setLocalPinError(setupRes.error || t.auth.invalidCreds);
                        return;
                      }
                    }
                    const loginRes = await loginLocalServerWithPin(trimmedPin, targetRestId);
                    if (!loginRes.ok) {
                      setLocalPinError(loginRes.error || t.auth.invalidCreds);
                      return;
                    }
                    setLocalPinInput('');
                    const status = await fetchLocalAuthStatus();
                    setLocalAuthStatus(status);
                    showToast(t.toast.loginSuccess);
                    if (onLocalAuthSuccess) {
                      await onLocalAuthSuccess();
                    }
                  } finally {
                    setLocalPinBusy(false);
                  }
                }}
                className="flex flex-wrap items-center gap-2"
              >
                <input
                  type="password"
                  value={localPinInput}
                  onChange={(e) => setLocalPinInput(e.target.value)}
                  placeholder={t.pro.localPinPlaceholder}
                  aria-label={t.pro.localPinPlaceholder}
                  minLength={4}
                  maxLength={32}
                  className="min-h-[40px] w-48 px-3 rounded-lg bg-zinc-900 border border-zinc-800 text-xs text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
                <button
                  type="submit"
                  disabled={localPinBusy}
                  className="min-h-[40px] px-4 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-xs font-semibold text-white cursor-pointer"
                >
                  {!localAuthStatus?.pinConfigured && localAuthStatus?.localhostSetupAllowed
                    ? t.pro.localPinSetupBtn
                    : t.pro.localPinUnlockBtn}
                </button>
              </form>
            )}
          </div>
        )}

        {/* Role-Based Views */}
        {currentUser.role === 'super_admin' && adminMode === 'overview' && (
          <AdminDashboard
            restaurants={restaurants}
            menuItems={menuItems}
            users={users}
            onAddRestaurant={onAddRestaurant}
            onUpdateRestaurant={onUpdateRestaurant}
            onToggleRestaurantStatus={onToggleRestaurantStatus}
            onDeleteRestaurant={onDeleteRestaurant}
            onCreateOwnerAccount={onCreateOwnerAccount}
            onToggleUserActive={onToggleUserActive}
            onReassignOwner={onReassignOwner}
            onManageRestaurant={(id) => {
              onSelectRestaurant(id);
              setAdminMode('venue');
            }}
            onOpenQr={onOpenQr}
            onOpenCustomerMenu={onOpenCustomerMenu}
          />
        )}

        {currentUser.role === 'super_admin' && adminMode === 'security' && (
          <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 space-y-5 max-w-3xl">
            <div className="flex items-center gap-3">
              <ShieldCheck className="w-6 h-6 text-orange-400" aria-hidden="true" />
              <h2 className="font-display text-2xl sm:text-3xl font-bold text-white">
                {t.pro.securityTitle}
              </h2>
            </div>

            <p className="text-sm text-zinc-300 leading-relaxed">{t.pro.securityBody}</p>

            <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-4 space-y-2 text-xs text-zinc-300">
              <p className="font-semibold text-white">
                {supabaseReady ? t.auth.supabaseActive : t.auth.supabaseFallback}
                {supabaseReady && projectHost ? ` · ${projectHost}` : ''}
              </p>
              <ul className="list-disc pl-5 space-y-1 text-zinc-400">
                <li>
                  {language === 'fr'
                    ? 'Tables SQL multi-restaurants : restaurants, profiles, categories, menu_items (supabase/schema.sql)'
                    : 'Multi-restaurant SQL tables: restaurants, profiles, categories, menu_items (supabase/schema.sql)'}
                </li>
                <li>
                  {language === 'fr'
                    ? 'Script de démonstration non destructif (1 restaurant + 4 plats + profil Super Admin) : supabase/seed.sql'
                    : 'Non-destructive demo seed script (1 venue + 4 dishes + Super Admin profile): supabase/seed.sql'}
                </li>
                <li>
                  {language === 'fr'
                    ? 'Politiques RLS actives : chaque restaurateur ne peut modifier que ses propres lignes (restaurant_id).'
                    : 'RLS policies enforced: each owner can only mutate rows matching their own restaurant_id.'}
                </li>
                <li>
                  {language === 'fr'
                    ? 'Stockage Storage : bucket public restaurant-assets restreint en écriture par dossier restaurant_id.'
                    : 'Storage bucket: restaurant-assets restricted per restaurant_id folder on write.'}
                </li>
                <li>
                  {language === 'fr'
                    ? 'Variables publiques requises : VITE_SUPABASE_URL et VITE_SUPABASE_ANON_KEY (jamais de clé service_role côté navigateur).'
                    : 'Required public env vars: VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY (service_role key is strictly server-only).'}
                </li>
              </ul>
            </div>
          </div>
        )}

        {((currentUser.role === 'super_admin' && adminMode === 'venue') ||
          currentUser.role === 'restaurateur') &&
          scopedRestaurant && (
            <div className="space-y-4">
              {currentUser.role === 'super_admin' && (
                <button
                  type="button"
                  onClick={() => setAdminMode('overview')}
                  className="inline-flex items-center gap-1.5 text-xs font-medium text-orange-400 hover:underline cursor-pointer"
                >
                  <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
                  <span>{t.pro.tabOverview}</span>
                </button>
              )}

              <RestaurateurDashboard
                restaurant={scopedRestaurant}
                categories={categories}
                menuItems={menuItems}
                onSaveItem={onSaveMenuItem}
                onDeleteItem={onDeleteMenuItem}
                onToggleAvailability={onToggleAvailability}
                onAddCategory={onAddCategory}
                onUpdateCategory={onUpdateCategory}
                onDeleteCategory={onDeleteCategory}
                onOpenQr={onOpenQr}
                onOpenCustomerMenu={onOpenCustomerMenu}
              />
            </div>
          )}
      </div>
    </main>
  );
};

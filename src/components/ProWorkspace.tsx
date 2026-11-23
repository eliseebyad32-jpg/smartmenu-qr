import React, { useEffect, useState } from 'react';
import {
  ArrowLeft,
  Database,
  KeyRound,
  Lock,
  LogOut,
  Mail,
  RefreshCw,
  ShieldCheck,
  Unlock,
  UserCog,
} from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { useToast } from '../context/ToastContext';
import {
  getSupabaseClient,
  getSupabaseProjectHost,
  isSupabaseConfigured,
} from '../services/supabaseClient';
import {
  completeSupabasePasswordRecovery,
  fetchCurrentSupabaseUser,
  getSupabaseAppSessionToken,
  requestSupabasePasswordReset,
  signOutSupabase,
} from '../services/supabaseData';
import {
  fetchLocalAuthStatus,
  fetchLocalServerCurrentUser,
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

const LEGACY_SESSION_KEY = 'smartmenu_qr_pro_user_id';
const ADMIN_MODE_KEY = 'smartmenu_qr_admin_mode_v1';

type AdminMode = 'overview' | 'venue' | 'account' | 'security';

function readStoredAdminMode(): AdminMode {
  if (typeof window === 'undefined') return 'overview';
  try {
    const raw = window.localStorage.getItem(ADMIN_MODE_KEY);
    return raw === 'venue' || raw === 'account' || raw === 'security' ? raw : 'overview';
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
  onUpdateOwnCredentials: (payload: {
    username: string;
    email?: string;
    password?: string;
    name?: string;
  }) => Promise<PlatformUser | null>;
  onChangeOwnPassword: (currentPassword: string, newPassword: string) => Promise<boolean>;
  onSaveMenuItem: (item: MenuItem, isNew: boolean) => void;
  onDeleteMenuItem: (itemId: string) => void;
  onToggleAvailability: (itemId: string) => void;
  onAddCategory: (category: Category) => void;
  onUpdateCategory: (category: Category) => void;
  onDeleteCategory: (categoryId: string) => void;
  onOpenQr: (restaurant: Restaurant) => void;
  onOpenCustomerMenu: (restaurantId: string) => void;
  onRefreshCloud?: () => Promise<void>;
  onAuthSessionChanged?: (user: PlatformUser | null) => Promise<void> | void;
  localServerActive?: boolean;
  localAuthRequired?: boolean;
  initialRecoveryMode?: boolean;
  onRecoveryComplete?: () => void;
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
  onUpdateOwnerProfile,
  onToggleUserActive,
  onReassignOwner,
  onResetUserPassword,
  onUpdateOwnCredentials,
  onChangeOwnPassword,
  onSaveMenuItem,
  onDeleteMenuItem,
  onToggleAvailability,
  onAddCategory,
  onUpdateCategory,
  onDeleteCategory,
  onOpenQr,
  onOpenCustomerMenu,
  onRefreshCloud,
  onAuthSessionChanged,
  localServerActive = false,
  localAuthRequired = false,
  initialRecoveryMode = false,
  onRecoveryComplete,
  onAuthUserChange,
  onLocalAuthSuccess,
}) => {
  const { t, language } = useLanguage();
  const { showToast } = useToast();

  const supabaseReady = isSupabaseConfigured();
  const projectHost = getSupabaseProjectHost();

  const [supabaseUser, setSupabaseUser] = useState<PlatformUser | null>(null);
  const [localAccountUser, setLocalAccountUser] = useState<PlatformUser | null>(null);
  const [checkingSession, setCheckingSession] = useState<boolean>(
    supabaseReady || localServerActive
  );
  const [adminMode, setAdminMode] = useState<AdminMode>(() => readStoredAdminMode());
  const [localAuthStatus, setLocalAuthStatus] = useState<LocalAuthStatus | null>(null);
  const [localPinInput, setLocalPinInput] = useState('');
  const [localPinError, setLocalPinError] = useState('');
  const [localPinBusy, setLocalPinBusy] = useState(false);

  // Supabase Auth Email Recovery flow state
  const [recoveryMode, setRecoveryMode] = useState<boolean>(() => {
    if (initialRecoveryMode) return true;
    if (typeof window === 'undefined') return false;
    return window.location.hash.includes('type=recovery');
  });

  useEffect(() => {
    if (initialRecoveryMode) {
      setRecoveryMode(true);
    }
  }, [initialRecoveryMode]);
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryConfirm, setRecoveryConfirm] = useState('');
  const [recoveryError, setRecoveryError] = useState('');
  const [recoveryBusy, setRecoveryBusy] = useState(false);

  // Super Admin Account Settings form state (email is preserved read-only)
  const [accountUsername, setAccountUsername] = useState('');
  const [accountName, setAccountName] = useState('');
  const [accountPassword, setAccountPassword] = useState('');
  const [accountConfirmPassword, setAccountConfirmPassword] = useState('');
  const [accountBusy, setAccountBusy] = useState(false);
  const [accountResetSending, setAccountResetSending] = useState(false);

  // Restaurateur isolated password change panel state
  const [showOwnerPasswordBox, setShowOwnerPasswordBox] = useState(false);
  const [ownerCurrentPass, setOwnerCurrentPass] = useState('');
  const [ownerNewPass, setOwnerNewPass] = useState('');
  const [ownerConfirmPass, setOwnerConfirmPass] = useState('');
  const [ownerPassBusy, setOwnerPassBusy] = useState(false);

  // Scrub any legacy localStorage user session ID on startup
  useEffect(() => {
    try {
      window.localStorage.removeItem(LEGACY_SESSION_KEY);
    } catch {
      // Ignore storage errors
    }
  }, []);

  useEffect(() => {
    try {
      window.localStorage.setItem(ADMIN_MODE_KEY, adminMode);
    } catch {
      // Ignore storage errors
    }
  }, [adminMode]);

  useEffect(() => {
    if (!supabaseReady) {
      if (!localServerActive) {
        setCheckingSession(false);
        return;
      }
      let mounted = true;
      fetchLocalServerCurrentUser()
        .then((user) => {
          if (!mounted) return;
          setLocalAccountUser(user);
          if (user?.role === 'restaurateur' && user.assignedRestaurantId) {
            onSelectRestaurant(user.assignedRestaurantId);
          }
        })
        .finally(() => {
          if (mounted) setCheckingSession(false);
        });
      return () => {
        mounted = false;
      };
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
          if (event === 'PASSWORD_RECOVERY') {
            setRecoveryMode(true);
            return;
          }
          if (event === 'SIGNED_OUT' || !session) {
            if (!getSupabaseAppSessionToken()) {
              setSupabaseUser(null);
            }
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
  }, [supabaseReady, localServerActive]);

  const currentUser = supabaseReady ? supabaseUser : localAccountUser;

  useEffect(() => {
    onAuthUserChange?.(currentUser);
  }, [currentUser, onAuthUserChange]);

  useEffect(() => {
    if (currentUser?.role === 'super_admin') {
      setAccountUsername(currentUser.username || '');
      setAccountName(currentUser.name || '');
    }
  }, [currentUser?.id, currentUser?.username, currentUser?.name, currentUser?.role]);

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

  const handleAuthenticated = async (user: PlatformUser) => {
    if (supabaseReady) {
      setSupabaseUser(user);
    } else {
      setLocalAccountUser(user);
    }

    if (user.role === 'restaurateur' && user.assignedRestaurantId) {
      onSelectRestaurant(user.assignedRestaurantId);
    } else if (user.role === 'super_admin') {
      setAdminMode('overview');
    }

    if (onAuthSessionChanged) {
      await onAuthSessionChanged(user);
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
    } else {
      setLocalAccountUser(null);
    }
    setAdminMode('overview');
    if (onAuthSessionChanged) {
      await onAuthSessionChanged(null);
    }
  };

  const handleRecoverySubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setRecoveryError('');
    if (recoveryPassword.length < 6) {
      setRecoveryError(
        language === 'fr'
          ? 'Pour la récupération par e-mail Supabase, le mot de passe doit contenir au moins 6 caractères.'
          : 'For Supabase email recovery, the password must be at least 6 characters.'
      );
      return;
    }
    if (recoveryPassword !== recoveryConfirm) {
      setRecoveryError(t.auth.passwordMismatch);
      return;
    }

    setRecoveryBusy(true);
    try {
      const res = await completeSupabasePasswordRecovery(recoveryPassword);
      if (!res.ok || !res.user) {
        setRecoveryError(res.error || t.toast.supabaseError);
        return;
      }
      setRecoveryPassword('');
      setRecoveryConfirm('');
      setRecoveryMode(false);
      onRecoveryComplete?.();
      if (typeof window !== 'undefined' && window.location.hash.includes('type=recovery')) {
        window.history.replaceState({}, '', window.location.pathname + window.location.search);
      }
      showToast(t.toast.passwordChanged);
      await handleAuthenticated(res.user);
      if (res.user.role === 'super_admin') {
        setAdminMode('account');
      }
    } finally {
      setRecoveryBusy(false);
    }
  };

  const handleSaveSuperAdminAccount = async (e: React.FormEvent) => {
    e.preventDefault();
    if (accountUsername.trim().length < 2) {
      showToast(t.toast.validationError, 'error');
      return;
    }
    if (accountPassword) {
      if (accountPassword.length < 4) {
        showToast(t.auth.passwordTooShort, 'error');
        return;
      }
      if (accountPassword !== accountConfirmPassword) {
        showToast(t.auth.passwordMismatch, 'error');
        return;
      }
    }

    setAccountBusy(true);
    try {
      // Omit email so the Super Admin's existing email address is strictly preserved
      const updated = await onUpdateOwnCredentials({
        username: accountUsername.trim().toLowerCase(),
        ...(accountName.trim() ? { name: accountName.trim() } : {}),
        ...(accountPassword ? { password: accountPassword } : {}),
      });
      if (updated) {
        if (supabaseReady) {
          setSupabaseUser(updated);
        } else {
          setLocalAccountUser(updated);
        }
        setAccountPassword('');
        setAccountConfirmPassword('');
        showToast(t.toast.credentialsUpdated);
      }
    } finally {
      setAccountBusy(false);
    }
  };

  const handleOwnerChangePassword = async (e: React.FormEvent) => {
    e.preventDefault();
    if (ownerNewPass.length < 4) {
      showToast(t.auth.passwordTooShort, 'error');
      return;
    }
    if (ownerNewPass !== ownerConfirmPass) {
      showToast(t.auth.passwordMismatch, 'error');
      return;
    }
    setOwnerPassBusy(true);
    try {
      const ok = await onChangeOwnPassword(ownerCurrentPass, ownerNewPass);
      if (ok) {
        setOwnerCurrentPass('');
        setOwnerNewPass('');
        setOwnerConfirmPass('');
        setShowOwnerPasswordBox(false);
        showToast(t.toast.passwordChanged);
      }
    } finally {
      setOwnerPassBusy(false);
    }
  };

  if (checkingSession) {
    return (
      <main className="min-h-[80vh] bg-[#09090B] flex items-center justify-center text-sm text-zinc-400">
        Loading...
      </main>
    );
  }

  if (recoveryMode) {
    return (
      <main className="min-h-[80vh] bg-[#09090B] px-4 py-12 sm:py-20">
        <div className="mx-auto max-w-xl rounded-2xl bg-[#141418] border border-orange-500/40 p-6 sm:p-8 shadow-2xl space-y-6">
          <div>
            <p className="text-xs sm:text-sm font-semibold text-orange-400 tracking-wide">
              {t.auth.eyebrow}
            </p>
            <h1 className="mt-1 font-display text-3xl font-bold text-white tracking-tight">
              {t.auth.recoveryTitle}
            </h1>
            <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{t.auth.recoverySubtitle}</p>
          </div>

          <form onSubmit={handleRecoverySubmit} className="space-y-4">
            <div>
              <label
                htmlFor="recovery-password"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.newPasswordLabel}
              </label>
              <input
                id="recovery-password"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={recoveryPassword}
                onChange={(e) => setRecoveryPassword(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[46px] px-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label
                htmlFor="recovery-confirm"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.confirmPasswordLabel}
              </label>
              <input
                id="recovery-confirm"
                type="password"
                required
                minLength={6}
                autoComplete="new-password"
                value={recoveryConfirm}
                onChange={(e) => setRecoveryConfirm(e.target.value)}
                placeholder="••••••••"
                className="w-full min-h-[46px] px-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>

            {recoveryError && (
              <p role="alert" className="text-xs font-medium text-red-400">
                {recoveryError}
              </p>
            )}

            <button
              type="submit"
              disabled={recoveryBusy}
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-60 text-sm font-semibold text-white transition cursor-pointer"
            >
              {t.auth.saveRecoveryBtn}
            </button>
          </form>
        </div>
      </main>
    );
  }

  if (!currentUser) {
    return (
      <main className="min-h-[80vh] bg-[#09090B]">
        <ProAuthGate localServerActive={localServerActive} onAuthenticated={handleAuthenticated} />
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
              <span className="font-mono text-zinc-300">
                {currentUser.username}
                {currentUser.email ? ` · ${currentUser.email}` : ''}
              </span>
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
                  onClick={() => setAdminMode('account')}
                  className={`inline-flex items-center gap-1.5 min-h-[42px] px-4 rounded-lg text-xs sm:text-sm font-medium cursor-pointer ${
                    adminMode === 'account'
                      ? 'bg-red-600 text-white'
                      : 'bg-zinc-900 border border-zinc-800 text-zinc-300 hover:text-white'
                  }`}
                >
                  <UserCog className="w-4 h-4" aria-hidden="true" />
                  <span>{t.pro.tabMyAccount}</span>
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

            {currentUser.role === 'restaurateur' && (
              <button
                type="button"
                onClick={() => setShowOwnerPasswordBox((prev) => !prev)}
                className="inline-flex items-center gap-1.5 min-h-[42px] px-3.5 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 text-xs font-medium text-zinc-200 cursor-pointer"
              >
                <KeyRound className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                <span>{t.pro.changePasswordBtn}</span>
              </button>
            )}

            {supabaseReady && (
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

        {/* Isolated Restaurateur Password Change Panel */}
        {currentUser.role === 'restaurateur' && showOwnerPasswordBox && (
          <form
            onSubmit={handleOwnerChangePassword}
            className="rounded-2xl bg-[#141418] border border-orange-500/40 p-5 grid grid-cols-1 sm:grid-cols-4 gap-3 items-end"
          >
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                {t.pro.currentPasswordLabel}
              </label>
              <input
                type="password"
                required
                value={ownerCurrentPass}
                onChange={(e) => setOwnerCurrentPass(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                {t.auth.newPasswordLabel}
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={ownerNewPass}
                onChange={(e) => setOwnerNewPass(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
              />
            </div>
            <div>
              <label className="block text-xs text-zinc-400 mb-1">
                {t.auth.confirmPasswordLabel}
              </label>
              <input
                type="password"
                required
                minLength={4}
                value={ownerConfirmPass}
                onChange={(e) => setOwnerConfirmPass(e.target.value)}
                className="w-full min-h-[40px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-xs text-white"
              />
            </div>
            <div className="flex gap-2 justify-end">
              <button
                type="button"
                onClick={() => setShowOwnerPasswordBox(false)}
                className="min-h-[40px] px-3 rounded-lg bg-zinc-800 text-xs text-zinc-300 cursor-pointer"
              >
                {t.pro.cancel}
              </button>
              <button
                type="submit"
                disabled={ownerPassBusy}
                className="min-h-[40px] px-4 rounded-lg bg-red-600 hover:bg-red-500 disabled:opacity-60 text-xs font-semibold text-white cursor-pointer"
              >
                {t.pro.saveNewPasswordBtn}
              </button>
            </div>
          </form>
        )}

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
                  if (!supabaseReady) {
                    setLocalAccountUser(null);
                  }
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
            onUpdateOwnerProfile={async (payload) => {
              const updated = await onUpdateOwnerProfile(payload);
              return updated;
            }}
            onToggleUserActive={onToggleUserActive}
            onReassignOwner={onReassignOwner}
            onResetUserPassword={onResetUserPassword}
            onManageRestaurant={(id) => {
              onSelectRestaurant(id);
              setAdminMode('venue');
            }}
            onOpenQr={onOpenQr}
            onOpenCustomerMenu={onOpenCustomerMenu}
          />
        )}

        {currentUser.role === 'super_admin' && adminMode === 'account' && (
          <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
            <form
              onSubmit={handleSaveSuperAdminAccount}
              className="lg:col-span-2 rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 space-y-5"
            >
              <div className="flex items-start gap-3">
                <UserCog className="w-6 h-6 text-orange-400 shrink-0 mt-0.5" aria-hidden="true" />
                <div>
                  <h2 className="font-display text-2xl font-bold text-white">
                    {t.pro.myAccountTitle}
                  </h2>
                  <p className="text-xs sm:text-sm text-zinc-400 mt-1">{t.pro.myAccountSubtitle}</p>
                </div>
              </div>

              <div className="rounded-xl bg-zinc-900 border border-zinc-800 px-4 py-3 text-xs flex flex-wrap items-center justify-between gap-2">
                <span className="text-zinc-400">{t.pro.currentEmailLabel}</span>
                <span className="font-mono font-semibold text-white">
                  {currentUser.email || '—'}
                </span>
              </div>

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.adminUsernameLabel}
                  </label>
                  <input
                    type="text"
                    required
                    minLength={2}
                    maxLength={50}
                    value={accountUsername}
                    onChange={(e) => setAccountUsername(e.target.value)}
                    placeholder={t.auth.setupUsernamePlaceholder}
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.auth.setupFullNameLabel}
                  </label>
                  <input
                    type="text"
                    value={accountName}
                    onChange={(e) => setAccountName(e.target.value)}
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.adminNewPasswordLabel}
                  </label>
                  <input
                    type="password"
                    minLength={4}
                    autoComplete="new-password"
                    value={accountPassword}
                    onChange={(e) => setAccountPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
                <div>
                  <label className="block text-xs text-zinc-400 mb-1">
                    {t.pro.adminConfirmPasswordLabel}
                  </label>
                  <input
                    type="password"
                    minLength={4}
                    autoComplete="new-password"
                    value={accountConfirmPassword}
                    onChange={(e) => setAccountConfirmPassword(e.target.value)}
                    placeholder="••••••••"
                    className="w-full min-h-[42px] px-3 rounded-lg bg-zinc-900 border border-zinc-700 text-sm text-white"
                  />
                </div>
              </div>

              <div className="flex flex-wrap items-center justify-between gap-3 pt-2">
                {supabaseReady && currentUser.email?.includes('@') ? (
                  <button
                    type="button"
                    disabled={accountResetSending}
                    onClick={async () => {
                      const targetEmail = (currentUser.email || '').trim();
                      setAccountResetSending(true);
                      try {
                        const res = await requestSupabasePasswordReset(targetEmail);
                        if (!res.ok) {
                          showToast(res.error || t.toast.supabaseError, 'error');
                        } else {
                          showToast(t.auth.resetEmailSent);
                        }
                      } finally {
                        setAccountResetSending(false);
                      }
                    }}
                    className="inline-flex items-center gap-1.5 min-h-[40px] px-4 rounded-lg bg-zinc-900 hover:bg-zinc-800 border border-zinc-700 text-xs font-medium text-zinc-200 cursor-pointer disabled:opacity-60"
                  >
                    <Mail className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
                    <span>{t.pro.triggerEmailResetBtn}</span>
                  </button>
                ) : (
                  <span />
                )}

                <button
                  type="submit"
                  disabled={accountBusy}
                  className="min-h-[42px] px-5 rounded-lg bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-60 text-xs sm:text-sm font-semibold text-white cursor-pointer"
                >
                  {t.pro.saveAdminCredsBtn}
                </button>
              </div>
            </form>

            <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 space-y-4 h-fit">
              <div className="flex items-center gap-2.5">
                <ShieldCheck className="w-5 h-5 text-emerald-400 shrink-0" aria-hidden="true" />
                <h3 className="text-base font-bold text-white">{t.pro.accountInfoTitle}</h3>
              </div>

              <div className="space-y-2.5 text-xs">
                <div className="flex justify-between gap-2 py-1.5 border-b border-zinc-800">
                  <span className="text-zinc-400">{t.auth.setupFullNameLabel}</span>
                  <span className="font-medium text-white text-right">{currentUser.name || '—'}</span>
                </div>
                <div className="flex justify-between gap-2 py-1.5 border-b border-zinc-800">
                  <span className="text-zinc-400">{t.pro.currentUsernameLabel}</span>
                  <span className="font-mono font-semibold text-white text-right">
                    {currentUser.username || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 py-1.5 border-b border-zinc-800">
                  <span className="text-zinc-400">{t.pro.credsEmailLabel}</span>
                  <span className="font-mono text-zinc-200 text-right">
                    {currentUser.email || '—'}
                  </span>
                </div>
                <div className="flex justify-between gap-2 py-1.5 border-b border-zinc-800">
                  <span className="text-zinc-400">{t.pro.accountRoleLabel}</span>
                  <span className="font-mono font-semibold text-orange-400">super_admin</span>
                </div>
                <div className="flex justify-between gap-2 py-1.5 border-b border-zinc-800">
                  <span className="text-zinc-400">{t.pro.accountStatusLabel}</span>
                  <span className="text-emerald-400 font-medium">{t.pro.statusActive}</span>
                </div>
                <div className="flex justify-between gap-2 py-1.5 border-b border-zinc-800">
                  <span className="text-zinc-400">Backend</span>
                  <span className="text-zinc-200">
                    {supabaseReady ? 'Supabase Cloud' : 'Serveur local PC'}
                  </span>
                </div>
              </div>

              <p className="text-xs text-zinc-400 leading-relaxed">{t.pro.accountIsolationNotice}</p>
            </div>
          </div>
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
                {supabaseReady
                  ? t.auth.supabaseActive
                  : localServerActive
                  ? t.auth.localServerActive
                  : t.auth.noBackendTitle}
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

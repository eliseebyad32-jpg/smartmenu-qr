import React, { useEffect, useState } from 'react';
import { ArrowLeft, Lock, Mail, ServerCrash, ShieldCheck, User, UserPlus } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { getSupabaseProjectHost, isSupabaseConfigured } from '../../services/supabaseClient';
import {
  fetchSupabaseBootstrapStatus,
  requestSupabasePasswordReset,
  setupSupabaseInitialSuperAdmin,
  signInWithSupabase,
} from '../../services/supabaseData';
import {
  fetchLocalServerAuthStatus,
  loginLocalServerAccount,
  setupLocalServerSuperAdmin,
} from '../../services/syncService';
import { PlatformUser } from '../../types/menu';

interface ProAuthGateProps {
  localServerActive?: boolean;
  onAuthenticated: (user: PlatformUser) => void;
}

export const ProAuthGate: React.FC<ProAuthGateProps> = ({
  localServerActive = false,
  onAuthenticated,
}) => {
  const { t } = useLanguage();
  const { showToast } = useToast();

  const [identifier, setIdentifier] = useState('');
  const [setupEmail, setSetupEmail] = useState('');
  const [password, setPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [fullName, setFullName] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const [showForgotPassword, setShowForgotPassword] = useState(false);
  const [resetEmail, setResetEmail] = useState('');
  const [resetSent, setResetSent] = useState(false);

  const [checkingBootstrap, setCheckingBootstrap] = useState(true);
  const [needsSuperAdminSetup, setNeedsSuperAdminSetup] = useState(false);
  const [localSetupRestricted, setLocalSetupRestricted] = useState(false);
  const [schemaPending, setSchemaPending] = useState(false);

  const supabaseReady = isSupabaseConfigured();
  const projectHost = getSupabaseProjectHost();
  const hasAuthBackend = supabaseReady || localServerActive;

  useEffect(() => {
    let mounted = true;
    const probe = async () => {
      setCheckingBootstrap(true);
      try {
        if (supabaseReady) {
          const status = await fetchSupabaseBootstrapStatus();
          if (mounted) {
            setNeedsSuperAdminSetup(status.rpcReady && !status.hasSuperAdmin);
            setLocalSetupRestricted(false);
            setSchemaPending(!status.rpcReady);
          }
          return;
        }
        if (localServerActive) {
          const status = await fetchLocalServerAuthStatus();
          if (mounted && status) {
            setNeedsSuperAdminSetup(!status.hasSuperAdmin);
            setLocalSetupRestricted(!status.hasSuperAdmin && status.localhostSetupAllowed === false);
          }
          return;
        }
        if (mounted) {
          setNeedsSuperAdminSetup(false);
          setLocalSetupRestricted(false);
        }
      } finally {
        if (mounted) setCheckingBootstrap(false);
      }
    };
    void probe();
    return () => {
      mounted = false;
    };
  }, [supabaseReady, localServerActive]);

  const handleLoginSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (supabaseReady) {
        const result = await signInWithSupabase(identifier, password);
        if (!result.user) {
          let msg: string = t.auth.invalidCreds;
          if (result.reason === 'locked') {
            msg = t.auth.lockedError;
          } else if (result.reason === 'profile_missing') {
            msg = t.auth.profileMissing;
          } else if (result.reason === 'profile_error') {
            msg = result.errorDetail
              ? `${t.auth.profileError} (${result.errorDetail})`
              : t.auth.profileError;
          } else if (result.reason === 'id_mismatch') {
            msg = result.errorDetail
              ? `${t.auth.idMismatch} (${result.errorDetail})`
              : t.auth.idMismatch;
          }
          setError(msg);
          showToast(msg, 'error');
          return;
        }

        showToast(t.toast.loginSuccess);
        onAuthenticated(result.user);
        return;
      }

      if (localServerActive) {
        const res = await loginLocalServerAccount(identifier, password);
        if (!res.ok || !res.user) {
          const msg = res.error || t.auth.invalidCreds;
          setError(msg);
          showToast(msg, 'error');
          return;
        }

        showToast(t.toast.loginSuccess);
        onAuthenticated(res.user);
        return;
      }

      setError(t.auth.noBackendBody);
      showToast(t.auth.noBackendBody, 'error');
    } finally {
      setLoading(false);
    }
  };

  const handleInitialSetupSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');

    if (password.length < 4) {
      setError(t.auth.passwordTooShort);
      return;
    }
    if (password !== confirmPassword) {
      setError(t.auth.passwordMismatch);
      return;
    }

    setLoading(true);
    try {
      const payload = {
        username: identifier.trim(),
        email: setupEmail.trim() || undefined,
        name: fullName.trim() || identifier.trim(),
        password,
      };

      const res = supabaseReady
        ? await setupSupabaseInitialSuperAdmin(payload)
        : await setupLocalServerSuperAdmin(payload);

      if (!res.ok || !res.user) {
        const msg = res.error || t.auth.invalidCreds;
        setError(msg);
        showToast(msg, 'error');
        return;
      }

      setNeedsSuperAdminSetup(false);
      showToast(t.toast.loginSuccess);
      onAuthenticated(res.user);
    } finally {
      setLoading(false);
    }
  };

  const handleSendResetEmail = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setResetSent(false);
    setLoading(true);
    try {
      const res = await requestSupabasePasswordReset(resetEmail);
      if (!res.ok) {
        const msg = res.error || t.auth.invalidCreds;
        setError(msg);
        showToast(msg, 'error');
        return;
      }
      setResetSent(true);
      showToast(t.auth.resetEmailSent);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 shadow-2xl space-y-6">
        <div>
          <p className="text-xs sm:text-sm font-semibold text-orange-400 tracking-wide">
            {t.auth.eyebrow}
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
            {needsSuperAdminSetup
              ? t.auth.setupTitle
              : showForgotPassword
              ? t.auth.resetEmailTitle
              : t.auth.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">
            {needsSuperAdminSetup
              ? t.auth.setupSubtitle
              : showForgotPassword
              ? t.auth.resetEmailSubtitle
              : t.auth.subtitle}
          </p>
        </div>

        {checkingBootstrap ? (
          <div className="py-8 text-center text-sm text-zinc-400">...</div>
        ) : !hasAuthBackend ? (
          <div className="rounded-xl bg-zinc-900 border border-zinc-800 p-5 space-y-3 text-sm text-zinc-300">
            <div className="flex items-center gap-2 text-orange-400 font-semibold">
              <ServerCrash className="w-5 h-5" aria-hidden="true" />
              <span>{t.auth.noBackendTitle}</span>
            </div>
            <p className="text-xs text-zinc-400 leading-relaxed">{t.auth.noBackendBody}</p>
          </div>
        ) : needsSuperAdminSetup && !supabaseReady && localSetupRestricted ? (
          <div className="rounded-xl bg-orange-950/30 border border-orange-500/40 p-5 space-y-2 text-xs text-orange-200 leading-relaxed">
            <p className="font-semibold text-orange-300">
              Configuration initiale réservée au PC serveur (localhost)
            </p>
            <p>
              Pour des raisons de sécurité, la création du compte Super Admin sur le serveur local
              doit être effectuée directement depuis le PC Windows hôte (via{' '}
              <span className="font-mono font-semibold">http://localhost:3000</span>).
            </p>
          </div>
        ) : needsSuperAdminSetup ? (
          <form onSubmit={handleInitialSetupSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="setup-username"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.setupUsernameLabel}
              </label>
              <div className="relative">
                <User
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="setup-username"
                  type="text"
                  required
                  minLength={2}
                  maxLength={50}
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t.auth.setupUsernamePlaceholder}
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-email"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.setupEmailLabel}
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="setup-email"
                  type="text"
                  autoComplete="email"
                  value={setupEmail}
                  onChange={(e) => setSetupEmail(e.target.value)}
                  placeholder={t.auth.setupEmailPlaceholder}
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-fullname"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.setupFullNameLabel}
              </label>
              <input
                id="setup-fullname"
                type="text"
                value={fullName}
                onChange={(e) => setFullName(e.target.value)}
                placeholder={t.auth.setupFullNamePlaceholder}
                className="w-full min-h-[46px] px-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>

            <div>
              <label
                htmlFor="setup-password"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.passwordLabel}
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="setup-password"
                  type="password"
                  required
                  minLength={4}
                  autoComplete="new-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div>
              <label
                htmlFor="setup-confirm"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.confirmPasswordLabel}
              </label>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="setup-confirm"
                  type="password"
                  required
                  minLength={4}
                  autoComplete="new-password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs font-medium text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] inline-flex items-center justify-center gap-2 rounded-xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-60 text-sm font-semibold text-white transition cursor-pointer"
            >
              <UserPlus className="w-4 h-4" aria-hidden="true" />
              <span>{t.auth.setupBtn}</span>
            </button>
          </form>
        ) : showForgotPassword ? (
          <form onSubmit={handleSendResetEmail} className="space-y-4">
            <div>
              <label
                htmlFor="reset-email"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.resetEmailLabel}
              </label>
              <div className="relative">
                <Mail
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="reset-email"
                  type="text"
                  required
                  autoComplete="email"
                  value={resetEmail}
                  onChange={(e) => setResetEmail(e.target.value)}
                  placeholder={t.auth.setupEmailPlaceholder}
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs font-medium text-red-400">
                {error}
              </p>
            )}

            {resetSent && (
              <p className="rounded-xl bg-emerald-950/40 border border-emerald-700/50 p-3 text-xs text-emerald-300 leading-relaxed">
                {t.auth.resetEmailSent}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-60 text-sm font-semibold text-white transition cursor-pointer"
            >
              {t.auth.sendResetBtn}
            </button>

            <button
              type="button"
              onClick={() => {
                setShowForgotPassword(false);
                setError('');
                setResetSent(false);
              }}
              className="inline-flex items-center gap-1.5 text-xs font-medium text-zinc-400 hover:text-white cursor-pointer"
            >
              <ArrowLeft className="w-3.5 h-3.5" aria-hidden="true" />
              <span>{t.auth.backToLogin}</span>
            </button>
          </form>
        ) : (
          <form onSubmit={handleLoginSubmit} className="space-y-4">
            <div>
              <label
                htmlFor="auth-identifier"
                className="block text-xs font-medium text-zinc-300 mb-1.5"
              >
                {t.auth.emailLabel}
              </label>
              <div className="relative">
                <User
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="auth-identifier"
                  type="text"
                  required
                  autoComplete="username"
                  value={identifier}
                  onChange={(e) => setIdentifier(e.target.value)}
                  placeholder={t.auth.emailPlaceholder}
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            <div>
              <div className="flex items-center justify-between mb-1.5">
                <label
                  htmlFor="auth-password"
                  className="block text-xs font-medium text-zinc-300"
                >
                  {t.auth.passwordLabel}
                </label>
                {supabaseReady && (
                  <button
                    type="button"
                    onClick={() => {
                      setShowForgotPassword(true);
                      setError('');
                      setResetSent(false);
                      if (identifier.includes('@')) {
                        setResetEmail(identifier.trim());
                      }
                    }}
                    className="text-xs font-medium text-orange-400 hover:text-orange-300 cursor-pointer"
                  >
                    {t.auth.forgotPasswordLink}
                  </button>
                )}
              </div>
              <div className="relative">
                <Lock
                  className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                  aria-hidden="true"
                />
                <input
                  id="auth-password"
                  type="password"
                  required
                  autoComplete="current-password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
                />
              </div>
            </div>

            {error && (
              <p role="alert" className="text-xs font-medium text-red-400">
                {error}
              </p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full min-h-[48px] rounded-xl bg-gradient-to-r from-red-600 to-orange-600 hover:from-red-500 hover:to-orange-500 disabled:opacity-60 text-sm font-semibold text-white transition cursor-pointer"
            >
              {t.auth.loginBtn}
            </button>

            {schemaPending && (
              <div className="rounded-xl bg-orange-950/30 border border-orange-500/40 p-3.5 text-xs text-orange-200 leading-relaxed">
                Exécutez <span className="font-mono font-semibold">supabase/schema.sql</span> dans
                le SQL Editor de votre projet Supabase pour activer la connexion par identifiant
                simple et la gestion complète des comptes.
              </div>
            )}
          </form>
        )}

        <div className="pt-4 border-t border-zinc-800/80 flex items-start gap-2 text-xs text-emerald-400 leading-relaxed">
          <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
          <span>
            {supabaseReady
              ? `${t.auth.supabaseActive}${projectHost ? ` (${projectHost})` : ''}`
              : localServerActive
              ? t.auth.localServerActive
              : t.auth.noBackendTitle}
          </span>
        </div>
      </div>
    </div>
  );
};

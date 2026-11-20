import React, { useState } from 'react';
import { KeyRound, Lock, Mail, ShieldCheck } from 'lucide-react';
import { useLanguage } from '../../context/LanguageContext';
import { useToast } from '../../context/ToastContext';
import { getSupabaseProjectHost, isSupabaseConfigured } from '../../services/supabaseClient';
import { signInWithSupabase } from '../../services/supabaseData';
import { PlatformUser } from '../../types/menu';

interface ProAuthGateProps {
  users: PlatformUser[];
  onAuthenticated: (user: PlatformUser) => void;
}

export const ProAuthGate: React.FC<ProAuthGateProps> = ({ users, onAuthenticated }) => {
  const { t } = useLanguage();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const supabaseReady = isSupabaseConfigured();
  const projectHost = getSupabaseProjectHost();

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);

    try {
      if (supabaseReady) {
        const result = await signInWithSupabase(email, password);
        if (!result.user) {
          let msg: string = t.auth.invalidCreds;
          if (result.reason === 'profile_missing') {
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

      // Local demo authentication (when Supabase env vars are not configured)
      const matched = users.find(
        (u) =>
          u.email.toLowerCase() === email.trim().toLowerCase() &&
          u.password === password &&
          u.isActive
      );

      if (!matched) {
        setError(t.auth.invalidCreds);
        showToast(t.auth.invalidCreds, 'error');
        return;
      }

      showToast(t.toast.loginSuccess);
      onAuthenticated(matched);
    } finally {
      setLoading(false);
    }
  };

  const fillDemoUser = (user: PlatformUser) => {
    setEmail(user.email);
    setPassword(user.password);
    setError('');
  };

  return (
    <div className="mx-auto max-w-xl px-4 py-12 sm:py-20">
      <div className="rounded-2xl bg-[#141418] border border-zinc-800 p-6 sm:p-8 shadow-2xl space-y-6">
        <div>
          <p className="text-xs sm:text-sm font-semibold text-orange-400 tracking-wide">
            {t.auth.eyebrow}
          </p>
          <h1 className="mt-1 font-display text-3xl sm:text-4xl font-bold text-white tracking-tight">
            {t.auth.title}
          </h1>
          <p className="mt-2 text-sm text-zinc-400 leading-relaxed">{t.auth.subtitle}</p>
        </div>

        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label htmlFor="auth-email" className="block text-xs font-medium text-zinc-300 mb-1.5">
              {t.auth.emailLabel}
            </label>
            <div className="relative">
              <Mail
                className="w-4 h-4 text-zinc-500 absolute left-3.5 top-1/2 -translate-y-1/2"
                aria-hidden="true"
              />
              <input
                id="auth-email"
                type="email"
                required
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                placeholder={supabaseReady ? 'eliseebyad32@gmail.com' : 'manager@rocomamas-lshi.demo'}
                className="w-full min-h-[46px] pl-10 pr-4 rounded-xl bg-zinc-900 border border-zinc-800 text-sm text-white placeholder:text-zinc-500 focus:outline-none focus:border-orange-500"
              />
            </div>
          </div>

          <div>
            <label
              htmlFor="auth-password"
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
                id="auth-password"
                type="password"
                required
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="••••••••••••"
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
        </form>

        {/* Demo Quick-Fill only when running in local demo mode */}
        {!supabaseReady ? (
          <div className="pt-5 border-t border-zinc-800/80 space-y-3">
            <div className="flex items-center gap-2 text-xs font-semibold text-zinc-300">
              <KeyRound className="w-3.5 h-3.5 text-orange-400" aria-hidden="true" />
              <span>{t.auth.demoQuickTitle}</span>
            </div>
            <p className="text-xs text-zinc-400">{t.auth.demoQuickNote}</p>

            <div className="grid grid-cols-1 gap-2">
              {users
                .filter((u) => u.isActive)
                .map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => fillDemoUser(u)}
                    className="text-left rounded-xl bg-zinc-900/80 hover:bg-zinc-900 border border-zinc-800 hover:border-orange-500/50 px-3.5 py-2.5 transition-colors cursor-pointer"
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-white">{u.name}</span>
                      <span className="text-[11px] font-mono text-orange-400">
                        {u.role === 'super_admin' ? 'SUPER ADMIN' : 'RESTAURATEUR'}
                      </span>
                    </div>
                    <p className="text-[11px] font-mono text-zinc-400 mt-0.5">{u.email}</p>
                  </button>
                ))}
            </div>

            <div className="pt-2 flex items-start gap-2 text-[11px] text-zinc-400 leading-relaxed">
              <ShieldCheck className="w-4 h-4 text-zinc-500 shrink-0 mt-0.5" aria-hidden="true" />
              <span>{t.auth.supabaseFallback}</span>
            </div>
          </div>
        ) : (
          <div className="pt-4 border-t border-zinc-800/80 flex items-start gap-2 text-xs text-emerald-400 leading-relaxed">
            <ShieldCheck className="w-4 h-4 shrink-0 mt-0.5" aria-hidden="true" />
            <span>
              {t.auth.supabaseActive}
              {projectHost ? ` (${projectHost})` : ''}
            </span>
          </div>
        )}
      </div>
    </div>
  );
};

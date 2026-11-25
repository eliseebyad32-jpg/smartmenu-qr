import { createClient, SupabaseClient } from '@supabase/supabase-js';

function normalizeSupabaseUrl(raw: string | undefined): string | undefined {
  const trimmed = raw?.trim();
  if (!trimmed) return undefined;
  try {
    const parsed = new URL(trimmed);
    return parsed.origin;
  } catch {
    return trimmed.replace(/\/rest\/v1\/?$/i, '').replace(/\/+$/, '');
  }
}

const supabaseUrl = normalizeSupabaseUrl(import.meta.env.VITE_SUPABASE_URL as string | undefined);
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY as string | undefined)?.trim();

export function isSupabaseConfigured(): boolean {
  return Boolean(
    supabaseUrl &&
      supabaseAnonKey &&
      supabaseUrl.startsWith('http') &&
      supabaseAnonKey.length > 20
  );
}

export function getSupabaseProjectHost(): string | null {
  if (!supabaseUrl) return null;
  try {
    return new URL(supabaseUrl).host;
  } catch {
    return null;
  }
}

const SUPABASE_FETCH_TIMEOUT_MS = 9000;

function fetchSupabaseWithTimeout(input: RequestInfo | URL, init?: RequestInit): Promise<Response> {
  if (typeof AbortController === 'undefined') {
    return fetch(input, { ...init, cache: 'no-store' });
  }
  const controller = new AbortController();
  const externalSignal = init?.signal;
  if (externalSignal) {
    if (externalSignal.aborted) {
      controller.abort();
    } else {
      externalSignal.addEventListener('abort', () => controller.abort(), { once: true });
    }
  }
  const timer = globalThis.setTimeout(() => controller.abort(), SUPABASE_FETCH_TIMEOUT_MS);
  return fetch(input, {
    ...init,
    cache: 'no-store',
    signal: controller.signal,
  }).finally(() => {
    globalThis.clearTimeout(timer);
  });
}

let cachedClient: SupabaseClient | null = null;

export function getSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured()) return null;
  if (!cachedClient && supabaseUrl && supabaseAnonKey) {
    cachedClient = createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
      },
      global: {
        fetch: fetchSupabaseWithTimeout,
      },
    });
  }
  return cachedClient;
}

/**
 * Non-persisted transient client used only when Super Admin registers a new
 * restaurateur via auth.signUp without overwriting the active Admin session.
 */
export function createEphemeralSupabaseClient(): SupabaseClient | null {
  if (!isSupabaseConfigured() || !supabaseUrl || !supabaseAnonKey) return null;
  return createClient(supabaseUrl, supabaseAnonKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
      detectSessionInUrl: false,
    },
  });
}

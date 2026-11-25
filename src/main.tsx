import { createRoot } from 'react-dom/client';
import { registerSW } from 'virtual:pwa-register';
import App from './App.tsx';
import './index.css';

const rawSupabaseUrl = (import.meta.env.VITE_SUPABASE_URL as string | undefined)?.trim();
if (rawSupabaseUrl && typeof document !== 'undefined') {
  try {
    const origin = new URL(rawSupabaseUrl).origin;
    const preconnect = document.createElement('link');
    preconnect.rel = 'preconnect';
    preconnect.href = origin;
    preconnect.crossOrigin = 'anonymous';
    document.head.appendChild(preconnect);
  } catch {
    // Ignore invalid URL
  }
}

if (
  typeof window !== 'undefined' &&
  'serviceWorker' in navigator &&
  (window.isSecureContext || window.location.hostname === 'localhost')
) {
  try {
    registerSW({
      immediate: true,
      onRegisterError() {
        // Ignore SW registration failure on restricted browsers
      },
    });
  } catch {
    // Ignore unsupported SW environments
  }
}

createRoot(document.getElementById('root')!).render(<App />);

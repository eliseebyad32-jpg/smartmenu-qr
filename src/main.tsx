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

registerSW({ immediate: true });

createRoot(document.getElementById('root')!).render(<App />);

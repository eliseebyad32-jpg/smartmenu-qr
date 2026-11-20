import React from 'react';
import { useLanguage } from '../context/LanguageContext';
import { AppView } from '../types/menu';

interface FooterProps {
  onNavigateView: (view: AppView, sectionId?: string) => void;
}

export const Footer: React.FC<FooterProps> = ({ onNavigateView }) => {
  const { t } = useLanguage();

  return (
    <footer className="bg-[#070709] border-t border-zinc-800/80 py-12">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        <div className="grid grid-cols-1 md:grid-cols-12 gap-8 pb-10 border-b border-zinc-800/80">
          <div className="md:col-span-5">
            <span className="font-display text-2xl font-bold tracking-wider text-white">
              SMARTMENU <span className="text-orange-500">QR</span>
            </span>
            <p className="mt-3 text-sm text-zinc-400 leading-relaxed max-w-sm">
              {t.footer.tagline}
            </p>
          </div>

          <div className="md:col-span-3">
            <p className="text-xs font-semibold text-zinc-300 tracking-wide mb-3">Navigation</p>
            <ul className="space-y-2 text-sm text-zinc-400">
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView('customer', 'top')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {t.nav.home}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView('customer', 'specialties')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {t.nav.specialties}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView('customer', 'menu')}
                  className="hover:text-white transition-colors cursor-pointer"
                >
                  {t.nav.menu}
                </button>
              </li>
              <li>
                <button
                  type="button"
                  onClick={() => onNavigateView('pro')}
                  className="hover:text-orange-400 transition-colors cursor-pointer"
                >
                  {t.nav.pro}
                </button>
              </li>
            </ul>
          </div>

          <div className="md:col-span-4">
            <p className="text-xs font-semibold text-zinc-300 tracking-wide mb-3">
              {t.footer.disclaimerTitle}
            </p>
            <p className="text-xs text-zinc-400 leading-relaxed">{t.footer.disclaimerBody}</p>
          </div>
        </div>

        <div className="pt-6 flex flex-col sm:flex-row items-center justify-between gap-3 text-xs text-zinc-500">
          <p>{t.footer.rights}</p>
          <p>© {new Date().getFullYear()} SMARTMENU QR</p>
        </div>
      </div>
    </footer>
  );
};

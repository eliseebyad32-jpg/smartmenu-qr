import React, { useState } from 'react';
import { Menu, X } from 'lucide-react';
import { useLanguage } from '../context/LanguageContext';
import { AppView } from '../types/menu';

interface NavbarProps {
  activeView: AppView;
  onNavigateView: (view: AppView, sectionId?: string) => void;
}

export const Navbar: React.FC<NavbarProps> = ({ activeView, onNavigateView }) => {
  const { language, setLanguage, t } = useLanguage();
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  const handleLinkClick = (view: AppView, sectionId?: string) => {
    setMobileMenuOpen(false);
    onNavigateView(view, sectionId);
  };

  return (
    <header className="sticky top-0 z-40 border-b border-zinc-800/80 bg-[#09090B]/90 backdrop-blur-md">
      <div className="mx-auto flex h-14 sm:h-16 max-w-7xl items-center justify-between gap-4 sm:gap-8 px-4 sm:px-6 lg:px-8">
        {/* Zone 1: Single-line Brand Wordmark */}
        <button
          type="button"
          onClick={() => handleLinkClick('customer', 'top')}
          className="font-display text-xl sm:text-2xl font-bold tracking-wider text-white whitespace-nowrap shrink-0 cursor-pointer focus-visible:outline-2 focus-visible:outline-orange-500 rounded"
        >
          SMARTMENU <span className="text-orange-500">QR</span>
        </button>

        {/* Zone 2: Clean single-line navigation links */}
        <nav
          aria-label="Navigation principale"
          className="hidden md:flex items-center gap-7 text-sm font-medium text-zinc-300"
        >
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'top')}
            className="hover:text-white transition-colors underline-offset-4 hover:underline whitespace-nowrap shrink-0 cursor-pointer py-2"
          >
            {t.nav.home}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'specialties')}
            className="hover:text-white transition-colors underline-offset-4 hover:underline whitespace-nowrap shrink-0 cursor-pointer py-2"
          >
            {t.nav.specialties}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'menu')}
            className="hover:text-white transition-colors underline-offset-4 hover:underline whitespace-nowrap shrink-0 cursor-pointer py-2"
          >
            {t.nav.menu}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'location')}
            className="hover:text-white transition-colors underline-offset-4 hover:underline whitespace-nowrap shrink-0 cursor-pointer py-2"
          >
            {t.nav.location}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('pro')}
            className={`transition-colors underline-offset-4 hover:underline whitespace-nowrap shrink-0 cursor-pointer py-2 ${
              activeView === 'pro' ? 'text-orange-400 font-semibold' : 'hover:text-white'
            }`}
          >
            {t.nav.pro}
          </button>
        </nav>

        {/* Zone 3: Visible top-right Language Switcher (FR / EN) + Mobile Drawer Trigger */}
        <div className="flex items-center gap-2 shrink-0">
          <div
            role="group"
            aria-label="Sélecteur de langue"
            className="inline-flex items-center rounded-lg bg-zinc-900 border border-zinc-800 p-0.5"
          >
            <button
              type="button"
              onClick={() => setLanguage('fr')}
              aria-pressed={language === 'fr'}
              className={`min-h-[36px] px-2.5 sm:px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                language === 'fr'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              🇫🇷 FR
            </button>
            <button
              type="button"
              onClick={() => setLanguage('en')}
              aria-pressed={language === 'en'}
              className={`min-h-[36px] px-2.5 sm:px-3 text-xs font-semibold rounded-md transition-colors whitespace-nowrap shrink-0 cursor-pointer ${
                language === 'en'
                  ? 'bg-red-600 text-white shadow-sm'
                  : 'text-zinc-400 hover:text-zinc-100'
              }`}
            >
              🇬🇧 EN
            </button>
          </div>

          <button
            type="button"
            onClick={() => setMobileMenuOpen((prev) => !prev)}
            aria-expanded={mobileMenuOpen}
            aria-label={mobileMenuOpen ? t.menu.close : 'Menu'}
            className="md:hidden min-h-[44px] min-w-[44px] flex items-center justify-center rounded-lg text-zinc-300 hover:text-white hover:bg-zinc-900 transition-colors cursor-pointer"
          >
            {mobileMenuOpen ? <X className="w-5 h-5" /> : <Menu className="w-5 h-5" />}
          </button>
        </div>
      </div>

      {/* Mobile Navigation Drawer */}
      {mobileMenuOpen && (
        <div className="md:hidden border-t border-zinc-800 bg-[#0D0D10] px-4 py-3 space-y-1">
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'top')}
            className="w-full min-h-[44px] px-3 flex items-center text-left text-sm font-medium text-zinc-200 hover:bg-zinc-900 rounded-lg cursor-pointer"
          >
            {t.nav.home}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'specialties')}
            className="w-full min-h-[44px] px-3 flex items-center text-left text-sm font-medium text-zinc-200 hover:bg-zinc-900 rounded-lg cursor-pointer"
          >
            {t.nav.specialties}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'menu')}
            className="w-full min-h-[44px] px-3 flex items-center text-left text-sm font-medium text-zinc-200 hover:bg-zinc-900 rounded-lg cursor-pointer"
          >
            {t.nav.menu}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('customer', 'location')}
            className="w-full min-h-[44px] px-3 flex items-center text-left text-sm font-medium text-zinc-200 hover:bg-zinc-900 rounded-lg cursor-pointer"
          >
            {t.nav.location}
          </button>
          <button
            type="button"
            onClick={() => handleLinkClick('pro')}
            className="w-full min-h-[44px] px-3 flex items-center text-left text-sm font-semibold text-orange-400 hover:bg-zinc-900 rounded-lg cursor-pointer"
          >
            {t.nav.pro}
          </button>
        </div>
      )}
    </header>
  );
};

# SMARTMENU QR — Architecture, Configuration & Déploiement

## 1. Architecture du projet

- **Frontend (React 19 + TypeScript + Tailwind CSS v4 + Vite)**
  - `src/App.tsx` : Coquille principale avec chargement différé (`React.lazy`) de l'Espace Pro et des tiroirs modaux pour alléger la charge initiale sur mobile.
  - `src/components/` : Interface client responsive en cartes horizontales compactes (`MenuCatalog`, `SpecialtiesSection`, `PopularSection`), détail plat (`DishDetailModal`), panier client (`CartDrawer`), générateur/impression QR (`QRCodeModal`) et indicateur réseau (`OfflineIndicator`).
  - `src/components/pro/` : Authentification multi-rôles (`ProAuthGate`), tableau de bord Super Admin (`AdminDashboard`), espace Restaurateur isolé (`RestaurateurDashboard`) et gestionnaire de catalogue (`ProductManager`).
- **Couche Hors Ligne & Synchronisation**
  - `vite.config.ts` (`vite-plugin-pwa` + Workbox) : Génère le manifeste PWA et met en cache l'application, les polices et les images WebP/JPG. **Une première visite connectée est indispensable pour mettre le menu en cache avant toute consultation hors ligne.**
  - `src/services/offlineStore.ts` : Stockage **IndexedDB** (`catalog_v2`, `sync_outbox`, jetons renouvelables hachés) avec repli `localStorage`, file ordonnée par dépendances et fusion automatique des éditions successives.
  - `src/services/syncService.ts` : Synchronisation optimiste à verrou unique, réessais automatiques progressifs, résolution ciblée des conflits sans perte des autres modifications et repli transparent vers le serveur local Wi-Fi.
- **Serveur Local Wi-Fi Windows**
  - `local-server/server.mjs` & `local-server/sync-cloud.mjs` : Serveur Express autonome hébergeant le build `dist/`, l'API locale `/api/catalog` (avec protection des modifications locales en attente), les médias `/local-uploads/*` et le miroir `/api/cached-image` sur le réseau Wi-Fi du restaurant.
- **Images optimisées**
  - `src/assets/images/*-thumb.webp` (miniatures 280px, ~7 à 14 Ko) et `*-md.webp` (800px) servies via `<picture>` + `loading="lazy"` + dimensions explicites, avec repli automatique vers le miroir local `/api/cached-image`.

---

## 2. Configuration Supabase (Production Cloud)

Pour activer la base PostgreSQL, l'authentification renouvelable et le stockage cloud :

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Exécuter le script SQL idempotent **`supabase/schema.sql`** (ou ses parties validées) dans le **SQL Editor** Supabase (crée `restaurants`, `profiles`, `app_credentials`, `app_sessions`, `app_refresh_tokens`, `categories`, `menu_items`, le bucket Storage `restaurant-assets`, les fonctions RPC sécurisées et les politiques **RLS** par `restaurant_id`).
3. Initialiser le compte Super Admin depuis l'interface Pro (ou vérifier les profils dans `public.profiles`) et créer les comptes restaurateurs depuis le tableau de bord.
4. Configurer uniquement les clés publiques dans `.env` (ne jamais exposer `SUPABASE_SERVICE_ROLE_KEY` avec un préfixe `VITE_`) :
   ```env
   VITE_SUPABASE_URL="https://VOTRE-PROJET.supabase.co"
   VITE_SUPABASE_ANON_KEY="VOTRE_CLE_ANON_PUBLIQUE"
   ```

---

## 3. Déploiement Cloud

1. Compiler l'application :
   ```bash
   npm run build
   ```
2. Déployer le dossier `dist/` sur Vercel, Netlify, Cloudflare Pages ou Cloud Run en renseignant `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY`.
3. Vérifier que le site est servi en **HTTPS** (obligatoire pour l'installation PWA et le Service Worker sur Android et iOS).

---

## 4. Limites techniques & Notes d'exploitation

- **Authentification & Base de données** : Sans `VITE_SUPABASE_URL` ni `VITE_SUPABASE_ANON_KEY`, l'authentification et les modifications utilisent le serveur local PC Windows (`local-server/data/`) ou le stockage local du navigateur.
- **Commandes en salle** : Le panier permet au client de composer sa sélection et de copier/présenter le récapitulatif, sans transmission automatique en cuisine tant qu'un endpoint POS temps réel n'est pas branché.
- **Serveur Windows** : Installé sur le PC du restaurant via le véritable installateur **`windows-installer/output/SmartMenu-QR-Setup.exe`** et piloté en 1 clic par **`SmartMenuQR.exe`** (`docs/GUIDE-INSTALLATION-WINDOWS.md` et `docs/WINDOWS-LOCAL-SERVER.md`).


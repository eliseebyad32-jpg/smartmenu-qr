# SMARTMENU QR — Architecture, Configuration & Déploiement

## 1. Architecture du projet

- **Frontend (React 19 + TypeScript + Tailwind CSS v4 + Vite)**
  - `src/App.tsx` : Coquille principale avec chargement différé (`React.lazy`) de l'Espace Pro et des tiroirs modaux pour alléger la charge initiale sur mobile.
  - `src/components/` : Interface client responsive en cartes horizontales compactes (`MenuCatalog`, `SpecialtiesSection`, `PopularSection`), détail plat (`DishDetailModal`), panier client (`CartDrawer`), générateur/impression QR (`QRCodeModal`) et indicateur réseau (`OfflineIndicator`).
  - `src/components/pro/` : Authentification multi-rôles (`ProAuthGate`), tableau de bord Super Admin (`AdminDashboard`), espace Restaurateur isolé (`RestaurateurDashboard`) et gestionnaire de catalogue (`ProductManager`).
- **Couche Hors Ligne & Synchronisation**
  - `vite.config.ts` (`vite-plugin-pwa` + Workbox) : Génère le manifeste PWA et met en cache l'application, les polices et les images WebP/JPG. **Une première visite connectée est indispensable pour mettre le menu en cache avant toute consultation hors ligne.**
  - `src/services/offlineStore.ts` : Stockage **IndexedDB** (`catalog_v2` + `sync_outbox`) avec repli `localStorage`.
  - `src/services/syncService.ts` : Synchronisation optimiste avec détection de conflit (`HTTP 409`) et résolution manuelle sans perte silencieuse.
- **Serveur Local Wi-Fi Windows**
  - `local-server/server.mjs` : Serveur Express autonome pour héberger le build `dist/` et l'API locale `/api/catalog` sur le réseau Wi-Fi du restaurant.
- **Images optimisées**
  - `src/assets/images/*-thumb.webp` (miniatures 280px, ~7 à 14 Ko) et `*-md.webp` (800px) servies via `<picture>` + `loading="lazy"` + dimensions explicites.

---

## 2. Configuration Supabase (Production Cloud)

L'application fonctionne actuellement avec une persistance locale de démonstration. Pour activer la base PostgreSQL, l'authentification et le stockage cloud :

1. Créer un projet sur [supabase.com](https://supabase.com).
2. Exécuter l'intégralité du fichier **`supabase/schema.sql`** dans le **SQL Editor** Supabase (crée `restaurants`, `profiles`, `categories`, `menu_items`, le bucket Storage `restaurant-assets` et les politiques **RLS** par `restaurant_id`).
3. Dans **Authentication → Users**, créer les utilisateurs et insérer leurs rôles (`super_admin` ou `restaurateur` + `restaurant_id`) dans `public.profiles`.
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

## 4. Limites techniques actuelles & Prochaines étapes

- **Authentification & Base de données** : Tant que `VITE_SUPABASE_URL` et `VITE_SUPABASE_ANON_KEY` ne sont pas renseignées, l'authentification et les modifications restent stockées localement dans le navigateur (ou sur le serveur local Node si lancé).
- **Commandes en salle** : Le panier permet au client de composer sa sélection et de copier/présenter le récapitulatif, mais n'envoie pas de commande vers une cuisine ou caisse POS tant qu'un endpoint de réception temps réel n'est pas branché.
- **Serveur Windows** : Nécessite une installation manuelle sur le PC du restaurant selon `docs/WINDOWS-LOCAL-SERVER.md`.

# SMARTMENU QR — Installation et Utilisation du Serveur Local Windows

> **Important :** Tous les fichiers et scripts sont prêts, **mais le serveur n'est pas préinstallé sur votre PC Windows**. Pour une installation guidée sans aucune ligne de commande, consultez **[docs/GUIDE-INSTALLATION-WINDOWS.md](./GUIDE-INSTALLATION-WINDOWS.md)** et double-cliquez simplement sur **`INSTALLER-SMARTMENU-WINDOWS.bat`** à la racine du projet.

---

## Contenu des scripts Windows

- **`INSTALLER-SMARTMENU-WINDOWS.bat`** *(à la racine)* : Lance directement l'assistant graphique Windows (`local-server/installer-ui.ps1`) — zéro commande à taper.
- **`local-server/installer-ui.ps1`** : Interface graphique Windows (vérification/installation Node.js LTS, `.env` Supabase, isolation restaurant ou mode multi-restaurants, règle Pare-feu Wi-Fi, compilation `dist/`, pré-synchronisation Supabase, création des raccourcis Bureau **Démarrer SMARTMENU QR** & **Arrêter SMARTMENU QR**).
- **`local-server/setup-windows.bat`** : Script console de secours si l'assistant graphique ne peut pas s'ouvrir.
- **`local-server/start-windows.bat`** : Synchronise rapidement depuis Supabase si Internet est disponible, puis démarre le serveur Wi-Fi local (ou ouvre directement l'URL locale s'il tourne déjà).
- **`local-server/stop-windows.bat`** : Arrête proprement uniquement le processus serveur SMARTMENU QR.
- **`local-server/sync-windows.bat`** : Force en 1 clic le téléchargement des dernières mises à jour (menus, prix, plats, images) depuis Supabase vers le disque du PC.
- **`local-server/server.mjs` & `local-server/sync-cloud.mjs`** : Moteur serveur Express + moteur de synchronisation REST/images sur le PC.
- **`local-server/config.example.json`** : Modèle de configuration pour `local-server/config.json`.

---

## Étape 1 — Prérequis et lancement en 1 double-clic

1. Copiez le dossier complet du projet **SMARTMENU QR** sur le PC du restaurant (exemple : `C:\SMARTMENU-QR`).
2. Double-cliquez sur **`INSTALLER-SMARTMENU-WINDOWS.bat`** à la racine du dossier.
3. Si **Node.js LTS** n'est pas encore présent sur le PC, cliquez sur **« Installer Node.js LTS »** directement dans l'assistant graphique.

---

## Étape 2 — Installation automatique (1 seule fois)

Dans la fenêtre **SMARTMENU QR — Serveur Local & Synchronisation** :

1. Choisissez le mode **isolé sur un restaurant** (slug ex. `rocomamas-lubumbashi`) ou **multi-restaurants** (case décochée).
2. Vérifiez le **Port local** (`3000` par défaut) et vos clés **Supabase** (`.env` existant préservé automatiquement).
3. Cliquez sur **« Installer automatiquement »** : l'assistant installe les paquets, ouvre le port Wi-Fi dans le Pare-feu Windows, compile l'application PWA (`dist/`), pré-synchronise le menu + les images sur le disque et crée sur le Bureau les deux raccourcis **Démarrer SMARTMENU QR** et **Arrêter SMARTMENU QR**.

> **Astuce stabilité Wi-Fi :** Dans votre routeur Wi-Fi, attribuez une **IP locale fixe (réservation DHCP)** au PC Windows (ex. `192.168.1.50`) pour que les QR Codes imprimés sur les tables restent valides après chaque redémarrage du PC ou du routeur.

---

## Étape 3 — Démarrer et connecter les téléphones sur le Wi-Fi

1. Double-cliquez sur **`local-server\start-windows.bat`** (ou sur le raccourci Bureau **SMARTMENU QR Serveur**).
2. Le terminal affiche l'adresse locale à utiliser sur votre Wi-Fi, par exemple :
   ```text
   SMARTMENU QR — Serveur Local Wi-Fi actif sur le port 3000
   - Mode isolé restaurant : rocomamas-lubumbashi
   - Sur ce PC : http://localhost:3000
   - Sur le réseau Wi-Fi local : http://192.168.1.50:3000
   - Lien QR client recommandé : http://192.168.1.50:3000/?restaurant=rocomamas-lubumbashi
   ```
3. Connectez les smartphones des clients au **même réseau Wi-Fi** (même sans connexion Internet sur le routeur).
4. Ouvrez **Espace Pro → QR Code de table** sur le PC : le modal détecte le serveur local et propose **« Utiliser l’adresse Wi-Fi locale (sans Internet) »** afin d'imprimer des QR Codes pointant vers l'adresse LAN (`http://192.168.1.50:3000/?restaurant=...`).

> **Précision technique sur les images et le mode hors ligne :**
> - Sur l'adresse locale Wi-Fi (`http://192.168.x.x:3000`), les téléphones chargent directement le menu, les WebP locaux (`/src/assets/images/*`), les photos importées hors ligne (`/local-uploads/*`) et les photos Supabase mises en miroir sur le PC (`/api/cached-image`), sans aucun accès à Internet.
> - *Note navigateur* : les navigateurs mobiles (Chrome Android / Safari iOS) n'activent le Service Worker PWA que sur `https://` ou `http://localhost`, pas sur une IP locale HTTP nue (`http://192.168.x.x`). En salle sur Wi-Fi local, c'est donc le **serveur PC Windows** qui assure la disponibilité continue sans Internet ; sur votre domaine public `https://`, c'est le Service Worker PWA qui prend le relais.

---

## Étape 4 — Arrêter, redémarrer et synchroniser avec Supabase

- **Arrêter le serveur** : appuyez sur `Ctrl + C` dans la fenêtre du serveur ou double-cliquez sur **`local-server\stop-windows.bat`**.
- **Synchronisation automatique au retour d'Internet** :
  - **PC → Supabase** : toute modification faite hors ligne dans l'Espace Pro (nouveau plat, prix, disponibilité, catégorie, photo locale `/local-uploads/...`) est conservée dans IndexedDB (`sync_outbox`) et envoyée vers Supabase (Storage + PostgreSQL) dès le retour d'Internet (sans doublons grâce aux `upsert` par `id`, avec bandeau de résolution en cas de conflit).
  - **Supabase → PC** : tant que le serveur local tourne avec Internet, il rafraîchit le catalogue et le cache d'images local toutes les 5 minutes (`autoSyncMinutes: 5`), à chaque démarrage (`start-windows.bat`), ou manuellement en double-cliquant sur **`local-server\sync-windows.bat`**.

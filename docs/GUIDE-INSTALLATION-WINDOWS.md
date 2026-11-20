# SMARTMENU QR — Guide très simple d'installation sur PC Windows

> **Important :** Le serveur n'est **pas** encore installé sur votre ordinateur Windows. Vous n'avez **aucune commande** à taper dans PowerShell ou CMD : tout se fait par double-clic et via une fenêtre graphique simple.

---

## Avant de commencer

1. Copiez le dossier complet **SMARTMENU QR** sur le PC Windows du restaurant (par exemple sur `C:\SMARTMENU-QR` ou dans `Documents\SMARTMENU-QR`).
2. Assurez-vous que le PC est connecté à Internet **uniquement la première fois** pour télécharger les composants et récupérer votre menu Supabase (ensuite, le restaurant pourra fonctionner même sans Internet).

---

## Étape 1 — Lancer l'installateur graphique (1 double-clic)

1. Ouvrez le dossier **SMARTMENU QR**.
2. Double-cliquez sur le fichier **`INSTALLER-SMARTMENU-WINDOWS.bat`**.
3. Une fenêtre s'ouvre automatiquement : **« SMARTMENU QR — Serveur Local & Synchronisation »**.

---

## Étape 2 — Vérifier les options dans la fenêtre

Dans l'assistant graphique :

1. **Node.js** (en haut de la fenêtre) :
   - S'il est affiché en vert (**« Node.js détecté (prêt) »**), passez directement à la suite.
   - Sinon, cliquez simplement sur le bouton orange **« Installer Node.js LTS »**, attendez la fin de l'installation automatique, puis passez à la suite.
2. **Restaurant & isolation** :
   - Laissez coché **« Isoler ce PC uniquement sur un restaurant »** et indiquez le **slug** du restaurant (ex. `rocomamas-lubumbashi`).
   - *Décocher* cette case permet au contraire de conserver le mode **multi-restaurants** complet sur ce PC.
3. **Supabase** :
   - Vérifiez ou collez votre **URL Supabase** et votre **clé publique (`anon key`)**. Si un fichier `.env` existe déjà, vos paramètres sont pré-remplis et conservés.
4. **Cases cochées par défaut** (laissez-les cochées) :
   - Configurer l'accès Wi-Fi des téléphones (Pare-feu Windows) — acceptez la fenêtre Windows si elle demande votre confirmation.
   - Créer le raccourci Bureau **« Démarrer SMARTMENU QR »**.
   - Créer le raccourci Bureau **« Arrêter SMARTMENU QR »**.
   - Pré-télécharger le menu et les images depuis Supabase.
5. Cliquez sur le bouton rouge **« Installer automatiquement »** et attendez que la barre atteigne **100 %**.

---

## Étape 3 — Démarrer le serveur et connecter les téléphones sur le Wi-Fi

1. Cliquez sur le bouton vert **« Démarrer le serveur »** dans l'installateur (ou double-cliquez plus tard sur le raccourci **`Démarrer SMARTMENU QR`** sur votre Bureau).
2. L'adresse Wi-Fi locale s'affiche, par exemple : `http://192.168.1.50:3000`.
3. Connectez les téléphones des clients au **même réseau Wi-Fi** que ce PC (même si Internet est coupé).
4. Dans l'**Espace Pro → QR Code**, activez l'option **« Utiliser l’adresse Wi-Fi locale (sans Internet) »** et imprimez vos QR Codes de table.

---

## Utilisation au quotidien (sur le Bureau Windows)

- **Allumer le serveur :** double-cliquez sur **`Démarrer SMARTMENU QR`** sur votre Bureau.
- **Éteindre le serveur :** double-cliquez sur **`Arrêter SMARTMENU QR`** sur votre Bureau.
- **Synchronisation avec Supabase :** dès qu'Internet est disponible, les modifications faites hors ligne (plats, prix, images) sont envoyées automatiquement vers Supabase et les nouveautés du cloud sont téléchargées automatiquement sur le PC toutes les 5 minutes.

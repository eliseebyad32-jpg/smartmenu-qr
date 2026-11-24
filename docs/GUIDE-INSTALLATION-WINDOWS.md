# SMARTMENU QR — Guide d'installation simple sur Windows 10 / 11

> **Objectif :** Installer SmartMenu QR comme un logiciel Windows classique, sans ouvrir de terminal et sans aucune manipulation technique.

---

## 1. Installation en quelques clics (`SmartMenu-QR-Setup.exe`)

1. Récupérez le fichier **`SmartMenu-QR-Setup.exe`** (situé dans `windows-installer/output/SmartMenu-QR-Setup.exe`).
2. **Double-cliquez sur `SmartMenu-QR-Setup.exe`** et acceptez la demande Windows *(Autoriser cette application à apporter des modifications)*.
3. Suivez l'assistant :
   - L'assistant **détecte automatiquement votre réseau Wi-Fi et l'adresse IP du PC** (exemple : `http://192.168.1.50:3000`).
   - Vérifiez le mode souhaité : **un seul restaurant** (ex. `rocomamas-lubumbashi`) ou **multi-restaurants**.
   - Les paramètres nécessaires (Node.js intégré, application compilée, Pare-feu Windows, accès Supabase) sont configurés **automatiquement**.
   - Cochez si vous le souhaitez **« Lancer automatiquement SmartMenu QR après le démarrage de Windows »**.
4. Cliquez sur **Installer**, puis sur **Terminer** (en laissant coché *Démarrer SmartMenu QR maintenant*).

Un raccourci **SmartMenu QR** est automatiquement créé sur votre **Bureau Windows** et dans le **Menu Démarrer**.

---

## 2. Utilisation au quotidien (1 clic)

Double-cliquez sur l'icône **SmartMenu QR** sur le Bureau :

- **Démarrer / Arrêter le serveur** : un seul bouton dans la fenêtre (ou clic droit sur l'icône près de l'horloge Windows).
- **Ouvrir dans le navigateur** : ouvre directement le menu sur ce PC (`http://localhost:3000`).
- **Copier l'adresse Wi-Fi** : copie l'adresse exacte pour les téléphones des clients (`http://192.168.x.x:3000/?restaurant=...`).
- **Synchroniser depuis Supabase** : télécharge les dernières nouveautés du cloud sur le PC en 1 clic (automatique aussi toutes les 5 minutes dès qu'Internet est disponible).
- **Lancer automatiquement après le démarrage de Windows** : cochez ou décochez cette option à tout moment dans la fenêtre.
- **Fermer la fenêtre (`X`)** : réduit SmartMenu QR près de l'horloge sans couper le Wi-Fi des clients. Pour couper le serveur complètement, cliquez sur **Arrêter et Quitter**.

---

## 3. Mise à jour simple (sans perte de données)

Toutes vos données locales (menus, plats, prix, photos ajoutées hors ligne, comptes et configuration) sont enregistrées séparément dans `C:\ProgramData\SmartMenuQR`.

Pour mettre à jour SmartMenu QR :

- **Pour mettre à jour les menus et photos** : cliquez simplement sur **Synchroniser depuis Supabase** (ou attendez la synchronisation automatique).
- **Pour installer une nouvelle version du logiciel** :
  1. Double-cliquez directement sur le nouveau **`SmartMenu-QR-Setup.exe`** (ou cliquez sur **Mettre à jour (.exe)...** dans SmartMenu QR).
  2. L'assistant arrête le serveur, met à jour le logiciel et **conserve 100 % de vos données et réglages locaux automatiquement**.

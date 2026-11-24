# SMARTMENU QR — Architecture du Serveur Local Windows (.exe)

> Pour le guide utilisateur pas-à-pas sans terminal, consultez **[docs/GUIDE-INSTALLATION-WINDOWS.md](./GUIDE-INSTALLATION-WINDOWS.md)**.

---

## Composants de la solution Windows 10 / 11

- **`windows-installer/output/SmartMenu-QR-Setup.exe`** : Véritable installateur Windows (NSIS Unicode) incluant :
  - Le runtime **Node.js v22 LTS x64** intégré (aucun prérequis à installer séparément).
  - L'application PWA précompilée (`dist/`), le serveur Express (`local-server/server.mjs`) et le moteur de synchronisation (`local-server/sync-cloud.mjs`).
  - L'application de contrôle native Windows **`SmartMenuQR.exe`** (interface graphique + icône près de l'horloge Windows).
  - La configuration automatique du **Pare-feu Windows**, des **raccourcis Bureau / Menu Démarrer**, du **démarrage automatique optionnel** (`HKCU\Software\Microsoft\Windows\CurrentVersion\Run`) et du **désinstallateur Windows** (*Ajouter ou supprimer des programmes*).
- **Séparation programme / données (mises à jour sans perte)** :
  - **Programme** : `C:\Program Files\SmartMenu QR\` (`SmartMenuQR.exe`, `runtime\node.exe`, `app\`).
  - **Données persistantes** : `C:\ProgramData\SmartMenuQR\` (`config.json`, `.env`, `data\catalog.json`, `data\local-auth.json`, `data\uploads\`, `data\image-cache\`, `logs\server.log`).
  - Lors d'une mise à jour par `.exe` (ou via le bouton **Mettre à jour (.exe)...** dans `SmartMenuQR.exe`), seul le dossier programme est remplacé : toutes les données locales du restaurant sont conservées intactes.

---

## Recompiler l'installateur (développeur / poste de build)

Après modification du frontend ou du serveur local :

```bash
npm run build:windows-installer
```

Ce script compile le frontend (`vite build`), compile `SmartMenuQR.exe`, collecte les dépendances runtime (`express`, `dotenv`) et génère `windows-installer/output/SmartMenu-QR-Setup.exe`.

*(Les scripts `.bat` historiques dans `local-server/` et à la racine restent disponibles comme solution de secours pour un usage manuel depuis un dossier source.)*

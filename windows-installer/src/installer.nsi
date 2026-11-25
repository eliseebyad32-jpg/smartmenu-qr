Unicode True

!ifndef OUT_FILE
  !define OUT_FILE "../output/SmartMenu-QR-Setup.exe"
!endif
!ifndef SRC_DIR
  !define SRC_DIR "."
!endif
!ifndef STAGING_DIR
  !define STAGING_DIR "../.staging"
!endif

!define APP_NAME "SmartMenu QR"
!define APP_VERSION "1.0.0"
!define APP_PUBLISHER "SmartMenu QR"
!define APP_EXE "SmartMenuQR.exe"
!define UNINSTALL_REG_KEY "Software\Microsoft\Windows\CurrentVersion\Uninstall\SmartMenuQR"

Name "${APP_NAME}"
OutFile "${OUT_FILE}"
InstallDir "$PROGRAMFILES64\SmartMenu QR"
InstallDirRegKey HKLM "${UNINSTALL_REG_KEY}" "InstallLocation"
RequestExecutionLevel admin
SetCompressor /SOLID lzma
ManifestDPIAware true

!include "MUI2.nsh"
!include "nsDialogs.nsh"
!include "LogicLib.nsh"
!include "x64.nsh"

!define MUI_ICON "${SRC_DIR}/smartmenu.ico"
!define MUI_UNICON "${SRC_DIR}/smartmenu.ico"
!define MUI_ABORTWARNING

!define MUI_WELCOMEPAGE_TITLE "Bienvenue dans l'installateur de SmartMenu QR"
!define MUI_WELCOMEPAGE_TEXT "Cet assistant installe SmartMenu QR et son serveur local Wi-Fi sur votre PC Windows.$\r$\n$\r$\n• Aucun terminal ni compétence technique requis.$\r$\n• Détection automatique de votre réseau Wi-Fi et de l'adresse IP.$\r$\n• Vos données locales (menus, images, comptes) sont conservées lors des mises à jour.$\r$\n$\r$\nCliquez sur Suivant pour continuer."

!define MUI_FINISHPAGE_RUN "$INSTDIR\${APP_EXE}"
!define MUI_FINISHPAGE_RUN_TEXT "Démarrer SmartMenu QR maintenant"

!insertmacro MUI_PAGE_WELCOME
!insertmacro MUI_PAGE_DIRECTORY
Page custom ConfigPageCreate ConfigPageLeave
!insertmacro MUI_PAGE_INSTFILES
!insertmacro MUI_PAGE_FINISH

!insertmacro MUI_UNPAGE_CONFIRM
!insertmacro MUI_UNPAGE_INSTFILES

!insertmacro MUI_LANGUAGE "French"

Var DataRoot
Var DetectedIp
Var IsUpgradeMode
Var OptIsolate
Var OptSlug
Var OptPort
Var OptSbUrl
Var OptSbKey
Var OptFirewall
Var OptDesktopShortcut
Var OptAutoStart

Var CtlDialog
Var CtlNotice
Var CtlIpLabel
Var CtlChkIsolate
Var CtlTxtSlug
Var CtlTxtPort
Var CtlTxtSbUrl
Var CtlTxtSbKey
Var CtlChkFirewall
Var CtlChkDesktop
Var CtlChkAutoStart

Function TrimLineEnding
  Exch $R0
  Push $R1
  loop:
    StrLen $R1 $R0
    IntCmp $R1 0 done
    StrCpy $R1 $R0 1 -1
    ${If} $R1 == "$\r"
    ${OrIf} $R1 == "$\n"
      StrCpy $R0 $R0 -1
      Goto loop
    ${EndIf}
  done:
  Pop $R1
  Exch $R0
FunctionEnd

Function ParseHelperOutput
  StrCpy $DetectedIp ""
  StrCpy $OptPort "3000"
  StrCpy $OptSlug "rocomamas-lubumbashi"
  StrCpy $OptIsolate "1"
  StrCpy $OptSbUrl ""
  StrCpy $OptSbKey ""
  StrCpy $IsUpgradeMode "0"
  StrCpy $OptAutoStart "0"
  StrCpy $OptFirewall "1"
  StrCpy $OptDesktopShortcut "1"

  nsExec::ExecToStack 'powershell.exe -NoProfile -ExecutionPolicy Bypass -File "$PLUGINSDIR\setup-helper.ps1" -DefaultsEnvPath "$PLUGINSDIR\env.defaults"'
  Pop $0
  Pop $1

  ${If} $0 == 0
    StrCpy $R2 0
    StrLen $R3 $1
    StrCpy $R4 ""
    ${DoWhile} $R2 < $R3
      StrCpy $R5 $1 1 $R2
      ${If} $R5 == "$\n"
        Push $R4
        Call TrimLineEnding
        Pop $R4
        StrCpy $R6 $R4 3
        ${If} $R6 == "IP="
          StrCpy $DetectedIp $R4 "" 3
        ${Else}
          StrCpy $R6 $R4 5
          ${If} $R6 == "PORT="
            StrCpy $OptPort $R4 "" 5
          ${ElseIf} $R6 == "SLUG="
            StrCpy $OptSlug $R4 "" 5
          ${ElseIf} $R6 == "SBURL="
            StrCpy $OptSbUrl $R4 "" 6
          ${ElseIf} $R6 == "SBKEY="
            StrCpy $OptSbKey $R4 "" 6
          ${Else}
            StrCpy $R6 $R4 8
            ${If} $R6 == "ISOLATE="
              StrCpy $OptIsolate $R4 "" 8
            ${ElseIf} $R6 == "UPGRADE="
              StrCpy $IsUpgradeMode $R4 "" 8
            ${Else}
              StrCpy $R6 $R4 10
              ${If} $R6 == "AUTOSTART="
                StrCpy $OptAutoStart $R4 "" 10
              ${EndIf}
            ${EndIf}
          ${EndIf}
        ${EndIf}
        StrCpy $R4 ""
      ${Else}
        StrCpy $R4 "$R4$R5"
      ${EndIf}
      IntOp $R2 $R2 + 1
    ${Loop}
  ${EndIf}
FunctionEnd

Function OnIsolateToggle
  ${NSD_GetState} $CtlChkIsolate $0
  ${If} $0 == ${BST_CHECKED}
    EnableWindow $CtlTxtSlug 1
  ${Else}
    EnableWindow $CtlTxtSlug 0
  ${EndIf}
FunctionEnd

Function ConfigPageCreate
  !insertmacro MUI_HEADER_TEXT "Configuration automatique du serveur local" "Vérifiez les paramètres détectés avant d'installer."

  Call ParseHelperOutput

  nsDialogs::Create 1018
  Pop $CtlDialog
  ${If} $CtlDialog == error
    Abort
  ${EndIf}

  ${If} $IsUpgradeMode == "1"
    ${NSD_CreateLabel} 0 0u 100% 18u "Mise à jour détectée : vos menus, photos et comptes locaux seront conservés."
    Pop $CtlNotice
    SetCtlColors $CtlNotice 0x059669 transparent
  ${Else}
    ${NSD_CreateLabel} 0 0u 100% 18u "Les paramètres détectés sont pré-remplis. Vous pourrez les modifier à tout moment."
    Pop $CtlNotice
  ${EndIf}

  ${If} $DetectedIp != ""
    ${NSD_CreateLabel} 0 20u 100% 14u "Réseau Wi-Fi / LAN détecté automatiquement : http://$DetectedIp:$OptPort"
  ${Else}
    ${NSD_CreateLabel} 0 20u 100% 14u "Détection automatique du réseau Wi-Fi active au démarrage du serveur."
  ${EndIf}
  Pop $CtlIpLabel

  ${NSD_CreateCheckbox} 0 38u 100% 13u "Isoler ce PC sur un seul restaurant (recommandé en salle)"
  Pop $CtlChkIsolate
  ${If} $OptIsolate == "1"
    ${NSD_Check} $CtlChkIsolate
  ${EndIf}
  ${NSD_OnClick} $CtlChkIsolate OnIsolateToggle

  ${NSD_CreateLabel} 0 55u 68% 12u "Identifiant / Slug du restaurant :"
  Pop $0
  ${NSD_CreateText} 0 67u 68% 13u "$OptSlug"
  Pop $CtlTxtSlug
  ${If} $OptIsolate != "1"
    EnableWindow $CtlTxtSlug 0
  ${EndIf}

  ${NSD_CreateLabel} 72% 55u 28% 12u "Port local :"
  Pop $0
  ${NSD_CreateNumber} 72% 67u 28% 13u "$OptPort"
  Pop $CtlTxtPort

  ${NSD_CreateLabel} 0 85u 100% 12u "URL Supabase (optionnel — synchronisation Cloud) :"
  Pop $0
  ${NSD_CreateText} 0 97u 100% 13u "$OptSbUrl"
  Pop $CtlTxtSbUrl

  ${NSD_CreateLabel} 0 114u 100% 12u "Clé publique Anon Supabase (optionnel) :"
  Pop $0
  ${NSD_CreateText} 0 126u 100% 13u "$OptSbKey"
  Pop $CtlTxtSbKey

  ${NSD_CreateCheckbox} 0 144u 100% 12u "Ouvrir automatiquement le port Wi-Fi dans le Pare-feu Windows"
  Pop $CtlChkFirewall
  ${NSD_Check} $CtlChkFirewall

  ${NSD_CreateCheckbox} 0 158u 100% 12u "Créer le raccourci « SmartMenu QR » sur le Bureau Windows"
  Pop $CtlChkDesktop
  ${NSD_Check} $CtlChkDesktop

  ${NSD_CreateCheckbox} 0 172u 100% 12u "Lancer automatiquement SmartMenu QR après le démarrage de Windows"
  Pop $CtlChkAutoStart
  ${If} $OptAutoStart == "1"
    ${NSD_Check} $CtlChkAutoStart
  ${EndIf}

  nsDialogs::Show
FunctionEnd

Function ConfigPageLeave
  ${NSD_GetState} $CtlChkIsolate $OptIsolate
  ${If} $OptIsolate == ${BST_CHECKED}
    StrCpy $OptIsolate "1"
  ${Else}
    StrCpy $OptIsolate "0"
  ${EndIf}

  ${NSD_GetText} $CtlTxtSlug $OptSlug
  ${NSD_GetText} $CtlTxtPort $OptPort
  ${If} $OptPort == ""
    StrCpy $OptPort "3000"
  ${EndIf}
  ${NSD_GetText} $CtlTxtSbUrl $OptSbUrl
  ${NSD_GetText} $CtlTxtSbKey $OptSbKey

  ${NSD_GetState} $CtlChkFirewall $OptFirewall
  ${If} $OptFirewall == ${BST_CHECKED}
    StrCpy $OptFirewall "1"
  ${Else}
    StrCpy $OptFirewall "0"
  ${EndIf}

  ${NSD_GetState} $CtlChkDesktop $OptDesktopShortcut
  ${If} $OptDesktopShortcut == ${BST_CHECKED}
    StrCpy $OptDesktopShortcut "1"
  ${Else}
    StrCpy $OptDesktopShortcut "0"
  ${EndIf}

  ${NSD_GetState} $CtlChkAutoStart $OptAutoStart
  ${If} $OptAutoStart == ${BST_CHECKED}
    StrCpy $OptAutoStart "1"
  ${Else}
    StrCpy $OptAutoStart "0"
  ${EndIf}
FunctionEnd

Function .onInit
  InitPluginsDir
  File "/oname=$PLUGINSDIR\setup-helper.ps1" "${SRC_DIR}/setup-helper.ps1"
  File "/oname=$PLUGINSDIR\write-config.mjs" "${SRC_DIR}/write-config.mjs"
  File "/oname=$PLUGINSDIR\env.defaults" "${STAGING_DIR}/env.defaults"
  SetShellVarContext all
  StrCpy $DataRoot "$APPDATA\SmartMenuQR"
FunctionEnd

Section "SmartMenu QR" SecMain
  SetShellVarContext all
  StrCpy $DataRoot "$APPDATA\SmartMenuQR"

  DetailPrint "Arrêt d'une éventuelle instance active..."
  IfFileExists "$INSTDIR\${APP_EXE}" 0 +2
    nsExec::ExecToLog '"$INSTDIR\${APP_EXE}" --stop'
  nsExec::ExecToLog 'powershell.exe -NoProfile -Command "Get-CimInstance Win32_Process -Filter \"Name=''node.exe''\" | Where-Object { $$_.CommandLine -like ''*local-server*server.mjs*'' } | ForEach-Object { Stop-Process -Id $$_.ProcessId -Force -ErrorAction SilentlyContinue }"'

  DetailPrint "Préparation du dossier de données persistant ($DataRoot)..."
  CreateDirectory "$DataRoot"
  CreateDirectory "$DataRoot\data"
  CreateDirectory "$DataRoot\data\uploads"
  CreateDirectory "$DataRoot\data\image-cache"
  CreateDirectory "$DataRoot\logs"
  nsExec::ExecToLog 'icacls "$DataRoot" /grant *S-1-5-32-545:(OI)(CI)F /T /Q'

  ; Migration automatique d'une ancienne installation manuelle éventuelle sans jamais écraser les données existantes
  ${If} ${FileExists} "$INSTDIR\app\local-server\data\catalog.json"
  ${AndIfNot} ${FileExists} "$DataRoot\data\catalog.json"
    CopyFiles /SILENT "$INSTDIR\app\local-server\data\*.*" "$DataRoot\data"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\local-server\data\catalog.json"
  ${AndIfNot} ${FileExists} "$DataRoot\data\catalog.json"
    CopyFiles /SILENT "$INSTDIR\local-server\data\*.*" "$DataRoot\data"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\local-server\config.json"
  ${AndIfNot} ${FileExists} "$DataRoot\config.json"
    CopyFiles /SILENT "$INSTDIR\local-server\config.json" "$DataRoot\config.json"
  ${EndIf}
  ${If} ${FileExists} "$INSTDIR\.env"
  ${AndIfNot} ${FileExists} "$DataRoot\.env"
    CopyFiles /SILENT "$INSTDIR\.env" "$DataRoot\.env"
  ${EndIf}

  DetailPrint "Installation des composants SmartMenu QR (Node.js + Application PWA + Contrôleur)..."
  SetOutPath "$INSTDIR"
  File "${STAGING_DIR}/${APP_EXE}"

  SetOutPath "$INSTDIR\runtime"
  File "${STAGING_DIR}/runtime/node.exe"

  SetOutPath "$INSTDIR\app"
  File /r "${STAGING_DIR}/app/*"

  DetailPrint "Enregistrement de la configuration dans $DataRoot..."
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_CFG_FILE", t "$DataRoot\config.json")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_ENV_FILE", t "$DataRoot\.env")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_ISOLATE", t "$OptIsolate")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_SLUG", t "$OptSlug")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_PORT", t "$OptPort")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_SB_URL", t "$OptSbUrl")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SM_SB_KEY", t "$OptSbKey")'
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$PLUGINSDIR\write-config.mjs"'

  ${If} $OptFirewall == "1"
    DetailPrint "Configuration du Pare-feu Windows (port TCP $OptPort)..."
    nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SMARTMENU QR Local Server"'
    nsExec::ExecToLog 'netsh advfirewall firewall add rule name="SMARTMENU QR Local Server" dir=in action=allow protocol=TCP localport=$OptPort profile=any'
  ${EndIf}

  DetailPrint "Pré-synchronisation du catalogue local (/api/catalog)..."
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SMARTMENU_DATA_DIR", t "$DataRoot\data")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SMARTMENU_CONFIG_FILE", t "$DataRoot\config.json")'
  System::Call 'Kernel32::SetEnvironmentVariableW(t "SMARTMENU_ENV_FILE", t "$DataRoot\.env")'
  nsExec::ExecToLog '"$INSTDIR\runtime\node.exe" "$INSTDIR\app\local-server\sync-cloud.mjs" --timeout=8000'

  DetailPrint "Création des raccourcis Windows..."
  ${If} $OptDesktopShortcut == "1"
    CreateShortcut "$DESKTOP\SmartMenu QR.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  ${EndIf}

  CreateDirectory "$SMPROGRAMS\SmartMenu QR"
  CreateShortcut "$SMPROGRAMS\SmartMenu QR\SmartMenu QR.lnk" "$INSTDIR\${APP_EXE}" "" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\SmartMenu QR\Synchroniser le menu.lnk" "$INSTDIR\${APP_EXE}" "--sync" "$INSTDIR\${APP_EXE}" 0
  CreateShortcut "$SMPROGRAMS\SmartMenu QR\Désinstaller SmartMenu QR.lnk" "$INSTDIR\Uninstall.exe" "" "$INSTDIR\Uninstall.exe" 0

  ${If} $OptAutoStart == "1"
    WriteRegStr HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SmartMenuQR" '"$INSTDIR\${APP_EXE}" --autostart'
  ${Else}
    DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SmartMenuQR"
  ${EndIf}

  WriteUninstaller "$INSTDIR\Uninstall.exe"

  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayName" "${APP_NAME}"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayVersion" "${APP_VERSION}"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "Publisher" "${APP_PUBLISHER}"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "DisplayIcon" "$INSTDIR\${APP_EXE},0"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "InstallLocation" "$INSTDIR"
  WriteRegStr HKLM "${UNINSTALL_REG_KEY}" "UninstallString" '"$INSTDIR\Uninstall.exe"'
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "NoModify" 1
  WriteRegDWORD HKLM "${UNINSTALL_REG_KEY}" "NoRepair" 1
SectionEnd

Section "Uninstall"
  SetShellVarContext all
  DetailPrint "Arrêt de SmartMenu QR..."
  IfFileExists "$INSTDIR\${APP_EXE}" 0 +2
    nsExec::ExecToLog '"$INSTDIR\${APP_EXE}" --stop'

  DeleteRegValue HKCU "Software\Microsoft\Windows\CurrentVersion\Run" "SmartMenuQR"
  nsExec::ExecToLog 'netsh advfirewall firewall delete rule name="SMARTMENU QR Local Server"'

  Delete "$DESKTOP\SmartMenu QR.lnk"
  RMDir /r "$SMPROGRAMS\SmartMenu QR"

  RMDir /r "$INSTDIR\runtime"
  RMDir /r "$INSTDIR\app"
  Delete "$INSTDIR\${APP_EXE}"
  Delete "$INSTDIR\Uninstall.exe"
  RMDir "$INSTDIR"

  DeleteRegKey HKLM "${UNINSTALL_REG_KEY}"

  MessageBox MB_YESNO|MB_ICONQUESTION|MB_DEFBUTTON2 "Voulez-vous également supprimer les données locales du restaurant (menus, photos, comptes) situées dans $APPDATA\SmartMenuQR ?$\r$\n$\r$\nCliquez sur NON pour les conserver (recommandé en cas de réinstallation)." IDNO keep_data
    RMDir /r "$APPDATA\SmartMenuQR"
  keep_data:
SectionEnd

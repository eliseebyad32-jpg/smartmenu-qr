# SMARTMENU QR - Installateur Graphique Windows (WinForms)
$ErrorActionPreference = "Stop"

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing
[System.Windows.Forms.Application]::EnableVisualStyles()

$ScriptDir = Split-Path -Parent $MyInvocation.MyCommand.Path
$RootDir = Split-Path -Parent $ScriptDir
$EnvFile = Join-Path $RootDir ".env"
$ConfigFile = Join-Path $ScriptDir "config.json"
$StartBat = Join-Path $ScriptDir "start-windows.bat"
$StopBat = Join-Path $ScriptDir "stop-windows.bat"

function Get-PrimaryLanIp {
    try {
        $ips = [System.Net.Dns]::GetHostAddresses([System.Net.Dns]::GetHostName()) |
            Where-Object {
                $_.AddressFamily -eq [System.Net.Sockets.AddressFamily]::InterNetwork -and
                -not [System.Net.IPAddress]::IsLoopback($_) -and
                $_.IPAddressToString -notlike "169.254.*"
            } |
            Select-Object -ExpandProperty IPAddressToString
        $preferred = $ips | Where-Object { $_ -like "192.168.*" -or $_ -like "10.*" } | Select-Object -First 1
        if ($preferred) { return $preferred }
        return ($ips | Select-Object -First 1)
    } catch {
        return ""
    }
}

function Read-DotEnvValue([string]$Key) {
    if (-not (Test-Path $EnvFile)) { return "" }
    $lines = Get-Content $EnvFile -Encoding UTF8 -ErrorAction SilentlyContinue
    foreach ($line in $lines) {
        if ($line -match "^\s*$Key\s*=\s*(.*)$") {
            $val = $Matches[1].Trim()
            if (($val.StartsWith('"') -and $val.EndsWith('"')) -or ($val.StartsWith("'") -and $val.EndsWith("'"))) {
                $val = $val.Substring(1, $val.Length - 2)
            }
            return $val
        }
    }
    return ""
}

function Read-ExistingConfig {
    if (-not (Test-Path $ConfigFile)) { return $null }
    try {
        return (Get-Content $ConfigFile -Raw -Encoding UTF8 | ConvertFrom-Json)
    } catch {
        return $null
    }
}

function Get-NodeExe {
    $cmd = Get-Command node -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $stdPath = Join-Path $env:ProgramFiles "nodejs\node.exe"
    if (Test-Path $stdPath) { return $stdPath }
    return $null
}

function Get-NpmCmd {
    $cmd = Get-Command npm.cmd -ErrorAction SilentlyContinue
    if ($cmd) { return $cmd.Source }
    $stdPath = Join-Path $env:ProgramFiles "nodejs\npm.cmd"
    if (Test-Path $stdPath) { return $stdPath }
    return $null
}

$ExistingCfg = Read-ExistingConfig
$DetectedIp = Get-PrimaryLanIp
$ExistingSbUrl = Read-DotEnvValue "VITE_SUPABASE_URL"
$ExistingSbKey = Read-DotEnvValue "VITE_SUPABASE_ANON_KEY"
if (-not $ExistingSbUrl -and $ExistingCfg -and $ExistingCfg.supabaseUrl) { $ExistingSbUrl = $ExistingCfg.supabaseUrl }
if (-not $ExistingSbKey -and $ExistingCfg -and $ExistingCfg.supabaseAnonKey) { $ExistingSbKey = $ExistingCfg.supabaseAnonKey }

$DefaultPort = if ($ExistingCfg -and $ExistingCfg.port) { [string]$ExistingCfg.port } else { "3000" }
$DefaultSlug = if ($ExistingCfg -and ($null -ne $ExistingCfg.restaurantSlug)) { [string]$ExistingCfg.restaurantSlug } else { "rocomamas-lubumbashi" }
$DefaultIsolated = if ($ExistingCfg) { [bool]($ExistingCfg.restaurantSlug -or $ExistingCfg.restaurantId) } else { $true }
$DefaultPublicLan = if ($ExistingCfg -and $ExistingCfg.publicLanUrl) { [string]$ExistingCfg.publicLanUrl } else { "" }

# --- UI Form ---
$form = New-Object System.Windows.Forms.Form
$form.Text = "SMARTMENU QR — Assistant d'installation Windows"
$form.Size = New-Object System.Drawing.Size(640, 690)
$form.StartPosition = "CenterScreen"
$form.FormBorderStyle = "FixedDialog"
$form.MaximizeBox = $false
$form.AutoScroll = $true
$form.BackColor = [System.Drawing.Color]::FromArgb(18, 18, 22)
$form.ForeColor = [System.Drawing.Color]::FromArgb(244, 244, 245)
$form.Font = New-Object System.Drawing.Font("Segoe UI", 9.5)

$lblTitle = New-Object System.Windows.Forms.Label
$lblTitle.Text = "SMARTMENU QR — Serveur Local & Synchronisation"
$lblTitle.Font = New-Object System.Drawing.Font("Segoe UI", 14, [System.Drawing.FontStyle]::Bold)
$lblTitle.ForeColor = [System.Drawing.Color]::White
$lblTitle.Location = New-Object System.Drawing.Point(20, 16)
$lblTitle.Size = New-Object System.Drawing.Size(580, 30)
$form.Controls.Add($lblTitle)

$lblSub = New-Object System.Windows.Forms.Label
$lblSub.Text = "Installation automatique sans commande manuelle (Wi-Fi local + PWA + Supabase)."
$lblSub.ForeColor = [System.Drawing.Color]::FromArgb(161, 161, 170)
$lblSub.Location = New-Object System.Drawing.Point(20, 48)
$lblSub.Size = New-Object System.Drawing.Size(580, 20)
$form.Controls.Add($lblSub)

# Node.js Status Panel
$panelNode = New-Object System.Windows.Forms.Panel
$panelNode.Location = New-Object System.Drawing.Point(20, 76)
$panelNode.Size = New-Object System.Drawing.Size(584, 44)
$panelNode.BackColor = [System.Drawing.Color]::FromArgb(28, 28, 34)
$form.Controls.Add($panelNode)

$lblNodeStatus = New-Object System.Windows.Forms.Label
$lblNodeStatus.Location = New-Object System.Drawing.Point(12, 12)
$lblNodeStatus.Size = New-Object System.Drawing.Size(370, 22)
$panelNode.Controls.Add($lblNodeStatus)

$btnInstallNode = New-Object System.Windows.Forms.Button
$btnInstallNode.Text = "Installer Node.js LTS"
$btnInstallNode.Location = New-Object System.Drawing.Point(400, 8)
$btnInstallNode.Size = New-Object System.Drawing.Size(172, 28)
$btnInstallNode.FlatStyle = "Flat"
$btnInstallNode.BackColor = [System.Drawing.Color]::FromArgb(234, 88, 12)
$btnInstallNode.ForeColor = [System.Drawing.Color]::White
$btnInstallNode.Visible = $false
$panelNode.Controls.Add($btnInstallNode)

function Refresh-NodeStatus {
    $nodePath = Get-NodeExe
    if ($nodePath) {
        $ver = & $nodePath -v 2>$null
        $lblNodeStatus.Text = "Node.js détecté : $ver (prêt)"
        $lblNodeStatus.ForeColor = [System.Drawing.Color]::FromArgb(52, 211, 153)
        $btnInstallNode.Visible = $false
        return $true
    } else {
        $lblNodeStatus.Text = "Node.js non détecté — requis pour le serveur local"
        $lblNodeStatus.ForeColor = [System.Drawing.Color]::FromArgb(251, 146, 60)
        $btnInstallNode.Visible = $true
        return $false
    }
}

$null = Refresh-NodeStatus

# Helper to add labeled textbox
function Add-Field([string]$label, [string]$defaultVal, [int]$y, [int]$width = 584) {
    $lbl = New-Object System.Windows.Forms.Label
    $lbl.Text = $label
    $lbl.ForeColor = [System.Drawing.Color]::FromArgb(212, 212, 216)
    $lbl.Location = New-Object System.Drawing.Point(20, $y)
    $lbl.Size = New-Object System.Drawing.Size($width, 20)
    $form.Controls.Add($lbl)

    $tb = New-Object System.Windows.Forms.TextBox
    $tb.Text = $defaultVal
    $tb.Location = New-Object System.Drawing.Point(20, ($y + 22))
    $tb.Size = New-Object System.Drawing.Size($width, 26)
    $tb.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 30)
    $tb.ForeColor = [System.Drawing.Color]::White
    $tb.BorderStyle = "FixedSingle"
    $form.Controls.Add($tb)
    return $tb
}

# Isolation toggle + Slug + Port
$chkIsolate = New-Object System.Windows.Forms.CheckBox
$chkIsolate.Text = "Isoler ce PC uniquement sur un restaurant (recommandé en salle)"
$chkIsolate.Checked = $DefaultIsolated
$chkIsolate.Location = New-Object System.Drawing.Point(20, 132)
$chkIsolate.Size = New-Object System.Drawing.Size(584, 24)
$chkIsolate.ForeColor = [System.Drawing.Color]::FromArgb(251, 146, 60)
$form.Controls.Add($chkIsolate)

$txtSlug = Add-Field "Identifiant / Slug du restaurant (ex : rocomamas-lubumbashi)" $DefaultSlug 160 400
$txtSlug.Enabled = $chkIsolate.Checked

$lblPort = New-Object System.Windows.Forms.Label
$lblPort.Text = "Port local"
$lblPort.ForeColor = [System.Drawing.Color]::FromArgb(212, 212, 216)
$lblPort.Location = New-Object System.Drawing.Point(440, 160)
$lblPort.Size = New-Object System.Drawing.Size(164, 20)
$form.Controls.Add($lblPort)

$txtPort = New-Object System.Windows.Forms.TextBox
$txtPort.Text = $DefaultPort
$txtPort.Location = New-Object System.Drawing.Point(440, 182)
$txtPort.Size = New-Object System.Drawing.Size(164, 26)
$txtPort.BackColor = [System.Drawing.Color]::FromArgb(24, 24, 30)
$txtPort.ForeColor = [System.Drawing.Color]::White
$txtPort.BorderStyle = "FixedSingle"
$form.Controls.Add($txtPort)

$chkIsolate.Add_CheckedChanged({
    $txtSlug.Enabled = $chkIsolate.Checked
})

$lanHint = if ($DetectedIp) { "Adresse Wi-Fi fixe optionnelle (IP détectée : http://${DetectedIp}:$DefaultPort — laisser vide = auto)" } else { "Adresse Wi-Fi fixe optionnelle (ex : http://192.168.1.50:3000 — laisser vide = auto)" }
$txtLanUrl = Add-Field $lanHint $DefaultPublicLan 216
$txtSbUrl = Add-Field "URL Supabase (VITE_SUPABASE_URL — conservée si .env existe déjà)" $ExistingSbUrl 272
$txtSbKey = Add-Field "Clé publique Supabase (VITE_SUPABASE_ANON_KEY)" $ExistingSbKey 328

# Checkboxes
$chkFirewall = New-Object System.Windows.Forms.CheckBox
$chkFirewall.Text = "Configurer l'accès Wi-Fi des téléphones (Pare-feu Windows)"
$chkFirewall.Checked = $true
$chkFirewall.Location = New-Object System.Drawing.Point(20, 386)
$chkFirewall.Size = New-Object System.Drawing.Size(584, 22)
$form.Controls.Add($chkFirewall)

$chkStartShortcut = New-Object System.Windows.Forms.CheckBox
$chkStartShortcut.Text = "Créer le raccourci Bureau « Démarrer SMARTMENU QR »"
$chkStartShortcut.Checked = $true
$chkStartShortcut.Location = New-Object System.Drawing.Point(20, 412)
$chkStartShortcut.Size = New-Object System.Drawing.Size(584, 22)
$form.Controls.Add($chkStartShortcut)

$chkStopShortcut = New-Object System.Windows.Forms.CheckBox
$chkStopShortcut.Text = "Créer le raccourci Bureau « Arrêter SMARTMENU QR »"
$chkStopShortcut.Checked = $true
$chkStopShortcut.Location = New-Object System.Drawing.Point(20, 438)
$chkStopShortcut.Size = New-Object System.Drawing.Size(584, 22)
$form.Controls.Add($chkStopShortcut)

$chkSync = New-Object System.Windows.Forms.CheckBox
$chkSync.Text = "Pré-télécharger le menu et les images depuis Supabase"
$chkSync.Checked = $true
$chkSync.Location = New-Object System.Drawing.Point(20, 464)
$chkSync.Size = New-Object System.Drawing.Size(584, 22)
$form.Controls.Add($chkSync)

$progress = New-Object System.Windows.Forms.ProgressBar
$progress.Location = New-Object System.Drawing.Point(20, 496)
$progress.Size = New-Object System.Drawing.Size(584, 16)
$progress.Minimum = 0
$progress.Maximum = 100
$form.Controls.Add($progress)

$txtLog = New-Object System.Windows.Forms.TextBox
$txtLog.Multiline = $true
$txtLog.ReadOnly = $true
$txtLog.ScrollBars = "Vertical"
$txtLog.Location = New-Object System.Drawing.Point(20, 520)
$txtLog.Size = New-Object System.Drawing.Size(584, 80)
$txtLog.BackColor = [System.Drawing.Color]::FromArgb(12, 12, 16)
$txtLog.ForeColor = [System.Drawing.Color]::FromArgb(212, 212, 216)
$txtLog.BorderStyle = "FixedSingle"
$txtLog.Font = New-Object System.Drawing.Font("Consolas", 8.5)
$form.Controls.Add($txtLog)

$btnInstall = New-Object System.Windows.Forms.Button
$btnInstall.Text = "Installer automatiquement"
$btnInstall.Location = New-Object System.Drawing.Point(20, 610)
$btnInstall.Size = New-Object System.Drawing.Size(220, 36)
$btnInstall.FlatStyle = "Flat"
$btnInstall.BackColor = [System.Drawing.Color]::FromArgb(220, 38, 38)
$btnInstall.ForeColor = [System.Drawing.Color]::White
$btnInstall.Font = New-Object System.Drawing.Font("Segoe UI", 9.5, [System.Drawing.FontStyle]::Bold)
$form.Controls.Add($btnInstall)

$btnLaunch = New-Object System.Windows.Forms.Button
$btnLaunch.Text = "Démarrer le serveur"
$btnLaunch.Location = New-Object System.Drawing.Point(252, 610)
$btnLaunch.Size = New-Object System.Drawing.Size(180, 36)
$btnLaunch.FlatStyle = "Flat"
$btnLaunch.BackColor = [System.Drawing.Color]::FromArgb(5, 150, 105)
$btnLaunch.ForeColor = [System.Drawing.Color]::White
$btnLaunch.Enabled = (Test-Path (Join-Path $RootDir "dist\index.html"))
$form.Controls.Add($btnLaunch)

$btnClose = New-Object System.Windows.Forms.Button
$btnClose.Text = "Fermer"
$btnClose.Location = New-Object System.Drawing.Point(494, 610)
$btnClose.Size = New-Object System.Drawing.Size(110, 36)
$btnClose.FlatStyle = "Flat"
$btnClose.BackColor = [System.Drawing.Color]::FromArgb(39, 39, 42)
$btnClose.ForeColor = [System.Drawing.Color]::White
$form.Controls.Add($btnClose)

function Append-Log([string]$msg) {
    $txtLog.AppendText("$msg`r`n")
    [System.Windows.Forms.Application]::DoEvents()
}

function Set-Progress([int]$val) {
    $progress.Value = [Math]::Min(100, [Math]::Max(0, $val))
    [System.Windows.Forms.Application]::DoEvents()
}

$btnInstallNode.Add_Click({
    $btnInstallNode.Enabled = $false
    Append-Log "Tentative d'installation automatique de Node.js LTS via winget..."
    $winget = Get-Command winget -ErrorAction SilentlyContinue
    if ($winget) {
        $proc = Start-Process -FilePath $winget.Source -ArgumentList "install -e --id OpenJS.NodeJS.LTS --accept-package-agreements --accept-source-agreements" -Wait -PassThru
        if ($proc.ExitCode -eq 0) {
            $env:Path = [System.Environment]::GetEnvironmentVariable("Path", "Machine") + ";" + [System.Environment]::GetEnvironmentVariable("Path", "User")
            if (Refresh-NodeStatus) {
                Append-Log "[OK] Node.js LTS installé avec succès."
                return
            }
        }
    }
    Append-Log "[INFO] Ouverture de https://nodejs.org/ — installez Node.js LTS puis relancez l'installateur."
    Start-Process "https://nodejs.org/"
    $btnInstallNode.Enabled = $true
})

$btnClose.Add_Click({ $form.Close() })

$btnLaunch.Add_Click({
    if (Test-Path $StartBat) {
        Start-Process -FilePath $StartBat -WorkingDirectory $RootDir
    }
})

$btnInstall.Add_Click({
    $btnInstall.Enabled = $false
    $txtLog.Clear()
    Set-Progress 5

    try {
        # 1. Verification Node.js
        $nodeExe = Get-NodeExe
        $npmCmd = Get-NpmCmd
        if (-not $nodeExe -or -not $npmCmd) {
            Append-Log "[ERREUR] Node.js n'est pas installé. Cliquez sur 'Installer Node.js LTS' ci-dessus."
            [System.Windows.Forms.MessageBox]::Show("Node.js LTS est requis pour le serveur local. Cliquez sur 'Installer Node.js LTS' puis relancez l'installation.", "Node.js requis", "OK", "Warning") | Out-Null
            $btnInstall.Enabled = $true
            return
        }
        $nodeDir = Split-Path -Parent $nodeExe
        if ($env:Path -notlike "*$nodeDir*") {
            $env:Path = "$nodeDir;$env:Path"
        }
        Append-Log "[1/6] Node.js prêt : $(& $nodeExe -v)"
        Set-Progress 15

        # 2. Configuration .env (sans ecraser les secrets existants si non modifies)
        $sbUrl = $txtSbUrl.Text.Trim()
        $sbKey = $txtSbKey.Text.Trim()
        $envChanged = $false
        if ($sbUrl -ne $ExistingSbUrl -or $sbKey -ne $ExistingSbKey -or (-not (Test-Path $EnvFile))) {
            $envContent = "VITE_SUPABASE_URL=`"$sbUrl`"`r`nVITE_SUPABASE_ANON_KEY=`"$sbKey`"`r`n"
            [System.IO.File]::WriteAllText($EnvFile, $envContent, (New-Object System.Text.UTF8Encoding($false)))
            $envChanged = $true
            Append-Log "[2/6] Configuration Supabase enregistrée dans .env."
        } else {
            Append-Log "[2/6] Configuration Supabase existante (.env) préservée."
        }
        Set-Progress 28

        # 3. Dependances npm
        $nodeModulesDir = Join-Path $RootDir "node_modules"
        if (-not (Test-Path $nodeModulesDir)) {
            Append-Log "[3/6] Installation des dépendances npm (patientez 1 à 2 min)..."
            $pNpm = Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$RootDir`" && `"$npmCmd`" install" -Wait -PassThru -WindowStyle Hidden
            if ($pNpm.ExitCode -ne 0) {
                throw "Échec de npm install (vérifiez votre connexion Internet)."
            }
            Append-Log "[OK] Dépendances npm installées."
        } else {
            Append-Log "[3/6] Dépendances npm déjà installées."
        }
        Set-Progress 48

        # 4. Configuration serveur local (local-server/config.json)
        $portNum = 3000
        if ([int]::TryParse($txtPort.Text.Trim(), [ref]$portNum) -eq $false -or $portNum -lt 1 -or $portNum -gt 65535) {
            $portNum = 3000
        }
        $slugVal = if ($chkIsolate.Checked) { $txtSlug.Text.Trim() } else { "" }
        $cfgObj = @{
            port = $portNum
            restaurantId = $slugVal
            restaurantSlug = $slugVal
            publicLanUrl = $txtLanUrl.Text.Trim().TrimEnd('/')
            autoSyncMinutes = 5
        }
        $cfgJson = $cfgObj | ConvertTo-Json -Depth 3
        [System.IO.File]::WriteAllText($ConfigFile, $cfgJson, (New-Object System.Text.UTF8Encoding($false)))
        if ($slugVal) {
            Append-Log "[4/6] Serveur local isolé sur : $slugVal (port $portNum)."
        } else {
            Append-Log "[4/6] Serveur local configuré en mode multi-restaurants (port $portNum)."
        }
        Set-Progress 60

        # 5. Pare-feu Windows pour acces Wi-Fi des telephones
        if ($chkFirewall.Checked) {
            $fwCmd = "netsh advfirewall firewall delete rule name=`"SMARTMENU QR Local Server`" >nul 2>&1 & netsh advfirewall firewall add rule name=`"SMARTMENU QR Local Server`" dir=in action=allow protocol=TCP localport=$portNum"
            $pFw = Start-Process -FilePath "cmd.exe" -ArgumentList "/c $fwCmd" -Wait -PassThru -WindowStyle Hidden
            if ($pFw.ExitCode -ne 0) {
                Append-Log "[INFO] Élévation UAC demandée pour ouvrir le port Wi-Fi $portNum dans le Pare-feu..."
                try {
                    Start-Process -FilePath "cmd.exe" -ArgumentList "/c $fwCmd" -Verb RunAs -Wait -WindowStyle Hidden | Out-Null
                    Append-Log "[OK] Règle Pare-feu Windows configurée pour le port $portNum."
                } catch {
                    Append-Log "[INFO] Pare-feu ignoré (autorisez Node.js lors du premier démarrage)."
                }
            } else {
                Append-Log "[OK] Règle Pare-feu Windows configurée pour le port $portNum."
            }
        }
        Set-Progress 72

        # 6. Compilation PWA (dist/) + Synchronisation initiale Supabase -> PC
        $distIndex = Join-Path $RootDir "dist\index.html"
        if ($envChanged -or (-not (Test-Path $distIndex))) {
            Append-Log "[5/6] Compilation de l'application PWA (dist/)..."
            $pBuild = Start-Process -FilePath "cmd.exe" -ArgumentList "/c cd /d `"$RootDir`" && `"$npmCmd`" run build" -Wait -PassThru -WindowStyle Hidden
            if ($pBuild.ExitCode -ne 0) {
                throw "Échec de la compilation Vite (npm run build)."
            }
            Append-Log "[OK] Build PWA prêt."
        } else {
            Append-Log "[5/6] Build PWA (dist/) déjà prêt."
        }
        Set-Progress 86

        if ($chkSync.Checked) {
            Append-Log "[6/6] Synchronisation initiale Supabase -> PC local..."
            $syncScript = Join-Path $ScriptDir "sync-cloud.mjs"
            $pSync = Start-Process -FilePath $nodeExe -ArgumentList "`"$syncScript`" --timeout=10000" -WorkingDirectory $RootDir -Wait -PassThru -WindowStyle Hidden
            if ($pSync.ExitCode -eq 0) {
                Append-Log "[OK] Catalogue et images synchronisés sur le PC."
            } else {
                Append-Log "[INFO] Synchronisation initiale ignorée (PC hors ligne ou clés Supabase non renseignées)."
            }
        }

        # Raccourcis Bureau (Demarrer & Arreter)
        $desktop = [Environment]::GetFolderPath("Desktop")
        $wsh = New-Object -ComObject WScript.Shell
        if ($chkStartShortcut.Checked) {
            $lnkStart = $wsh.CreateShortcut((Join-Path $desktop "Démarrer SMARTMENU QR.lnk"))
            $lnkStart.TargetPath = $StartBat
            $lnkStart.WorkingDirectory = $RootDir
            $lnkStart.Description = "Démarrer le serveur local Wi-Fi SMARTMENU QR"
            $lnkStart.Save()
            Append-Log "[OK] Raccourci Bureau créé : Démarrer SMARTMENU QR."
        }
        if ($chkStopShortcut.Checked) {
            $lnkStop = $wsh.CreateShortcut((Join-Path $desktop "Arrêter SMARTMENU QR.lnk"))
            $lnkStop.TargetPath = $StopBat
            $lnkStop.WorkingDirectory = $RootDir
            $lnkStop.Description = "Arrêter le serveur local SMARTMENU QR"
            $lnkStop.Save()
            Append-Log "[OK] Raccourci Bureau créé : Arrêter SMARTMENU QR."
        }

        Set-Progress 100
        $btnLaunch.Enabled = $true
        $lanExample = if ($txtLanUrl.Text.Trim()) { $txtLanUrl.Text.Trim() } elseif ($DetectedIp) { "http://${DetectedIp}:$portNum" } else { "http://localhost:$portNum" }
        Append-Log "=== INSTALLATION TERMINÉE AVEC SUCCÈS ==="
        Append-Log "Adresse Wi-Fi pour les téléphones : $lanExample"
        [System.Windows.Forms.MessageBox]::Show("Installation de SMARTMENU QR terminée.`r`n`r`nVous pouvez maintenant cliquer sur 'Démarrer le serveur' ou utiliser les raccourcis créés sur votre Bureau.", "Installation réussie", "OK", "Information") | Out-Null
    } catch {
        Append-Log "[ERREUR] $($_.Exception.Message)"
        [System.Windows.Forms.MessageBox]::Show("Erreur pendant l'installation : $($_.Exception.Message)", "Erreur", "OK", "Error") | Out-Null
    } finally {
        $btnInstall.Enabled = $true
    }
})

[void]$form.ShowDialog()

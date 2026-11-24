param(
    [string]$DefaultsEnvPath = ""
)

$ErrorActionPreference = "SilentlyContinue"
[Console]::OutputEncoding = [System.Text.Encoding]::UTF8

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

function Read-EnvKey([string]$FilePath, [string]$Key) {
    if (-not $FilePath -or -not (Test-Path $FilePath)) { return "" }
    $lines = Get-Content $FilePath -Encoding UTF8
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

$DataRoot = Join-Path ([Environment]::GetFolderPath("CommonApplicationData")) "SmartMenuQR"
$CfgFile = Join-Path $DataRoot "config.json"
$EnvFile = Join-Path $DataRoot ".env"

$Ip = Get-PrimaryLanIp
$Port = "3000"
$Slug = "rocomamas-lubumbashi"
$Isolate = "1"
$IsUpgrade = "0"

if (Test-Path $CfgFile) {
    $IsUpgrade = "1"
    try {
        $cfg = Get-Content $CfgFile -Raw -Encoding UTF8 | ConvertFrom-Json
        if ($cfg.port) { $Port = [string]$cfg.port }
        if ($null -ne $cfg.restaurantSlug -and [string]$cfg.restaurantSlug -ne "") {
            $Slug = [string]$cfg.restaurantSlug
            $Isolate = "1"
        } elseif ($null -ne $cfg.restaurantId -and [string]$cfg.restaurantId -ne "") {
            $Slug = [string]$cfg.restaurantId
            $Isolate = "1"
        } else {
            $Slug = ""
            $Isolate = "0"
        }
    } catch {}
}

$SbUrl = Read-EnvKey $EnvFile "VITE_SUPABASE_URL"
$SbKey = Read-EnvKey $EnvFile "VITE_SUPABASE_ANON_KEY"

if (-not $SbUrl -and $DefaultsEnvPath) { $SbUrl = Read-EnvKey $DefaultsEnvPath "VITE_SUPABASE_URL" }
if (-not $SbKey -and $DefaultsEnvPath) { $SbKey = Read-EnvKey $DefaultsEnvPath "VITE_SUPABASE_ANON_KEY" }

$AutoStart = "0"
try {
    $runVal = Get-ItemProperty -Path "HKCU:\Software\Microsoft\Windows\CurrentVersion\Run" -Name "SmartMenuQR"
    if ($runVal -and $runVal.SmartMenuQR) { $AutoStart = "1" }
} catch {}

Write-Output "IP=$Ip"
Write-Output "PORT=$Port"
Write-Output "SLUG=$Slug"
Write-Output "ISOLATE=$Isolate"
Write-Output "SBURL=$SbUrl"
Write-Output "SBKEY=$SbKey"
Write-Output "UPGRADE=$IsUpgrade"
Write-Output "AUTOSTART=$AutoStart"

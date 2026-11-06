# Builds the OpenMTG installer into release\installer\:
#
#   OpenMTG-Setup-<version>.exe   the installer (installer\OpenMTG.nsi)
#   latest.yml                    what installed copies read to update themselves (the same file the earlier desktop app read)
#
# Steps: export the app (Godot, preset "Windows Desktop"), put the game server next to it (bin\openmtg-server.exe, built by the
# server's scripts/build-godot-server.mjs with the same version), sign both, write update.json (the publishers an update may be
# signed by), make the installer with NSIS, sign it, and write latest.yml.
#
# Signing uses Azure Artifact Signing with the settings in installer\signing.local.json (not in git):
#   { "publisherName": "...", "endpoint": "https://<region>.codesigning.azure.net/", "certificateProfileName": "...",
#     "codeSigningAccountName": "..." }
# Sign in first with `az login`. Without the settings file (or with -NoSign) the build is UNSIGNED, for trying things out only:
# it is named ...-unsigned.exe, has no update.json (so it never updates itself) and no latest.yml (so it cannot be released).
#
#   powershell -File installer\build.ps1 -Version 0.3.0 -Godot <Godot console exe> -Makensis <makensis.exe> [-NoSign]

param(
  [Parameter(Mandatory = $true)][string]$Version,
  [Parameter(Mandatory = $true)][string]$Godot,
  [Parameter(Mandatory = $true)][string]$Makensis,
  [switch]$NoSign
)
$ErrorActionPreference = 'Stop'
if ($Version -notmatch '^\d+\.\d+\.\d+$') { throw "The version must be x.y.z (it is '$Version')." }

$root = Split-Path -Parent $PSScriptRoot
$out = Join-Path $root 'release\installer'
$app = Join-Path $root 'release\app'
$signingFile = Join-Path $PSScriptRoot 'signing.local.json'
$sign = (-not $NoSign) -and (Test-Path $signingFile)
$signing = if ($sign) { Get-Content $signingFile -Raw | ConvertFrom-Json } else { $null }
if ($sign -and [string]::IsNullOrWhiteSpace($signing.publisherName)) { throw "$signingFile has no publisherName: installed copies need it to check updates." }
if (-not $sign) { Write-Warning 'UNSIGNED BUILD: for trying things out only. Never release or hand it out.' }

# The project's version must be the one built: the app compares it with each release's.
$projectVersion = (Select-String -Path (Join-Path $root 'project.godot') -Pattern '^config/version="([^"]+)"').Matches[0].Groups[1].Value
if ($projectVersion -ne $Version) { throw "project.godot says config/version=$projectVersion, not ${Version}: raise it first." }
$server = Join-Path $root 'bin\openmtg-server.exe'
if (-not (Test-Path $server)) { throw "$server is missing: build it with the server's scripts/build-godot-server.mjs --version $Version --out bin." }

Remove-Item -Recurse -Force $app, $out -ErrorAction SilentlyContinue
New-Item -ItemType Directory -Force (Join-Path $app 'bin'), $out | Out-Null

Write-Host 'Exporting the app...'
& $Godot --headless --path $root --export-release 'Windows Desktop' (Join-Path $app 'OpenMTG.exe')
if ($LASTEXITCODE -ne 0 -or -not (Test-Path (Join-Path $app 'OpenMTG.exe'))) { throw 'The export failed (are the Godot export templates installed?).' }
Copy-Item $server (Join-Path $app 'bin\openmtg-server.exe')
Copy-Item (Join-Path $root 'LICENSE') $app -ErrorAction SilentlyContinue
Copy-Item (Join-Path $root 'assets\brand\app-icon.ico') (Join-Path $app 'installer-icon.ico')

# UTF-8 without a byte order mark (Windows PowerShell's Set-Content would add one).
function Write-Utf8([string]$path, [string]$text) {
  [System.IO.File]::WriteAllText($path, $text, (New-Object System.Text.UTF8Encoding $false))
}

function Sign-Files([string[]]$files) {
  if (-not $sign) { return }
  if (-not (Get-Module -ListAvailable -Name TrustedSigning)) { Install-Module -Name TrustedSigning -Scope CurrentUser -Force }
  Invoke-TrustedSigning -Endpoint $signing.endpoint -CodeSigningAccountName $signing.codeSigningAccountName `
    -CertificateProfileName $signing.certificateProfileName -Files ($files -join ',') -FileDigest SHA256 `
    -TimestampRfc3161 'http://timestamp.acs.microsoft.com' -TimestampDigest SHA256
  foreach ($f in $files) {
    $s = Get-AuthenticodeSignature -LiteralPath $f
    if ($s.Status -ne 'Valid') { throw "$f is not signed properly ($($s.Status))." }
  }
}

Sign-Files @((Join-Path $app 'OpenMTG.exe'), (Join-Path $app 'bin\openmtg-server.exe'))

if ($sign) {
  # The names an update's signature may carry: this certificate's, and DigiDice LLC's (the signer can change without stopping updates).
  $publishers = @($signing.publisherName, 'DigiDice LLC') | Select-Object -Unique
  Write-Utf8 (Join-Path $app 'update.json') (@{ publishers = @($publishers) } | ConvertTo-Json)
}

$setupName = if ($sign) { "OpenMTG-Setup-$Version.exe" } else { "OpenMTG-Setup-$Version-unsigned.exe" }
$setup = Join-Path $out $setupName
Write-Host 'Making the installer...'
& $Makensis "/DVERSION=$Version" "/DAPP_DIR=$app" "/DOUT_FILE=$setup" (Join-Path $PSScriptRoot 'OpenMTG.nsi')
if ($LASTEXITCODE -ne 0) { throw 'makensis failed.' }
Sign-Files @($setup)

if ($sign) {
  # latest.yml as electron-builder writes it: the installer's name, its SHA-512 (base64) and size.
  $bytes = [System.IO.File]::ReadAllBytes($setup)
  $sha = [Convert]::ToBase64String([System.Security.Cryptography.SHA512]::Create().ComputeHash($bytes))
  $date = (Get-Date).ToUniversalTime().ToString("yyyy-MM-ddTHH:mm:ss.fffZ")
  $latest = @(
    "version: $Version",
    'files:',
    "  - url: $setupName",
    "    sha512: $sha",
    "    size: $($bytes.Length)",
    "path: $setupName",
    "sha512: $sha",
    "releaseDate: '$date'"
  ) -join "`n"
  Write-Utf8 (Join-Path $out 'latest.yml') $latest
}
Write-Host "Done: $setup"

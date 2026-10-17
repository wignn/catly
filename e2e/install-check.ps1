# No network requests or real installation. Uses PowerShell's function precedence.
$ErrorActionPreference = 'Stop'
$installer = Join-Path $PSScriptRoot '../install.ps1'
$originalUrl = $env:VPS_MANAGER_RELEASE_URL
$global:vpsInstallerCheck_scenario = 'valid'
$global:vpsInstallerCheck_launches = 0
$global:vpsInstallerCheck_downloads = 0
$global:vpsInstallerCheck_downloadFolder = ''
function Invoke-WebRequest {
    param($Uri, $OutFile, [switch]$UseBasicParsing)
    $global:vpsInstallerCheck_downloads++
    $global:vpsInstallerCheck_downloadFolder = Split-Path $OutFile
    if ($Uri.EndsWith('.sha256')) {
        $hash = (Get-FileHash (Join-Path $global:vpsInstallerCheck_downloadFolder 'vps-manager-windows-x64.msi') -Algorithm SHA256).Hash
        if ($global:vpsInstallerCheck_scenario -eq 'mismatch') { $hash = '0' * 64 }
        if ($global:vpsInstallerCheck_scenario -eq 'malformed') { $hash = 'invalid checksum' }
        Set-Content -Encoding ascii -LiteralPath $OutFile -Value $hash
    } else {
        if ($global:vpsInstallerCheck_scenario -eq 'network') { throw 'Simulated network error' }
        Set-Content -Encoding ascii -LiteralPath $OutFile -Value 'Fake MSI for installer checks'
    }
}
function Start-Process {
    param($FilePath, $ArgumentList, [switch]$Wait, [switch]$PassThru)
    if ($FilePath -ne 'msiexec.exe') { throw 'Unexpected executable' }
    $global:vpsInstallerCheck_launches++
    if ($global:vpsInstallerCheck_scenario -eq 'cancel') { return [pscustomobject]@{ ExitCode = 1602 } }
    if ($global:vpsInstallerCheck_scenario -eq 'reboot') { return [pscustomobject]@{ ExitCode = 3010 } }
    return [pscustomobject]@{ ExitCode = 0 }
}
function Check-Scenario($scenario, $url, $expectedFailure, $expectedLaunches) {
    $global:vpsInstallerCheck_scenario = $scenario
    $global:vpsInstallerCheck_launches = 0
    $global:vpsInstallerCheck_downloads = 0
    $global:vpsInstallerCheck_downloadFolder = ''
    $env:VPS_MANAGER_RELEASE_URL = $url
    $failure = ''
    try { & $installer } catch { $failure = $_.Exception.Message }
    if ($expectedFailure -and $failure -notlike "*$expectedFailure*") { throw "$scenario expected '$expectedFailure', received '$failure'" }
    if (-not $expectedFailure -and $failure) { throw "$scenario unexpectedly failed: $failure" }
    if ($global:vpsInstallerCheck_launches -ne $expectedLaunches) { throw "$scenario launched installer $global:vpsInstallerCheck_launches times" }
    if ($global:vpsInstallerCheck_downloadFolder -and (Test-Path -LiteralPath $global:vpsInstallerCheck_downloadFolder)) { throw "$scenario left temporary downloads behind" }
    if ($scenario -eq 'invalid-url' -and $global:vpsInstallerCheck_downloads) { throw 'Invalid URL triggered a download' }
    Write-Host "PASS: $scenario"
}
try {
    Check-Scenario 'invalid-url' 'http://insecure.example/release' 'HTTPS' 0
    Check-Scenario 'mismatch' 'https://release.example/v1' 'Checksum tidak cocok' 0
    Check-Scenario 'malformed' 'https://release.example/v1' 'Format checksum' 0
    Check-Scenario 'network' 'https://release.example/v1' 'Simulated network error' 0
    Check-Scenario 'cancel' 'https://release.example/v1' '1602' 1
    Check-Scenario 'valid' 'https://release.example/v1' '' 1
    Check-Scenario 'reboot' 'https://release.example/v1' '' 1
} finally { $env:VPS_MANAGER_RELEASE_URL = $originalUrl }

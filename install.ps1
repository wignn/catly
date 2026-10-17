# Windows x64. VPS_MANAGER_RELEASE_URL can override the Catly release folder.
& {
    $ErrorActionPreference = 'Stop'
    if ([Environment]::OSVersion.Platform -ne 'Win32NT') { throw 'Windows diperlukan.' }
    if (-not [Environment]::Is64BitOperatingSystem -or $env:PROCESSOR_ARCHITECTURE -eq 'ARM64' -or $env:PROCESSOR_ARCHITEW6432 -eq 'ARM64') { throw 'Installer ini memerlukan Windows x64.' }
    $releaseUrl = $env:VPS_MANAGER_RELEASE_URL
    if (-not $releaseUrl) { $releaseUrl = 'https://github.com/wignn/catly/releases/latest/download' }
    if ($releaseUrl -notmatch '^https://[a-zA-Z0-9.-]+(:[0-9]+)?(/[a-zA-Z0-9._~/-]*)?$') { throw 'Set VPS_MANAGER_RELEASE_URL ke folder rilis HTTPS yang tepercaya.' }
    $releaseUrl = $releaseUrl.TrimEnd('/')
    $installTemp = Join-Path ([IO.Path]::GetTempPath()) ('vps-manager-' + [Guid]::NewGuid().ToString('N'))
    New-Item -ItemType Directory -Path $installTemp | Out-Null
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
        $package = Join-Path $installTemp 'vps-manager-windows-x64.msi'
        $checksumFile = Join-Path $installTemp 'checksum.txt'
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/vps-manager-windows-x64.msi" -OutFile $package
        Invoke-WebRequest -UseBasicParsing -Uri "$releaseUrl/vps-manager-windows-x64.msi.sha256" -OutFile $checksumFile
        $expected = ((Get-Content -LiteralPath $checksumFile -Raw).Trim() -split '\s+')[0]
        if ($expected -notmatch '^[a-fA-F0-9]{64}$') { throw 'Format checksum tidak valid.' }
        if ((Get-FileHash -LiteralPath $package -Algorithm SHA256).Hash -ne $expected) { throw 'Checksum tidak cocok. Instalasi dibatalkan.' }
        Write-Host 'Checksum valid. Membuka wizard VPS Manager...'
        $installResult = Start-Process -FilePath 'msiexec.exe' -ArgumentList @('/i', ('"' + $package + '"')) -Wait -PassThru
        if ($installResult.ExitCode -notin @(0, 1641, 3010)) { throw "Instalasi gagal (kode $($installResult.ExitCode))." }
        if ($installResult.ExitCode -in @(1641, 3010)) { Write-Host 'Instalasi selesai. Windows memerlukan restart.' }
        else { Write-Host 'VPS Manager terpasang. Buka dari menu Start.' }
    } finally {
        $resolvedTemp = [IO.Path]::GetFullPath($installTemp)
        $tempRoot = [IO.Path]::GetFullPath([IO.Path]::GetTempPath()).TrimEnd('\') + '\'
        if ($resolvedTemp.StartsWith($tempRoot, [StringComparison]::OrdinalIgnoreCase) -and [IO.Path]::GetFileName($resolvedTemp).StartsWith('vps-manager-')) {
            Remove-Item -LiteralPath $resolvedTemp -Recurse -Force
        }
    }
}

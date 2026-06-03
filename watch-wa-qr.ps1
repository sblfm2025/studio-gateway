# Watcher script: watch-wa-qr.ps1
# Monitors temp directory for 'wa-qr-*.flag' or 'wa-qr-*.html' files.
# When detected, opens a visible PowerShell window with info and opens the HTML in default browser.

$Temp = [IO.Path]::GetTempPath()
$Seen = @{}

Write-Host "[wa-qr-watcher] Monitoring $Temp for wa-qr-*.flag/html"

while ($true) {
  try {
    $files = Get-ChildItem -Path $Temp -Filter "wa-qr-*.flag" -ErrorAction SilentlyContinue
    if (-not $files) { $files = Get-ChildItem -Path $Temp -Filter "wa-qr-*.html" -ErrorAction SilentlyContinue }
    foreach ($f in $files) {
      $key = $f.FullName
      if (-not $Seen.ContainsKey($key)) {
        $Seen[$key] = $true
        # Read HTML path from flag if exists
        $htmlPath = $f.FullName
        if ($f.Extension -eq ".flag") {
          try { $htmlPath = Get-Content -Path $f.FullName -ErrorAction Stop } catch { $htmlPath = $null }
        }

        $cmd = "-NoExit -Command \"Write-Host 'WhatsApp QR detected: '; Write-Host 'HTML path:'; Write-Host '$htmlPath'; if ((Test-Path '$htmlPath') -eq $true) { Start-Process -FilePath '$htmlPath' } ; Read-Host 'Press Enter to close this window'\""
        Start-Process -FilePath "powershell" -ArgumentList $cmd -WindowStyle Normal
      }
    }
  } catch {
    # ignore loop errors
  }
  Start-Sleep -Seconds 2
}

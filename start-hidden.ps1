# Start background watcher (hidden) to surface a visible terminal only when QR appears
$watcher = Join-Path $PSScriptRoot "watch-wa-qr.ps1"
if (Test-Path $watcher) {
	Start-Process -FilePath "powershell" -ArgumentList "-File \"$watcher\"" -WindowStyle Hidden -WorkingDirectory $PSScriptRoot
}

# Start the gateway hidden
Start-Process -FilePath "cmd.exe" -ArgumentList "/c start-gateway.bat" -WindowStyle Hidden -WorkingDirectory $PSScriptRoot

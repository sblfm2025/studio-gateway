# Install the Studio Gateway autostart task in Windows Task Scheduler.
# This registers start-hidden.vbs to run automatically when the current user logs on.
# Run this script from the project root or anywhere; it resolves the script path automatically.

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Resolve-Path $scriptRoot
$vbsPath = Join-Path $projectRoot "start-hidden.vbs"
$taskName = "RadioSBL Studio Gateway Agent"

if (-not (Test-Path $vbsPath)) {
    Write-Error "File not found: $vbsPath"
    Write-Error "Pastikan Anda menjalankan install-autostart.ps1 dari folder proyek yang berisi start-hidden.vbs."
    exit 1
}

# Ensure the command is quoted safely for schtasks
$wscript = 'wscript.exe'
$taskAction = $wscript + ' "' + $vbsPath + '"'
$escapedTaskAction = $taskAction.Replace('"', '\"')

Write-Host "Creating or updating scheduled task: $taskName"
Write-Host "Action: $taskAction"

# Create or update the task for current user on logon
$processInfo = New-Object System.Diagnostics.ProcessStartInfo
$processInfo.FileName = 'schtasks.exe'
$processInfo.Arguments = '/Create /TN "{0}" /TR "{1}" /SC ONLOGON /RL LIMITED /F' -f $taskName, $escapedTaskAction
$processInfo.RedirectStandardOutput = $true
$processInfo.RedirectStandardError = $true
$processInfo.UseShellExecute = $false
$processInfo.CreateNoWindow = $true

function Install-RunKey {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    $value = 'wscript.exe "' + $vbsPath + '"'
    New-ItemProperty -Path $runKey -Name $taskName -Value $value -PropertyType String -Force | Out-Null
    Write-Host "Current-user autorun entry created at HKCU Run key."
    Write-Host "Run value: $value"
}

$process = [System.Diagnostics.Process]::Start($processInfo)
$stdout = $process.StandardOutput.ReadToEnd()
$stderr = $process.StandardError.ReadToEnd()
$process.WaitForExit()

if ($process.ExitCode -eq 0) {
    Write-Host "Scheduled task successfully created or updated."
    Write-Host $stdout
    Write-Host "Task name: $taskName"
    Write-Host "Task will run when the current user logs on."
    Write-Host ('To verify, run: schtasks /Query /TN "{0}"' -f $taskName)
} else {
    Write-Warning "Failed to create scheduled task."
    if ($stdout) { Write-Host $stdout }
    if ($stderr) { Write-Host $stderr }
    if ($stderr -and $stderr -match 'Access is denied') {
        Write-Warning "Access denied when creating the scheduled task. Falling back to current-user autorun registry."
        Install-RunKey
    } else {
        exit $process.ExitCode
    }
}

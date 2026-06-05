<#
Uninstall autostart entry created by install-autostart.ps1.
Removes scheduled task and HKCU Run registry entry if present.
#>

$scriptRoot = Split-Path -Parent $MyInvocation.MyCommand.Definition
$projectRoot = Resolve-Path $scriptRoot
$vbsPath = Join-Path $projectRoot "start-hidden.vbs"
$taskName = "RadioSBL Studio Gateway Agent"

function Remove-RunKey {
    $runKey = 'HKCU:\Software\Microsoft\Windows\CurrentVersion\Run'
    if (Get-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue) {
        Remove-ItemProperty -Path $runKey -Name $taskName -ErrorAction SilentlyContinue
        Write-Host "Removed HKCU Run entry: $taskName"
    } else {
        Write-Host "No HKCU Run entry found for: $taskName"
    }
}

function Remove-Schtask {
    $processInfo = New-Object System.Diagnostics.ProcessStartInfo
    $processInfo.FileName = 'schtasks.exe'
    $processInfo.Arguments = '/Delete /TN "' + $taskName + '" /F'
    $processInfo.RedirectStandardOutput = $true
    $processInfo.RedirectStandardError = $true
    $processInfo.UseShellExecute = $false
    $processInfo.CreateNoWindow = $true

    $process = [System.Diagnostics.Process]::Start($processInfo)
    $stdout = $process.StandardOutput.ReadToEnd()
    $stderr = $process.StandardError.ReadToEnd()
    $process.WaitForExit()

    if ($process.ExitCode -eq 0) {
        Write-Host "Scheduled task removed: $taskName"
    } else {
        Write-Warning "Failed to remove scheduled task or it did not exist. schtasks exit: $($process.ExitCode)"
        if ($stderr) { Write-Host $stderr }
    }
}

Write-Host "Attempting to remove scheduled task and autorun entry for: $taskName"

Remove-Schtask
Remove-RunKey

Write-Host "Cleanup complete. If the scheduled task was created for another user, run this script as that user or remove the task via Task Scheduler GUI."

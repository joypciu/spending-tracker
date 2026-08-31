$ErrorActionPreference = "Stop"
$root = Split-Path -Parent $MyInvocation.MyCommand.Path
$remind = Join-Path $root "remind.ps1"
$html = Join-Path $root "index.html"
$taskName = "SpendingTracker-1030PM"

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File `"$remind`""
$trigger = New-ScheduledTaskTrigger -Daily -At "22:30"
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -LogonType Interactive -RunLevel Limited
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Principal $principal -Force | Out-Null

$desktop = [Environment]::GetFolderPath("Desktop")
$shortcutPath = Join-Path $desktop "Monthly spending.lnk"
$wshell = New-Object -ComObject WScript.Shell
$sc = $wshell.CreateShortcut($shortcutPath)
$sc.TargetPath = $html
$sc.WorkingDirectory = $root
$sc.Description = "Monthly spending tracker (offline)"
$sc.Save()

Write-Host ""
Write-Host "Done."
Write-Host " - Daily Windows reminder: 10:30 PM (task $taskName)"
Write-Host " - Desktop shortcut: $shortcutPath"
Write-Host "Open the sheet anytime, including offline, from that shortcut."
Write-Host "To stop reminders later: Unregister-ScheduledTask -TaskName $taskName -Confirm:`$false"

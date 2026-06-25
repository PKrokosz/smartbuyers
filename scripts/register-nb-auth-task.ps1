# Register NB Auth Refresh as Windows Scheduled Task (every 15 min)
# Usage: powershell -File scripts\register-nb-auth-task.ps1

$action = New-ScheduledTaskAction -Execute "powershell.exe" -Argument "-NoProfile -WindowStyle Hidden -File `"D:\smartbuyers\scripts\nb-auth-refresh.ps1`"" -WorkingDirectory "D:\smartbuyers"
$trigger = New-ScheduledTaskTrigger -RepetitionInterval (New-TimeSpan -Minutes 15) -AtStartup -Once
$principal = New-ScheduledTaskPrincipal -UserId "$env:USERDOMAIN\$env:USERNAME" -RunLevel Highest
$settings = New-ScheduledTaskSettingsSet -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries -StartWhenAvailable -MultipleInstances IgnoreNew

try {
    Register-ScheduledTask -TaskName "SmartBuyers NB Auth Refresh" -Action $action -Trigger $trigger -Principal $principal -Settings $settings -Force
    Write-Host "Zadanie 'SmartBuyers NB Auth Refresh' zarejestrowane (co 15 min)" -ForegroundColor Green
} catch {
    Write-Host "ERROR: $_" -ForegroundColor Red
}

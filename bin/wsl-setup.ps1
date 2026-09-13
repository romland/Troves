# Define target port
$port = 5173
$taskName = "WSL_LAN_Forward_$port"
$fwRuleName = "WSL_LAN_Forward_$port"
$payloadPath = "$env:USERPROFILE\.wsl\wsl-forward.ps1"

Write-Host "1. Writing payload script to $payloadPath..."
New-Item -ItemType Directory -Force -Path "$env:USERPROFILE\.wsl" | Out-Null
$payload = @"
`$wslIP = (wsl.exe -e hostname -I).Trim().Split(' ')[0]
if (-not `$wslIP) { exit }
netsh interface portproxy delete v4tov4 listenport=$port listenaddress=0.0.0.0 2>&1 | Out-Null
netsh interface portproxy add v4tov4 listenport=$port listenaddress=0.0.0.0 connectport=$port connectaddress=`$wslIP
"@
Set-Content -Path $payloadPath -Value $payload

Write-Host "2. Configuring Firewall (Idempotent)..."
if (-not (Get-NetFirewallRule -DisplayName $fwRuleName -ErrorAction SilentlyContinue)) {
    New-NetFirewallRule -DisplayName $fwRuleName -Direction Inbound -Action Allow -Protocol TCP -LocalPort $port | Out-Null
}

Write-Host "3. Creating Scheduled Task (Idempotent)..."
Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue
$action = New-ScheduledTaskAction -Execute 'powershell.exe' -Argument "-ExecutionPolicy Bypass -WindowStyle Hidden -File `"$payloadPath`""
$trigger = New-ScheduledTaskTrigger -AtLogOn
$principal = New-ScheduledTaskPrincipal -GroupId "BUILTIN\Administrators" -RunLevel Highest
Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Principal $principal -Force | Out-Null

Write-Host "4. Executing payload immediately..."
& $payloadPath

Write-Host "Done. Port $port is exposed to the LAN and will persist across reboots." -ForegroundColor Green
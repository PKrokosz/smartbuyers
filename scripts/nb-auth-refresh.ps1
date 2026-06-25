# NotebookLM Auth Refresh — run via Task Scheduler every 15 min
# Usage: powershell -File scripts\nb-auth-refresh.ps1

$logFile = Join-Path $PSScriptRoot "..\nb-auth-refresh.log"
$timestamp = Get-Date -Format "yyyy-MM-dd HH:mm:ss"

try {
    $out = & python -m notebooklm auth refresh --quiet 2>&1
    "$timestamp | OK | $out" | Out-File -Append -Encoding utf8 $logFile
} catch {
    "$timestamp | FAIL | $_" | Out-File -Append -Encoding utf8 $logFile
}

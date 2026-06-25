# NotebookLM Auth — Login Script
# Usage: powershell -File scripts\login-notebooklm.ps1
# Opens browser for Google login, saves cookies for notebooklm-py

Write-Host "SmartBuyers NB Auth`n" -ForegroundColor Cyan

$py = (Get-Command python -ErrorAction SilentlyContinue).Source
if (-not $py) { Write-Host "ERROR: Python nie znaleziony" -ForegroundColor Red; exit 1 }

Write-Host "[1/3] Sprawdzanie notebooklm-py..."
$nb = pip show notebooklm-py 2>$null
if (-not $nb) { Write-Host "ERROR: notebooklm-py nie zainstalowany. Uruchom: pip install notebooklm-py" -ForegroundColor Red; exit 1 }
Write-Host "  notebooklm-py zainstalowany" -ForegroundColor Green

Write-Host "`n[2/3] Logowanie przez przeglądarkę..."
Write-Host "  Otworzy się przeglądarka. Zaloguj się na konto Google." -ForegroundColor Yellow
Write-Host "  Po zalogowaniu cookies zostaną zapisane automatycznie.`n" -ForegroundColor Yellow

try {
    $out = & python -m notebooklm login 2>&1
    Write-Host $out
} catch {
    Write-Host "  Alternatywna metoda: użyj istniejących cookies z Chrome" -ForegroundColor Yellow
    try {
        $out = & python -m notebooklm login --browser-cookies chrome 2>&1
        Write-Host $out
    } catch {
        Write-Host "ERROR: Logowanie nie powiodło się. Spróbuj ręcznie: python -m notebooklm login" -ForegroundColor Red
        exit 1
    }
}

Write-Host "`n[3/3] Weryfikacja autoryzacji..."
try {
    $check = & python -m notebooklm auth check --test --json 2>&1
    Write-Host "  Auth: $check" -ForegroundColor Green
} catch {
    Write-Host "  Auth check nie powiódł się, ale cookies mogą działać" -ForegroundColor Yellow
}

Write-Host "`nGotowe. Uruchom 'node menu-server\server.mjs' aby używać NB przez Tile UI." -ForegroundColor Cyan

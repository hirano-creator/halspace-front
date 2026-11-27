# What'sNo desktop integration - one-line bootstrap.
#
# Started from the dashboard's "copy" button via Win+R:
#   powershell -nop -ep bypass -c "$t='<token>';$u='https://.../whatsno/tools/';irm($u+'wn-setup.ps1')|iex"
#
# It downloads the scripts next to it, then runs wn-install.ps1 with the
# recommended answers (classic context menu ON, apply at next sign-in) so the
# user never has to save files, open a folder, or answer Y/N questions.
#
# KEEP THIS FILE ASCII-ONLY: it is fetched with Invoke-RestMethod and the server
# sends no charset, so any non-ASCII text here would be garbled. Japanese
# messages are written as \u escapes and decoded with [regex]::Unescape.

$ErrorActionPreference = 'Stop'
try { [Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12 } catch {}
Add-Type -AssemblyName System.Windows.Forms

function Show-WnBox([string]$escaped, [string]$icon) {
    [System.Windows.Forms.MessageBox]::Show(
        [regex]::Unescape($escaped), "What'sNo", 'OK', $icon) | Out-Null
}

if (-not $t) {
    # (Japanese message below)
    Show-WnBox 'What''sNo \u306e\u753b\u9762\u3067\u300c\u30b3\u30d4\u30fc\u300d\u3092\u62bc\u3057\u3066\u304b\u3089\u3001\u3082\u3046\u4e00\u5ea6\u8cbc\u308a\u4ed8\u3051\u3066\u304f\u3060\u3055\u3044\u3002' 'Warning'
    return
}
if (-not $u) { $u = 'https://space-apps.pages.dev/whatsno/tools/' }

$work = Join-Path $env:TEMP ('whatsno-setup-' + [guid]::NewGuid().ToString('N'))
New-Item -ItemType Directory -Force -Path $work | Out-Null

try {
    Write-Host 'Downloading What''sNo desktop tools...' -ForegroundColor Cyan
    # -OutFile keeps the raw bytes (UTF-8 with BOM), so the Japanese text in
    # these scripts survives intact.
    foreach ($name in 'wn-install.ps1', 'wn-upload.ps1', 'wn-token-handler.ps1', 'wn-sync-server.ps1', 'wn-fix-desktop-icons.ps1') {
        Invoke-WebRequest -UseBasicParsing -Uri ($u + $name + '?cb=' + [guid]::NewGuid().ToString('N')) -OutFile (Join-Path $work $name)
    }

    & powershell.exe -NoProfile -ExecutionPolicy Bypass -File (Join-Path $work 'wn-install.ps1') `
        -Token $t -ClassicMenu on -ApplyNow next-logon -DoneDialog
    if ($LASTEXITCODE -ne 0) { throw "wn-install.ps1 exit $LASTEXITCODE" }
} catch {
    # (Japanese message below)
    Show-WnBox ('\u3046\u307e\u304f\u3044\u304d\u307e\u305b\u3093\u3067\u3057\u305f\u3002\u3082\u3046\u4e00\u5ea6\u304a\u8a66\u3057\u304f\u3060\u3055\u3044\u3002\n\u7d9a\u304f\u5834\u5408\u306f\u7ba1\u7406\u8005\u306b\u304a\u77e5\u3089\u305b\u304f\u3060\u3055\u3044\u3002\n\n' + ($_.Exception.Message -replace '\\', '\\')) 'Error'
} finally {
    Remove-Item -Recurse -Force $work -ErrorAction SilentlyContinue
}

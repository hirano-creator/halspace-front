# What'sNo デスクトップ連携 アンインストールスクリプト
# 使い方: 右クリック → 「PowerShellで実行」

Add-Type -AssemblyName System.Windows.Forms

$result = [System.Windows.Forms.MessageBox]::Show(
    "What'sNo デスクトップ連携をアンインストールしますか？`n右クリックメニューと保存済みトークンが削除されます。",
    "What'sNo アンインストール", 'YesNo', 'Question')

if ($result -ne 'Yes') { exit 0 }

# スケジュールタスク停止・削除
Stop-ScheduledTask       -TaskName 'WhatsNoSyncServer' -ErrorAction SilentlyContinue
Unregister-ScheduledTask -TaskName 'WhatsNoSyncServer' -Confirm:$false -ErrorAction SilentlyContinue

# レジストリ削除（HKCU）
# 注意: パスの '*' は PowerShell プロバイダ経由だとワイルドカード展開されて
#       Classes 配下を全走査し固まるため、.NET API でリテラル扱いにする。
function Remove-WnRegKey {
    param([string]$SubKey)
    try {
        [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($SubKey, $false)
    } catch {}
}

# 右クリックメニューは shell 配下の WhatsNo* を全て消す。
# 旧バージョンのキー名（WhatsNoSave / WhatsNoOpen）や、過去の不具合で残った
# 壊れたキーもまとめて掃除できるようにキー名で総なめする。
function Remove-WnMenuKeys {
    param([string]$ShellPath)
    $shell = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($ShellPath)
    if (-not $shell) { return }
    $names = $shell.GetSubKeyNames()
    $shell.Close()
    foreach ($n in $names) {
        # -like の '*' はここではPowerShellのワイルドカードとして意図通り使う
        if ($n -like 'WhatsNo*') { Remove-WnRegKey "$ShellPath\$n" }
    }
}

Remove-WnMenuKeys 'Software\Classes\*\shell'
Remove-WnMenuKeys 'Software\Classes\Directory\Background\shell'
Remove-WnMenuKeys 'Software\Classes\DesktopBackground\shell'

Remove-WnRegKey 'Software\Classes\whatsno'

# AppData フォルダ削除
$appDir = Join-Path $env:APPDATA 'WhatsNo'
if (Test-Path $appDir) {
    Remove-Item -Path $appDir -Recurse -Force
}

[System.Windows.Forms.MessageBox]::Show(
    'アンインストールが完了しました。',
    "What'sNo アンインストール", 'OK', 'Information') | Out-Null

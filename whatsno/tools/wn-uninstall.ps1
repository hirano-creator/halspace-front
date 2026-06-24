# What'sNo デスクトップ連携 アンインストールスクリプト
# 使い方: 右クリック → 「PowerShellで実行」

Add-Type -AssemblyName System.Windows.Forms

$result = [System.Windows.Forms.MessageBox]::Show(
    "What'sNo デスクトップ連携をアンインストールしますか？`n右クリックメニューと保存済みトークンが削除されます。",
    "What'sNo アンインストール", 'YesNo', 'Question')

if ($result -ne 'Yes') { exit 0 }

# レジストリ削除（HKCU）
$regBase = 'HKCU:\Software\Classes\*\shell\WhatsNoSave'
if (Test-Path $regBase) {
    Remove-Item -Path $regBase -Recurse -Force
}

# AppData フォルダ削除
$appDir = Join-Path $env:APPDATA 'WhatsNo'
if (Test-Path $appDir) {
    Remove-Item -Path $appDir -Recurse -Force
}

[System.Windows.Forms.MessageBox]::Show(
    'アンインストールが完了しました。',
    "What'sNo アンインストール", 'OK', 'Information') | Out-Null

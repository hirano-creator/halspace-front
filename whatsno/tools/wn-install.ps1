# What'sNo デスクトップ連携 セットアップスクリプト
# 使い方: このファイルを wn-upload.ps1 と同じフォルダに置き、右クリック → 「PowerShellで実行」

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName Microsoft.VisualBasic

$appDir       = Join-Path $env:APPDATA 'WhatsNo'
$uploadScript = Join-Path $appDir 'wn-upload.ps1'
$configFile   = Join-Path $appDir 'config.json'

# ── wn-upload.ps1 を配置 ──
$srcDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcUpload = Join-Path $srcDir 'wn-upload.ps1'

if (-not (Test-Path $srcUpload)) {
    [System.Windows.Forms.MessageBox]::Show(
        "wn-upload.ps1 が見つかりません。`nwn-install.ps1 と同じフォルダに置いてください。",
        "What'sNo セットアップ", 'OK', 'Error') | Out-Null
    exit 1
}

New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item $srcUpload $uploadScript -Force

# ── トークン入力 ──
$existing = if (Test-Path $configFile) {
    try { (Get-Content $configFile -Raw -Encoding utf8 | ConvertFrom-Json).token } catch { '' }
} else { '' }

$prompt = if ($existing) {
    "既存のトークンが設定されています。`n新しいトークンを入力すると上書きされます（キャンセルで既存を保持）。`n`nWhat'sNo ダッシュボードの「デスクトップ連携」からトークンをコピーして貼り付けてください。"
} else {
    "What'sNo ダッシュボードの「デスクトップ連携」からトークンをコピーし、以下に貼り付けてください。"
}

$token = [Microsoft.VisualBasic.Interaction]::InputBox($prompt, "What'sNo セットアップ — トークン入力", '')

if (-not $token) {
    if ($existing) {
        [System.Windows.Forms.MessageBox]::Show(
            '既存のトークンを保持しました。', "What'sNo セットアップ", 'OK', 'Information') | Out-Null
        exit 0
    }
    [System.Windows.Forms.MessageBox]::Show(
        'セットアップをキャンセルしました。', "What'sNo セットアップ", 'OK', 'Warning') | Out-Null
    exit 0
}

# ── config.json 保存 & ACL制限 ──
@{ token = $token } | ConvertTo-Json | Set-Content $configFile -Encoding utf8
icacls $configFile /inheritance:r /grant:r "${env:USERNAME}:F" 2>&1 | Out-Null

# ── レジストリ登録（HKCU — 管理者権限不要） ──
$regBase    = 'HKCU:\Software\Classes\*\shell\WhatsNoSave'
$regCommand = "$regBase\command"
$psCmd      = "powershell.exe -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$uploadScript`" `"%1`""

New-Item -Path $regBase    -Force | Out-Null
New-Item -Path $regCommand -Force | Out-Null
Set-ItemProperty -Path $regBase    -Name '(Default)' -Value "What'sNoに保存"
Set-ItemProperty -Path $regBase    -Name 'Icon'      -Value 'shell32.dll,13'
Set-ItemProperty -Path $regCommand -Name '(Default)' -Value $psCmd

# ── 完了 ──
[System.Windows.Forms.MessageBox]::Show(
    "セットアップが完了しました！`n`nエクスプローラーでファイルを右クリックすると`n「What'sNoに保存」が表示されます。",
    "What'sNo セットアップ完了", 'OK', 'Information') | Out-Null

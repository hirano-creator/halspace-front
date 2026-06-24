# What'sNo コンテキストメニュー アップロードスクリプト
# 使い方: wn-install.ps1 でレジストリ登録後、右クリックから自動実行される

param([string]$FilePath)

Add-Type -AssemblyName System.Windows.Forms

$configFile = Join-Path $env:APPDATA 'WhatsNo\config.json'
$apiBase    = 'https://halspace-api-production.up.railway.app/api'

# ── トークン読み込み ──
if (-not (Test-Path $configFile)) {
    [System.Windows.Forms.MessageBox]::Show(
        "What'sNo デスクトップ連携が設定されていません。`nWhat'sNo ダッシュボードの「デスクトップ連携」からセットアップしてください。",
        "What'sNo", 'OK', 'Information') | Out-Null
    exit 1
}

$config = Get-Content $configFile -Raw -Encoding utf8 | ConvertFrom-Json
$token  = $config.token

if (-not $token) {
    [System.Windows.Forms.MessageBox]::Show(
        'トークンが見つかりません。wn-install.ps1 を再実行してください。',
        "What'sNo", 'OK', 'Warning') | Out-Null
    exit 1
}

# ── ファイル存在確認 ──
if (-not (Test-Path $FilePath)) {
    [System.Windows.Forms.MessageBox]::Show(
        "ファイルが見つかりません:`n$FilePath",
        "What'sNo", 'OK', 'Error') | Out-Null
    exit 1
}

# ── MIMEタイプ判定 ──
$ext = [System.IO.Path]::GetExtension($FilePath).ToLower()
$mimeMap = @{
    '.pdf'  = 'application/pdf'
    '.png'  = 'image/png'
    '.jpg'  = 'image/jpeg'
    '.jpeg' = 'image/jpeg'
    '.gif'  = 'image/gif'
    '.bmp'  = 'image/bmp'
    '.webp' = 'image/webp'
    '.heic' = 'image/heic'
    '.tiff' = 'image/tiff'
    '.tif'  = 'image/tiff'
    '.svg'  = 'image/svg+xml'
    '.dxf'  = 'application/dxf'
    '.dwg'  = 'application/acad'
    '.xlsx' = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
    '.xls'  = 'application/vnd.ms-excel'
    '.docx' = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'
    '.doc'  = 'application/msword'
    '.pptx' = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'
    '.ppt'  = 'application/vnd.ms-powerpoint'
    '.mp4'  = 'video/mp4'
    '.mov'  = 'video/quicktime'
    '.zip'  = 'application/zip'
    '.txt'  = 'text/plain'
    '.csv'  = 'text/csv'
}
$contentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }

# ── アップロード ──
$fileName    = [System.IO.Path]::GetFileName($FilePath)
$encodedName = [Uri]::EscapeDataString($fileName)
$fileBytes   = [System.IO.File]::ReadAllBytes($FilePath)

try {
    $headers = @{
        'Authorization' = "Bearer $token"
        'Accept'        = 'application/json'
        'X-File-Name'   = $encodedName
    }

    $response = Invoke-WebRequest `
        -Uri         "$apiBase/wn/files" `
        -Method      POST `
        -Headers     $headers `
        -ContentType $contentType `
        -Body        $fileBytes `
        -TimeoutSec  300 `
        -ErrorAction Stop

    if ($response.StatusCode -in 200, 201) {
        $notify = New-Object System.Windows.Forms.NotifyIcon
        $notify.Icon    = [System.Drawing.SystemIcons]::Information
        $notify.Visible = $true
        $notify.ShowBalloonTip(3000, "What'sNo", "`"$fileName`" をアップロードしました", 'Info')
        Start-Sleep -Milliseconds 3500
        $notify.Visible = $false
        $notify.Dispose()
    }
} catch {
    $status = $null
    try { $status = $_.Exception.Response.StatusCode.value__ } catch {}

    $msg = switch ($status) {
        401     { "トークンの有効期限が切れています。`nWhat'sNo ダッシュボードで新しいトークンをコピーし、wn-install.ps1 を再実行してください。" }
        413     { "ファイルが大きすぎます（上限: 100MB）`nファイル: $fileName" }
        default { "アップロードに失敗しました$(if($status){' (HTTP '+$status+')'})。`nファイル: $fileName`n$($_.Exception.Message)" }
    }
    [System.Windows.Forms.MessageBox]::Show($msg, "What'sNo — エラー", 'OK', 'Error') | Out-Null
    exit 1
}

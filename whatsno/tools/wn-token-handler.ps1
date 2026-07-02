# What'sNo デスクトップ連携 トークン自動同期ハンドラ
# whatsno:// カスタムプロトコルのハンドラとして wn-install.ps1 が登録する
# ダッシュボードを開くたびに自動実行され config.json を最新トークンで更新する

param([string]$Url)

$configDir  = Join-Path $env:APPDATA 'WhatsNo'
$configFile = Join-Path $configDir 'config.json'

if (-not (Test-Path $configDir)) { exit 0 }

try {
    # whatsno://sync?token=URL_ENCODED_TOKEN からトークンを抽出
    $query = ($Url -split '\?', 2)[1]
    if (-not $query) { exit 0 }

    $token = ''
    foreach ($pair in $query -split '&') {
        $kv = $pair -split '=', 2
        if ($kv[0] -eq 'token' -and $kv.Count -eq 2) {
            $token = [System.Uri]::UnescapeDataString($kv[1])
            break
        }
    }

    if (-not $token) { exit 0 }

    @{ token = $token } | ConvertTo-Json | Set-Content $configFile -Encoding utf8
    icacls $configFile /inheritance:r /grant:r "${env:USERNAME}:F" 2>&1 | Out-Null
} catch {
    # サイレントに失敗（ダッシュボードの動作に影響させない）
}

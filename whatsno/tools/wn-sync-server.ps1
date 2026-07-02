# What'sNo デスクトップ連携 トークン同期サーバー
# wn-install.ps1 がWindowsログイン時に自動起動するスケジュールタスクとして登録する

$configFile   = Join-Path $env:APPDATA 'WhatsNo\config.json'
$port         = 39876
$allowOrigins = @(
    'https://space-apps.pages.dev',
    'http://localhost',
    'http://127.0.0.1'
)

# 起動（既に動いている場合はポート競合でexit）
$listener = $null
try {
    $listener = [System.Net.HttpListener]::new()
    $listener.Prefixes.Add("http://localhost:$port/")
    $listener.Start()
} catch {
    exit 0
}

while ($true) {
    try {
        $context  = $listener.GetContext()
        $request  = $context.Request
        $response = $context.Response

        $origin        = $request.Headers['Origin']
        $allowedOrigin = if ($origin -and $allowOrigins -contains $origin) { $origin } else { $null }

        if ($allowedOrigin) {
            $response.Headers.Add('Access-Control-Allow-Origin',  $allowedOrigin)
            $response.Headers.Add('Access-Control-Allow-Methods', 'POST, OPTIONS')
            $response.Headers.Add('Access-Control-Allow-Headers', 'Content-Type')
            $response.Headers.Add('Vary', 'Origin')
        }

        if ($request.HttpMethod -eq 'OPTIONS') {
            $response.StatusCode = 204
            $response.Close()
            continue
        }

        if ($request.HttpMethod -eq 'POST' -and
            $request.Url.AbsolutePath -eq '/sync' -and
            $allowedOrigin) {

            $body  = [System.IO.StreamReader]::new($request.InputStream, [System.Text.Encoding]::UTF8).ReadToEnd()
            $data  = $body | ConvertFrom-Json
            $token = [string]$data.token

            if ($token) {
                @{ token = $token } | ConvertTo-Json | Set-Content $configFile -Encoding utf8
                icacls $configFile /inheritance:r /grant:r "${env:USERNAME}:F" 2>&1 | Out-Null
            }

            $response.StatusCode = 200
            $bytes = [System.Text.Encoding]::UTF8.GetBytes('OK')
            $response.OutputStream.Write($bytes, 0, $bytes.Length)
        } else {
            $response.StatusCode = 403
        }

        $response.Close()
    } catch {
        try { $response.Close() } catch {}
    }
}

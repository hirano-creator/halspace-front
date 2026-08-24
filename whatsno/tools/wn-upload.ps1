# What'sNo コンテキストメニュー アップロードスクリプト
# 使い方: wn-install.ps1 でレジストリ登録後、右クリックから自動実行される
#
# 複数ファイルを選択すると Windows はファイルの数だけこのスクリプトを起動する。
# そのまま各プロセスが送ると (1) ウィンドウがファイル数だけ出る (2) 通知も同数出る
# (3) 単一ワーカーの本番APIに同時接続が集中して詰まる、という問題が起きる。
# そこで受け取ったファイルはいったんキューに積み、ミューテックスを取れた
# 1プロセスだけが順番に送って最後にまとめて1回だけ通知する。

param([string]$FilePath)

Add-Type -AssemblyName System.Windows.Forms
Add-Type -AssemblyName System.Drawing

$appDir     = Join-Path $env:APPDATA 'WhatsNo'
$configFile = Join-Path $appDir 'config.json'
$queueDir   = Join-Path $appDir 'queue'
$apiBase    = 'https://halspace-api-production.up.railway.app/api'

function Show-WnMessage {
    param([string]$Message, [string]$Title = "What'sNo", [string]$Icon = 'Information')
    [System.Windows.Forms.MessageBox]::Show($Message, $Title, 'OK', $Icon) | Out-Null
}

function Show-WnBalloon {
    param([string]$Message)
    $notify = New-Object System.Windows.Forms.NotifyIcon
    try {
        $notify.Icon    = [System.Drawing.SystemIcons]::Information
        $notify.Visible = $true
        $notify.ShowBalloonTip(3000, "What'sNo", $Message, 'Info')
        Start-Sleep -Milliseconds 3500
    } finally {
        $notify.Visible = $false
        $notify.Dispose()
    }
}

# ── 受け取ったファイルをキューに置く ──
# 同時起動しても衝突しないよう、1件につき1ファイル（GUID名）で書き出す。
if ($FilePath) {
    New-Item -ItemType Directory -Force -Path $queueDir | Out-Null
    $entry = Join-Path $queueDir ([guid]::NewGuid().ToString() + '.txt')
    [System.IO.File]::WriteAllText($entry, $FilePath, [System.Text.Encoding]::UTF8)
}

# ── 送信役は1プロセスだけ。取れなかったプロセスは即終了する ──
$mutex    = New-Object System.Threading.Mutex($false, 'Local\WhatsNoUploader')
$isWorker = $false
try {
    $isWorker = $mutex.WaitOne(0)
} catch [System.Threading.AbandonedMutexException] {
    # 前回のプロセスが異常終了して放棄された状態。所有権は取得できている。
    $isWorker = $true
}
if (-not $isWorker) { exit 0 }

$lockHeld = $true
function Close-WnLock {
    if (-not $script:lockHeld) { return }
    $script:lockHeld = $false
    try { $script:mutex.ReleaseMutex() } catch {}
}

try {
    # ── トークン読み込み ──
    if (-not (Test-Path $configFile)) {
        Show-WnMessage "What'sNo デスクトップ連携が設定されていません。`nWhat'sNo ダッシュボードの「デスクトップ連携」からセットアップしてください。"
        exit 1
    }

    $token = (Get-Content $configFile -Raw -Encoding utf8 | ConvertFrom-Json).token
    if (-not $token) {
        Show-WnMessage 'トークンが見つかりません。wn-install.ps1 を再実行してください。' "What'sNo" 'Warning'
        exit 1
    }

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

    $okNames   = New-Object System.Collections.Generic.List[string]
    $errors    = New-Object System.Collections.Generic.List[string]
    $authError = $false

    function Get-QueuedEntries {
        @(Get-ChildItem -Path $queueDir -Filter '*.txt' -File -ErrorAction SilentlyContinue |
            Sort-Object CreationTimeUtc)
    }

    while ($true) {
        $entries = Get-QueuedEntries
        if ($entries.Count -eq 0) {
            # 直後に別プロセスが積んだ分を取りこぼさないよう、少し待って再確認する
            Start-Sleep -Milliseconds 500
            $entries = Get-QueuedEntries
            if ($entries.Count -eq 0) { break }
        }

        foreach ($entry in $entries) {
            $path = $null
            try { $path = [System.IO.File]::ReadAllText($entry.FullName, [System.Text.Encoding]::UTF8).Trim() } catch {}
            Remove-Item $entry.FullName -Force -ErrorAction SilentlyContinue
            if (-not $path) { continue }

            $fileName = [System.IO.Path]::GetFileName($path)

            if (-not (Test-Path -LiteralPath $path)) {
                $errors.Add("$fileName : ファイルが見つかりません")
                continue
            }

            $ext         = [System.IO.Path]::GetExtension($path).ToLower()
            $contentType = if ($mimeMap.ContainsKey($ext)) { $mimeMap[$ext] } else { 'application/octet-stream' }

            try {
                $fileBytes = [System.IO.File]::ReadAllBytes($path)
                $headers   = @{
                    'Authorization' = "Bearer $token"
                    'Accept'        = 'application/json'
                    'X-File-Name'   = [Uri]::EscapeDataString($fileName)
                }

                # -UseBasicParsing は必須。付けないと Windows PowerShell 5.1 が
                # IEエンジンでの解析について確認を求め、入力待ちで固まる。
                $response = Invoke-WebRequest `
                    -Uri             "$apiBase/wn/files" `
                    -Method          POST `
                    -Headers         $headers `
                    -ContentType     $contentType `
                    -Body            $fileBytes `
                    -TimeoutSec      300 `
                    -UseBasicParsing `
                    -ErrorAction     Stop

                if ($response.StatusCode -in 200, 201) {
                    $okNames.Add($fileName)
                } else {
                    $errors.Add("$fileName : HTTP $($response.StatusCode)")
                }
            } catch {
                $status = $null
                try { $status = $_.Exception.Response.StatusCode.value__ } catch {}

                switch ($status) {
                    401     { $authError = $true }
                    413     { $errors.Add("$fileName : ファイルが大きすぎます（上限 100MB）") }
                    default { $errors.Add("$fileName : $($_.Exception.Message)") }
                }
                # トークン切れは以降も全て失敗するので、残りのキューを捨てて中断する
                if ($authError) {
                    Get-QueuedEntries | Remove-Item -Force -ErrorAction SilentlyContinue
                    break
                }
            }
        }

        if ($authError) { break }
    }

    # ── 知らせる前に送信役の座を手放す ──
    # バルーンは3.5秒の表示待ちがあり、MessageBox はユーザーが閉じるまで戻らない。
    # その間ロックを握ったままだと、ちょうどその最中に右クリックされたファイルが
    # 「キューに積まれたのに送る役がいない」状態で取り残され、次に誰かが保存するまで
    # 送られないままになる（＝保存したのに出てこない）。
    Close-WnLock

    # ── 結果はまとめて1回だけ知らせる ──
    if ($authError) {
        Show-WnMessage "トークンの有効期限が切れています。`nWhat'sNo ダッシュボードで新しいトークンをコピーし、wn-install.ps1 を再実行してください。" "What'sNo — エラー" 'Error'
        exit 1
    }

    if ($errors.Count -gt 0) {
        $shown = $errors | Select-Object -First 10
        $more  = if ($errors.Count -gt 10) { "`n…ほか $($errors.Count - 10) 件" } else { '' }
        $head  = if ($okNames.Count -gt 0) { "$($okNames.Count) 件をアップロードしました。`n`n以下は失敗しました:`n" } else { "アップロードに失敗しました:`n" }
        Show-WnMessage ($head + ($shown -join "`n") + $more) "What'sNo — エラー" 'Error'
        exit 1
    }

    if ($okNames.Count -eq 1) {
        Show-WnBalloon "`"$($okNames[0])`" をアップロードしました"
    } elseif ($okNames.Count -gt 1) {
        Show-WnBalloon "$($okNames.Count) 件のファイルをアップロードしました"
    }
} finally {
    Close-WnLock
    $mutex.Dispose()
}

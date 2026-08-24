# What'sNo デスクトップ連携 セットアップスクリプト
# 使い方: ダッシュボードの「デスクトップ連携」でコマンドをコピーし、
#          スクリプトと同じフォルダで PowerShell に貼り付けて実行

param(
    [string]$Token = ''
)

$interactive = (-not $Token)  # Token未指定 = 対話モード（ダイアログ表示）
if ($interactive) { Add-Type -AssemblyName System.Windows.Forms }

$appDir       = Join-Path $env:APPDATA 'WhatsNo'
$uploadScript = Join-Path $appDir 'wn-upload.ps1'
$configFile   = Join-Path $appDir 'config.json'

# ── wn-upload.ps1 を配置 ──
$srcDir    = Split-Path -Parent $MyInvocation.MyCommand.Path
$srcUpload = Join-Path $srcDir 'wn-upload.ps1'

if (-not (Test-Path $srcUpload)) {
    if ($interactive) {
        Add-Type -AssemblyName System.Windows.Forms
        [System.Windows.Forms.MessageBox]::Show(
            "wn-upload.ps1 が見つかりません。`nwn-install.ps1 と同じフォルダに置いてください。",
            "What'sNo セットアップ", 'OK', 'Error') | Out-Null
    } else {
        Write-Host "ERROR: wn-upload.ps1 が見つかりません。wn-install.ps1 と同じフォルダに置いてください。" -ForegroundColor Red
    }
    exit 1
}

Write-Host "[1/5] ファイルを配置中…" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $appDir | Out-Null
Copy-Item $srcUpload $uploadScript -Force

# ── wn-token-handler.ps1 を配置（存在する場合） ──
$srcHandler    = Join-Path $srcDir 'wn-token-handler.ps1'
$handlerScript = Join-Path $appDir 'wn-token-handler.ps1'
if (Test-Path $srcHandler) {
    Copy-Item $srcHandler $handlerScript -Force
}

# ── wn-sync-server.ps1 を配置（存在する場合） ──
$srcSyncServer  = Join-Path $srcDir 'wn-sync-server.ps1'
$syncServerScript = Join-Path $appDir 'wn-sync-server.ps1'
if (Test-Path $srcSyncServer) {
    Copy-Item $srcSyncServer $syncServerScript -Force
}

# ── 非表示ランチャー(wn-launch.vbs)を生成 ──
# powershell.exe を直接登録すると -WindowStyle Hidden を付けてもコンソールが出る
# （既定のターミナルが Windows Terminal の環境では隠れずに残ってしまう）。
# 複数ファイルを選ぶとファイル数だけ窓が出るため、WScript.Shell.Run の
# 非表示モード(0)経由で起動するランチャーを挟む。
# 第1引数に実行したい .ps1、それ以降がそのスクリプトへの引数。右クリック保存 /
# whatsno:// ハンドラ / 同期サーバーの3つとも、この1本を通して起動する
# （どれか1つでも powershell.exe 直起動のまま残すと、そこだけ窓が出る）。
# 中身は環境依存を避けるためASCIIのみで書き、ファイルはUTF-16(BOM付き)で保存する
# （ユーザー名に日本語が含まれてもパスが壊れないようにするため）。
$launcherScript = Join-Path $appDir 'wn-launch.vbs'
$vbs = @'
' What'sNo desktop integration - launches a PowerShell script with no visible console window.
' Usage: wscript.exe wn-launch.vbs "<script.ps1>" ["<arg>" ...]
Option Explicit
Dim sh, i, cmd
If WScript.Arguments.Count = 0 Then WScript.Quit 0
cmd = "powershell.exe -NoProfile -ExecutionPolicy Bypass -File """ & WScript.Arguments(0) & """"
For i = 1 To WScript.Arguments.Count - 1
  cmd = cmd & " """ & WScript.Arguments(i) & """"
Next
Set sh = CreateObject("WScript.Shell")
sh.Run cmd, 0, False
'@
[System.IO.File]::WriteAllText($launcherScript, $vbs, [System.Text.Encoding]::Unicode)

# ── トークン取得（パラメータ優先、なければ InputBox） ──
if (-not $Token) {
    $existing = if (Test-Path $configFile) {
        try { (Get-Content $configFile -Raw -Encoding utf8 | ConvertFrom-Json).token } catch { '' }
    } else { '' }

    $prompt = if ($existing) {
        "既存のトークンが設定されています。`n新しいトークンを入力すると上書きされます（キャンセルで既存を保持）。"
    } else {
        "What'sNo ダッシュボードの「デスクトップ連携」でコマンドをコピーして実行することをお勧めします。`n直接入力する場合はトークンを以下に貼り付けてください。"
    }

    Add-Type -AssemblyName Microsoft.VisualBasic
    $Token = [Microsoft.VisualBasic.Interaction]::InputBox($prompt, "What'sNo セットアップ — トークン入力", '')

    if (-not $Token) {
        if ($existing) {
            [System.Windows.Forms.MessageBox]::Show(
                '既存のトークンを保持しました。', "What'sNo セットアップ", 'OK', 'Information') | Out-Null
            exit 0
        }
        [System.Windows.Forms.MessageBox]::Show(
            'セットアップをキャンセルしました。', "What'sNo セットアップ", 'OK', 'Warning') | Out-Null
        exit 0
    }
}

# ── config.json 保存 & ACL制限 ──
Write-Host "[2/5] トークンを保存中…" -ForegroundColor Cyan
@{ token = $Token } | ConvertTo-Json | Set-Content $configFile -Encoding utf8
icacls $configFile /inheritance:r /grant:r "${env:USERNAME}:F" 2>&1 | Out-Null

# ── レジストリ登録（HKCU — 管理者権限不要） ──
# 注意: パスに含まれる '*'（全ファイル種別）は PowerShell のプロバイダ経由だと
#       ワイルドカードとして展開され Classes 配下を全走査して固まる。
#       そのため .NET のレジストリ API を直接使い、'*' を必ずリテラル扱いにする。
function Set-WnRegKey {
    param(
        [string]$SubKey,              # HKCU からの相対パス
        [hashtable]$Values = @{}      # 値名 => データ（'' キーは (Default)）
    )
    $key = [Microsoft.Win32.Registry]::CurrentUser.CreateSubKey($SubKey)
    try {
        foreach ($name in $Values.Keys) {
            $key.SetValue($name, $Values[$name], [Microsoft.Win32.RegistryValueKind]::String)
        }
    } finally {
        $key.Close()
    }
}

# 過去バージョンが作ったメニュー項目を掃除する。
# 旧スクリプトのワイルドカード不具合で 'WhatsNoOpen HKCU:' のような壊れたキーが
# 残っていることがあり、これがメニューに意味不明な項目として出てしまう。
function Remove-WnLegacyMenuKeys {
    param(
        [string]$ShellPath,
        [string[]]$Keep = @()
    )
    $shell = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($ShellPath)
    if (-not $shell) { return }
    $names = $shell.GetSubKeyNames()
    $shell.Close()
    foreach ($n in $names) {
        # -like の '*' はここではPowerShellのワイルドカードとして意図通り使う
        if ($n -like 'WhatsNo*' -and $Keep -notcontains $n) {
            try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree("$ShellPath\$n", $false) } catch {}
        }
    }
}

Write-Host "[3/5] 右クリックメニューを登録中…" -ForegroundColor Cyan

# メニューの並び順は shell 配下のキー名の昇順で決まる。
# 「保存」を「開く」より上に出すため、キー名に連番を付けて順序を固定し、
# 両方を Position=Top にして先頭グループにまとめる。
$saveKey = 'WhatsNo1Save'
$openKey = 'WhatsNo2Open'

Remove-WnLegacyMenuKeys 'Software\Classes\*\shell'                    @($saveKey, $openKey)
Remove-WnLegacyMenuKeys 'Software\Classes\Directory\Background\shell' @($openKey)
Remove-WnLegacyMenuKeys 'Software\Classes\DesktopBackground\shell'    @($openKey)

# wscript.exe が使える環境ではランチャー経由（コンソールが一切出ない）。
# 使えない環境では従来どおり powershell.exe を直接呼ぶ（一瞬コンソールが出る）。
$wscript = Join-Path $env:SystemRoot 'System32\wscript.exe'
$psCmd = if (Test-Path $wscript) {
    "`"$wscript`" `"$launcherScript`" `"$uploadScript`" `"%1`""
} else {
    "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$uploadScript`" `"%1`""
}
Set-WnRegKey "Software\Classes\*\shell\$saveKey" @{
    ''         = "What'sNoに保存"
    'Icon'     = 'shell32.dll,13'
    'Position' = 'Top'
}
Set-WnRegKey "Software\Classes\*\shell\$saveKey\command" @{ '' = $psCmd }

# ── 「What'sNoを開く」登録（アプリをブラウザで開くだけ・保存とは別） ──
# ファイル上／フォルダ背景／デスクトップ背景の3か所に登録する。
# from=desktop は「デスクトップから開いた」印で、これが付いているときだけ
# What'sNo側が前回のログインを引き継ぐ（毎回ログイン画面になるのを防ぐ）。
$appUrl    = 'https://space-apps.pages.dev/whatsno/app/dashboard.html?from=desktop'
$openCmd   = "rundll32.exe url.dll,FileProtocolHandler $appUrl"
$openRoots = @(
    "Software\Classes\*\shell\$openKey"                       # ファイルを右クリック
    "Software\Classes\Directory\Background\shell\$openKey"    # フォルダ内の背景を右クリック
    "Software\Classes\DesktopBackground\shell\$openKey"       # デスクトップの背景を右クリック
)
foreach ($openBase in $openRoots) {
    Set-WnRegKey $openBase @{
        ''         = "What'sNoを開く"
        'Icon'     = 'shell32.dll,220'
        'Position' = 'Top'
    }
    Set-WnRegKey "$openBase\command" @{ '' = $openCmd }
}

# ── whatsno:// プロトコルハンドラ登録（自動トークン同期用） ──
Write-Host "[4/5] プロトコルハンドラを登録中…" -ForegroundColor Cyan
if (Test-Path $handlerScript) {
    $protoCmd = if (Test-Path $wscript) {
        "`"$wscript`" `"$launcherScript`" `"$handlerScript`" `"%1`""
    } else {
        "powershell.exe -NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$handlerScript`" `"%1`""
    }
    Set-WnRegKey 'Software\Classes\whatsno' @{
        ''             = 'URL:WhatsNo Protocol'
        'URL Protocol' = ''
    }
    Set-WnRegKey 'Software\Classes\whatsno\shell\open\command' @{ '' = $protoCmd }
}

# ── 同期サーバーをスケジュールタスクに登録してすぐ起動（タスクスケジューラ無応答対策でタイムアウト付き） ──
Write-Host "[5/5] 同期サーバーを登録中…" -ForegroundColor Cyan
if (Test-Path $syncServerScript) {
    $taskLauncher = if (Test-Path $wscript) { $wscript } else { '' }

    $taskJob = Start-Job -ScriptBlock {
        param($taskName, $syncServerScript, $userName, $wscript, $launcherScript)
        Stop-ScheduledTask       -TaskName $taskName -ErrorAction SilentlyContinue
        Unregister-ScheduledTask -TaskName $taskName -Confirm:$false -ErrorAction SilentlyContinue

        # 常駐プロセスなので、ここもランチャー経由。powershell.exe を直接タスクに
        # 登録すると、ログオンのたびにコンソールが出たまま居座る環境がある。
        $action = if ($wscript) {
            New-ScheduledTaskAction -Execute $wscript -Argument "`"$launcherScript`" `"$syncServerScript`""
        } else {
            New-ScheduledTaskAction -Execute 'powershell.exe' `
                -Argument "-NoProfile -WindowStyle Hidden -ExecutionPolicy Bypass -File `"$syncServerScript`""
        }
        $trigger = New-ScheduledTaskTrigger -AtLogOn -User $userName
        # バッテリー駆動だと既定では起動せず・途中で止められる。同期サーバーが
        # 落ちていると whatsno:// フォールバックが毎回走ってしまうので明示的に許可する。
        $settings = New-ScheduledTaskSettingsSet -ExecutionTimeLimit 0 -RestartCount 3 `
                        -RestartInterval (New-TimeSpan -Minutes 1) `
                        -AllowStartIfOnBatteries -DontStopIfGoingOnBatteries
        Register-ScheduledTask -TaskName $taskName -Action $action -Trigger $trigger -Settings $settings -Force | Out-Null
        Start-ScheduledTask    -TaskName $taskName
    } -ArgumentList 'WhatsNoSyncServer', $syncServerScript, $env:USERNAME, $taskLauncher, $launcherScript

    if (Wait-Job $taskJob -Timeout 20) {
        Receive-Job $taskJob -ErrorAction SilentlyContinue | Out-Null
    } else {
        Stop-Job $taskJob -ErrorAction SilentlyContinue
        Write-Host "  ※ 同期サーバーの登録がタイムアウトしました（タスクスケジューラが応答していない可能性）。右クリックメニューは問題なく使えます。" -ForegroundColor Yellow
    }
    Remove-Job $taskJob -Force -ErrorAction SilentlyContinue
}

# ── 完了 ──
if ($interactive) {
    [System.Windows.Forms.MessageBox]::Show(
        "セットアップが完了しました！`n`n・ファイルを右クリック →「What'sNoに保存」`n・ファイル／デスクトップの背景を右クリック →「What'sNoを開く」",
        "What'sNo セットアップ完了", 'OK', 'Information') | Out-Null
} else {
    Write-Host "セットアップ完了！右クリック →「What'sNoに保存」/「What'sNoを開く」が使えます。" -ForegroundColor Green
}

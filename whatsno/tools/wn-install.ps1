# What'sNo デスクトップ連携 セットアップスクリプト
# 使い方: ダッシュボードの「デスクトップ連携」でコマンドをコピーし、
#          スクリプトと同じフォルダで PowerShell に貼り付けて実行

param(
    [string]$Token = '',
    # Windows 11 の右クリックメニューを従来型に戻すか
    #   ask  = 確認する（既定）/ on = 戻す / off = Windows 11 の新メニューに戻す / keep = 触らない
    [ValidateSet('ask', 'on', 'off', 'keep')]
    [string]$ClassicMenu = 'ask',
    # 従来型メニューをいつ反映するか
    #   ask = 確認する（既定）/ now = 今すぐ（エクスプローラーを再起動）
    #   next-logon = 次回サインイン時（再起動しない・既定の推奨）
    [ValidateSet('ask', 'now', 'next-logon')]
    [string]$ApplyNow = 'ask'
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

# ── スクリプトの配置 ──
# Windows PowerShell 5.1 は BOM の無い .ps1 を CP932 として読む。このスクリプト群は
# 日本語コメントを含むので、BOM が落ちると化けたバイト列が構文を壊し、右クリック保存が
# パースエラーで「無言のまま何も起きない」状態になる（非表示起動なのでエラーも見えない）。
# 配布ファイルがどうであれ、配置時に必ず BOM 付き UTF-8 へ揃え直す。
function Copy-WnScript {
    param([string]$Source, [string]$Dest)

    $text = [System.IO.File]::ReadAllText($Source, (New-Object System.Text.UTF8Encoding($false)))
    $text = $text.TrimStart([char]0xFEFF)   # 二重BOMを避ける
    [System.IO.File]::WriteAllText($Dest, $text, (New-Object System.Text.UTF8Encoding($true)))

    # 配置したものが本当に実行できる形かを確認する。ここを黙って通すと
    # 「セットアップ完了」と出たうえで保存だけが効かない、という壊れ方をする。
    $errs = $null
    [System.Management.Automation.Language.Parser]::ParseFile($Dest, [ref]$null, [ref]$errs) | Out-Null
    if ($errs -and $errs.Count -gt 0) {
        Write-Host "  ※ $(Split-Path -Leaf $Dest) に構文エラー: $($errs[0].Message)" -ForegroundColor Red
        return $false
    }
    return $true
}

Write-Host "[1/6] ファイルを配置中…" -ForegroundColor Cyan
New-Item -ItemType Directory -Force -Path $appDir | Out-Null

if (-not (Copy-WnScript $srcUpload $uploadScript)) {
    $msg = "wn-upload.ps1 が壊れています。ダッシュボードからスクリプトをダウンロードし直してください。"
    if ($interactive) {
        [System.Windows.Forms.MessageBox]::Show($msg, "What'sNo セットアップ", 'OK', 'Error') | Out-Null
    } else {
        Write-Host "ERROR: $msg" -ForegroundColor Red
    }
    exit 1
}

# ── wn-token-handler.ps1 を配置（存在する場合） ──
$srcHandler    = Join-Path $srcDir 'wn-token-handler.ps1'
$handlerScript = Join-Path $appDir 'wn-token-handler.ps1'
if (Test-Path $srcHandler) {
    Copy-WnScript $srcHandler $handlerScript | Out-Null
}

# ── wn-fix-desktop-icons.ps1 を配置（存在する場合） ──
# 右クリックメニュー反映のためエクスプローラーを再起動したあと、拡大率の違う
# ディスプレイを併用している環境ではアイコンの間隔が崩れることがある。
# その場で直せるように復旧ツールも一緒に置いておく。
$srcFixIcons  = Join-Path $srcDir 'wn-fix-desktop-icons.ps1'
$fixIconsScript = Join-Path $appDir 'wn-fix-desktop-icons.ps1'
if (Test-Path $srcFixIcons) {
    Copy-WnScript $srcFixIcons $fixIconsScript | Out-Null
}

# ── wn-sync-server.ps1 を配置（存在する場合） ──
$srcSyncServer  = Join-Path $srcDir 'wn-sync-server.ps1'
$syncServerScript = Join-Path $appDir 'wn-sync-server.ps1'
if (Test-Path $srcSyncServer) {
    Copy-WnScript $srcSyncServer $syncServerScript | Out-Null
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
Write-Host "[2/6] トークンを保存中…" -ForegroundColor Cyan
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

Write-Host "[3/6] 右クリックメニューを登録中…" -ForegroundColor Cyan

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
Write-Host "[4/6] プロトコルハンドラを登録中…" -ForegroundColor Cyan
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
Write-Host "[5/6] 同期サーバーを登録中…" -ForegroundColor Cyan
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

# ── Windows 11 の右クリックメニューを従来型に戻す（任意） ──
# Windows 11 の新しい右クリックメニュー（1階層目）は、MSIX パッケージ済みアプリが
# IExplorerCommand で登録したコマンドしか描画しない。ここで登録している HKCU の
# shell 動詞は仕様上どうやっても「その他のオプションを確認」の中に入る
# （Position=Top は旧メニュー内の並び順にしか効かない）。
# 下記 CLSID の InprocServer32 を空で置くと従来型メニューが既定になり、
# 「What'sNoに保存」が1クリック目で出るようになる。HKCU なので管理者権限は不要で、
# wn-uninstall.ps1 から元に戻せる。
Write-Host "[6/6] 右クリックメニューの表示形式を確認中…" -ForegroundColor Cyan

$classicRoot  = 'Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'
$classicClsid = "$classicRoot\InprocServer32"

function Test-WnClassicMenu {
    $key = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey($classicClsid)
    if ($key) { $key.Close(); return $true }
    return $false
}

# 反映前にデスクトップのアイコン配置を控えておく。
# 万一崩れても wn-fix-desktop-icons.ps1 と合わせて復旧できるようにするため。
function Backup-WnDesktopLayout {
    $dir = Join-Path $appDir 'desktop-backup'
    New-Item -ItemType Directory -Force -Path $dir | Out-Null
    $stamp = Get-Date -Format 'yyyyMMdd-HHmmss'
    reg.exe export 'HKCU\Software\Microsoft\Windows\Shell\Bags\1\Desktop' (Join-Path $dir "icons-$stamp.reg") /y 2>&1 | Out-Null
    reg.exe export 'HKCU\Control Panel\Desktop\WindowMetrics'                 (Join-Path $dir "metrics-$stamp.reg") /y 2>&1 | Out-Null
}

# エクスプローラーを「正規の手順で」終了させる。
# Ctrl+Shift+右クリックの「エクスプローラーの終了」と同じ経路（WM_USER+436）で、
# 終了前に設定を保存する。
# Stop-Process -Force で落とすと、デスクトップのアイコン座標が保存されないまま
# 終了するため、次の起動で配置が壊れる（画面いっぱいに散らばる）。
# ここでは絶対に強制終了へフォールバックしないこと。
function Stop-WnExplorerGracefully {
    if (-not ([System.Management.Automation.PSTypeName]'WnShellExit').Type) {
        Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WnShellExit {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr wp, IntPtr lp);
}
'@
    }
    $tray = [WnShellExit]::FindWindow('Shell_TrayWnd', $null)
    if ($tray -eq [IntPtr]::Zero) { return $false }
    [WnShellExit]::PostMessage($tray, 0x5B4, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
    for ($i = 0; $i -lt 60; $i++) {
        Start-Sleep -Milliseconds 250
        if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) { return $true }
    }
    return $false
}

# 戻り値: 反映できたら $true、できなければ $false（次回サインイン時に反映される）
function Restart-WnExplorer {
    Backup-WnDesktopLayout
    if (-not (Stop-WnExplorerGracefully)) {
        Write-Host "  エクスプローラーを正常に終了できませんでした。強制終了はしません" -ForegroundColor Yellow
        Write-Host "  （アイコン配置が壊れるため）。次回サインイン時に反映されます。" -ForegroundColor Yellow
        return $false
    }
    Start-Sleep -Seconds 1
    if (-not (Get-Process -Name explorer -ErrorAction SilentlyContinue)) {
        Start-Process explorer.exe
    }
    Start-Sleep -Seconds 4
    return $true
}

$classicOn = Test-WnClassicMenu

$applyClassic = switch ($ClassicMenu) {
    'on'   { $true }
    'off'  { $false }
    'keep' { $classicOn }
    default {
        if ($classicOn) {
            $true                                   # 既に従来型。黙って維持する
        } elseif (-not [Environment]::UserInteractive) {
            $classicOn                              # 問いかけ先がないので触らない
        } elseif ($interactive) {
            $msg = "Windows 11 では「What'sNoに保存」が『その他のオプションを確認』の中に入ります。`n" +
                   "右クリックメニューを従来型に戻すと、1クリック目で表示されるようになります。`n`n" +
                   "戻しますか？（アンインストール時に元へ戻せます）"
            ([System.Windows.Forms.MessageBox]::Show(
                $msg, "What'sNo セットアップ", 'YesNo', 'Question') -eq 'Yes')
        } else {
            Write-Host "  Windows 11 では「What'sNoに保存」が『その他のオプションを確認』の中に入ります。" -ForegroundColor Yellow
            $ans = Read-Host "  右クリックメニューを従来型に戻しますか？ [Y/n]"
            ($ans -eq '' -or $ans -match '^[Yy]')
        }
    }
}

$menuApplied = $true
if ($applyClassic -ne $classicOn) {
    if ($applyClassic) {
        Set-WnRegKey $classicClsid @{ '' = '' }
    } else {
        try { [Microsoft.Win32.Registry]::CurrentUser.DeleteSubKeyTree($classicRoot, $false) } catch {}
    }
    $style = if ($applyClassic) { '従来型' } else { 'Windows 11 標準' }
    Write-Host "  右クリックメニューを$style に設定しました。" -ForegroundColor Green

    # 反映にはエクスプローラーの再起動が必要。既定は「次回サインイン時」。
    # 今すぐ再起動すると開いているフォルダのウィンドウが閉じるうえ、
    # 拡大率の違うディスプレイを併用している環境ではデスクトップのアイコン間隔が
    # 崩れることがあるため、勝手には再起動しない。
    $restartNow = switch ($ApplyNow) {
        'now'        { $true }
        'next-logon' { $false }
        default {
            if (-not [Environment]::UserInteractive) {
                $false
            } elseif ($interactive) {
                $m = "設定を今すぐ反映しますか？`n`n" +
                     "「はい」… エクスプローラーを再起動します（開いているフォルダのウィンドウが閉じます）`n" +
                     "「いいえ」… 次回サインイン時に反映します（推奨）"
                ([System.Windows.Forms.MessageBox]::Show(
                    $m, "What'sNo セットアップ", 'YesNo', 'Question') -eq 'Yes')
            } else {
                $a = Read-Host "  今すぐ反映しますか？ エクスプローラーを再起動します [y/N]"
                ($a -match '^[Yy]')
            }
        }
    }

    if ($restartNow) {
        $menuApplied = Restart-WnExplorer
    } else {
        $menuApplied = $false
        Write-Host "  次回サインイン時に反映されます。" -ForegroundColor DarkGray
    }
}

# ── 完了 ──
# 従来型メニューにしなかった場合は、項目がどこに出るかを明示しておく
# （黙っていると「登録されていない」と誤解されるため）
$where = if (Test-WnClassicMenu) { '右クリック' } else { '右クリック →「その他のオプションを確認」' }

# 再起動していない場合、メニューの表示形式だけは次回サインインまで変わらない
$pending = if ($menuApplied) { '' } else { "`n`n※ 右クリックメニューの表示形式は次回サインイン時から変わります。" }

if ($interactive) {
    [System.Windows.Forms.MessageBox]::Show(
        "セットアップが完了しました！`n`n・ファイルを$where →「What'sNoに保存」`n・ファイル／デスクトップの背景を$where →「What'sNoを開く」$pending",
        "What'sNo セットアップ完了", 'OK', 'Information') | Out-Null
} else {
    Write-Host "セットアップ完了！$where →「What'sNoに保存」/「What'sNoを開く」が使えます。" -ForegroundColor Green
    if (-not $menuApplied) {
        Write-Host "※ 右クリックメニューの表示形式は次回サインイン時から変わります。" -ForegroundColor Yellow
    }
}

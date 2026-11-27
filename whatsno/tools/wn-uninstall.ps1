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

# 「プログラムから開く」→「What'sNoに保存」の登録を消す。
# 各拡張子の OpenWithProgids から自分の値だけを抜く（他のアプリの値は触らない）。
$saveProgId = 'WhatsNo.SaveFile'
$cu = [Microsoft.Win32.Registry]::CurrentUser
$classes = $cu.OpenSubKey('Software\Classes')
if ($classes) {
    $extKeys = @('*') + @($classes.GetSubKeyNames() | Where-Object { $_ -like '.*' })
    $classes.Close()
    foreach ($ext in $extKeys) {
        $k = $cu.OpenSubKey("Software\Classes\$ext\OpenWithProgids", $true)
        if (-not $k) { continue }
        try { if ($k.GetValueNames() -contains $saveProgId) { $k.DeleteValue($saveProgId, $false) } } finally { $k.Close() }
    }
}
Remove-WnRegKey "Software\Classes\$saveProgId"
$toast = $cu.OpenSubKey('Software\Microsoft\Windows\CurrentVersion\ApplicationAssociationToasts', $true)
if ($toast) {
    try {
        foreach ($n in $toast.GetValueNames()) { if ($n -like "${saveProgId}_*") { $toast.DeleteValue($n, $false) } }
    } finally { $toast.Close() }
}

# ── Windows 11 の右クリックメニューを元に戻す（セットアップで従来型にしていた場合） ──
# 従来型メニューは OS 全体の見た目に関わる設定なので、What'sNo の都合で勝手に戻さず
# 必ず確認する（気に入って使い続けている利用者がいるため）。
$classicRoot = 'Software\Classes\CLSID\{86ca1aa0-34aa-4e8b-a509-50c905bae2a2}'
$classicKey  = [Microsoft.Win32.Registry]::CurrentUser.OpenSubKey("$classicRoot\InprocServer32")
if ($classicKey) {
    $classicKey.Close()
    $restore = [System.Windows.Forms.MessageBox]::Show(
        "右クリックメニューを従来型にする設定が残っています。`nWindows 11 標準のメニューに戻しますか？`n（エクスプローラーが再起動し、開いているフォルダのウィンドウは閉じます）",
        "What'sNo アンインストール", 'YesNo', 'Question')
    if ($restore -eq 'Yes') {
        Remove-WnRegKey $classicRoot
        # 強制終了はしない。設定を保存せずに落ちるとデスクトップのアイコン配置が
        # 壊れるため、正規の終了経路（Ctrl+Shift+右クリックの「エクスプローラーの
        # 終了」と同じ WM_USER+436）を使う。失敗したら再起動せず次回サインインに任せる。
        if (-not ([System.Management.Automation.PSTypeName]'WnShellExit').Type) {
            Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Runtime.InteropServices;
public class WnShellExit {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool PostMessage(IntPtr h, uint m, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
}
'@
        }
        # 待つのはタスクバーを持っているプロセスだけ。explorer.exe 全体の消滅を待つと、
        # 別プロセスのフォルダ窓などが残って「失敗」と誤判定し、タスクバーが消えたまま
        # 放置されていた（2026-11-27 セットアップ側で実例）。最後に必ずタスクバーを戻す。
        $tray = [WnShellExit]::FindWindow('Shell_TrayWnd', $null)
        if ($tray -ne [IntPtr]::Zero) {
            [uint32]$shellPid = 0
            [WnShellExit]::GetWindowThreadProcessId($tray, [ref]$shellPid) | Out-Null
            [WnShellExit]::PostMessage($tray, 0x5B4, [IntPtr]::Zero, [IntPtr]::Zero) | Out-Null
            for ($i = 0; $i -lt 80; $i++) {
                Start-Sleep -Milliseconds 250
                $alive = $shellPid -and (Get-Process -Id $shellPid -ErrorAction SilentlyContinue)
                if (-not $alive -and [WnShellExit]::FindWindow('Shell_TrayWnd', $null) -eq [IntPtr]::Zero) { break }
            }
            Start-Sleep -Seconds 1
        }
        $shellOk = $false
        for ($try = 0; $try -lt 3 -and -not $shellOk; $try++) {
            if ([WnShellExit]::FindWindow('Shell_TrayWnd', $null) -ne [IntPtr]::Zero) { $shellOk = $true; break }
            Start-Process explorer.exe
            for ($i = 0; $i -lt 40; $i++) {
                Start-Sleep -Milliseconds 250
                if ([WnShellExit]::FindWindow('Shell_TrayWnd', $null) -ne [IntPtr]::Zero) { $shellOk = $true; break }
            }
        }
        if (-not $shellOk) {
            [System.Windows.Forms.MessageBox]::Show(
                "画面（タスクバー）を自動で戻せませんでした。`n`nCtrl + Shift + Esc でタスクマネージャーを開き、`n「新しいタスクを実行する」→ explorer と入力して OK を押してください。",
                "What'sNo アンインストール", 'OK', 'Warning') | Out-Null
        }
    }
}

# AppData フォルダ削除
$appDir = Join-Path $env:APPDATA 'WhatsNo'
if (Test-Path $appDir) {
    Remove-Item -Path $appDir -Recurse -Force
}

[System.Windows.Forms.MessageBox]::Show(
    'アンインストールが完了しました。',
    "What'sNo アンインストール", 'OK', 'Information') | Out-Null

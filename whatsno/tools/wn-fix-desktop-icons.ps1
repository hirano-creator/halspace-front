# What'sNo デスクトップアイコン復旧ツール
#
# エクスプローラーが異常終了したあとなどに、デスクトップアイコンの間隔が広がって
# 画面いっぱいに散らばってしまうことがある。これはアイコンのセル寸法が実際の
# 画面とは違う DPI で計算されたまま残るために起きる（内蔵ディスプレイと外部モニタで
# 拡大率が違う環境で起きやすい）。
#
# このスクリプトは explorer を再起動せずに、デスクトップの ListView へ直接
# 正しいセル寸法を設定し、アイコンを左上から詰め直す。
#
# 使い方:
#   .\wn-fix-desktop-icons.ps1              … 状態を診断し、異常なら確認のうえ修正
#   .\wn-fix-desktop-icons.ps1 -Repack      … 確認なしで詰め直す
#   .\wn-fix-desktop-icons.ps1 -CheckOnly   … 診断だけして何もしない

param(
    [switch]$Repack,      # 確認なしで詰め直す
    [switch]$CheckOnly,   # 診断のみ
    [int]$CX = 0,         # 列ピッチ(px)。0 ならアイコンサイズから自動算出
    [int]$CY = 0,         # 行ピッチ(px)。0 ならアイコンサイズから自動算出
    [int]$X0 = 45,        # 左マージン
    [int]$Y0 = 8          # 上マージン
)

if (-not ([System.Management.Automation.PSTypeName]'WnDesk').Type) {
    Add-Type -Language CSharp -TypeDefinition @'
using System;
using System.Text;
using System.Runtime.InteropServices;
public class WnDesk {
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern IntPtr FindWindow(string c, string w);
  [DllImport("user32.dll")] public static extern bool EnumChildWindows(IntPtr p, EnumProc cb, IntPtr l);
  public delegate bool EnumProc(IntPtr h, IntPtr l);
  [DllImport("user32.dll", CharSet=CharSet.Unicode)] public static extern int GetClassName(IntPtr h, StringBuilder s, int max);
  [DllImport("user32.dll", CharSet=CharSet.Auto)] public static extern IntPtr SendMessage(IntPtr h, uint m, IntPtr wp, IntPtr lp);
  [DllImport("user32.dll")] public static extern bool GetWindowRect(IntPtr h, out RECT r);
  [DllImport("user32.dll")] public static extern uint GetWindowThreadProcessId(IntPtr h, out uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr OpenProcess(uint acc, bool inherit, uint pid);
  [DllImport("kernel32.dll")] public static extern IntPtr VirtualAllocEx(IntPtr h, IntPtr addr, UIntPtr size, uint type, uint prot);
  [DllImport("kernel32.dll")] public static extern bool VirtualFreeEx(IntPtr h, IntPtr addr, UIntPtr size, uint type);
  [DllImport("kernel32.dll")] public static extern bool ReadProcessMemory(IntPtr h, IntPtr addr, byte[] buf, UIntPtr size, out UIntPtr read);
  [DllImport("kernel32.dll")] public static extern bool CloseHandle(IntPtr h);

  [StructLayout(LayoutKind.Sequential)] public struct RECT { public int L, T, R, B; }

  // デスクトップのアイコンを描画している SysListView32 を探す。
  // FindWindowEx で親を決め打ちすると環境によって取り逃すため、Progman の
  // 子孫を総なめする。
  public static IntPtr FindListView() {
    IntPtr progman = FindWindow("Progman", null);
    IntPtr found = IntPtr.Zero;
    EnumChildWindows(progman, delegate(IntPtr h, IntPtr l) {
      var sb = new StringBuilder(256);
      GetClassName(h, sb, 256);
      if (sb.ToString() == "SysListView32") { found = h; return false; }
      return true;
    }, IntPtr.Zero);
    return found;
  }
}
'@
}

$LVM_GETITEMCOUNT    = 0x1004
$LVM_GETITEMPOSITION = 0x1010
$LVM_SETITEMPOSITION = 0x100F
$LVM_GETITEMSPACING  = 0x1033
$LVM_SETICONSPACING  = 0x1035

$lv = [WnDesk]::FindListView()
if ($lv -eq [IntPtr]::Zero) {
    Write-Host "デスクトップのアイコン一覧が見つかりませんでした。" -ForegroundColor Red
    exit 1
}

# ── 現在の状態を取得 ──
$spacing = [WnDesk]::SendMessage($lv, $LVM_GETITEMSPACING, [IntPtr]0, [IntPtr]::Zero).ToInt32()
$curCX = $spacing -band 0xFFFF
$curCY = ($spacing -shr 16) -band 0xFFFF

$rect = New-Object WnDesk+RECT
[WnDesk]::GetWindowRect($lv, [ref]$rect) | Out-Null
$viewH = $rect.B - $rect.T

$iconSize = 48
try {
    $v = (Get-ItemProperty 'HKCU:\Software\Microsoft\Windows\Shell\Bags\1\Desktop' -ErrorAction Stop).IconSize
    if ($v) { $iconSize = [int]$v }
} catch {}

# アイコンサイズから素直なセル寸法を出す（48px アイコンで 122 x 110 相当）
if ($CX -le 0) { $CX = [int]([math]::Round($iconSize * 2.55)) }
if ($CY -le 0) { $CY = [int]([math]::Round($iconSize * 2.30)) }

Write-Host ""
Write-Host "── デスクトップアイコンの状態 ──" -ForegroundColor Cyan
Write-Host ("  アイコンサイズ : {0}px" -f $iconSize)
Write-Host ("  現在のセル寸法 : {0} x {1}px" -f $curCX, $curCY)
Write-Host ("  適正なセル寸法 : {0} x {1}px" -f $CX, $CY)

# 適正値の 1.4 倍を超えていたら異常とみなす
$abnormal = ($curCX -gt $CX * 1.4) -or ($curCY -gt $CY * 1.4)
if ($abnormal) {
    Write-Host "  判定           : 異常（間隔が広がっています）" -ForegroundColor Yellow
} else {
    Write-Host "  判定           : 正常" -ForegroundColor Green
}
Write-Host ""

if ($CheckOnly) { exit 0 }

if (-not $Repack) {
    if (-not $abnormal) {
        Write-Host "間隔は正常です。詰め直す場合は -Repack を付けて実行してください。"
        exit 0
    }
    $ans = Read-Host "アイコンを左上から詰め直しますか？（エクスプローラーは再起動しません）[Y/n]"
    if (-not ($ans -eq '' -or $ans -match '^[Yy]')) {
        Write-Host "何もせず終了しました。"
        exit 0
    }
}

# ── 現在のアイコン座標を読む ──
$count = [WnDesk]::SendMessage($lv, $LVM_GETITEMCOUNT, [IntPtr]::Zero, [IntPtr]::Zero).ToInt32()
if ($count -le 0) {
    Write-Host "アイコンがありません。" -ForegroundColor Yellow
    exit 0
}

$procId = 0
[WnDesk]::GetWindowThreadProcessId($lv, [ref]$procId) | Out-Null
# PROCESS_VM_OPERATION | PROCESS_VM_READ | PROCESS_VM_WRITE
$hProc = [WnDesk]::OpenProcess(0x0008 -bor 0x0010 -bor 0x0020, $false, $procId)
if ($hProc -eq [IntPtr]::Zero) {
    Write-Host "エクスプローラーのプロセスを開けませんでした。" -ForegroundColor Red
    exit 1
}

# 座標は explorer 側のメモリに書き戻されるので、そこに領域を確保して読み出す
$mem = [WnDesk]::VirtualAllocEx($hProc, [IntPtr]::Zero, ([UIntPtr]::new(8)), 0x1000, 4)
$items = @()
for ($i = 0; $i -lt $count; $i++) {
    [WnDesk]::SendMessage($lv, $LVM_GETITEMPOSITION, [IntPtr]$i, $mem) | Out-Null
    $buf = New-Object byte[] 8
    $read = [UIntPtr]::Zero
    [WnDesk]::ReadProcessMemory($hProc, $mem, $buf, ([UIntPtr]::new(8)), [ref]$read) | Out-Null
    $items += [pscustomobject]@{
        Index = $i
        X     = [BitConverter]::ToInt32($buf, 0)
        Y     = [BitConverter]::ToInt32($buf, 4)
    }
}
[WnDesk]::VirtualFreeEx($hProc, $mem, [UIntPtr]::Zero, 0x8000) | Out-Null
[WnDesk]::CloseHandle($hProc) | Out-Null

# ── セル寸法を正し、左上から詰め直す ──
# 間隔が壊れているときだけ算出値へ直す。正常な端末で -Repack を実行しただけの
# ときに、算出値で逆に広げてしまわないようにする。
if ($abnormal) {
    $lp = ($CY -shl 16) -bor ($CX -band 0xFFFF)
    [WnDesk]::SendMessage($lv, $LVM_SETICONSPACING, [IntPtr]::Zero, [IntPtr][int]$lp) | Out-Null
} else {
    $CX = $curCX
    $CY = $curCY
}

$rows = [math]::Max(1, [math]::Floor(($viewH - $Y0) / $CY))

# 元のグルーピングを保つため、現在の見た目の順（左の列から上→下）で詰め直す
$sorted = $items | Sort-Object X, Y
$n = 0
foreach ($it in $sorted) {
    $col = [math]::Floor($n / $rows)
    $row = $n % $rows
    $nx = $X0 + $col * $CX
    $ny = $Y0 + $row * $CY
    $pos = ($ny -shl 16) -bor ($nx -band 0xFFFF)
    [WnDesk]::SendMessage($lv, $LVM_SETITEMPOSITION, [IntPtr]$it.Index, [IntPtr][int]$pos) | Out-Null
    $n++
}

Write-Host ("{0}個のアイコンを {1} x {2}px のグリッドに詰め直しました（1列 {3} 行）。" -f $n, $CX, $CY, $rows) -ForegroundColor Green
Write-Host ""
Write-Host "※ セル寸法はエクスプローラー再起動までの一時設定です。サインアウト→サインインすると" -ForegroundColor DarkGray
Write-Host "   本来の値に戻ります。再び広がった場合はこのスクリプトをもう一度実行してください。" -ForegroundColor DarkGray

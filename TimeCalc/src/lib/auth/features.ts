// スタッフ（アカウント）単位の機能設定
//
// ロールで基本権限を決めたうえで、個人ごとに機能をON/OFF・切り替えできる
// ハイブリッド方式（GPS判定の User.gpsCheckEnabled と同じ考え方の一般化）。
// User.featureOverrides（JSON文字列）に「デフォルトと異なる値」だけを保存し、
// 未設定キーはここで定義するデフォルト値が適用される。
// 項目を将来追加してもDB構造を変えずに済む。

/** 本人による勤怠修正の扱い */
export type SelfEditMode = "request" | "direct" | "none";

export const SELF_EDIT_LABELS: Record<SelfEditMode, string> = {
  request: "申請のみ（承認後に反映）",
  direct: "本人直接修正可",
  none: "不可",
};

/** 打刻方式: 自由打刻 / QR経由でタップ打刻 / QRスキャン即打刻 */
export type ClockMode = "free" | "qrTap" | "qrScan";

export const CLOCK_MODE_LABELS: Record<ClockMode, string> = {
  free: "自由打刻（QRなしで画面から打刻可）",
  qrTap: "QRタップ打刻（QR読取後にボタンで打刻）",
  qrScan: "スキャン即打刻（出勤・退勤QRの読取だけで自動打刻）",
};

/** スタッフ単位で切り替えられる機能設定 */
export interface FeatureSettings {
  /** 押し忘れ・誤打刻の修正: 申請のみ / 本人直接修正可 / 不可 */
  selfEdit: SelfEditMode;
  /** 打刻方式。free以外はQRコード経由（?dept= 付きURL）でのみ打刻を許可する */
  clockMode: ClockMode;
  /** マイページに月次集計（勤務時間・遅刻回数など）を表示する */
  showMonthlySummary: boolean;
}

export const DEFAULT_FEATURES: FeatureSettings = {
  selfEdit: "request",
  clockMode: "free",
  showMonthlySummary: true,
};

/** User.featureOverrides のJSON文字列を FeatureSettings に解決する（不正値はデフォルト） */
export function resolveFeatures(featureOverrides: string | null | undefined): FeatureSettings {
  if (!featureOverrides) return { ...DEFAULT_FEATURES };
  try {
    // qrOnlyClock は clockMode 導入前の旧キー。保存済みJSONの互換のため読み取りだけ残す
    const parsed = JSON.parse(featureOverrides) as Partial<FeatureSettings> & {
      qrOnlyClock?: boolean;
    };
    const clockMode =
      parsed.clockMode === "free" || parsed.clockMode === "qrTap" || parsed.clockMode === "qrScan"
        ? parsed.clockMode
        : parsed.qrOnlyClock === true
          ? "qrTap"
          : DEFAULT_FEATURES.clockMode;
    return {
      selfEdit:
        parsed.selfEdit === "direct" || parsed.selfEdit === "none" || parsed.selfEdit === "request"
          ? parsed.selfEdit
          : DEFAULT_FEATURES.selfEdit,
      clockMode,
      showMonthlySummary:
        typeof parsed.showMonthlySummary === "boolean"
          ? parsed.showMonthlySummary
          : DEFAULT_FEATURES.showMonthlySummary,
    };
  } catch {
    return { ...DEFAULT_FEATURES };
  }
}

/** FeatureSettings を保存用JSONに変換する（デフォルトと同じなら null = 上書きなし） */
export function serializeFeatures(features: FeatureSettings): string | null {
  const overrides: Partial<FeatureSettings> = {};
  if (features.selfEdit !== DEFAULT_FEATURES.selfEdit) overrides.selfEdit = features.selfEdit;
  if (features.clockMode !== DEFAULT_FEATURES.clockMode) {
    overrides.clockMode = features.clockMode;
  }
  if (features.showMonthlySummary !== DEFAULT_FEATURES.showMonthlySummary) {
    overrides.showMonthlySummary = features.showMonthlySummary;
  }
  return Object.keys(overrides).length === 0 ? null : JSON.stringify(overrides);
}

/** 打刻方式のフォーム値を検証する（不正値はデフォルト） */
export function toClockMode(value: unknown): ClockMode {
  return value === "free" || value === "qrTap" || value === "qrScan"
    ? value
    : DEFAULT_FEATURES.clockMode;
}

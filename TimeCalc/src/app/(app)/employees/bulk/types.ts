// 社員CSV一括登録の共有型（Route Handler / クライアントコンポーネント両方から使う）

/** CSVの1行分（クライアントでパース済み） */
export interface BulkRow {
  employeeCode: string;
  name: string;
  email: string;
  role: string; // 権限キーまたは表示名（空はEMPLOYEE）
  department: string; // 部署名（空は未設定）
  hourlyWage: string;
  password: string; // 空はランダム生成
}

export interface BulkRowResult {
  employeeCode: string;
  name: string;
  status: "created" | "skipped" | "error";
  message: string;
  /** ランダム生成した初期パスワード（この画面でのみ表示される） */
  generatedPassword: string | null;
}

export interface BulkResult {
  ok: boolean;
  message: string;
  rows: BulkRowResult[];
}

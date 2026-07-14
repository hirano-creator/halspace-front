"use client";

// CSV取込のクライアントUI
// ドラッグ＆ドロップ → 文字コード自動判定 → 列マッピング → プレビュー → 取込

import Papa from "papaparse";
import { useCallback, useMemo, useState, useTransition } from "react";
import type { CsvMappingSettings } from "@/lib/attendance/types";
import { importCsvAction, type ImportResult, type ImportRow } from "./actions";
import {
  Card,
  buttonPrimaryClass,
  inputClass,
  tdClass,
  thClass,
} from "@/components/ui";

interface ParsedCsv {
  fileName: string;
  headers: string[];
  rows: Record<string, string>[];
}

/** マッピング対象の項目定義 */
const FIELD_DEFS: { key: keyof CsvMappingSettings; label: string; required: boolean }[] = [
  { key: "employeeCode", label: "社員番号", required: true },
  { key: "name", label: "氏名（姓）", required: false },
  { key: "name2", label: "氏名（名）", required: false },
  { key: "date", label: "日付", required: true },
  { key: "clockIn", label: "出勤時間", required: true },
  { key: "clockOut", label: "退勤時間", required: true },
  { key: "breakMinutes", label: "休憩（整数=分/小数=時間）", required: false },
];

/**
 * 文字コードを自動判定して読み込む。
 * SquareのエクスポートはUTF-16 LE（BOM付き・タブ区切り）のため、
 * BOMを最優先で判定し、なければUTF-8→Shift_JISの順に試す。
 */
async function readFileWithEncoding(file: File): Promise<string> {
  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);

  // BOMによる判定（UTF-16 LE / UTF-16 BE / UTF-8）
  if (bytes.length >= 2 && bytes[0] === 0xff && bytes[1] === 0xfe) {
    return new TextDecoder("utf-16le").decode(buffer);
  }
  if (bytes.length >= 2 && bytes[0] === 0xfe && bytes[1] === 0xff) {
    return new TextDecoder("utf-16be").decode(buffer);
  }

  const utf8 = new TextDecoder("utf-8").decode(buffer);
  if (!utf8.includes("�")) return utf8;
  try {
    return new TextDecoder("shift_jis").decode(buffer);
  } catch {
    return utf8; // Shift_JIS非対応環境ではUTF-8の結果を使う
  }
}

export function ImportClient({ initialMapping }: { initialMapping: CsvMappingSettings }) {
  const [csv, setCsv] = useState<ParsedCsv | null>(null);
  const [mapping, setMapping] = useState<CsvMappingSettings>(initialMapping);
  const [dragOver, setDragOver] = useState(false);
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFile = useCallback(
    async (file: File) => {
      setParseError(null);
      setResult(null);
      try {
        const text = await readFileWithEncoding(file);
        const parsed = Papa.parse<Record<string, string>>(text, {
          header: true,
          skipEmptyLines: true,
          transformHeader: (h) => h.trim(),
        });
        const headers = parsed.meta.fields ?? [];
        if (!headers.length || !parsed.data.length) {
          setParseError("CSVにデータがありません（1行目をヘッダーとして読み込みます）");
          return;
        }
        setCsv({ fileName: file.name, headers, rows: parsed.data });

        // 保存済みマッピングの列名がこのCSVに存在しない場合は自動推測する
        setMapping((prev) => {
          const next = { ...prev };
          for (const def of FIELD_DEFS) {
            if (!headers.includes(next[def.key])) {
              const guess = headers.find((h) => h.includes(def.label.slice(0, 2)));
              next[def.key] = guess ?? "";
            }
          }
          return next;
        });
      } catch (e) {
        console.error(e);
        setParseError("ファイルの読み込みに失敗しました");
      }
    },
    [],
  );

  const mappedPreview = useMemo<ImportRow[]>(() => {
    if (!csv) return [];
    return csv.rows.map((row, i) => ({
      line: i + 2, // ヘッダーが1行目のため データは2行目から
      employeeCode: row[mapping.employeeCode] ?? "",
      // 姓・名が別列の場合は結合する
      name: [row[mapping.name], mapping.name2 ? row[mapping.name2] : ""]
        .filter(Boolean)
        .join(" "),
      date: row[mapping.date] ?? "",
      clockIn: row[mapping.clockIn] ?? "",
      clockOut: row[mapping.clockOut] ?? "",
      breakMinutes: mapping.breakMinutes ? (row[mapping.breakMinutes] ?? "") : "",
    }));
  }, [csv, mapping]);

  const mappingComplete = FIELD_DEFS.every(
    (def) => !def.required || (mapping[def.key] && csv?.headers.includes(mapping[def.key])),
  );

  const submit = () => {
    if (!csv) return;
    startTransition(async () => {
      try {
        const res = await importCsvAction({
          fileName: csv.fileName,
          rows: mappedPreview,
          mapping,
        });
        setResult(res);
        if (res.ok) setCsv(null);
      } catch (e) {
        console.error(e);
        setResult({
          ok: false,
          message: "取込リクエストに失敗しました。時間をおいて再度お試しください。",
          importedCount: 0,
          createdEmployees: [],
          errors: [],
        });
      }
    });
  };

  return (
    <div className="space-y-6">
      {/* ファイル選択（ドラッグ＆ドロップ） */}
      <Card
        className={`border-2 border-dashed text-center transition ${
          dragOver ? "border-primary bg-violet-50/50" : "border-border"
        }`}
      >
        <div
          onDragOver={(e) => {
            e.preventDefault();
            setDragOver(true);
          }}
          onDragLeave={() => setDragOver(false)}
          onDrop={(e) => {
            e.preventDefault();
            setDragOver(false);
            const file = e.dataTransfer.files[0];
            if (file) void handleFile(file);
          }}
          className="py-10"
        >
          <p className="text-4xl">📥</p>
          <p className="mt-3 font-medium">SquareのCSVファイルをここにドロップ</p>
          <p className="mt-1 text-sm text-muted">または</p>
          <label className="mt-3 inline-block cursor-pointer rounded-lg border border-border bg-white px-4 py-2 text-sm font-medium transition hover:bg-gray-50">
            ファイルを選択
            <input
              type="file"
              accept=".csv,text/csv"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (file) void handleFile(file);
                e.target.value = "";
              }}
            />
          </label>
          <p className="mt-3 text-xs text-muted">UTF-8 / Shift_JIS 対応</p>
        </div>
      </Card>

      {parseError && (
        <p className="rounded-lg bg-red-50 px-4 py-3 text-sm text-red-600">{parseError}</p>
      )}

      {/* 取込結果 */}
      {result && (
        <Card className={result.ok ? "border-emerald-200" : "border-red-200"}>
          <p className={`font-medium ${result.ok ? "text-emerald-700" : "text-red-700"}`}>
            {result.message}
          </p>
          {result.createdEmployees.length > 0 && (
            <div className="mt-3 rounded-lg bg-amber-50 px-4 py-3 text-sm">
              <p className="font-medium text-amber-800">
                以下の社員をCSVから自動登録しました。
                <a href="/employees" className="ml-1 text-primary underline">
                  社員管理
                </a>
                で時給を設定してください（時給0円のままだと金額が計算されません）
              </p>
              <ul className="mt-2 space-y-0.5 text-amber-700">
                {result.createdEmployees.map((e) => (
                  <li key={e.employeeCode}>
                    {e.employeeCode} ・ {e.name}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {result.errors.length > 0 && (
            <ul className="mt-3 max-h-48 space-y-1 overflow-y-auto text-sm text-red-600">
              {result.errors.map((err, i) => (
                <li key={i}>{err}</li>
              ))}
            </ul>
          )}
        </Card>
      )}

      {/* 列マッピングとプレビュー */}
      {csv && (
        <>
          <Card>
            <h2 className="mb-1 text-base font-semibold">列マッピング</h2>
            <p className="mb-4 text-sm text-muted">
              CSVのどの列を各項目として読み込むか選択してください（次回から自動適用されます）
            </p>
            <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FIELD_DEFS.map((def) => (
                <div key={def.key}>
                  <label className="mb-1 block text-xs font-medium text-muted">
                    {def.label}
                    {def.required && <span className="ml-1 text-red-500">*</span>}
                  </label>
                  <select
                    value={mapping[def.key]}
                    onChange={(e) => setMapping({ ...mapping, [def.key]: e.target.value })}
                    className={inputClass}
                  >
                    <option value="">（使用しない）</option>
                    {csv.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </div>
              ))}
            </div>
          </Card>

          <Card className="overflow-x-auto p-0">
            <div className="flex items-center justify-between px-6 py-4">
              <div>
                <h2 className="text-base font-semibold">プレビュー</h2>
                <p className="text-sm text-muted">
                  {csv.fileName} ・ 全{csv.rows.length}行（先頭10行を表示）
                </p>
              </div>
              <button
                type="button"
                onClick={submit}
                disabled={!mappingComplete || pending}
                className={buttonPrimaryClass}
              >
                {pending ? "取込中..." : `${csv.rows.length}行を取り込む`}
              </button>
            </div>
            <table className="w-full min-w-[640px] border-t border-border">
              <thead className="bg-gray-50/50">
                <tr>
                  <th className={thClass}>行</th>
                  <th className={thClass}>社員番号</th>
                  <th className={thClass}>氏名</th>
                  <th className={thClass}>日付</th>
                  <th className={thClass}>出勤</th>
                  <th className={thClass}>退勤</th>
                  <th className={thClass}>休憩</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {mappedPreview.slice(0, 10).map((row) => (
                  <tr key={row.line}>
                    <td className={`${tdClass} text-muted`}>{row.line}</td>
                    <td className={tdClass}>{row.employeeCode}</td>
                    <td className={tdClass}>{row.name}</td>
                    <td className={tdClass}>{row.date}</td>
                    <td className={tdClass}>{row.clockIn}</td>
                    <td className={tdClass}>{row.clockOut}</td>
                    <td className={tdClass}>{row.breakMinutes || "-"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </Card>
        </>
      )}
    </div>
  );
}

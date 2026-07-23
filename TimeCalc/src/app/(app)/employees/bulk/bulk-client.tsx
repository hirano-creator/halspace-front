"use client";

// 社員CSV一括登録のクライアントUI
// ファイル選択 → プレビュー → 登録 → 結果（ランダム生成した初期パスワードはここでのみ表示）

import Papa from "papaparse";
import Link from "next/link";
import { useCallback, useState, useTransition } from "react";
import { readFileWithEncoding } from "@/lib/utils/file-encoding";
import { bulkCreateEmployeesAction } from "./client-actions";
import type { BulkResult, BulkRow } from "./types";
import {
  Badge,
  Card,
  buttonPrimaryClass,
  buttonSecondaryClass,
  tdClass,
  thClass,
} from "@/components/ui";

// CSVの列名（この名前のヘッダー行を1行目に置く）
const COLUMNS = ["社員番号", "氏名", "メール", "権限", "部署", "時給", "初期パスワード"] as const;

const TEMPLATE_CSV =
  "﻿" +
  COLUMNS.join(",") +
  "\r\n" +
  "1001,山田 太郎,taro@example.com,一般社員,ヒラノ,1200,\r\n" +
  "1002,鈴木 花子,,アルバイト,HaLSpace,,\r\n";

function downloadCsv(fileName: string, content: string) {
  const blob = new Blob([content], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = fileName;
  a.click();
  URL.revokeObjectURL(url);
}

export function BulkClient() {
  const [rows, setRows] = useState<BulkRow[] | null>(null);
  const [fileName, setFileName] = useState("");
  const [parseError, setParseError] = useState<string | null>(null);
  const [result, setResult] = useState<BulkResult | null>(null);
  const [pending, startTransition] = useTransition();

  const handleFile = useCallback(async (file: File) => {
    setParseError(null);
    setResult(null);
    setRows(null);
    try {
      const text = await readFileWithEncoding(file);
      const parsed = Papa.parse<Record<string, string>>(text, {
        header: true,
        skipEmptyLines: true,
        transformHeader: (h) => h.trim(),
      });
      const headers = parsed.meta.fields ?? [];
      if (!headers.includes("社員番号") || !headers.includes("氏名")) {
        setParseError(
          "1行目のヘッダーに「社員番号」「氏名」列が必要です（テンプレートをダウンロードして作成してください）",
        );
        return;
      }
      const data: BulkRow[] = parsed.data.map((r) => ({
        employeeCode: r["社員番号"] ?? "",
        name: r["氏名"] ?? "",
        email: r["メール"] ?? "",
        role: r["権限"] ?? "",
        department: r["部署"] ?? "",
        hourlyWage: r["時給"] ?? "",
        password: r["初期パスワード"] ?? "",
      }));
      if (data.length === 0) {
        setParseError("CSVにデータ行がありません");
        return;
      }
      setFileName(file.name);
      setRows(data);
    } catch (e) {
      console.error(e);
      setParseError("ファイルの読み込みに失敗しました");
    }
  }, []);

  function register() {
    if (!rows) return;
    startTransition(async () => {
      const res = await bulkCreateEmployeesAction(rows);
      setResult(res);
    });
  }

  const createdWithPassword = result?.rows.filter((r) => r.generatedPassword) ?? [];

  function downloadPasswords() {
    const csv =
      "﻿社員番号,氏名,初期パスワード\r\n" +
      createdWithPassword
        .map((r) => `${r.employeeCode},${r.name},${r.generatedPassword}`)
        .join("\r\n");
    downloadCsv("initial-passwords.csv", csv);
  }

  return (
    <div className="space-y-6">
      <Card>
        <div className="flex flex-wrap items-center gap-3">
          <label className={`${buttonPrimaryClass} cursor-pointer`}>
            CSVファイルを選択
            <input
              type="file"
              accept=".csv,.txt"
              className="hidden"
              onChange={(e) => {
                const f = e.target.files?.[0];
                if (f) handleFile(f);
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            onClick={() => downloadCsv("employees-template.csv", TEMPLATE_CSV)}
            className={buttonSecondaryClass}
          >
            テンプレートをダウンロード
          </button>
          <Link href="/employees" className={buttonSecondaryClass}>
            社員管理へ戻る
          </Link>
        </div>
        <ul className="mt-4 list-inside list-disc space-y-1 text-xs text-muted">
          <li>1行目はヘッダー（{COLUMNS.join(" / ")}）。「社員番号」「氏名」以外は空欄可</li>
          <li>権限は空欄で一般社員。部署は設定画面で登録済みの部署名を書いてください</li>
          <li>初期パスワードが空欄の場合は自動生成し、登録後にこの画面で一度だけ表示します</li>
          <li>既に登録済みの社員番号はスキップされます（上書きしません）</li>
          <li>文字コードはUTF-8・Shift_JIS（Excelで保存したCSV）のどちらでも読み込めます</li>
        </ul>
        {parseError && (
          <p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-600">{parseError}</p>
        )}
      </Card>

      {rows && !result && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
            <p className="text-sm">
              <span className="font-medium">{fileName}</span>
              <span className="ml-2 text-muted">{rows.length}行</span>
            </p>
            <button type="button" onClick={register} disabled={pending} className={buttonPrimaryClass}>
              {pending ? "登録中..." : `${rows.length}名を登録する`}
            </button>
          </div>
          <div className="overflow-x-auto">
            <table className="w-full min-w-[720px]">
              <thead className="border-b border-border bg-gray-50/50">
                <tr>
                  {COLUMNS.map((c) => (
                    <th key={c} className={thClass}>
                      {c}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {rows.slice(0, 20).map((r, i) => (
                  <tr key={i}>
                    <td className={tdClass}>{r.employeeCode}</td>
                    <td className={tdClass}>{r.name}</td>
                    <td className={`${tdClass} text-muted`}>{r.email}</td>
                    <td className={`${tdClass} text-muted`}>{r.role}</td>
                    <td className={`${tdClass} text-muted`}>{r.department}</td>
                    <td className={`${tdClass} text-muted`}>{r.hourlyWage}</td>
                    <td className={`${tdClass} text-muted`}>{r.password ? "指定あり" : "自動生成"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
            {rows.length > 20 && (
              <p className="px-4 py-2 text-xs text-muted">…ほか{rows.length - 20}行（プレビューは先頭20行）</p>
            )}
          </div>
        </Card>
      )}

      {result && (
        <Card className="p-0">
          <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border px-4 py-3 sm:px-6">
            <p className={`text-sm font-medium ${result.ok ? "text-emerald-700" : "text-amber-700"}`}>
              {result.message}
            </p>
            {createdWithPassword.length > 0 && (
              <button type="button" onClick={downloadPasswords} className={buttonSecondaryClass}>
                初期パスワードをCSVで保存
              </button>
            )}
          </div>
          {createdWithPassword.length > 0 && (
            <p className="border-b border-border bg-amber-50 px-4 py-2 text-xs text-amber-800 sm:px-6">
              自動生成した初期パスワードは再表示できません。この画面でCSV保存するか控えてください。
            </p>
          )}
          <div className="overflow-x-auto">
            <table className="w-full min-w-[640px]">
              <thead className="border-b border-border bg-gray-50/50">
                <tr>
                  <th className={thClass}>社員番号</th>
                  <th className={thClass}>氏名</th>
                  <th className={thClass}>結果</th>
                  <th className={thClass}>内容</th>
                  <th className={thClass}>初期パスワード</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-border">
                {result.rows.map((r, i) => (
                  <tr key={i}>
                    <td className={tdClass}>{r.employeeCode}</td>
                    <td className={tdClass}>{r.name}</td>
                    <td className={tdClass}>
                      <Badge
                        tone={
                          r.status === "created" ? "green" : r.status === "skipped" ? "gray" : "red"
                        }
                      >
                        {r.status === "created" ? "登録" : r.status === "skipped" ? "スキップ" : "エラー"}
                      </Badge>
                    </td>
                    <td className={`${tdClass} text-muted`}>{r.message}</td>
                    <td className={`${tdClass} font-mono`}>{r.generatedPassword ?? ""}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}
    </div>
  );
}

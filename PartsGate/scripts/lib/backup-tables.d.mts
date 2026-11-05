// backup-tables.mjs の型（TypeScript の Worker・テストから読むため）
export interface TableSpec { name: string; key: string[]; since: string; appendOnly?: boolean; updateWhere?: string }
export const TABLES: TableSpec[];
export const COUNT_TRIGGERS: string[];
export function sqlValue(v: unknown): string;
export function upsertSql(spec: TableSpec, row: Record<string, unknown>): string;
export function triggerCreateSql(migrationSql: string): string[];
export function restoreStatements(backups: Record<string, Record<string, unknown>[]>[], migrationSql: string): string[];

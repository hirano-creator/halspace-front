import { useEffect, useState, type FormEvent } from 'react';
import { STAFF_EDITABLE_EQUIPMENT_FIELDS } from '@tenq/shared';
import { apiGet, apiSend } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, Button, Field, Loading, PageHeader, errorMessage, fieldErrors } from '../components/ui';
import { FREQUENCY } from '../labels';
import { navigate } from '../router';
import type { EquipmentDetail } from './EquipmentDetailPage';

type Form = {
  factory_id: string; equipment_code: string; name: string; location: string; category: string; maker: string; model: string;
  manager_user_id: string; area_id: string; frequency: string; template_id: string; notes: string;
};
const EMPTY: Form = { factory_id: '', equipment_code: '', name: '', location: '', category: '', maker: '', model: '', manager_user_id: '', area_id: '', frequency: 'daily', template_id: '', notes: '' };

interface Option { id: string; name: string }

/** 設備の登録・編集。設備担当者は担当設備の一部の項目だけ編集できる（requirements §3-2） */
export function EquipmentFormPage({ id }: { id?: string }) {
  const { me } = useAuth();
  const editing = Boolean(id);
  const [form, setForm] = useState<Form>({ ...EMPTY, factory_id: me?.factories[0]?.id ?? '' });
  const [original, setOriginal] = useState<EquipmentDetail | null>(null);
  const [full, setFull] = useState(!editing);
  const [areas, setAreas] = useState<Option[]>([]);
  const [users, setUsers] = useState<Option[]>([]);
  const [templates, setTemplates] = useState<Option[]>([]);
  const [loading, setLoading] = useState(editing);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  // 編集: 現在の値を読む
  useEffect(() => {
    if (!id) return;
    apiGet<{ item: EquipmentDetail; permissions: { edit: boolean; editAll: boolean } }>(`/equipment/${encodeURIComponent(id)}`)
      .then(({ item, permissions }) => {
        if (!permissions.edit) { setError('この設備を編集する権限がありません。'); return; }
        setOriginal(item);
        setFull(permissions.editAll);
        setForm({
          factory_id: item.factory_id, equipment_code: item.equipment_code, name: item.name, location: item.location ?? '', category: item.category ?? '',
          maker: item.maker ?? '', model: item.model ?? '', manager_user_id: item.manager_user_id ?? '', area_id: item.area_id ?? '',
          frequency: item.frequency, template_id: item.template_id ?? '', notes: item.notes ?? '',
        });
      })
      .catch((e: unknown) => setError(errorMessage(e)))
      .finally(() => setLoading(false));
  }, [id]);

  // 選択肢（担当者・点検基準は会社単位、エリアは工場単位）
  useEffect(() => {
    void apiGet<{ items: Option[] }>('/users/directory').then((r) => setUsers(r.items)).catch(() => {});
    void apiGet<{ items: Option[] }>('/templates').then((r) => setTemplates(r.items)).catch(() => {});
  }, []);
  useEffect(() => {
    if (!form.factory_id) return;
    void apiGet<{ items: (Option & { status: string })[] }>(`/areas?factory=${encodeURIComponent(form.factory_id)}`)
      .then((r) => setAreas(r.items.filter((a) => a.status === 'active'))).catch(() => setAreas([]));
  }, [form.factory_id]);

  const set = (k: keyof Form) => (e: { target: { value: string } }) => setForm((f) => ({ ...f, [k]: e.target.value }));
  const locked = (k: keyof Form) => !full && !(STAFF_EDITABLE_EQUIPMENT_FIELDS as readonly string[]).includes(k);

  async function onSubmit(e: FormEvent) {
    e.preventDefault();
    setBusy(true); setError(null); setErrors({});
    const nul = (v: string) => (v.trim() === '' ? null : v.trim());
    try {
      if (!editing) {
        const r = await apiSend<{ id: string }>('POST', '/equipment', {
          ...Object.fromEntries(Object.entries(form).map(([k, v]) => [k, nul(v)])),
          frequency: form.frequency,
        });
        navigate(`/equipment/${r.id}`, true);
      } else if (original) {
        const keys = (full ? (Object.keys(form) as (keyof Form)[]).filter((k) => k !== 'factory_id') : [...STAFF_EDITABLE_EQUIPMENT_FIELDS]) as (keyof Form)[];
        const body: Record<string, unknown> = { version: original.version };
        for (const k of keys) body[k] = k === 'frequency' ? form[k] : nul(form[k]);
        await apiSend('PATCH', `/equipment/${original.id}`, body);
        navigate(`/equipment/${original.id}`, true);
      }
    } catch (err) {
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
    } finally {
      setBusy(false);
    }
  }

  if (loading) return <Loading />;

  return (
    <>
      <PageHeader title={editing ? `設備の編集${original ? `（${original.equipment_code}）` : ''}` : '設備の登録'}
        sub={editing ? '変更した内容は履歴に残ります。' : '登録すると、設備の QR コードが自動で発行されます。'} />
      {!full && editing && <Alert kind="info">設備担当者が変更できるのは「設置場所・メーカー・型式・備考」です。そのほかは工場長に依頼してください。</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <form className="form panel" onSubmit={onSubmit} noValidate>
        <div className="form-grid">
          <Field label="工場" required error={errors.factory_id}>
            <select value={form.factory_id} onChange={set('factory_id')} disabled={editing}>
              {me?.factories.map((f) => <option key={f.id} value={f.id}>{f.name}</option>)}
            </select>
          </Field>
          <Field label="設備番号" required error={errors.equipment_code} hint="例: P-01（同じ工場の中で重ならない番号）">
            <input value={form.equipment_code} onChange={set('equipment_code')} maxLength={30} disabled={locked('equipment_code')} />
          </Field>
          <Field label="設備名" required error={errors.name}>
            <input value={form.name} onChange={set('name')} maxLength={60} disabled={locked('name')} />
          </Field>
          <Field label="エリア（カード一覧の置き場所）" error={errors.area_id}>
            <select value={form.area_id} onChange={set('area_id')} disabled={locked('area_id')}>
              <option value="">未配置</option>
              {areas.map((a) => <option key={a.id} value={a.id}>{a.name}</option>)}
            </select>
          </Field>
          <Field label="設置場所" error={errors.location} hint="例: A棟 プレスライン 2列目">
            <input value={form.location} onChange={set('location')} maxLength={100} disabled={locked('location')} />
          </Field>
          <Field label="設備分類" error={errors.category} hint="例: プレス・旋盤・溶接">
            <input value={form.category} onChange={set('category')} maxLength={40} disabled={locked('category')} />
          </Field>
          <Field label="メーカー" error={errors.maker}>
            <input value={form.maker} onChange={set('maker')} maxLength={60} disabled={locked('maker')} />
          </Field>
          <Field label="型式" error={errors.model}>
            <input value={form.model} onChange={set('model')} maxLength={60} disabled={locked('model')} />
          </Field>
          <Field label="管理担当者" error={errors.manager_user_id}>
            <select value={form.manager_user_id} onChange={set('manager_user_id')} disabled={locked('manager_user_id')}>
              <option value="">未設定</option>
              {users.map((u) => <option key={u.id} value={u.id}>{u.name}</option>)}
            </select>
          </Field>
          <Field label="点検頻度" error={errors.frequency}>
            <select value={form.frequency} onChange={set('frequency')} disabled={locked('frequency')}>
              {Object.entries(FREQUENCY).map(([k, v]) => <option key={k} value={k}>{v}</option>)}
            </select>
          </Field>
          <Field label="点検基準" error={errors.template_id}>
            <select value={form.template_id} onChange={set('template_id')} disabled={locked('template_id')}>
              <option value="">未設定</option>
              {templates.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </Field>
        </div>
        <Field label="備考" error={errors.notes}>
          <textarea value={form.notes} onChange={set('notes')} rows={3} maxLength={1000} />
        </Field>
        <div className="button-row end">
          <Button onClick={() => history.back()} disabled={busy}>やめる</Button>
          <Button type="submit" variant="primary" disabled={busy}>{busy ? '保存しています…' : editing ? '保存する' : '登録する'}</Button>
        </div>
      </form>
    </>
  );
}

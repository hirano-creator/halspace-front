import { useEffect, useState, type FormEvent } from 'react';
import { SEVERITIES, SEVERITY_LABELS, type Severity } from '@tenq/shared';
import { apiGet, apiSend, apiUpload } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { shrinkPhoto } from '../components/Photo';
import { Alert, Button, Field, PageHeader, errorMessage, fieldErrors, useLoad } from '../components/ui';
import { currentQuery, navigate } from '../router';

/**
 * 異常報告（S-05）。点検の完了画面・設備の詳細から開く。
 * 危険度「高」では設備の使用停止と責任者への連絡を促す。実際の安全判断は会社の安全管理ルールに従う。
 */
export function AbnormalityNewPage() {
  const { me, can } = useAuth();
  const q = currentQuery();
  const equipmentId = q.get('equipment') ?? '';
  const inspectionId = q.get('inspection');
  const itemId = q.get('item');
  const eq = useLoad(() => apiGet<{ item: { id: string; equipment_code: string; name: string; factory_id: string; manager_user_id: string | null; status: string } }>(`/equipment/${encodeURIComponent(equipmentId)}`), [equipmentId]);

  const [title, setTitle] = useState(q.get('title') ?? '');
  const [description, setDescription] = useState(q.get('note') ?? '');
  const [severity, setSeverity] = useState<Severity | ''>('');
  const [emergency, setEmergency] = useState('');
  const [stopped, setStopped] = useState(false);
  const [photos, setPhotos] = useState<{ file: File; url: string }[]>([]);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});

  useEffect(() => () => photos.forEach((p) => URL.revokeObjectURL(p.url)), [photos]);
  const maxPhotos = me?.settings.photo_max_count ?? 10;

  if (!equipmentId) return <Alert kind="error">設備が指定されていません。設備の詳細画面、または点検の完了画面から報告してください。</Alert>;
  const e = eq.data?.item;
  const canStop = e ? can('equipment.stop', { factoryId: e.factory_id, equipmentManagerId: e.manager_user_id }) : false;

  async function submit(ev: FormEvent) {
    ev.preventDefault();
    setError(null); setErrors({});
    setBusy('報告しています…');
    try {
      const r = await apiSend<{ id: string; report_no: string }>('POST', '/abnormalities', {
        equipment_id: equipmentId, inspection_id: inspectionId, inspection_item_id: itemId,
        title, description: description || null, severity: severity || null, emergency_action: emergency || null, equipment_stopped: stopped,
      });
      // 写真は報告のあとに1枚ずつ送る。失敗しても報告自体は残り、詳細画面から追加し直せる
      let failed = 0;
      for (let i = 0; i < photos.length; i++) {
        setBusy(`写真を送っています（${i + 1} / ${photos.length}）…`);
        try { await apiUpload(`/attachments?owner_type=abnormality&owner_id=${r.id}`, await shrinkPhoto(photos[i]!.file), photos[i]!.file.name); } catch { failed++; }
      }
      navigate(`/abnormalities/${r.id}?new=1${failed ? `&photoFailed=${failed}` : ''}`, true);
    } catch (err) {
      setError(errorMessage(err));
      setErrors(fieldErrors(err));
      setBusy(null);
    }
  }

  return (
    <>
      <PageHeader title="異常の報告" sub={e ? `${e.equipment_code} ${e.name}` : '設備を確認しています…'} />
      {eq.error && <Alert kind="error">{eq.error}</Alert>}
      {error && <Alert kind="error">{error}</Alert>}

      <form className="form panel" onSubmit={submit} noValidate>
        <Field label="異常の内容（ひとことで）" required error={errors.title} hint="例: 安全カバーの留め具が外れている">
          <input value={title} onChange={(x) => setTitle(x.target.value)} maxLength={100} />
        </Field>

        <fieldset className="severity" aria-describedby="sev-hint">
          <legend>危険度<span className="req">必須</span></legend>
          <div className="sev-options">
            {SEVERITIES.map((s) => (
              <label key={s} className={`sev sev-${s} ${severity === s ? 'on' : ''}`}>
                <input type="radio" name="severity" value={s} checked={severity === s} onChange={() => setSeverity(s)} />
                <b>{SEVERITY_LABELS[s].label}</b>
                <small>{SEVERITY_LABELS[s].hint}</small>
              </label>
            ))}
          </div>
          {errors.severity && <p className="field-error">{errors.severity}</p>}
        </fieldset>

        {severity === 'high' && (
          <div className="danger-box" role="alert">
            <b>{me?.settings.high_severity_message}</b>
            <label className="check">
              <input type="checkbox" checked={stopped} onChange={(x) => setStopped(x.target.checked)} />
              <span>設備の使用を止めた（止める）
                <small>{canStop ? 'チェックすると、TENQ でもこの設備を「停止中」にします。' : '設備の状態の変更は設備担当者が行います。チェックすると「止めた」ことが記録されます。'}</small>
              </span>
            </label>
          </div>
        )}

        <Field label="詳しい内容" error={errors.description} hint="どこが・どうなっているか、いつから、など">
          <textarea rows={3} value={description} onChange={(x) => setDescription(x.target.value)} maxLength={2000} />
        </Field>
        <Field label="応急処置（したこと）" error={errors.emergency_action} hint="例: 電源を切り、立入禁止の札を掛けた">
          <textarea rows={2} value={emergency} onChange={(x) => setEmergency(x.target.value)} maxLength={1000} />
        </Field>

        <div className="field">
          <span className="field-label">写真（{photos.length} / {maxPhotos}枚）</span>
          <div className="photo-picks">
            {photos.map((p, i) => (
              <figure key={p.url}>
                <img src={p.url} alt={`選んだ写真 ${i + 1}`} />
                <button type="button" className="photo-remove" aria-label={`写真 ${i + 1} を外す`} onClick={() => setPhotos((ps) => ps.filter((_, j) => j !== i))}>×</button>
              </figure>
            ))}
            {photos.length < maxPhotos && (
              <label className="photo-add">
                <input type="file" accept="image/jpeg,image/png,image/webp,image/*" capture="environment" multiple
                  onChange={(x) => {
                    const files = [...(x.target.files ?? [])].slice(0, maxPhotos - photos.length);
                    setPhotos((ps) => [...ps, ...files.map((file) => ({ file, url: URL.createObjectURL(file) }))]);
                    x.target.value = '';
                  }} />
                <span>＋ 写真を撮る・選ぶ</span>
              </label>
            )}
          </div>
          <span className="field-hint">送る前にこの端末で小さくします（長辺 2048px）。</span>
        </div>

        <div className="sticky-action">
          <Button type="submit" variant={severity === 'high' ? 'danger' : 'primary'} className="block big" disabled={!!busy || !title.trim() || !severity || !e}>
            {busy ?? '報告する'}
          </Button>
        </div>
      </form>
    </>
  );
}

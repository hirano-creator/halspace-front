import { useEffect, useState } from 'react';
import { apiBlobUrl } from '../api/client';

/**
 * 写真の縮小（送る前に端末で行う）。長辺 2048px・JPEG（品質 0.8）。
 * iPhone の HEIC は、写真を選んだ時点でブラウザが JPEG に変換して渡すので、ここで読める。
 * 読めない形式は例外を投げる（呼び出し側で利用者に伝える）。
 */
export async function shrinkPhoto(file: File, maxSide = 2048, quality = 0.8): Promise<Blob> {
  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: 'from-image' });
  } catch {
    throw new Error(`「${file.name}」は読み込めない形式です。JPEG・PNG の写真を選んでください。`);
  }
  const scale = Math.min(1, maxSide / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bitmap.width * scale);
  canvas.height = Math.round(bitmap.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('写真を処理できませんでした。');
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', quality));
  if (!blob) throw new Error('写真を処理できませんでした。');
  return blob;
}

/** 権限が必要な写真の表示（取得してから blob: URL で出す） */
export function AuthImage({ id, alt, className }: { id: string; alt: string; className?: string }) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let url: string | null = null;
    let alive = true;
    apiBlobUrl(`/attachments/${encodeURIComponent(id)}`)
      .then((u) => { url = u; if (alive) setSrc(u); else URL.revokeObjectURL(u); })
      .catch(() => { if (alive) setFailed(true); });
    return () => { alive = false; if (url) URL.revokeObjectURL(url); };
  }, [id]);
  if (failed) return <span className="photo-missing">写真を表示できません</span>;
  return src ? <img src={src} alt={alt} className={className} loading="lazy" /> : <span className="photo-loading" aria-label="読み込み中" />;
}

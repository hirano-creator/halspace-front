/**
 * 読み取り結果の音（Web Audio で合成。音声ファイルは使わない）。
 * ブラウザは利用者の操作なしに音を鳴らせないので、担当者を選ぶボタンを押したときに unlock() する。
 *  - 正常: 高い音 1 回 / 警告（読み取り済み・要確認）: 低い音 2 回 / 異常（未登録・エラー）: 長い低い音
 */

let ctx: AudioContext | null = null;

export function unlockSound(): void {
  try {
    ctx ??= new AudioContext();
    if (ctx.state === 'suspended') void ctx.resume();
  } catch { /* 音が使えない環境では鳴らさない */ }
}

function tone(freq: number, start: number, dur: number, type: OscillatorType = 'sine'): void {
  if (!ctx) return;
  const o = ctx.createOscillator();
  const g = ctx.createGain();
  o.type = type;
  o.frequency.value = freq;
  const t = ctx.currentTime + start;
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(0.25, t + 0.01);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(ctx.destination);
  o.start(t);
  o.stop(t + dur + 0.02);
}

export type SoundKind = 'ok' | 'warn' | 'error';

export function play(kind: SoundKind): void {
  if (!ctx) return;
  try {
    if (kind === 'ok') tone(1760, 0, 0.12);
    else if (kind === 'warn') { tone(520, 0, 0.14, 'square'); tone(520, 0.2, 0.14, 'square'); }
    else tone(220, 0, 0.6, 'sawtooth');
  } catch { /* 何もしない */ }
}

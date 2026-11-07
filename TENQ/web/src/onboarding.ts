/**
 * 初めての人の案内（2026-11-08。requirements §10 Q-16）を見たかどうか。
 * 仮定: 端末のブラウザ（localStorage）に利用者ごとに覚える。別の端末ではもう一度出る。
 * 人ごとに覚えるには DB に項目を足す必要があるので、決まったらここだけを差し替える。
 * 秘密情報ではない（ログインのトークンは session.ts。localStorage に置くのは端末記憶トークンだけ、の決まりとは別）
 */

/** 「はじめにやること」のうち、画面のデータから分からないもの（印刷した・毎朝の見方を読んだ） */
export type OnbFlag = 'qr' | 'inspect' | 'daily';

export interface OnbState {
  done: Partial<Record<OnbFlag, boolean>>;
  /** リストを小さくたたんでいる */
  collapsed?: boolean;
  /** 全部終わって閉じた（⚙ の「使い方を見る」でまた出る） */
  finished?: boolean;
  /** 作業者向けの吹き出しを見た（home = ホーム、inspect = 点検表） */
  tips?: Record<string, boolean>;
}

/** E2E・デモで案内を出さないための印（案内そのものを確かめるテスト以外で使う） */
const OFF_KEY = 'tenq_onboarding_off';
const key = (userId: string) => `tenq_onboarding_${userId}`;
/** ⚙ の「使い方を見る」で、開いている画面に知らせる */
export const HELP_EVENT = 'tenq-help';

export function onboardingOff(): boolean {
  try { return localStorage.getItem(OFF_KEY) === '1'; } catch { return true; }
}

export function loadOnb(userId: string): OnbState {
  try {
    const v = JSON.parse(localStorage.getItem(key(userId)) ?? '{}') as Partial<OnbState>;
    return { done: v.done ?? {}, collapsed: v.collapsed, finished: v.finished, tips: v.tips ?? {} };
  } catch { return { done: {}, tips: {} }; }
}

export function saveOnb(userId: string, s: OnbState): void {
  try { localStorage.setItem(key(userId), JSON.stringify(s)); } catch { /* 保存できなくても案内が毎回出るだけ */ }
}

export function updateOnb(userId: string, f: (s: OnbState) => OnbState): OnbState {
  const next = f(loadOnb(userId));
  saveOnb(userId, next);
  return next;
}

export function markOnb(userId: string, flag: OnbFlag): void {
  updateOnb(userId, (s) => ({ ...s, done: { ...s.done, [flag]: true } }));
}

/** ⚙ の「使い方を見る」: リストと吹き出しをもう一度出す（できた手順の ✓ は残す） */
export function replayOnb(userId: string): void {
  updateOnb(userId, (s) => ({ ...s, collapsed: false, finished: false, tips: {} }));
  window.dispatchEvent(new Event(HELP_EVENT));
}

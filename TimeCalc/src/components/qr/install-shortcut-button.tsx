"use client";

// キオスク表示ページ（/qr/[kioskKey]）専用の「ホーム画面に追加」ボタン。
//
// beforeinstallprompt はページ読み込み直後に一度だけ発火する。Reactのハイドレーション後に
// リスナーを張ると、再訪時（Service Workerが既に有効でインストール判定が即座に済む状態）には
// 取りこぼしてボタンが出ないため、捕捉はページ側のインラインスクリプト
// （qr/[kioskKey]/page.tsx の EARLY_INSTALL_CAPTURE）で行い、ここではその結果を読むだけにする。
//
// 表示状態（インストール済みか・どのブラウザか）はサーバー側では判定できない。
// サーバーで仮の内容を描くと、ハイドレーション直後に別の内容へ差し替わって
// 「ボタンが一瞬出てすぐ消える」ように見えてしまうため、判定が済むまでは何も描かない。

import { useState, useSyncExternalStore } from "react";
import {
  INSTALL_PROMPT_EVENT,
  INSTALL_PROMPT_KEY,
  type BeforeInstallPromptEvent,
} from "./install-prompt-shared";

type Platform = "ios" | "android" | "desktop";

interface InstallSnapshot {
  /** クライアント側の判定が済んだか（済むまでは何も描画しない＝チラつき防止） */
  ready: boolean;
  promptEvent: BeforeInstallPromptEvent | null;
  installed: boolean;
  platform: Platform;
}

const SERVER_SNAPSHOT: InstallSnapshot = {
  ready: false,
  promptEvent: null,
  installed: false,
  platform: "desktop",
};

function detectEnvironment(): { installed: boolean; platform: Platform } {
  const standalone =
    window.matchMedia("(display-mode: standalone)").matches ||
    (navigator as unknown as { standalone?: boolean }).standalone === true;

  const ua = navigator.userAgent;
  const isIos =
    /iphone|ipad|ipod/i.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  const isAndroid = /android/i.test(ua);

  return { installed: standalone, platform: isIos ? "ios" : isAndroid ? "android" : "desktop" };
}

function readStashedPrompt(): BeforeInstallPromptEvent | null {
  return (window as unknown as Record<string, BeforeInstallPromptEvent | null>)[INSTALL_PROMPT_KEY] ?? null;
}

function createInstallStore() {
  let snapshot: InstallSnapshot = SERVER_SNAPSHOT;
  let notify: (() => void) | null = null;

  function refresh() {
    snapshot = { ...snapshot, ready: true, ...detectEnvironment(), promptEvent: readStashedPrompt() };
    notify?.();
  }

  function subscribe(onStoreChange: () => void): () => void {
    notify = onStoreChange;
    refresh();

    function onInstalled() {
      snapshot = { ...snapshot, installed: true, promptEvent: null };
      notify?.();
    }

    // インラインスクリプトが捕捉した時に飛ばすカスタムイベント（ハイドレーション後の発火にも対応）
    window.addEventListener(INSTALL_PROMPT_EVENT, refresh);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      notify = null;
      window.removeEventListener(INSTALL_PROMPT_EVENT, refresh);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }

  return {
    subscribe,
    getSnapshot: () => snapshot,
    getServerSnapshot: () => SERVER_SNAPSHOT,
    markPrompted: () => {
      (window as unknown as Record<string, unknown>)[INSTALL_PROMPT_KEY] = null;
      snapshot = { ...snapshot, promptEvent: null };
      notify?.();
    },
  };
}

/** beforeinstallpromptが取れなかった環境向けの手動インストール手順 */
const MANUAL_HINTS: Record<Platform, string> = {
  ios: "共有ボタン（□に↑のアイコン）→「ホーム画面に追加」をタップしてください",
  android: "ブラウザのメニュー（⋮）→「アプリをインストール」または「ホーム画面に追加」をタップしてください",
  desktop:
    "ブラウザのメニュー（⋮）→「キャスト、保存、共有」→「ページをアプリとしてインストール」を選んでください",
};

/** 追加済みの場合に、アイコンがどこにあるかを案内する（Windowsはデスクトップに自動作成されない） */
const INSTALLED_HINTS: Record<Platform, string> = {
  ios: "ホーム画面にアイコンが追加されています。",
  android: "ホーム画面またはアプリ一覧にアイコンが追加されています。",
  desktop:
    "アイコンはスタートメニュー（Macは Launchpad／アプリケーション）に作成されます。デスクトップに置くには、スタートメニューで検索し、右クリック →「その他」→「ファイルの場所を開く」→ 出てきたショートカットをデスクトップへコピーしてください。",
};

export function InstallShortcutButton() {
  const [store] = useState(createInstallStore);
  const { ready, promptEvent, installed, platform } = useSyncExternalStore(
    store.subscribe,
    store.getSnapshot,
    store.getServerSnapshot,
  );
  const [showHint, setShowHint] = useState(false);

  // クライアント判定が済むまでは描画しない（サーバー描画との差し替えによるチラつきを避ける）
  if (!ready) return null;

  // 店舗に掲示する画面のため、説明文は常時出さず1行のトグルに畳んでおく（既存の「URLを表示」と同じ扱い）
  if (installed) {
    return (
      <div className="mb-3 text-center print:hidden">
        <button
          type="button"
          onClick={() => setShowHint((v) => !v)}
          className="text-xs text-muted underline-offset-2 hover:underline"
        >
          ✅ アプリとして追加済み{showHint ? "（閉じる ▲）" : "・アイコンの場所 ▼"}
        </button>
        {showHint && (
          <div className="mx-auto mt-2 max-w-sm space-y-2 rounded-lg bg-gray-50 px-3 py-2 text-left">
            <p className="text-xs text-muted">{INSTALLED_HINTS[platform]}</p>
            {/*
              ルートのTimeCalcアプリ（start_url="/"・スコープが全ページ）が先にインストールされていると、
              キオスクURLもそのアプリのウィンドウで開かれ、ここが「追加済み」表示になる。
              ただしそのアイコンから起動すると "/" ＝ログイン必須画面が開き、目的のQR画面にはならないため、
              見分け方と対処を残しておく。
            */}
            <p className="text-xs text-amber-700">
              アイコンから開いた時にログイン画面が出る場合は、部署ごとのQRではなく「TimeCalc」アプリが追加されています。
              そちらをアンインストールしてから、この画面をブラウザのタブで開き直して追加し直してください。
            </p>
          </div>
        )}
      </div>
    );
  }

  async function handleClick() {
    if (promptEvent) {
      await promptEvent.prompt();
      await promptEvent.userChoice;
      store.markPrompted();
      return;
    }
    // イベントが取れていない環境では手順を案内する（ボタンを無反応にしない）
    setShowHint((v) => !v);
  }

  return (
    <div className="mb-3 text-center print:hidden">
      <button
        type="button"
        onClick={handleClick}
        className="inline-flex items-center gap-1.5 rounded-lg border border-primary/30 bg-violet-50 px-4 py-2 text-sm font-medium text-primary"
      >
        📲 ホーム画面に追加
      </button>
      {showHint && !promptEvent && (
        <p className="mx-auto mt-2 max-w-sm text-xs text-muted">{MANUAL_HINTS[platform]}</p>
      )}
    </div>
  );
}

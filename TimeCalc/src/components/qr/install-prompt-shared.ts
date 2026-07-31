// キオスク画面の「ホーム画面に追加」でインラインスクリプト側とReact側が共有する定数・型。
// ここを単一の出どころにして、window に置くキー名がズレるのを防ぐ。

export interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

/** インラインスクリプトが捕捉した beforeinstallprompt を退避しておく window のプロパティ名 */
export const INSTALL_PROMPT_KEY = "__timecalcInstallPrompt";

/** 捕捉時にReact側へ知らせるカスタムイベント名 */
export const INSTALL_PROMPT_EVENT = "timecalc:installprompt";

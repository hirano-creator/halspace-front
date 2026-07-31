"use client";

import { useEffect } from "react";

/**
 * 旧実装で / スコープに登録してしまったService Workerを解除する後始末。
 *
 * 初期版の /sw.js は全ページを制御したうえ event.respondWith(fetch(...)) で通信を素通しさせており、
 * ナビゲーションが "Failed to fetch" になって画面が真っ白になる不具合を起こした。
 * Service Workerは一度登録されるとページ側のコードを直しても残り続けるため、
 * 既に登録済みの利用者を確実に復旧させる目的で明示的に解除する。
 *
 * 現在のSWは /qr/sw.js（スコープ /qr/）のみで、管理画面側には一切登録しない。
 */
export function ServiceWorkerCleanup() {
  useEffect(() => {
    if (!("serviceWorker" in navigator)) return;
    navigator.serviceWorker
      .getRegistrations()
      .then((registrations) => {
        for (const registration of registrations) {
          // /qr/ スコープの現行SWは残し、それより広いスコープ（旧 / スコープ）だけ解除する
          if (!registration.scope.includes("/qr/")) {
            registration.unregister();
          }
        }
      })
      .catch(() => {
        /* 解除できなくても画面表示には影響しないため握りつぶす */
      });
  }, []);
  return null;
}

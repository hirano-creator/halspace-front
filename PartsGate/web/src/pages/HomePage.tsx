import { apiGet, type Page } from '../api/client';
import { useAuth } from '../auth/AuthContext';
import { Alert, PageHeader, useLoad } from '../components/ui';

/**
 * ホーム。ダッシュボード（STEP 7）ができるまでは、初期設定の進み具合と、これからできることを出す。
 */
export function HomePage() {
  const { me, can } = useAuth();
  const counts = useLoad(async () => {
    const [staff, locations, destinations] = await Promise.all([
      apiGet<Page<unknown>>('/staff?status=active&limit=200'),
      apiGet<Page<unknown>>('/locations?status=active&limit=200'),
      apiGet<Page<unknown>>('/destinations?status=active&limit=200'),
    ]);
    const n = (p: Page<unknown>) => (p.next_cursor ? `${p.items.length}+` : String(p.items.length));
    return { staff: n(staff), locations: n(locations), destinations: n(destinations) };
  }, []);

  const steps = [
    { label: '担当者', to: '/staff', n: counts.data?.staff, hint: '読み取りをする人を登録します' },
    { label: '置場', to: '/locations', n: counts.data?.locations, hint: 'CSV の置場コード（例: 0053）と同じ書き方で登録します' },
    { label: '納品先', to: '/destinations', n: counts.data?.destinations, hint: 'CSV 取込の画面からまとめて登録することもできます' },
  ];

  return (
    <>
      <PageHeader title="ホーム" sub={`${me?.company?.name ?? ''} ・ ${me?.user.name ?? ''} さん`} />
      <div className="flex max-w-4xl flex-col gap-4 p-4 lg:p-5">
        {counts.error && <Alert kind="error">{counts.error}</Alert>}
        <section className="card p-5">
          <h2 className="mb-3 font-bold">初期設定</h2>
          <div className="grid gap-3 sm:grid-cols-3">
            {steps.map((s) => (
              <a key={s.to} href={`#${s.to}`} className="rounded-xl border border-slate-200 p-4 hover:border-slate-400 hover:bg-slate-50">
                <p className="text-xs text-slate-500">{s.label}（利用中）</p>
                <p className="text-3xl font-extrabold">{s.n ?? '…'}<span className="ml-1 text-sm font-semibold text-slate-500">件</span></p>
                <p className="mt-1 text-xs text-slate-500">{s.hint}</p>
              </a>
            ))}
          </div>
          {can('settings.manage') && <p className="mt-3 text-sm"><a className="text-blue-700 underline" href="#/settings">システム設定</a>で、照合に使う列やラベルの枚数を確認してください。</p>}
        </section>
        <a href="#/scan" className="card flex items-center gap-4 p-5 hover:border-slate-500">
          <span className="text-4xl" aria-hidden="true">▣</span>
          <span><b className="text-lg">バーコード読み取りを始める</b><span className="block text-sm text-slate-500">担当者を選んで、置場ごとに部品をチェックします</span></span>
        </a>
        <Alert kind="info">注文データ・読み取り履歴・分析の画面は、これから作ります（開発の STEP 7）。</Alert>
      </div>
    </>
  );
}

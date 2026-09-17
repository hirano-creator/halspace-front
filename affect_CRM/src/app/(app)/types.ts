// ダッシュボードの型（Route Handler とクライアントの両方から import する）

export interface DashboardStats {
  todayVisits: number;
  todayNamedVisits: number;
  todayAnonymousVisits: number;
  todayReservations: number;
  todaySchoolReservations: number;
  monthVisits: number;
  monthNewCustomers: number;
  monthPurchasedVisits: number;
  monthUnpurchasedVisits: number;
  /** 0〜100 の整数 */
  monthPurchaseRate: number;
  monthSales: number;
  monthAverageSpend: number;
  monthSchoolAttendees: number;
}

export interface DashboardReservation {
  id: string;
  startTime: string;
  courseName: string;
  customerName: string;
  headcount: number;
  staffName: string | null;
  status: string;
  source: string;
}

export interface DashboardFollowUp {
  id: string;
  customerId: string;
  customerName: string;
  content: string;
  memo: string | null;
  overdue: boolean;
}

export interface DashboardVisit {
  id: string;
  /** "9/12(土)" */
  date: string;
  time: string;
  /** 顧客名。匿名なら「お名前不明（20代・男性）」 */
  displayName: string;
  customerId: string | null;
  /** 既存顧客の来店回数（累計）。匿名来店なら null */
  visitCount: number | null;
  purposeLabel: string | null;
  channelLabel: string | null;
  purchased: boolean;
}

export interface DashboardPurchase {
  id: string;
  /** "9/12(土)" */
  date: string;
  /** お名前不明の購入は null（来店にだけ紐づく） */
  customerId: string | null;
  /** 顧客名。匿名なら「お名前不明（20代・男性）」 */
  customerName: string;
  visitId: string | null;
  /** 顧客の来店回数（累計）。匿名なら null */
  visitCount: number | null;
  items: string;
  totalAmount: number;
}

export interface DashboardDailyPoint {
  /** 1〜31 */
  day: number;
  /** 0=日 〜 6=土 */
  weekday: number;
  /** 来店組数 */
  count: number;
}

export interface DashboardVisitTrend {
  /** 1〜12 */
  currentMonthNumber: number;
  /** 1〜12 */
  previousMonthNumber: number;
  /** 当月の日数（前月と日数が違っても表示の横軸は当月基準で揃える） */
  currentMonthTotalDays: number;
  /** 今日の日にち（1〜31） */
  todayDay: number;
  /**
   * 当月 1 日〜末日の曜日（0=日 〜 6=土）。index は「日にち - 1」。
   * current は今日までしか無いので、未来日の曜日はこれを見る
   * （前月の同じ日にちから曜日を取るとズレる）
   */
  currentWeekdays: number[];
  /** 1日〜今日まで。未来日は含まない */
  current: DashboardDailyPoint[];
  /** 1日〜前月の末日まで */
  previous: DashboardDailyPoint[];
}

export interface DashboardResponse {
  date: string;
  stats: DashboardStats;
  visitTrend: DashboardVisitTrend;
  todayReservations: DashboardReservation[];
  todayFollowUps: DashboardFollowUp[];
  recentVisits: DashboardVisit[];
  recentPurchases: DashboardPurchase[];
}

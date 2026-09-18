// データ分析の型（Route Handler とクライアントで共有する）

/** 集計結果の 1 行。棒グラフ・円グラフにそのまま渡せる形にしておく */
export interface Bucket {
  label: string;
  count: number;
}

/** 率つきの集計行（購入率・未購入率など） */
export interface RateBucket {
  label: string;
  total: number;
  hit: number;
  /** 0〜100 の整数 */
  rate: number;
}

export interface AmountBucket {
  label: string;
  amount: number;
  count: number;
}

/** 時間帯別（0〜23 時の 24 要素。JST） */
export interface HourBucket {
  hour: number;
  count: number;
}

/** 曜日別（日=0 〜 土=6 の 7 要素。JST） */
export interface WeekdayBucket {
  weekday: number;
  count: number;
  /** 期間内にその曜日が何日あったか（未来日は含めない）。1 日平均を出すための分母 */
  days: number;
}

export interface WeekdayAmountBucket {
  weekday: number;
  amount: number;
  count: number;
}

export interface VisitAnalytics {
  total: number;
  named: number;
  anonymous: number;
  /** お名前を伺えた率（接客で声をかけられているかの指標） */
  namedRate: number;
  newCustomers: number;
  repeaters: number;
  byGender: Bucket[];
  /** 年代順（若い順、不明・未設定は最後） */
  byAgeGroup: Bucket[];
  byPrefecture: Bucket[];
  byPurpose: Bucket[];
  byChannel: Bucket[];
  byReferrer: Bucket[];
  byHour: HourBucket[];
  byWeekday: WeekdayBucket[];
  /** [曜日][時] の来店組数。混む時間帯のヒートマップ用 */
  byWeekdayHour: number[][];
}

export interface PurchaseAnalytics {
  purchasedVisits: number;
  unpurchasedVisits: number;
  purchaseRate: number;
  sales: number;
  purchaseCount: number;
  averageSpend: number;
  byCategory: AmountBucket[];
  byProduct: AmountBucket[];
  /** 年代順 */
  rateByAgeGroup: RateBucket[];
  rateByGender: RateBucket[];
  rateByChannel: RateBucket[];
  /** 曜日別の売上 */
  byWeekday: WeekdayAmountBucket[];
}

export interface ConsideringCustomer {
  visitId: string;
  customerId: string | null;
  name: string;
  visitedAt: string;
  interestNames: string[];
  comment: string | null;
  phone: string | null;
}

export interface NoPurchaseAnalytics {
  count: number;
  rate: number;
  byReason: Bucket[];
  byInterest: Bucket[];
  rateByChannel: RateBucket[];
  /** 年代順 */
  rateByAgeGroup: RateBucket[];
  /** 「検討中」で帰られた方。ワンクリックで出せるようにする */
  considering: ConsideringCustomer[];
}

export interface SchoolAnalytics {
  sessions: number;
  attendees: number;
  newAttendees: number;
  repeatAttendees: number;
  averagePerSession: number;
  capacity: number;
  fillRate: number;
  cancelled: number;
  noShow: number;
  cancelRate: number;
  byCourse: Bucket[];
  byStaff: Bucket[];
}

export interface FunnelAnalytics {
  visitToPurchase: RateBucket;
  visitToSchool: RateBucket;
  schoolToPurchase: RateBucket;
  firstToSecondVisit: RateBucket;
  noPurchaseToLaterPurchase: RateBucket;
}

export interface AnalyticsResponse {
  period: { key: string; label: string; from: string; to: string };
  visit: VisitAnalytics;
  purchase: PurchaseAnalytics;
  noPurchase: NoPurchaseAnalytics;
  school: SchoolAnalytics;
  funnel: FunnelAnalytics;
}

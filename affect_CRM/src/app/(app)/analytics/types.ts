// データ分析の型（Route Handler とクライアントで共有する）

/** 集計結果の 1 行。棒グラフにそのまま渡せる形にしておく */
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

export interface VisitAnalytics {
  total: number;
  named: number;
  anonymous: number;
  /** お名前を伺えた率（接客で声をかけられているかの指標） */
  namedRate: number;
  newCustomers: number;
  repeaters: number;
  byGender: Bucket[];
  byAgeGroup: Bucket[];
  byPrefecture: Bucket[];
  byPurpose: Bucket[];
  byChannel: Bucket[];
  byReferrer: Bucket[];
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
  rateByAgeGroup: RateBucket[];
  rateByGender: RateBucket[];
  rateByChannel: RateBucket[];
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

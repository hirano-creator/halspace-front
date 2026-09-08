// 来店管理の型（Route Handler とクライアントで共有する）

export interface VisitListItem {
  id: string;
  date: string;
  time: string;
  customerId: string | null;
  /** 顧客名。匿名なら「お名前不明（20代・男性）」 */
  displayName: string;
  isAnonymous: boolean;
  partySize: number;
  purposeLabel: string | null;
  channelLabel: string | null;
  purchased: boolean;
  noPurchaseReasonLabel: string | null;
  interestNames: string[];
  staffName: string | null;
}

/** グループ内の年代・性別が一様でないときだけ使う、1人ずつの内訳 */
export interface GuestBreakdownRow {
  ageGroup: string | null;
  gender: string | null;
}

export interface VisitListResponse {
  total: number;
  page: number;
  perPage: number;
  visits: VisitListItem[];
}

/** 来店記録の詳細（編集フォームにそのまま入れられる形で返す） */
export interface VisitDetailResponse {
  id: string;
  customerId: string | null;
  customerName: string | null;
  customerCode: string | null;
  displayName: string;
  guestAgeGroup: string | null;
  guestGender: string | null;
  guestMemo: string | null;
  guestBreakdown: GuestBreakdownRow[];
  /** "2026-09-01T14:20" */
  visitedAt: string;
  partySize: number;
  purposeCode: string | null;
  channelCode: string | null;
  referrerCode: string | null;
  prefectureCode: string | null;
  purchased: boolean;
  noPurchaseReasonCode: string | null;
  noPurchaseComment: string | null;
  conversation: string | null;
  nextProposal: string | null;
  /** "2026-09-10" */
  followUpDate: string | null;
  interestCategoryIds: string[];
  isFirstVisit: boolean;
  staffName: string | null;
  /** この来店に紐づく購入。削除の可否判定に使う */
  purchases: { id: string; totalAmount: number }[];
}

/** 顧客検索（来店登録の顧客選択で使う） */
export interface CustomerSuggestion {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  visitCount: number;
  lastVisitLabel: string | null;
}

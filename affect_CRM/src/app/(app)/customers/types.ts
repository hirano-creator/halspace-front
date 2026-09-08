// 顧客管理の型（Route Handler とクライアントで共有する）

export interface CustomerTagRef {
  id: string;
  name: string;
  color: string | null;
}

export interface CustomerListItem {
  id: string;
  code: string;
  name: string;
  nameKana: string | null;
  gender: string | null;
  age: number | null;
  prefecture: string | null;
  rank: string | null;
  phone: string | null;
  visitCount: number;
  lastVisitAt: string | null;
  purchaseTotal: number;
  purchaseCount: number;
  schoolCount: number;
  tags: CustomerTagRef[];
}

export interface CustomerListResponse {
  total: number;
  page: number;
  perPage: number;
  customers: CustomerListItem[];
}

export interface DuplicateCandidate {
  id: string;
  code: string;
  name: string;
  phone: string | null;
  email: string | null;
  reason: string;
}

/** 選択肢マスタ（/api/masters） */
export interface MastersResponse {
  options: Record<string, { code: string; label: string }[]>;
  tags: CustomerTagRef[];
  categories: { id: string; name: string }[];
}

// ---- 顧客カルテ ----

export interface CustomerDetailHeader {
  id: string;
  code: string;
  name: string;
  nameKana: string | null;
  nickname: string | null;
  gender: string | null;
  age: number | null;
  birthday: string | null;
  phone: string | null;
  email: string | null;
  prefecture: string | null;
  city: string | null;
  addressLine: string | null;
  lineId: string | null;
  instagram: string | null;
  rank: string | null;
  rankLabel: string | null;
  note: string | null;
  visitCount: number;
  lastVisitAt: string | null;
  purchaseTotal: number;
  purchaseCount: number;
  lastPurchaseAt: string | null;
  schoolCount: number;
  tags: CustomerTagRef[];
  surf: {
    experienceYears: number | null;
    levelLabel: string | null;
    boardTypeLabel: string | null;
    boardSize: string | null;
    wetsuitSizeLabel: string | null;
    favoritePoints: string | null;
    frequencyLabel: string | null;
    interestedCategoryNames: string[];
  } | null;
}

export interface CustomerVisitRow {
  id: string;
  visitedAt: string;
  purposeLabel: string | null;
  channelLabel: string | null;
  purchased: boolean;
  noPurchaseReasonLabel: string | null;
  noPurchaseComment: string | null;
  interestNames: string[];
  conversation: string | null;
  nextProposal: string | null;
  staffName: string | null;
}

export interface CustomerPurchaseRow {
  id: string;
  purchasedAt: string;
  totalAmount: number;
  items: { productName: string; size: string | null; quantity: number; subtotal: number }[];
  staffName: string | null;
}

export interface CustomerFollowUpRow {
  id: string;
  content: string;
  dueDate: string;
  status: string;
  memo: string | null;
  assigneeName: string | null;
}

export interface CustomerNoteRow {
  id: string;
  body: string;
  createdAt: string;
  staffName: string | null;
}

export interface CustomerDetailResponse {
  header: CustomerDetailHeader;
  visits: CustomerVisitRow[];
  purchases: CustomerPurchaseRow[];
  followUps: CustomerFollowUpRow[];
  notes: CustomerNoteRow[];
  /** Phase 2 で中身を入れる */
  schools: { id: string; attendedAt: string; courseName: string | null; evalTotal: number | null }[];
  reservations: { id: string; date: string; startTime: string; courseName: string; status: string }[];
}

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
  time: string;
  /** 顧客名。匿名なら「お名前不明（20代・男性）」 */
  displayName: string;
  customerId: string | null;
  purposeLabel: string | null;
  channelLabel: string | null;
  purchased: boolean;
}

export interface DashboardPurchase {
  id: string;
  customerId: string;
  customerName: string;
  items: string;
  totalAmount: number;
}

export interface DashboardResponse {
  date: string;
  stats: DashboardStats;
  todayReservations: DashboardReservation[];
  todayFollowUps: DashboardFollowUp[];
  recentVisits: DashboardVisit[];
  recentPurchases: DashboardPurchase[];
}

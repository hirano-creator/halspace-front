export interface FollowUpItem {
  id: string;
  customerId: string;
  customerName: string;
  customerPhone: string | null;
  content: string;
  dueDate: string;
  overdue: boolean;
  status: string;
  memo: string | null;
  assigneeId: string | null;
  assigneeName: string | null;
}

export interface FollowUpListResponse {
  followUps: FollowUpItem[];
  staffs: { id: string; name: string }[];
}

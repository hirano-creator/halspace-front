export interface TagRow {
  id: string;
  name: string;
  color: string | null;
  sortOrder: number;
  isActive: boolean;
  customerCount: number;
}

export interface MasterOptionRow {
  id: string;
  type: string;
  code: string;
  label: string;
  sortOrder: number;
  isActive: boolean;
}

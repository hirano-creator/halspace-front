export interface ProductItem {
  id: string;
  name: string;
  brand: string | null;
  price: number | null;
  categoryId: string | null;
  categoryName: string | null;
}

export interface ProductListResponse {
  products: ProductItem[];
  categories: { id: string; name: string }[];
}

export interface PurchaseRow {
  id: string;
  purchasedAt: string;
  /** お名前不明の購入は null（来店にだけ紐づく） */
  customerId: string | null;
  /** 顧客名。匿名なら「お名前不明（20代・男性）」 */
  customerName: string;
  visitId: string | null;
  totalAmount: number;
  staffName: string | null;
  items: { productName: string; size: string | null; quantity: number; subtotal: number }[];
}

export interface PurchaseListResponse {
  purchases: PurchaseRow[];
  total: number;
  count: number;
}

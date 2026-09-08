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
  customerId: string;
  customerName: string;
  totalAmount: number;
  staffName: string | null;
  items: { productName: string; size: string | null; quantity: number; subtotal: number }[];
}

export interface PurchaseListResponse {
  purchases: PurchaseRow[];
  total: number;
  count: number;
}

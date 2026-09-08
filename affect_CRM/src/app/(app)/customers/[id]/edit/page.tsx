"use client";

import { useParams } from "next/navigation";
import { CustomerForm } from "../../customer-form";

export default function EditCustomerPage() {
  const { id } = useParams<{ id: string }>();
  return (
    <div>
      <div className="border-b border-line bg-card px-5 py-4 sm:px-8">
        <h1 className="text-lg font-semibold sm:text-xl">顧客情報の編集</h1>
      </div>
      <CustomerForm customerId={id} />
    </div>
  );
}

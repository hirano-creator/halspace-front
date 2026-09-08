"use client";

import { CustomerForm } from "../customer-form";

export default function NewCustomerPage() {
  return (
    <div>
      <div className="border-b border-line bg-card px-5 py-4 sm:px-8">
        <h1 className="text-lg font-semibold sm:text-xl">顧客登録</h1>
        <p className="mt-1 text-xs text-gray-soft">氏名だけでも登録できます。残りは後から追記できます。</p>
      </div>
      <CustomerForm />
    </div>
  );
}

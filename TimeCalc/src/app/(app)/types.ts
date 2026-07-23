// (app)配下の共通レイアウト（AppShell）まわりの型

import type { Role } from "@/lib/auth/roles";

export interface NavResponse {
  roleLabels: Record<Role, string>;
  pendingCorrections: number;
}

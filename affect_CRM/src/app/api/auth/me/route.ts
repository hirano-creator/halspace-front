import { NextResponse } from "next/server";
import { requireApiUser } from "@/lib/auth/api-guard";

export async function GET(request: Request) {
  const auth = await requireApiUser(request);
  if (!auth.ok) return auth.response;
  return NextResponse.json({ user: auth.user });
}

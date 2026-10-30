import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/env";

export function GET(): NextResponse {
  return NextResponse.redirect(new URL("/login", getServerEnv().APP_BASE_URL));
}

export function POST(): NextResponse {
  return NextResponse.json(
    { error: "sdk_required" },
    { status: 410, headers: { "cache-control": "no-store" } },
  );
}

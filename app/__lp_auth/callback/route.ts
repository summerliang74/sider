import { NextResponse } from "next/server";

import { getServerEnv } from "@/src/lib/env";

const callbackParameters = ["code", "state", "error", "error_description"] as const;

export function GET(request: Request): NextResponse {
  const source = new URL(request.url);
  const destination = new URL("/login", getServerEnv().APP_BASE_URL);

  for (const name of callbackParameters) {
    const value = source.searchParams.get(name);
    if (value && value.length <= 4096) destination.searchParams.set(name, value);
  }

  const response = NextResponse.redirect(destination);
  response.headers.set("cache-control", "no-store");
  return response;
}

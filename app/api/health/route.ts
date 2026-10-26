import { noStoreJson } from "@/src/lib/http";

export function GET() {
  return noStoreJson({ status: "ok" });
}

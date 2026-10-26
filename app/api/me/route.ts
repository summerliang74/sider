import { noStoreJson } from "@/src/lib/http";
import { authorizeUserRequest } from "@/src/lib/security/user";

export async function GET(request: Request) {
  const authorization = await authorizeUserRequest(request, "page");
  if (authorization.response) return authorization.response;
  return noStoreJson({ user: authorization.user });
}

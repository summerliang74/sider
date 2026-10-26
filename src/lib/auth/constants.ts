export const SESSION_COOKIE = "shsid_session";
export const OAUTH_TRANSACTION_COOKIE = "shsid_oauth_transaction";
export const OAUTH_TRANSACTION_TTL_SECONDS = 10 * 60;
export const ORG_DISCOVERY_COOKIE = "shsid_org_discovery";
export const ORG_DISCOVERY_TTL_SECONDS = 5 * 60;

export function sessionCookieName(production: boolean): string {
  return production ? `__Host-${SESSION_COOKIE}` : SESSION_COOKIE;
}

export function oauthCookieName(production: boolean): string {
  return production ? `__Host-${OAUTH_TRANSACTION_COOKIE}` : OAUTH_TRANSACTION_COOKIE;
}

export function orgDiscoveryCookieName(production: boolean): string {
  return production ? `__Host-${ORG_DISCOVERY_COOKIE}` : ORG_DISCOVERY_COOKIE;
}

import { asc, eq } from "drizzle-orm";

import { getDatabase } from "@/src/db";
import { resourceReports, resources, users } from "@/src/db/schema";
import { noStoreJson } from "@/src/lib/http";
import { authorizeAdminRequest } from "@/src/lib/security/admin";

export async function GET(request: Request) {
  const authorization = await authorizeAdminRequest(request);
  if (authorization.response) return authorization.response;
  const reports = await getDatabase()
    .select({
      id: resourceReports.id,
      resourceId: resourceReports.resourceId,
      resourceTitle: resources.title,
      resourceStatus: resources.status,
      reporterName: users.displayName,
      reason: resourceReports.reason,
      details: resourceReports.details,
      createdAt: resourceReports.createdAt,
    })
    .from(resourceReports)
    .innerJoin(resources, eq(resourceReports.resourceId, resources.id))
    .innerJoin(users, eq(resourceReports.reporterId, users.id))
    .where(eq(resourceReports.status, "open"))
    .orderBy(asc(resourceReports.createdAt))
    .limit(100);
  return noStoreJson({ reports });
}

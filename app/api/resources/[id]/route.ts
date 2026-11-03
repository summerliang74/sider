import { resourceMetadataSchema } from "@/src/lib/files";
import { canAssignTags } from "@/src/lib/resource-tags";
import { noStoreJson } from "@/src/lib/http";
import { getResourceForViewer } from "@/src/lib/resources";
import { softDeleteResource, updateResourceMetadata } from "@/src/lib/resources-write";
import { requireSameOrigin } from "@/src/lib/security/request";
import { authorizeUserRequest } from "@/src/lib/security/user";
import { z } from "zod";

export async function GET(
  request: Request,
  context: { params: Promise<{ id: string }> },
) {
  const authorization = await authorizeUserRequest(request, "search");
  if (authorization.response) return authorization.response;
  const user = authorization.user;

  const { id } = await context.params;
  const resource = await getResourceForViewer(id, user);
  if (!resource) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  return noStoreJson({ resource });
}

export async function PATCH(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeUserRequest(request, "resource_write");
  if (authorization.response) return authorization.response;
  const user = authorization.user;
  const parsed = resourceMetadataSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) return noStoreJson({ error: "invalid_resource" }, { status: 400 });
  if (!canAssignTags(user.role, parsed.data.tags)) return noStoreJson({ error: "pa_tag_admin_only" }, { status: 403 });
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  const updated = await updateResourceMetadata(id, user, parsed.data);
  if (!updated) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  return noStoreJson({ resource: updated });
}

export async function DELETE(request: Request, context: { params: Promise<{ id: string }> }) {
  if (!requireSameOrigin(request)) return noStoreJson({ error: "forbidden" }, { status: 403 });
  const authorization = await authorizeUserRequest(request, "resource_write");
  if (authorization.response) return authorization.response;
  const user = authorization.user;
  const { id } = await context.params;
  if (!z.uuid().safeParse(id).success) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  const deleted = await softDeleteResource(id, user);
  if (!deleted) return noStoreJson({ error: "resource_unavailable" }, { status: 404 });
  return noStoreJson({ status: "deleted" });
}

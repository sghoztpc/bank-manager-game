import { getService, hashToken } from "@/lib/game/service";
import { bearer, codeParam, handle, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/**
 * Host balance adjustment. { preview: true, ... } only reports the consequence; without it the
 * adjustment is applied once per `id` (a repeated request returns the original record).
 */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const token = bearer(req);
    const body = await readJson(req);
    const svc = getService();
    if (body.preview === true) return json(await svc.previewAdjustment(code, token, body));
    // The actor is the host key's fingerprint, so a log shows which host device applied it.
    const actor = `Host (key ${hashToken(token).slice(0, 6)})`;
    return json(await svc.adjust(code, token, body, actor));
  });
}

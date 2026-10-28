import { getService } from "@/lib/game/service";
import { bearer, codeParam, handle, json, playerIdHeader, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Player Ready check (lobby only): { ready: true | false }. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const body = await readJson(req);
    return json(await getService().setReady(code, playerIdHeader(req), bearer(req), body.ready === true));
  });
}

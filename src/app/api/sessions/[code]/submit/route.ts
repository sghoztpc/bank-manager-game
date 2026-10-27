import { getService, GameError } from "@/lib/game/service";
import { bearer, codeParam, handle, json, playerIdHeader, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const body = await readJson(req);
    if (typeof body.itemIndex !== "number") throw new GameError(400, "Missing item.");
    const r = await getService().submit(code, playerIdHeader(req), bearer(req), body.itemIndex, body.choice);
    return json(r, r.accepted ? 200 : 409);
  });
}

import { getService } from "@/lib/game/service";
import { bearer, codeParam, handle, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Host controls: start, pause, resume, skip, kick. */
export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const body = await readJson(req);
    const meta = await getService().hostAction(
      code,
      bearer(req),
      String(body.action ?? ""),
      typeof body.playerId === "string" ? body.playerId : undefined,
    );
    return json({ ok: true, phase: meta.phase, status: meta.status, seq: meta.seq });
  });
}

import { getService, GameError } from "@/lib/game/service";
import { hostView, playerView, screenView } from "@/lib/game/views";
import { bearer, codeParam, handle, json, playerIdHeader } from "@/lib/http";

export const dynamic = "force-dynamic";

/** Polled by every client. ?role=player|host|screen; players add &hb=1 (heartbeat) and &first=1. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const url = new URL(req.url);
    const role = url.searchParams.get("role");
    const svc = getService();

    if (role === "player") {
      const { meta, player, submission, ready } = await svc.playerPoll(code, playerIdHeader(req), bearer(req), {
        heartbeat: url.searchParams.get("hb") === "1",
        firstView: url.searchParams.get("first") === "1",
      });
      return json(playerView(meta, player, submission, Date.now(), meta.rankedCount, ready));
    }
    if (role === "host") {
      const s = await svc.hostSnapshot(code, bearer(req));
      return json(hostView(s.meta, s.players, s.activeIds, s.submitted, Date.now(), s.storeKind, s.readyIds));
    }
    if (role === "screen") {
      const s = await svc.screenSnapshot(code);
      return json(screenView(s.meta, s.playerCount, s.activeCount, s.submitted, s.names, Date.now(), s.finalBoard, s.readyCount));
    }
    throw new GameError(400, "Unknown role.");
  });
}

import { eliminatedPlayers, rankPlayers } from "@/lib/engine/ranking";
import { getService } from "@/lib/game/service";
import { codeParam, handle, noStore } from "@/lib/http";

export const dynamic = "force-dynamic";

const csvCell = (v: string | number) => {
  const s = String(v);
  return /[",\n]/.test(s) || /^[=+\-@]/.test(s) ? `"${s.replace(/"/g, '""').replace(/^([=+\-@])/, "'$1")}"` : s;
};

/** Results as CSV. The host key comes as ?key= so the browser can download it directly. */
export async function GET(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const key = new URL(req.url).searchParams.get("key") ?? "";
    const [, players] = await getService().allPlayers(code, key);
    const rows = [...rankPlayers(players), ...eliminatedPlayers(players)];
    const lines = [
      ["rank", "name", "status", "elimination_order", "balance_vnd", "correct_decisions", "power_ups", "late_join"].join(","),
      ...rows.map((p) =>
        [p.rank ?? "", csvCell(p.name), p.status, p.eliminationOrder ?? "", p.balance, p.correct, p.inventory.length, p.joinedAtItem >= 0 ? "yes" : "no"].join(","),
      ),
    ];
    return new Response(lines.join("\n") + "\n", {
      headers: {
        ...noStore,
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="bank-manager-${code}.csv"`,
      },
    });
  });
}

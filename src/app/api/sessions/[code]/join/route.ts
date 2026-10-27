import { getService } from "@/lib/game/service";
import { codeParam, handle, json, readJson } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST(req: Request, ctx: { params: Promise<{ code: string }> }) {
  return handle(async () => {
    const code = await codeParam(ctx.params);
    const body = await readJson(req);
    return json(await getService().join(code, body.name), 201);
  });
}

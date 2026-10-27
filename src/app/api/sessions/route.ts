import { getService } from "@/lib/game/service";
import { handle, json } from "@/lib/http";

export const dynamic = "force-dynamic";

export async function POST() {
  return handle(async () => json(await getService().createSession(), 201));
}

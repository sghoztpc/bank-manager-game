import { NextResponse } from "next/server";
import { GameError, normaliseCode } from "./game/service";
import { StoreConfigError } from "./store";

export const noStore = { "Cache-Control": "no-store" };

export function json(body: unknown, status = 200) {
  return NextResponse.json(body, { status, headers: noStore });
}

/** Maps known errors to their status; anything else is a 500 without internals. */
export async function handle(fn: () => Promise<Response>): Promise<Response> {
  try {
    return await fn();
  } catch (err) {
    if (err instanceof GameError) return json({ error: err.message }, err.status);
    if (err instanceof StoreConfigError) return json({ error: err.message }, 503);
    console.error(err);
    return json({ error: "Something went wrong. Try again." }, 500);
  }
}

export async function codeParam(params: Promise<{ code: string }>): Promise<string> {
  const code = normaliseCode((await params).code);
  if (code.length !== 5) throw new GameError(404, "No game with that code.");
  return code;
}

export function bearer(req: Request): string {
  const h = req.headers.get("authorization") ?? "";
  const token = h.startsWith("Bearer ") ? h.slice(7).trim() : "";
  if (!token) throw new GameError(401, "Missing credentials.");
  return token;
}

export function playerIdHeader(req: Request): string {
  const id = req.headers.get("x-player-id") ?? "";
  if (!/^[A-Za-z0-9_-]{6,32}$/.test(id)) throw new GameError(401, "Missing player id.");
  return id;
}

export async function readJson(req: Request): Promise<Record<string, unknown>> {
  try {
    const body = await req.json();
    return body && typeof body === "object" ? (body as Record<string, unknown>) : {};
  } catch {
    throw new GameError(400, "Invalid request body.");
  }
}

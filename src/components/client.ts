"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// ---------- Saved credentials (localStorage, per room) ----------

export interface PlayerCreds {
  playerId: string;
  token: string;
  name: string;
}

function read<T>(key: string): T | null {
  try {
    const raw = localStorage.getItem(key);
    return raw ? (JSON.parse(raw) as T) : null;
  } catch {
    return null;
  }
}

function write(key: string, value: unknown) {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Private mode: identity then lasts for this tab only.
  }
}

export const creds = {
  player: (code: string) => read<PlayerCreds>(`bmg:player:${code}`),
  setPlayer: (code: string, c: PlayerCreds | null) => write(`bmg:player:${code}`, c),
  host: (code: string) => read<string>(`bmg:host:${code}`),
  setHost: (code: string, token: string) => write(`bmg:host:${code}`, token),
};

// ---------- Requests ----------

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function api<T>(path: string, init: RequestInit & { token?: string; playerId?: string } = {}): Promise<T> {
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (init.token) headers.Authorization = `Bearer ${init.token}`;
  if (init.playerId) headers["x-player-id"] = init.playerId;
  const res = await fetch(path, { ...init, headers, cache: "no-store" });
  const body = await res.json().catch(() => ({}));
  if (!res.ok && !(res.status === 409 && "duplicate" in body)) {
    throw new ApiError(res.status, body.error ?? `Request failed (${res.status})`);
  }
  return body as T;
}

// ---------- Polling with server clock ----------

interface Timed {
  serverNow: number;
}

/**
 * Polls `fetcher` and tracks the offset between this device's clock and the server's, so
 * countdowns match the server deadline. `nextDelay` picks the wait after each response.
 */
export function usePoll<T extends Timed>(fetcher: (() => Promise<T>) | null, nextDelay: (data: T, serverNow: number) => number) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<ApiError | null>(null);
  const offset = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const fetchRef = useRef(fetcher);
  const delayRef = useRef(nextDelay);
  fetchRef.current = fetcher;
  delayRef.current = nextDelay;
  const failures = useRef(0);
  const running = useRef(false);
  const pending = useRef(false);

  const poll = useCallback(async () => {
    if (timer.current) clearTimeout(timer.current);
    const f = fetchRef.current;
    if (!f) return;
    if (running.current) {
      pending.current = true;
      return;
    }
    running.current = true;
    const sent = Date.now();
    let wait = 2000;
    try {
      const d = await f();
      const received = Date.now();
      // Only trust fast round trips for the offset estimate.
      if (received - sent < 1500) offset.current = d.serverNow - (sent + received) / 2;
      failures.current = 0;
      setData(d);
      setError(null);
      wait = delayRef.current(d, received + offset.current);
    } catch (e) {
      failures.current += 1;
      setError(e instanceof ApiError ? e : new ApiError(0, "Connection problem. Retrying…"));
      if (e instanceof ApiError && (e.status === 401 || e.status === 403 || e.status === 404)) wait = -1;
      else wait = Math.min(1000 * 2 ** failures.current, 8000);
    } finally {
      running.current = false;
    }
    if (pending.current && wait >= 0) {
      pending.current = false;
      wait = 0;
    }
    if (wait >= 0) timer.current = setTimeout(poll, wait === 0 ? 0 : Math.max(150, wait));
  }, []);

  useEffect(() => {
    poll();
    const wake = () => document.visibilityState === "visible" && poll();
    document.addEventListener("visibilitychange", wake);
    window.addEventListener("online", wake);
    return () => {
      if (timer.current) clearTimeout(timer.current);
      document.removeEventListener("visibilitychange", wake);
      window.removeEventListener("online", wake);
    };
  }, [poll]);

  return { data, error, poll, serverNow: () => Date.now() + offset.current };
}

/** Re-renders on every animation frame while `active`, for smooth countdowns. */
export function useFrame(active: boolean) {
  const [, setTick] = useState(0);
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      setTick((t) => (t + 1) % 1_000_000);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
}

// ---------- Formatting ----------

/** Vietnamese grouping with dots, independent of the device's locale data: 1.000.000 */
export function groupDigits(n: number): string {
  return Math.abs(Math.round(n))
    .toString()
    .replace(/\B(?=(\d{3})+(?!\d))/g, ".");
}

/** 1.000.000 VND */
export const money = (n: number) => `${n < 0 ? "−" : ""}${groupDigits(n)} VND`;
/** +50.000 VND / −150.000.000 VND */
export const signedMoney = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : "±"}${groupDigits(n)} VND`;
/** ROI stays a percentage, separate from VND amounts. */
export const pct = (n: number) => `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n * 100).toFixed(1).replace(/\.0$/, "")}%`;

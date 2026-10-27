// Local stand-in for the Upstash REST API, backed by a real redis-server. Lets the production
// RedisStore (including its Lua scripts) run locally and in tests without an Upstash account.
//
//   redis-server --port 6390 &
//   npx tsx scripts/upstash-shim.ts --port 8079 --redis 6390
//   KV_REST_API_URL=http://localhost:8079 KV_REST_API_TOKEN=local npm run dev
//
// Implements POST / (one command) and /pipeline with plain JSON responses (all this app uses).

import http from "node:http";
import net from "node:net";

const args = Object.fromEntries(
  process.argv.slice(2).reduce<[string, string][]>((acc, a, i, all) => (a.startsWith("--") ? [...acc, [a.slice(2), all[i + 1]]] : acc), []),
);
const PORT = Number(args.port ?? 8079);
const REDIS_PORT = Number(args.redis ?? 6379);

type Reply = string | number | null | Reply[] | { error: string };

class Resp {
  private sock: net.Socket;
  private buf = Buffer.alloc(0);
  private waiting: ((r: Reply) => void)[] = [];

  constructor(port: number) {
    this.sock = net.connect(port, "127.0.0.1");
    this.sock.on("data", (d) => {
      this.buf = Buffer.concat([this.buf, d]);
      for (;;) {
        const parsed = this.parse(0);
        if (!parsed) break;
        this.buf = this.buf.subarray(parsed[1]);
        this.waiting.shift()!(parsed[0]);
      }
    });
  }

  send(cmd: (string | number)[]): Promise<Reply> {
    const parts = cmd.map((c) => Buffer.from(String(c)));
    const head = `*${parts.length}\r\n`;
    const chunks = [Buffer.from(head)];
    for (const p of parts) chunks.push(Buffer.from(`$${p.length}\r\n`), p, Buffer.from("\r\n"));
    return new Promise((resolve) => {
      this.waiting.push(resolve);
      this.sock.write(Buffer.concat(chunks));
    });
  }

  private line(at: number): [string, number] | null {
    const end = this.buf.indexOf("\r\n", at);
    return end < 0 ? null : [this.buf.subarray(at, end).toString(), end + 2];
  }

  private parse(at: number): [Reply, number] | null {
    if (at >= this.buf.length) return null;
    const type = String.fromCharCode(this.buf[at]);
    const l = this.line(at + 1);
    if (!l) return null;
    const [text, next] = l;
    switch (type) {
      case "+":
        return [text, next];
      case "-":
        return [{ error: text }, next];
      case ":":
        return [Number(text), next];
      case "$": {
        const len = Number(text);
        if (len < 0) return [null, next];
        if (this.buf.length < next + len + 2) return null;
        return [this.buf.subarray(next, next + len).toString(), next + len + 2];
      }
      case "*": {
        const n = Number(text);
        if (n < 0) return [null, next];
        const out: Reply[] = [];
        let pos = next;
        for (let i = 0; i < n; i++) {
          const r = this.parse(pos);
          if (!r) return null;
          out.push(r[0]);
          pos = r[1];
        }
        return [out, pos];
      }
    }
    throw new Error(`Bad RESP type ${type}`);
  }
}

const redis = new Resp(REDIS_PORT);
const wrap = (r: Reply) => (r && typeof r === "object" && !Array.isArray(r) && "error" in r ? { error: r.error } : { result: r });

http
  .createServer(async (req, res) => {
    let body = "";
    for await (const chunk of req) body += chunk;
    try {
      const cmd = JSON.parse(body);
      const path = (req.url ?? "/").split("?")[0];
      let out: unknown;
      if (path === "/pipeline") {
        out = (await Promise.all((cmd as (string | number)[][]).map((c) => redis.send(c)))).map(wrap);
      } else {
        out = wrap(await redis.send(cmd));
      }
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify(out));
    } catch (e) {
      res.writeHead(400, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ error: String(e) }));
    }
  })
  .listen(PORT, () => console.log(`Upstash shim on :${PORT} -> redis :${REDIS_PORT}`));

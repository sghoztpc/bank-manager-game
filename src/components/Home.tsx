"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { api, creds } from "./client";

export function Home() {
  const router = useRouter();
  const [code, setCode] = useState("");
  const [err, setErr] = useState("");
  const [busy, setBusy] = useState(false);

  function join(e: React.FormEvent) {
    e.preventDefault();
    const c = code.toUpperCase().replace(/[^A-Z0-9]/g, "");
    if (c.length !== 5) return setErr("The room code has 5 characters.");
    router.push(`/play/${c}`);
  }

  async function host() {
    setBusy(true);
    setErr("");
    try {
      const r = await api<{ code: string; hostToken: string }>("/api/sessions", { method: "POST" });
      creds.setHost(r.code, r.hostToken);
      router.push(`/host/${r.code}`);
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Could not create a game.");
      setBusy(false);
    }
  }

  return (
    <main className="wrap narrow">
      <div>
        <div className="eyebrow">Classroom game</div>
        <h1 style={{ fontSize: 44, lineHeight: 1 }}>
          Bank <span style={{ color: "var(--accent)" }}>Manager</span>
        </h1>
        <p className="muted">Assess loans, stop fraud, finish with the most money.</p>
      </div>
      <form className="card" onSubmit={join}>
        <span className="eyebrow">Join a game</span>
        <label>
          Room code
          <input
            className="code"
            value={code}
            onChange={(e) => setCode(e.target.value.toUpperCase().slice(0, 5))}
            autoComplete="off"
            autoCapitalize="characters"
            placeholder="ABCDE"
            maxLength={5}
            inputMode="text"
          />
        </label>
        <button className="go" type="submit">
          Join
        </button>
        <div className="err" role="alert">
          {err}
        </div>
      </form>
      <section className="card">
        <span className="eyebrow">Teacher or presenter</span>
        <p className="muted small">Creates a room, shows a QR code for the projector, and gives you the controls.</p>
        <button onClick={host} disabled={busy}>
          {busy ? "Creating…" : "Host a new game"}
        </button>
      </section>
    </main>
  );
}

import { useEffect, useMemo, useRef, useState } from "react";

/** Mirror of the audit record (DESIGN §10) — exactly what the SSE stream carries. */
interface AuditRecord {
  v: number;
  ts: string;
  platform: string;
  operation: string;
  method: string;
  host: string;
  path: string;
  status: number;
  duration_ms: number;
  outcome: string;
  bytes: number;
  request_id: string;
}

const MAX_ROWS = 1000;

/** Collapse the audit outcomes into the four display buckets used for colour/counts. */
function bucket(outcome: string): "ok" | "refused" | "timeout" | "error" {
  if (outcome === "ok") return "ok";
  if (outcome === "refused") return "refused";
  if (outcome === "timeout") return "timeout";
  return "error"; // client_error | server_error | error
}

function fmtTime(ts: string): string {
  const d = new Date(ts);
  return Number.isNaN(d.getTime()) ? ts : d.toLocaleTimeString();
}

export function App() {
  const [records, setRecords] = useState<AuditRecord[]>([]);
  const [connected, setConnected] = useState(false);
  // EventSource replays the backlog on every (re)connect, so dedupe by request_id.
  const seen = useRef<Set<string>>(new Set());

  useEffect(() => {
    const es = new EventSource("/events");
    es.onopen = () => setConnected(true);
    es.onerror = () => setConnected(false);
    es.onmessage = (e) => {
      try {
        const rec = JSON.parse(e.data) as AuditRecord;
        const id = rec.request_id;
        if (id) {
          if (seen.current.has(id)) return; // already shown (a reconnect replay)
          seen.current.add(id);
          if (seen.current.size > 4000) {
            seen.current = new Set([...seen.current].slice(-2000)); // bound the memory
          }
        }
        setRecords((prev) => [rec, ...prev].slice(0, MAX_ROWS)); // newest first
      } catch {
        /* ignore a malformed frame */
      }
    };
    return () => es.close();
  }, []);

  const counts = useMemo(() => {
    const c = { total: records.length, ok: 0, refused: 0, timeout: 0, error: 0 };
    for (const r of records) c[bucket(r.outcome)]++;
    return c;
  }, [records]);

  const perOp = useMemo(() => {
    const m = new Map<string, number>();
    for (const r of records) m.set(r.operation || "(unknown)", (m.get(r.operation || "(unknown)") ?? 0) + 1);
    return [...m.entries()].sort((a, b) => b[1] - a[1]);
  }, [records]);

  return (
    <div className="app">
      <header className="topbar">
        <h1>
          <span className="brand">Drawbridge</span> monitor
        </h1>
        <span className={`status ${connected ? "live" : "down"}`} data-testid="status">
          {connected ? "live" : "disconnected"}
        </span>
      </header>

      <section className="cards" data-testid="cards">
        <Card label="requests" value={counts.total} kind="total" />
        <Card label="ok" value={counts.ok} kind="ok" />
        <Card label="refused" value={counts.refused} kind="refused" />
        <Card label="timeout" value={counts.timeout} kind="timeout" />
        <Card label="errors" value={counts.error} kind="error" />
      </section>

      <div className="grid">
        <section className="panel ops">
          <h2>by operation</h2>
          {perOp.length === 0 ? (
            <p className="empty">no calls yet</p>
          ) : (
            <ul>
              {perOp.map(([op, n]) => (
                <li key={op}>
                  <span className="op">{op}</span>
                  <span className="n">{n}</span>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="panel feed">
          <h2>live request feed</h2>
          <table data-testid="feed">
            <thead>
              <tr>
                <th>time</th>
                <th>platform</th>
                <th>operation</th>
                <th>method</th>
                <th>status</th>
                <th>ms</th>
                <th>outcome</th>
              </tr>
            </thead>
            <tbody>
              {records.length === 0 ? (
                <tr>
                  <td colSpan={7} className="empty">
                    waiting for audit events…
                  </td>
                </tr>
              ) : (
                records.map((r, i) => (
                  <tr key={r.request_id || `${r.ts}-${i}`} className={`row ${bucket(r.outcome)}`}>
                    <td>{fmtTime(r.ts)}</td>
                    <td>{r.platform || "—"}</td>
                    <td className="op">{r.operation}</td>
                    <td>{r.method || "—"}</td>
                    <td>{r.status || "—"}</td>
                    <td>{r.duration_ms}</td>
                    <td>
                      <span className={`tag ${bucket(r.outcome)}`}>{r.outcome}</span>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </section>
      </div>
    </div>
  );
}

function Card({ label, value, kind }: { label: string; value: number; kind: string }) {
  return (
    <div className={`card ${kind}`}>
      <div className="value">{value}</div>
      <div className="label">{label}</div>
    </div>
  );
}

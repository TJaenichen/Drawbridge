import { createServer as createHttpServer, type Server, type ServerResponse } from "node:http";
import { existsSync, readFileSync, realpathSync, statSync } from "node:fs";
import { dirname, extname, normalize, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { createTailer, type AuditLine, type Tailer } from "./tail.js";

/** The only interface the monitor ever binds — loopback is a hard contract (DESIGN §11). */
const LOOPBACK_HOST = "127.0.0.1";

export interface MonitorOptions {
  /** Audit JSONL file to tail (the §10 default unless overridden). */
  auditFile: string;
  /** Loopback port (default 4737). */
  port?: number;
  /** Directory of built static UI assets; falls back to a built-in page when absent. */
  uiDir?: string;
  /** Max records replayed to a newly-connected client (default 500). */
  backlog?: number;
  /** Max concurrent SSE clients before new connections are refused (default 64). */
  maxClients?: number;
  /** Tail poll cadence in ms. */
  pollMs?: number;
}

export interface MonitorServer {
  server: Server;
  /** Run one tail poll immediately (used by tests for determinism). */
  poll(): void;
  /** Resolved bound address, available after listening. */
  address(): { host: string; port: number };
  close(): Promise<void>;
}

const CONTENT_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".json": "application/json; charset=utf-8",
  ".ico": "image/x-icon",
};

/** Built-in fallback page when no compiled UI is present (keeps the server self-sufficient). */
const FALLBACK_HTML = `<!doctype html><html><head><meta charset="utf-8"><title>Drawbridge monitor</title></head>
<body><h1>Drawbridge monitor</h1><p>No compiled dashboard found; streaming raw audit events.</p>
<pre id="log"></pre><script>
const log = document.getElementById('log');
new EventSource('/events').onmessage = (e) => { log.textContent += e.data + "\\n"; };
</script></body></html>`;

/**
 * Locate the built monitor UI by walking up from this module: the dev source layout
 * (`monitor-ui/dist`) or a bundled copy shipped beside `dist`/`schema` (`ui/`) for a
 * published package — mirroring `findConfigSchemaPath`'s dev/bundled fallback.
 */
function findUiDir(): string | undefined {
  let dir = dirname(fileURLToPath(import.meta.url));
  for (let i = 0; i < 8; i++) {
    for (const candidate of [resolve(dir, "monitor-ui", "dist"), resolve(dir, "ui")]) {
      if (existsSync(resolve(candidate, "index.html"))) return candidate;
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return undefined;
}

/** Only loopback hostnames may reach the server — blocks DNS-rebinding from a foreign page. */
function hostAllowed(hostHeader: string | undefined): boolean {
  if (!hostHeader) return false;
  const name = hostHeader.replace(/:\d+$/, "").toLowerCase();
  return name === "127.0.0.1" || name === "localhost" || name === "[::1]";
}

const sseFrame = (record: AuditLine): string => `data: ${JSON.stringify(record)}\n\n`;

/**
 * Build a loopback-only, read-only monitor server (DESIGN §11). It serves the static
 * dashboard and an SSE `/events` stream fed by tailing the audit log. It exposes GET
 * only — it never writes the audit file, calls the MCP server, or reads config. Call
 * `.server.listen(port, host)` (or use {@link startMonitor}) to run it.
 */
export function createMonitorServer(opts: MonitorOptions): MonitorServer {
  const rawUiDir = opts.uiDir ?? findUiDir();
  // Resolve the asset root through symlinks once, so per-request confinement compares
  // against a canonical path (a symlink planted in the dir can't escape it).
  const uiRoot = rawUiDir && existsSync(rawUiDir) ? realpathSync(rawUiDir) : rawUiDir;
  const backlog = opts.backlog ?? 500;
  const maxClients = opts.maxClients ?? 64;
  const recent: AuditLine[] = [];
  const clients = new Set<ServerResponse>();

  const onRecord = (record: AuditLine): void => {
    recent.push(record);
    if (recent.length > backlog) recent.shift();
    const frame = sseFrame(record);
    for (const client of clients) client.write(frame);
  };
  const tailer: Tailer = createTailer(opts.auditFile, onRecord, { pollMs: opts.pollMs });

  const sendStatic = (res: ServerResponse, urlPath: string): void => {
    if (!uiRoot) {
      res.writeHead(200, { "content-type": CONTENT_TYPES[".html"] });
      res.end(FALLBACK_HTML);
      return;
    }
    const rel = normalize(urlPath === "/" ? "/index.html" : urlPath).replace(/^(\.\.[/\\])+/, "");
    const filePath = resolve(uiRoot, "." + rel);
    // Confine to the asset root — lexically first…
    if (filePath !== uiRoot && !filePath.startsWith(uiRoot + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    if (!existsSync(filePath) || !statSync(filePath).isFile()) {
      res.writeHead(404).end("not found");
      return;
    }
    // …then again after resolving symlinks (defense-in-depth).
    let real: string;
    try {
      real = realpathSync(filePath);
    } catch {
      res.writeHead(404).end("not found");
      return;
    }
    if (real !== uiRoot && !real.startsWith(uiRoot + sep)) {
      res.writeHead(403).end("forbidden");
      return;
    }
    res.writeHead(200, { "content-type": CONTENT_TYPES[extname(real)] ?? "application/octet-stream" });
    res.end(readFileSync(real));
  };

  const server = createHttpServer((req, res) => {
    // Reject any non-loopback Host — defeats DNS-rebinding from a page the user has open.
    if (!hostAllowed(req.headers.host)) {
      res.writeHead(403).end("forbidden host");
      return;
    }
    // Read-only: the dashboard never mutates anything, so only GET is allowed.
    if (req.method !== "GET") {
      res.writeHead(405, { allow: "GET" }).end("method not allowed");
      return;
    }
    const urlPath = (req.url ?? "/").split("?")[0]!;
    if (urlPath === "/events") {
      if (clients.size >= maxClients) {
        res.writeHead(503).end("too many monitor clients");
        return;
      }
      res.writeHead(200, {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      });
      res.write(": connected\n\n"); // SSE comment — flushes headers immediately (clients ignore it)
      for (const record of recent) res.write(sseFrame(record));
      clients.add(res);
      const drop = () => clients.delete(res);
      req.on("close", drop);
      res.on("error", drop); // an abrupt socket teardown must not leak the entry
      return;
    }
    sendStatic(res, urlPath);
  });

  // Prime the backlog from existing file contents, then keep polling.
  tailer.start();

  return {
    server,
    poll: tailer.poll,
    address() {
      const addr = server.address();
      if (addr && typeof addr === "object") return { host: addr.address, port: addr.port };
      return { host: LOOPBACK_HOST, port: opts.port ?? 4737 };
    },
    close() {
      tailer.stop();
      for (const client of clients) client.end();
      clients.clear();
      return new Promise((done) => server.close(() => done()));
    },
  };
}

/** Start the monitor listening on loopback (127.0.0.1 only). Resolves once bound. */
export function startMonitor(opts: MonitorOptions): Promise<MonitorServer> {
  const monitor = createMonitorServer(opts);
  const port = opts.port ?? 4737;
  return new Promise((done) => monitor.server.listen(port, LOOPBACK_HOST, () => done(monitor)));
}

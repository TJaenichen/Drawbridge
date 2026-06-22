// Stateful stub of the internal work-tracking API. Unlike the Prism mock it actually
// stores items, so the proof can show real before/after state. Requires an auth
// header (proves Drawbridge injects it) and logs each request.
import http from "node:http";

export function startStub(port) {
  const items = [];
  let nextId = 1;
  const log = [];

  const server = http.createServer((req, res) => {
    const authPresent = Boolean(req.headers["authorization"]);
    const url = new URL(req.url, "http://x");
    log.push(`${req.method} ${url.pathname}${url.search}  auth=${authPresent ? "present" : "MISSING"}`);

    if (!authPresent) {
      res.writeHead(401, { "content-type": "application/json" });
      res.end('{"error":"missing authorization"}');
      return;
    }
    if (req.method === "GET" && url.pathname === "/work-items") {
      const state = url.searchParams.get("state");
      const out = state && state !== "all" ? items.filter((i) => i.state === state) : items;
      res.writeHead(200, { "content-type": "application/json" });
      res.end(JSON.stringify(out));
      return;
    }
    if (req.method === "POST" && url.pathname === "/work-items") {
      let body = "";
      req.on("data", (c) => (body += c));
      req.on("end", () => {
        const o = JSON.parse(body || "{}");
        const item = { id: nextId++, state: "open", title: o.title, type: o.type ?? "task" };
        items.push(item);
        res.writeHead(201, { "content-type": "application/json" });
        res.end(JSON.stringify(item));
      });
      return;
    }
    const m = url.pathname.match(/^\/work-items\/(\d+)$/);
    if (req.method === "GET" && m) {
      const it = items.find((i) => i.id === Number(m[1]));
      res.writeHead(it ? 200 : 404, { "content-type": "application/json" });
      res.end(JSON.stringify(it ?? { error: "not found" }));
      return;
    }
    res.writeHead(404, { "content-type": "application/json" });
    res.end('{"error":"no route"}');
  });

  return new Promise((resolve) => server.listen(port, () => resolve({ server, items, log })));
}

// Reverse proxy test: satu origin (127.0.0.1:1420) untuk client statis + agent.
//  /api/* dan /ws/* -> http://127.0.0.1:18710 ; sisanya -> file dist/.
import http from "http";
import net from "net";
import { readFile } from "fs/promises";
import { existsSync } from "fs";
import path from "path";

const DIST = "/home/hatch/workspace/vps-manager/client/dist";
const AGENT_HOST = "127.0.0.1";
const AGENT_PORT = 18710;
const MIME = { ".html": "text/html", ".js": "text/javascript", ".css": "text/css", ".png": "image/png", ".svg": "image/svg+xml", ".ico": "image/x-icon" };

const server = http.createServer(async (req, res) => {
  const u = new URL(req.url, "http://x");
  if (u.pathname.startsWith("/api/")) {
    // proxy REST ke agent
    const opts = { host: AGENT_HOST, port: AGENT_PORT, path: u.pathname + u.search, method: req.method, headers: { ...req.headers, host: `${AGENT_HOST}:${AGENT_PORT}` } };
    const preq = http.request(opts, (pres) => { res.writeHead(pres.statusCode, pres.headers); pres.pipe(res); });
    preq.on("error", () => { res.writeHead(502); res.end("bad gateway"); });
    req.pipe(preq);
    return;
  }
  let p = path.join(DIST, u.pathname === "/" ? "index.html" : u.pathname.slice(1));
  if (!existsSync(p) || !p.startsWith(DIST)) { res.writeHead(404); res.end("nf"); return; }
  try {
    const body = await readFile(p);
    res.writeHead(200, { "Content-Type": MIME[path.extname(p)] || "application/octet-stream" });
    res.end(body);
  } catch { res.writeHead(404); res.end("nf"); }
});

// proxy WebSocket: teruskan upgrade TCP mentah ke agent
server.on("upgrade", (req, sock) => {
  const u = new URL(req.url, "http://x");
  if (!u.pathname.startsWith("/ws/")) { sock.destroy(); return; }
  const target = net.connect(AGENT_PORT, AGENT_HOST, () => {
    let head = `${req.method} ${req.url} HTTP/1.1\r\n`;
    for (const [k, v] of Object.entries(req.headers)) head += `${k}: ${v}\r\n`;
    head += "\r\n";
    target.write(head);
    sock.pipe(target).pipe(sock);
  });
  target.on("error", () => sock.destroy());
  sock.on("error", () => target.destroy());
});

server.listen(1420, "127.0.0.1", () => console.log("proxy jalan di 127.0.0.1:1420"));

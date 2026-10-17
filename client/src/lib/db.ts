// Penyimpanan lokal:
// - Di Tauri: SQLite via tauri-plugin-sql (profil server, layout tab, riwayat metrik).
// - Di browser biasa (npm run dev tanpa Tauri): fallback localStorage agar UI tetap bisa dites.
import Database from "@tauri-apps/plugin-sql";
import { invoke } from "@tauri-apps/api/core";
import type { Server, TermTab } from "./types";

let db: Database | null = null;
let initPromise: Promise<boolean> | null = null;

function detectTauri(): boolean {
  return (
    typeof window !== "undefined" &&
    !!(window as unknown as { __TAURI_INTERNALS__?: unknown }).__TAURI_INTERNALS__
  );
}

/** true = SQLite (Tauri) siap; false = pakai fallback localStorage. Aman dari race. */
function ready(): Promise<boolean> {
  if (!initPromise) {
    initPromise = (async () => {
      if (!detectTauri()) return false;
      try {
        const d = await Database.load("sqlite:vpsmanager.db");
        await d.execute(`
          CREATE TABLE IF NOT EXISTS servers (
            id TEXT PRIMARY KEY, name TEXT NOT NULL, host TEXT NOT NULL,
            port INTEGER NOT NULL DEFAULT 18710, token TEXT NOT NULL
          )`);
        await d.execute(`
          CREATE TABLE IF NOT EXISTS layouts (
            id TEXT PRIMARY KEY, data TEXT NOT NULL, updated_at INTEGER NOT NULL
          )`);
        await d.execute(`
          CREATE TABLE IF NOT EXISTS metric_history (
            server_id TEXT NOT NULL, ts INTEGER NOT NULL,
            cpu REAL NOT NULL, mem_used INTEGER NOT NULL, mem_total INTEGER NOT NULL,
            rx_rate REAL NOT NULL, tx_rate REAL NOT NULL,
            PRIMARY KEY (server_id, ts)
          )`);
        db = d;
        return true;
      } catch (error) {
        db = null;
        throw new Error(`Desktop storage unavailable: ${String(error)}`);
      }
    })();
  }
  return initPromise;
}

function webGet<T>(key: string, fallback: T): T {
  try {
    const raw = localStorage.getItem("vpsm." + key);
    return raw ? (JSON.parse(raw) as T) : fallback;
  } catch {
    return fallback;
  }
}
function webSet(key: string, val: unknown): void {
  localStorage.setItem("vpsm." + key, JSON.stringify(val));
}

export async function loadServers(): Promise<Server[]> {
  if (await ready()) {
    const servers = await db!.select<Server[]>("SELECT * FROM servers ORDER BY name");
    for (const server of servers) {
      if (server.token) {
        await storeToken(server.id, server.token);
        await db!.execute("UPDATE servers SET token='' WHERE id=?", [server.id]);
      }
      server.token = await invoke<string | null>("credential_get", { id: server.id }) ?? "";
    }
    return servers;
  }
  return browserServers();
}

const sessionTokens = new Map<string, string>();
function browserServers(): Server[] {
  const servers = webGet<Server[]>("servers", []);
  // Copy every legacy token into this tab before removing any persisted secret.
  for (const server of servers) if (server.token) sessionTokens.set(server.id, server.token);
  if (servers.some(s => s.token)) webSet("servers", servers.map(s => ({ ...s, token: "" })));
  return servers.map(s => ({ ...s, token: sessionTokens.get(s.id) ?? "" }));
}
async function storeToken(id: string, token: string): Promise<void> {
  await invoke("credential_set", { id, token });
  if (await invoke<string | null>("credential_get", { id }) !== token) throw new Error("Credential verification failed; original token retained");
}

export async function saveServer(s: Server): Promise<void> {
  if (await ready()) {
    await storeToken(s.id, s.token);
    await db!.execute(
      "INSERT INTO servers (id,name,host,port,token) VALUES (?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,token=excluded.token",
      [s.id, s.name, s.host, s.port, ""],
    );
    return;
  }
  const all = browserServers().filter((x) => x.id !== s.id);
  sessionTokens.set(s.id, s.token);
  webSet("servers", [...all, s].map(server => ({ ...server, token: "" })));
}

export async function deleteServer(id: string): Promise<void> {
  if (await ready()) {
    await db!.execute("DELETE FROM servers WHERE id=?", [id]);
    await db!.execute("DELETE FROM metric_history WHERE server_id=?", [id]);
    await invoke("credential_delete", { id });
    return;
  }
  const servers = browserServers().filter((x) => x.id !== id);
  sessionTokens.delete(id);
  webSet("servers", servers.map(server => ({ ...server, token: "" })));
}

export async function loadTabs(): Promise<TermTab[]> {
  if (await ready()) {
    const rows = await db!.select<{ data: string }[]>(
      "SELECT data FROM layouts WHERE id='terminal' LIMIT 1",
    );
    if (!rows.length) return [];
    try {
      return JSON.parse(rows[0].data) as TermTab[];
    } catch {
      return [];
    }
  }
  return webGet<TermTab[]>("tabs", []);
}

export async function saveTabs(tabs: TermTab[]): Promise<void> {
  if (await ready()) {
    await db!.execute(
      "INSERT INTO layouts (id,data,updated_at) VALUES ('terminal',?,?) " +
        "ON CONFLICT(id) DO UPDATE SET data=excluded.data,updated_at=excluded.updated_at",
      [JSON.stringify(tabs), Date.now()],
    );
    return;
  }
  webSet("tabs", tabs);
}

/** Simpan satu sampel riwayat metrik (dipanggil throttled dari Dashboard). */
export async function saveMetricSample(
  serverId: string,
  ts: number,
  cpu: number,
  memUsed: number,
  memTotal: number,
  rxRate: number,
  txRate: number,
): Promise<void> {
  if (await ready()) {
    await db!.execute(
      "INSERT OR REPLACE INTO metric_history (server_id,ts,cpu,mem_used,mem_total,rx_rate,tx_rate) VALUES (?,?,?,?,?,?,?)",
      [serverId, ts, cpu, memUsed, memTotal, rxRate, txRate],
    );
    await db!.execute("DELETE FROM metric_history WHERE ts < ?", [ts - 7 * 86400]);
    return;
  }
  const key = "metrics";
  const all = webGet<MetricRow[]>(key, []).filter(row => row.ts >= ts - 7 * 86400 &&
    !(row.server_id === serverId && Math.floor(row.ts / 60) === Math.floor(ts / 60)));
  all.push({ server_id: serverId, ts, cpu, mem_used: memUsed, mem_total: memTotal, rx_rate: rxRate, tx_rate: txRate });
  // ponytail: browser retains one sample per minute per server; SQLite retains raw samples.
  webSet(key, all);
}

export interface MetricRow { server_id: string; ts: number; cpu: number; mem_used: number; mem_total: number; rx_rate: number; tx_rate: number }

export async function loadMetricHistory(serverId: string, since = Math.floor(Date.now() / 1000) - 7 * 86400): Promise<MetricRow[]> {
  since = Math.max(Number.isFinite(since) ? since : 0, Math.floor(Date.now() / 1000) - 7 * 86400);
  const bucket = Math.max(1, Math.ceil((Date.now() / 1000 - since + 1) / 2000));
  if (await ready()) return db!.select<MetricRow[]>(
    "SELECT server_id,MAX(ts) AS ts,AVG(cpu) AS cpu,AVG(mem_used) AS mem_used,AVG(mem_total) AS mem_total,AVG(rx_rate) AS rx_rate,AVG(tx_rate) AS tx_rate " +
      "FROM metric_history WHERE server_id=? AND ts>=? GROUP BY server_id,CAST((ts-?)/? AS INTEGER) ORDER BY ts",
    [serverId, since, since, bucket],
  );
  const rows = webGet<MetricRow[]>("metrics", []).filter(row => row.server_id === serverId && row.ts >= since).sort((a, b) => a.ts - b.ts);
  if (rows.length <= 2000) return rows;
  return Array.from({ length: 2000 }, (_, i) => rows[Math.floor(i * (rows.length - 1) / 1999)]);
}

// Penyimpanan lokal:
// - Di Tauri: SQLite via tauri-plugin-sql (profil server, layout tab, riwayat metrik).
// - Di browser biasa (npm run dev tanpa Tauri): fallback localStorage agar UI tetap bisa dites.
import Database from "@tauri-apps/plugin-sql";
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
      } catch {
        db = null;
        return false; // bukan di dalam Tauri / plugin gagal
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
  if (await ready()) return db!.select<Server[]>("SELECT * FROM servers ORDER BY name");
  return webGet<Server[]>("servers", []);
}

export async function saveServer(s: Server): Promise<void> {
  if (await ready()) {
    await db!.execute(
      "INSERT INTO servers (id,name,host,port,token) VALUES (?,?,?,?,?) " +
        "ON CONFLICT(id) DO UPDATE SET name=excluded.name,host=excluded.host,port=excluded.port,token=excluded.token",
      [s.id, s.name, s.host, s.port, s.token],
    );
    return;
  }
  const all = webGet<Server[]>("servers", []).filter((x) => x.id !== s.id);
  webSet("servers", [...all, s]);
}

export async function deleteServer(id: string): Promise<void> {
  if (await ready()) {
    await db!.execute("DELETE FROM servers WHERE id=?", [id]);
    await db!.execute("DELETE FROM metric_history WHERE server_id=?", [id]);
    return;
  }
  webSet("servers", webGet<Server[]>("servers", []).filter((x) => x.id !== id));
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
  interface MetricRow { server_id: string; ts: number; cpu: number; mem_used: number; mem_total: number; rx_rate: number; tx_rate: number }
  const key = "metrics";
  const all = webGet<MetricRow[]>(key, []);
  all.push({ server_id: serverId, ts, cpu, mem_used: memUsed, mem_total: memTotal, rx_rate: rxRate, tx_rate: txRate });
  webSet(key, all.slice(-2000)); // batasi
}

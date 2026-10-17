import type { MetricsSnapshot } from "./types";
import type { ServiceInfo } from "./api";

export interface ConnectionStatus { lastSeen?: number; version?: string; latency?: number; online?: boolean; error?: string }
export interface LocalAlert { id: string; serverId: string; kind: string; message: string; ts: number }
export async function pollInBatches<T>(items: T[], visit: (item:T)=>Promise<void>): Promise<void> {
  for(let start=0;start<items.length;start+=4) await Promise.all(items.slice(start,start+4).map(visit));
}
const statuses: Record<string, ConnectionStatus> = {};
try {
  const saved: unknown = JSON.parse(localStorage.getItem("vpsm.connection-status") ?? "{}");
  if (saved && typeof saved === "object" && !Array.isArray(saved)) for (const [id, value] of Object.entries(saved).slice(-500)) {
    if (value && typeof value === "object" && Number.isFinite(value.lastSeen) && typeof value.version === "string" && Number.isFinite(value.latency)) statuses[id]={lastSeen:value.lastSeen,version:value.version.slice(0,80),latency:value.latency};
  }
} catch { /* Status is optional when local storage is unavailable. */ }
export function connectionStatus(id: string): ConnectionStatus { return statuses[id] ?? {}; }
export function recordConnection(id: string, next: ConnectionStatus): void {
  statuses[id] = {...statuses[id], ...next};
  if (next.version === undefined) return;
  try {localStorage.setItem("vpsm.connection-status",JSON.stringify(Object.fromEntries(Object.entries(statuses).slice(-500).map(([key,value])=>[key,{lastSeen:value.lastSeen,version:value.version,latency:value.latency}]))));} catch { /* Optional metadata must not block a connection. */ }
}

export function evaluateAlerts(serverId: string, snap: MetricsSnapshot | null, services: ServiceInfo[], offline: boolean, ts = Date.now()): LocalAlert[] {
  const result: LocalAlert[] = [];
  const add = (kind: string, message: string) => result.push({id:`${serverId}:${kind}`,serverId,kind,message,ts});
  if (offline) add("offline", "Agent connection failed; see connection diagnostics");
  if (snap) {
    if (snap.cpu.total >= 90) add("cpu", `High CPU: ${snap.cpu.total.toFixed(1)}%`);
    if (snap.mem.total > 0 && snap.mem.used / snap.mem.total >= .9) add("ram", "RAM usage ≥ 90%");
    for (const disk of snap.disks) if (disk.total > 0 && disk.used / disk.total >= .9) add(`disk:${disk.mount}`, `Disk ${disk.mount} usage ≥ 90%`);
  }
  for (const service of services.slice(0, 5000)) if (service.active === "failed") add(`service:${service.unit}`, `Service failed: ${service.unit}`);
  return result.slice(0, 100);
}

export function mergeAlerts(previous: LocalAlert[], incoming: LocalAlert[]): LocalAlert[] {
  const current = new Map(incoming.map(a => [a.id,a]));
  return [...current.values(), ...previous.filter(a => !current.has(a.id))].slice(0, 100);
}

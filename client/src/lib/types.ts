// Tipe data sesuai docs/AGENT_PROTOCOL.md

export interface Server {
  id: string;
  name: string;
  host: string;
  port: number;
  token: string;
}

export interface ServerInfo {
  hostname: string;
  os: string;
  kernel: string;
  arch: string;
  uptime_secs: number;
  agent_version: string;
}

export interface CpuInfo {
  total: number;
  per_core: number[];
}

export interface MemInfo {
  total: number;
  used: number;
  free: number;
  available: number;
}

export interface DiskInfo {
  mount: string;
  total: number;
  used: number;
}

export interface NetInfo {
  iface: string;
  rx_bytes: number;
  tx_bytes: number;
  rx_rate: number;
  tx_rate: number;
}

export interface MetricsSnapshot {
  ts: number;
  cpu: CpuInfo;
  load: [number, number, number];
  mem: MemInfo;
  swap: MemInfo;
  disks: DiskInfo[];
  net: NetInfo[];
}

export interface ProcInfo {
  pid: number;
  user: string;
  name: string;
  cpu: number;
  mem: number;
  cmd: string;
}

export interface TabPane {
  id: string;
  serverId: string;
}

export interface TermTab {
  id: string;
  title: string;
  panes: TabPane[];
}

export type View = "servers" | "dashboard" | "terminal" | "monitoring" | "operations" | "files";

export function fmtBytes(b: number): string {
  if (b <= 0) return "0 B";
  const u = ["B", "KB", "MB", "GB", "TB"];
  const i = Math.min(u.length - 1, Math.floor(Math.log(b) / Math.log(1024)));
  return `${(b / 1024 ** i).toFixed(i === 0 ? 0 : 1)} ${u[i]}`;
}

export function fmtRate(bps: number): string {
  return `${fmtBytes(bps)}/s`;
}

export function uid(): string {
  return Math.random().toString(36).slice(2, 10) + Date.now().toString(36);
}

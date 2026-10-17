// Client HTTP + WebSocket ke satu agent VPS.
import type { MetricsSnapshot, Server, ServerInfo } from "./types";

export class AgentClient {
  public server: Server;
  public baseUrl?: string;
  public timeoutMs: number;
  constructor(server: Server, baseUrl?: string, timeoutMs = 10000) {
    this.server = server;
    this.baseUrl = baseUrl;
    this.timeoutMs = timeoutMs;
  }

  get base(): string {
    if (this.baseUrl) return this.baseUrl;
    const h = this.server.host.trim();
    // Dukung URL penuh (mis. https://agent.example.com dari reverse proxy TLS);
    // kalau tidak, pakai http://host:port.
    if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, "");
    return `http://${h}:${this.server.port}`;
  }

  private wsUrl(path: string, params: Record<string, string | number> = {}): string {
    const wsBase = this.base.replace(/^http/, "ws");
    const qs = new URLSearchParams({
      token: this.server.token,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    }).toString();
    return `${wsBase}${path}?${qs}`;
  }

  async request<T>(path: string, init?: RequestInit, timeoutMs = this.timeoutMs): Promise<T> {
    if (!path.startsWith("/api/") || path.includes("..") || path.includes("#")) throw new Error("Path API tidak sah");
    const target = `${this.base}${path}`;
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), timeoutMs);
    const abort = () => controller.abort();
    init?.signal?.addEventListener("abort", abort, { once: true });
    if (init?.signal?.aborted) controller.abort();
    try {
    const headers = new Headers(init?.headers);
    headers.set("Authorization", `Bearer ${this.server.token}`);
    const res = await fetch(target, {
      ...init,
      headers,
      signal: controller.signal,
    });
    if (res.status === 401) throw new Error(`HTTP 401: token salah / tidak sah. Periksa token profil. Target: ${target}`);
    if (!res.ok) {
      throw new Error(`HTTP ${res.status} dari ${target}. ${res.status === 403 ? "Token tidak diizinkan untuk tindakan ini." : "Periksa status agent dan coba lagi."}`);
    }
    return (await res.json()) as T;
    } catch (error) {
      if (init?.signal?.aborted) throw new Error(`Permintaan dibatalkan. Target: ${target}`);
      if (controller.signal.aborted) throw new Error(`Timeout ${timeoutMs} ms. Target: ${target}. Periksa alamat, jaringan, dan bind agent.`);
      if (error instanceof TypeError) throw new Error(`Jaringan gagal. Target: ${target}. Periksa alamat/port, agent aktif, bind, dan jalur jaringan/firewall. Browser juga dapat memblokir HTTPS campuran, sertifikat atau CORS; penyebab tepat belum diketahui.`);
      throw error;
    } finally {
      clearTimeout(timeout);
      init?.signal?.removeEventListener("abort", abort);
    }
  }

  private req<T>(path: string, init?: RequestInit): Promise<T> { return this.request<T>(path, init); }

  services(): Promise<{ services: ServiceInfo[] }> { return this.request("/api/services"); }
  serviceAction(unit: string, action: "start" | "stop" | "restart"): Promise<{ok: boolean; error?: string}> {
    return this.request("/api/services/action", {method:"POST", headers:{"Content-Type":"application/json"}, body:JSON.stringify({unit, action})}, 65000);
  }
  logsSocket(unit: string): WebSocket { return new WebSocket(this.wsUrl("/ws/logs", {unit})); }

  info(): Promise<ServerInfo> {
    return this.req<ServerInfo>("/api/info");
  }

  metrics(): Promise<MetricsSnapshot> {
    return this.req<MetricsSnapshot>("/api/metrics");
  }

  metricsSocket(): WebSocket {
    return new WebSocket(this.wsUrl("/ws/metrics"));
  }

  ptySocket(cols: number, rows: number): WebSocket {
    return new WebSocket(this.wsUrl("/ws/pty", { cols, rows }));
  }

  exec(command: string, timeout_secs = 30): Promise<{ stdout: string; stderr: string; exit_code: number; timed_out: boolean }> {
    return this.request("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout_secs }),
    }, Math.max(this.timeoutMs, (Math.max(1, Math.min(120, timeout_secs)) + 5) * 1000));
  }

  processes(limit = 200, sort = "cpu"): Promise<{ processes: import("./types").ProcInfo[] }> {
    return this.req(`/api/processes?limit=${limit}&sort=${sort}`);
  }

  killProcess(pid: number, signal = "TERM"): Promise<{ ok: boolean; error?: string }> {
    return this.req("/api/processes/kill", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ pid, signal }),
    });
  }
}

export interface ServiceInfo { unit: string; description: string; active: string; sub: string; load: string }

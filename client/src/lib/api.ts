// Client HTTP + WebSocket ke satu agent VPS.
import type { MetricsSnapshot, Server, ServerInfo } from "./types";

export class AgentClient {
  constructor(
    public server: Server,
    public baseUrl?: string,
  ) {}

  get base(): string {
    if (this.baseUrl) return this.baseUrl;
    const h = this.server.host.trim();
    // Dukung URL penuh (mis. https://agent.example.com dari reverse proxy TLS);
    // kalau tidak, pakai http://host:port.
    if (/^https?:\/\//i.test(h)) return h.replace(/\/+$/, "");
    return `http://${h}:${this.server.port}`;
  }

  private headers(): HeadersInit {
    return { Authorization: `Bearer ${this.server.token}` };
  }

  private wsUrl(path: string, params: Record<string, string | number> = {}): string {
    const wsBase = this.base.replace(/^http/, "ws");
    const qs = new URLSearchParams({
      token: this.server.token,
      ...Object.fromEntries(Object.entries(params).map(([k, v]) => [k, String(v)])),
    }).toString();
    return `${wsBase}${path}?${qs}`;
  }

  private async req<T>(path: string, init?: RequestInit): Promise<T> {
    const res = await fetch(`${this.base}${path}`, {
      ...init,
      headers: { ...this.headers(), ...(init?.headers ?? {}) },
    });
    if (res.status === 401) throw new Error("Token salah / tidak sah (401)");
    if (!res.ok) {
      const body = await res.text().catch(() => "");
      throw new Error(`HTTP ${res.status}: ${body.slice(0, 200)}`);
    }
    return (await res.json()) as T;
  }

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
    return this.req("/api/exec", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ command, timeout_secs }),
    });
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

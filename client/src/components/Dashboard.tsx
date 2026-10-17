// Dashboard semua VPS: CPU, RAM, swap, disk, upload/download realtime.
import { useEffect, useRef, useState } from "react";
import { AgentClient } from "../lib/api";
import { saveMetricSample } from "../lib/db";
import { useStore } from "../lib/store";
import type { MetricsSnapshot, Server } from "../lib/types";
import { fmtBytes, fmtRate } from "../lib/types";

function Spark({ data, color }: { data: number[]; color: string }) {
  const w = 120, h = 32;
  if (data.length < 2) return <svg width={w} height={h} />;
  const max = Math.max(...data, 1);
  const pts = data.map((v, i) => `${(i / (data.length - 1)) * w},${h - (v / max) * (h - 2) - 1}`).join(" ");
  return (
    <svg viewBox={`0 0 ${w} ${h}`} preserveAspectRatio="none" className="spark" role="img" aria-label="Riwayat penggunaan CPU">
      <polyline points={pts} fill="none" stroke={color} strokeWidth="1.5" />
    </svg>
  );
}

function Bar({ pct, color }: { pct: number; color: string }) {
  return (
    <div className="bar" role="progressbar" aria-label="Penggunaan resource" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(Math.max(0, Math.min(100, pct)))}><div className="bar-fill" style={{ width: `${Math.max(0, Math.min(100, pct))}%`, background: color }} /></div>
  );
}

function ServerCard({ server }: { server: Server }) {
  const [snap, setSnap] = useState<MetricsSnapshot | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<{ hostname: string; os: string; uptime: number } | null>(null);
  const hist = useRef<number[]>([]);
  const { dispatch } = useStore();

  useEffect(() => {
    const client = new AgentClient(server);
    let alive = true;
    let ws: WebSocket | null = null;
    let lastSaved = 0;
    let retry: ReturnType<typeof setTimeout>;

    client.info().then((i) => {
      if (alive) setInfo({ hostname: i.hostname, os: i.os, uptime: i.uptime_secs });
    }).catch(() => {});

    const connect = () => {
      if (!alive) return;
      try { ws = client.metricsSocket(); } catch { schedule(); return; }
      ws.onmessage = (ev) => {
        try {
          const s = JSON.parse(ev.data as string) as MetricsSnapshot;
          setSnap(s);
          setErr(null);
          hist.current = [...hist.current.slice(-59), s.cpu.total];
          // simpan riwayat ke SQLite max 1x per 5 detik
          if (Date.now() - lastSaved > 5000) {
            lastSaved = Date.now();
            const rx = s.net.reduce((a, n) => a + n.rx_rate, 0);
            const tx = s.net.reduce((a, n) => a + n.tx_rate, 0);
            saveMetricSample(server.id, s.ts, s.cpu.total, s.mem.used, s.mem.total, rx, tx).catch(() => {});
          }
        } catch { /* abaikan */ }
      };
      ws.onclose = () => { if (alive) { setErr("terputus — mencoba lagi…"); schedule(); } };
      ws.onerror = () => { if (alive) setErr("tidak bisa terhubung ke agent"); };
    };
    const schedule = () => { retry = setTimeout(connect, 3000); };
    connect();

    return () => { alive = false; clearTimeout(retry); try { ws?.close(); } catch { /* abaikan */ } };
  }, [server]);

  const memPct = snap ? (snap.mem.used / Math.max(1, snap.mem.total)) * 100 : 0;
  const swapPct = snap && snap.swap.total > 0 ? (snap.swap.used / snap.swap.total) * 100 : 0;
  const rx = snap ? snap.net.reduce((a, n) => a + n.rx_rate, 0) : 0;
  const tx = snap ? snap.net.reduce((a, n) => a + n.tx_rate, 0) : 0;

  return (
    <div className="card">
      <div className="card-head">
        <div>
          <div className="card-title">{server.name}</div>
          <div className="card-sub">{info ? `${info.hostname} · ${info.os}` : `${server.host}:${server.port}`}</div>
        </div>
        <span className="connection-state"><span className={"dot " + (err ? "bad" : snap ? "ok" : "")} />{err ? "Terputus" : snap ? "Terhubung" : "Menghubungkan"}</span>
      </div>
      {err && <div className="card-err">{err}</div>}
      {snap ? (
        <div className="metrics">
          <div className="metric">
            <div className="m-label">CPU {snap.cpu.total.toFixed(1)}%</div>
            <Spark data={hist.current} color="#285cce" />
          </div>
          <div className="metric">
            <div className="m-label">RAM {fmtBytes(snap.mem.used)} / {fmtBytes(snap.mem.total)}</div>
            <Bar pct={memPct} color={memPct > 85 ? "#b93838" : "#16805b"} />
          </div>
          <div className="metric">
            <div className="m-label">Swap {fmtBytes(snap.swap.used)} / {fmtBytes(snap.swap.total)}</div>
            <Bar pct={swapPct} color="#a77820" />
          </div>
          {snap.disks.slice(0, 2).map((d) => {
            const p = (d.used / Math.max(1, d.total)) * 100;
            return (
              <div className="metric" key={d.mount}>
                <div className="m-label">Disk {d.mount} {fmtBytes(d.used)} / {fmtBytes(d.total)}</div>
                <Bar pct={p} color={p > 85 ? "#b93838" : "#617ba5"} />
              </div>
            );
          })}
          <div className="metric net">
            <span>↓ {fmtRate(rx)}</span>
            <span>↑ {fmtRate(tx)}</span>
            <span className="muted">load {snap.load[0].toFixed(2)}</span>
          </div>
        </div>
      ) : (
        <div className="muted">Menghubungkan…</div>
      )}
      <div className="card-footer"><span className="muted">{snap ? `Sampel: ${new Date(snap.ts * 1000).toLocaleTimeString("id-ID")}` : "Menunggu metrik agent"}</span><button className="btn small" onClick={() => dispatch({ type: "open-tab", serverId: server.id })}>Terminal</button></div>
    </div>
  );
}

export default function Dashboard() {
  const { state, dispatch } = useStore();
  return <section>
    <header className="page-heading"><div><h1>Dashboard</h1><p>Pantau penggunaan resource dan koneksi setiap VPS secara langsung.</p></div><span className="muted">{state.servers.length} server terdaftar</span></header>
    {!state.servers.length ? <div className="empty panel"><h3>Belum ada server untuk dipantau</h3><p>Tambahkan VPS untuk melihat CPU, memori, disk, dan lalu lintas jaringan.</p><button className="btn primary" onClick={() => dispatch({ type: "set-view", view: "servers" })}>Tambah server</button></div> : <div className="dash">{state.servers.map(s => <ServerCard key={s.id} server={s} />)}</div>}
  </section>;
}

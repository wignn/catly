import { useEffect, useRef, useState } from "react";
import { AgentClient } from "../lib/api";
import { persistServer, useStore } from "../lib/store";

interface Service { unit: string; active: string; sub: string; description: string }
interface Diagnostics { bind: string; tailscale_ip?: string | null; agent_version: string; role: string }
interface UpdateStatus { installed_version: string; state: string; output?: string; rollback_available: boolean }
interface AuditEntry { ts: number; method: string; path: string; status: number; role: string }
const errorText = (e: unknown) => e instanceof Error ? e.message : String(e);

export default function Operations() {
  const { state, dispatch } = useStore();
  const [serverId, setServerId] = useState("");
  const server = state.servers.find(s => s.id === serverId) ?? state.servers[0];
  const [tab, setTab] = useState<"services" | "maintenance" | "security">("services");
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState("vps-agent.service");
  const [logs, setLogs] = useState<string[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [following, setFollowing] = useState(false);
  const [logStatus, setLogStatus] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const [diagnostics, setDiagnostics] = useState<Diagnostics | null>(null);
  const [update, setUpdate] = useState<UpdateStatus | null>(null);
  const [latest, setLatest] = useState("");
  const [audit, setAudit] = useState<AuditEntry[]>([]);
  const [newToken, setNewToken] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const requestSequence = useRef(0);

  useEffect(() => {
    requestSequence.current++;
    socket.current?.close(); socket.current = null;
    setFollowing(false); setServices([]); setLogs([]); setDiagnostics(null);
    setUpdate(null); setAudit([]); setNewToken(""); setError(""); setMessage("");
    setLatest("");
  }, [server?.id]);

  useEffect(() => () => { requestSequence.current++; socket.current?.close(); }, []);

  const perform = async (work: (client: AgentClient) => Promise<void>) => {
    if (!server || busy) return;
    const sequence = ++requestSequence.current;
    setBusy(true); setError(""); setMessage("");
    try { await work(new AgentClient(server)); }
    catch (e) { if (sequence === requestSequence.current) setError(errorText(e)); }
    finally { setBusy(false); }
  };

  const refreshServices = () => perform(async client => {
    const result = await client.services();
    setServices(result.services);
  });

  const act = (service: string, action: "start" | "stop" | "restart") => {
    if (!confirm(`${action} ${service} di ${server?.name}?`)) return;
    void perform(async client => {
      const result = await client.serviceAction(service, action);
      if (!result.ok) throw new Error(result.error || "Operasi service gagal.");
      setServices((await client.services()).services);
      setMessage(`${service}: ${action} berhasil.`);
    });
  };

  const followLogs = () => {
    socket.current?.close(); socket.current = null;
    if (following) { setFollowing(false); setLogStatus("Log dijeda."); return; }
    if (!server) return;
    setLogs([]); setError("");
    try {
      const ws = new AgentClient(server).logsSocket(unit);
      socket.current = ws; setFollowing(true); setLogStatus("Menghubungkan log…");
      ws.onopen = () => { if (socket.current === ws) setLogStatus("Mengikuti log langsung."); };
      ws.onmessage = event => {
        if (socket.current !== ws || typeof event.data !== "string") return;
        const text = event.data.slice(0, 65536);
        setLogs(previous => [...previous, ...text.split("\n")].slice(-1000));
      };
      ws.onerror = () => { if (socket.current === ws) setLogStatus("Log gagal terhubung. Periksa akses admin, koneksi, dan nama service."); };
      ws.onclose = () => { if (socket.current === ws) { setFollowing(false); setLogStatus("Koneksi log ditutup. Klik Ikuti log untuk menyambung lagi."); } };
    } catch (e) { setFollowing(false); setError(errorText(e)); }
  };

  const refreshMaintenance = () => perform(async client => {
    const [diag, status] = await Promise.all([
      client.request<Diagnostics>("/api/diagnostics"),
      client.request<UpdateStatus>("/api/update/status"),
    ]);
    setDiagnostics(diag); setUpdate(status);
    const response = await fetch("https://api.github.com/repos/wignn/catly/releases/latest", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Status agent berhasil dibaca, tetapi pemeriksaan rilis GitHub gagal (HTTP ${response.status}).`);
    const release: { tag_name?: string } = await response.json();
    if (!release.tag_name || !/^v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(release.tag_name)) throw new Error("Versi rilis GitHub tidak valid.");
    setLatest(release.tag_name);
  });

  const maintain = (action: "update" | "rollback") => {
    if (!confirm(`${action === "update" ? "Update agent ke rilis stabil Catly terbaru" : "Pulihkan binary agent sebelumnya"} di ${server?.name}? Koneksi akan terputus sementara.`)) return;
    void perform(async client => {
      const result = await client.request<{ ok: boolean; error?: string }>("/api/update", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!result.ok) throw new Error(result.error || "Permintaan pemeliharaan gagal.");
      setMessage("Permintaan diterima. Agent akan restart; klik Periksa versi dan status setelah beberapa saat untuk melihat hasilnya.");
    });
  };

  const rotate = (kind: "admin" | "readonly") => {
    if (!confirm(kind === "admin" ? "Ganti token admin? Semua client dengan token lama akan kehilangan akses. Token baru akan disimpan ke profil ini." : "Buat/ganti token pemantauan? Token read-only lama akan berhenti berlaku.")) return;
    void perform(async client => {
      const result = await client.request<{ token: string; kind: string }>("/api/security/rotate", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind }),
      });
      setNewToken(result.token);
      if (kind === "admin" && server) {
        const changed = { ...server, token: result.token };
        try { await persistServer(changed, dispatch); }
        catch {
          dispatch({ type: "add-server", server: changed });
          throw new Error("Token sudah diganti di VPS, tetapi penyimpanan lokal gagal. Salin token baru di bawah sebelum menutup aplikasi; profil sesi ini sudah memakai token baru.");
        }
      }
      setMessage(`Token ${kind} baru dibuat. Simpan dengan aman; jangan kirim ke log atau pesan publik.`);
    });
  };

  if (!server) return <div className="empty"><h2>Belum ada server</h2><p>Tambahkan profil server terlebih dahulu.</p></div>;
  return <div className="operations">
    <header className="page-heading"><div><h1>Kelola VPS</h1><p>Service, log, pemeliharaan agent, dan kontrol akses.</p></div>
      <label>Server<select value={server.id} onChange={e => setServerId(e.target.value)} disabled={busy}>{state.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    </header>
    <div className="platforms" role="group" aria-label="Bagian pengelolaan">{([
      ["services", "Service & log"], ["maintenance", "Update agent"], ["security", "Keamanan"],
    ] as const).map(([id, label]) => <button key={id} className={tab === id ? "selected" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <p role="alert" className="operation-message text-bad">{error}</p>}
    {message && <p role="status" className="operation-message text-ok">{message}</p>}
    {busy && <p role="status">Memproses…</p>}
    {tab === "services" && <>
      <section className="panel operation-section" aria-labelledby="service-title">
        <div className="section-heading"><h2 id="service-title">Service systemd</h2><button className="btn" disabled={busy} onClick={() => void refreshServices()}>Muat / refresh</button></div>
        <div className="operation-body"><label>Cari service<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="nginx, docker, vps-agent…" /></label>
          <div className="table-scroll"><table><thead><tr><th>Service</th><th>Status</th><th>Aksi</th></tr></thead><tbody>
            {services.filter(s => `${s.unit} ${s.description} ${s.active}`.toLowerCase().includes(query.toLowerCase())).map(s => <tr key={s.unit}>
              <td><strong>{s.unit}</strong><small>{s.description}</small></td><td><span className={s.active === "failed" ? "text-bad" : s.active === "active" ? "text-ok" : "muted"}>{s.active} / {s.sub}</span></td>
              <td><div className="row-actions">{(["start", "stop", "restart"] as const).map(action => <button className="btn small" key={action} disabled={busy} onClick={() => act(s.unit, action)}>{action}</button>)}<button className="btn small" onClick={() => { socket.current?.close(); socket.current = null; setFollowing(false); setUnit(s.unit); setLogs([]); }}>Pilih log</button></div></td>
            </tr>)}
          </tbody></table></div>
          {!services.length && <p className="muted">Klik Muat / refresh untuk membaca service dari VPS.</p>}
        </div>
      </section>
      <section className="panel operation-section" aria-labelledby="logs-title"><div className="section-heading"><h2 id="logs-title">Log langsung</h2><span className="muted">Maksimal 1.000 baris terakhir</span></div>
        <div className="operation-body"><div className="operation-toolbar"><label>Nama service<input value={unit} disabled={following} onChange={e => setUnit(e.target.value)} placeholder="nginx.service" /></label><button className="btn" disabled={!/^[a-zA-Z0-9_.@:-]+\.service$/.test(unit)} onClick={followLogs}>{following ? "Jeda log" : "Ikuti log"}</button><label>Cari dalam log<input type="search" value={logQuery} onChange={e => setLogQuery(e.target.value)} /></label></div>
          <p role="status" className="muted">{logStatus}</p><pre className="log-output" aria-label="Isi log">{logs.filter(line => line.toLowerCase().includes(logQuery.toLowerCase())).join("\n") || "Belum ada baris log."}</pre>
        </div>
      </section>
    </>}
    {tab === "maintenance" && <section className="panel operation-section"><div className="section-heading"><h2>Update dan rollback</h2><button className="btn" disabled={busy} onClick={() => void refreshMaintenance()}>Periksa versi dan status</button></div><div className="operation-body">
      <p>Unduhan update berasal dari <a href="https://github.com/wignn/catly/releases" target="_blank" rel="noreferrer">GitHub Releases Catly</a>. Updater memeriksa SHA-256 dan memulihkan binary sebelumnya jika service gagal aktif.</p>
      <dl className="status-grid"><dt>Versi terpasang</dt><dd>{update?.installed_version || diagnostics?.agent_version || "Belum diperiksa"}</dd><dt>Rilis terbaru</dt><dd>{latest || "Belum diperiksa"}</dd><dt>Alamat bind</dt><dd>{diagnostics?.bind || "Belum diperiksa"}</dd><dt>IP Tailscale</dt><dd>{diagnostics?.tailscale_ip || "Tidak tersedia / belum diperiksa"}</dd><dt>Status updater</dt><dd>{update?.state || "Belum diperiksa"}</dd></dl>
      <div className="row-actions"><button className="btn primary" disabled={busy || !update || !latest || diagnostics?.role !== "admin"} onClick={() => maintain("update")}>Update agent</button><button className="btn" disabled={busy || !update?.rollback_available || diagnostics?.role !== "admin"} onClick={() => maintain("rollback")}>Rollback binary</button></div>
      {update?.output && <pre className="log-output">{update.output}</pre>}<p className="muted">Jika endpoint belum tersedia, upgrade agent menggunakan installer rilis terbaru di VPS terlebih dahulu. Token dan bind dipertahankan.</p>
    </div></section>}
    {tab === "security" && <section className="panel operation-section"><div className="section-heading"><h2>Token dan audit</h2></div><div className="operation-body">
      <p>Token admin memberikan akses pengelolaan. Token read-only hanya untuk info, metrik, status service, dan diagnostik; tidak dapat membuka terminal, membaca file, atau menjalankan perintah.</p>
      <div className="row-actions"><button className="btn" disabled={busy} onClick={() => rotate("readonly")}>Buat / ganti token read-only</button><button className="btn" disabled={busy} onClick={() => rotate("admin")}>Rotasi token admin</button><button className="btn" disabled={busy} onClick={() => void perform(async client => { setAudit((await client.request<{ entries: AuditEntry[] }>("/api/security/audit")).entries); })}>Muat audit</button></div>
      {newToken && <div className="token-result"><label>Token baru — salin dan simpan dengan aman<input readOnly value={newToken} aria-label="Token baru" onFocus={e => e.target.select()} /></label><button className="btn small" onClick={() => setNewToken("")}>Sembunyikan</button></div>}
      <p className="muted">Audit mencatat jenis operasi, endpoint, dan hasil tanpa menyimpan token, isi file, atau isi perintah. Audit sesi agent dibatasi dan hilang saat agent restart; gunakan journalctl untuk catatan service.</p>
      <div className="table-scroll"><table><thead><tr><th>Waktu</th><th>Operasi</th><th>Status</th><th>Akses</th></tr></thead><tbody>{audit.slice().reverse().map((entry, index) => <tr key={`${entry.ts}-${index}`}><td>{new Date(entry.ts * 1000).toLocaleString()}</td><td>{entry.method} {entry.path}</td><td>{entry.status}</td><td>{entry.role}</td></tr>)}</tbody></table></div>
    </div></section>}
  </div>;
}

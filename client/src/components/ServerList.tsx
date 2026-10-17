import { useState } from "react";
import { AgentClient } from "../lib/api";
import { persistServer, removeServer, useStore } from "../lib/store";
import { uid } from "../lib/types";
import InstallGuide from "./InstallGuide";

export default function ServerList() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("18710");
  const [token, setToken] = useState("");
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState<string[]>([]);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; text: string }>>({});
  const servers = state.servers.filter(s => `${s.name} ${s.host}`.toLowerCase().includes(query.toLowerCase()));

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    setError("");
    const address = host.trim();
    try {
      const url = new URL(/^https?:\/\//i.test(address) ? address : `http://${address}:${port}`);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
      if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error();
    } catch {
      setError("Masukkan IP, domain, atau URL HTTP(S) tanpa path, serta port 1–65535.");
      return;
    }
    setSaving(true);
    try {
      await persistServer({ id: uid(), name: name.trim(), host: address, port: Number(port), token: token.trim() }, dispatch);
      setName(""); setHost(""); setToken(""); setPort("18710");
    } catch { setError("Server belum tersimpan. Periksa akses penyimpanan lalu coba lagi."); }
    finally { setSaving(false); }
  };

  const test = async (id: string) => {
    const server = state.servers.find(s => s.id === id);
    if (!server) return;
    setTesting(ids => [...ids, id]);
    try {
      const info = await new AgentClient(server).info();
      setTestMsg(msg => ({ ...msg, [id]: { ok: true, text: `OK — ${info.hostname} (${info.os}), agent v${info.agent_version}` } }));
    } catch (e) {
      setTestMsg(msg => ({ ...msg, [id]: { ok: false, text: `Gagal: ${(e as Error).message}` } }));
    } finally { setTesting(ids => ids.filter(x => x !== id)); }
  };

  return (
    <div className="servers">
      <header className="page-heading"><div><h1>Server</h1><p>Kelola koneksi VPS dan akses terminal dari satu tempat.</p></div><a className="btn primary" href="#add-server">+ Tambah server</a></header>
      <div className="server-layout">
        <section className="inventory panel" aria-labelledby="inventory-title">
          <div className="section-heading"><h2 id="inventory-title">Daftar server <span className="count">{state.servers.length}</span></h2><span className="muted">Koneksi agent</span></div>
          <div className="search-wrap"><input className="search" type="search" aria-label="Cari server" placeholder="Cari nama atau alamat server…" value={query} onChange={e => setQuery(e.target.value)} /></div>
          <div className="list-labels"><span>Nama / alamat</span><span>Akses server</span></div>
          <div className="server-rows">
            {servers.map(s => (
              <div key={s.id} className="server-row">
                <div className="server-identity"><span className="server-icon" aria-hidden="true">▤</span><div><div className="srv-name">{s.name}</div><div className="server-address">{s.host}:{s.port}</div><div className="test-msg" aria-live="polite">{testing.includes(s.id) ? "Menguji koneksi…" : testMsg[s.id] ? <span className={testMsg[s.id].ok ? "text-ok" : "text-bad"}>{testMsg[s.id].text}</span> : "Belum diuji"}</div></div></div>
                <div className="row-actions"><button className="btn small" disabled={testing.includes(s.id)} onClick={() => test(s.id)}>Uji koneksi</button><button className="btn small" onClick={() => dispatch({ type: "open-tab", serverId: s.id })}>Terminal</button><button className="btn small danger" aria-label={`Hapus ${s.name}`} onClick={async () => { if (confirm(`Hapus profil ${s.name}? VPS dan datanya tidak dihapus.`)) { try { await removeServer(s.id, dispatch); } catch { setError("Profil gagal dihapus. Coba lagi."); } } }}>Hapus</button></div>
              </div>
            ))}
            {!state.servers.length && <div className="empty"><span className="empty-symbol" aria-hidden="true">▤</span><h3>Hubungkan VPS pertama</h3><p>Pasang agent di VPS, lalu masukkan alamat dan token pada form di samping.</p><a className="btn" href="#install-agent">Lihat cara instalasi</a></div>}
            {!!state.servers.length && !servers.length && <div className="empty"><h3>Server tidak ditemukan</h3><p>Coba nama atau alamat lain.</p></div>}
          </div>
          <div className="panel-foot">{state.servers.length} server tersimpan <span>Token tidak ditampilkan dalam daftar</span></div>
        </section>
        <section className="add-server panel" id="add-server" aria-labelledby="add-title"><div className="section-heading"><h2 id="add-title">Tambah server</h2></div><p className="form-intro">Gunakan alamat VPS yang menjalankan agent.</p>
          <form className="form" onSubmit={add}>
            <label>Nama server<input required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="production-01" /></label>
            <label>Alamat host<input required value={host} onChange={e => setHost(e.target.value)} placeholder="100.64.0.1" /><small>IP Tailscale, domain, atau URL HTTPS.</small></label>
            <label>Port<input required type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} /></label>
            <label>Token agent<input required value={token} onChange={e => setToken(e.target.value)} placeholder="Tempel token dari VPS" type="password" autoComplete="off" /><small>Dari file /etc/vps-agent/token di VPS.</small></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn primary" disabled={saving || !name.trim() || !host.trim() || !token.trim()}>{saving ? "Menyimpan…" : "Simpan server"}</button>
          </form><p className="form-note">Gunakan jaringan Tailscale atau reverse proxy HTTPS untuk mengakses agent.</p>
        </section>
      </div>
      <InstallGuide />
    </div>
  );
}

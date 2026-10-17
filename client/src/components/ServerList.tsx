import { useEffect, useRef, useState } from "react";
import { AgentClient } from "../lib/api";
import { persistServer, removeServer, useStore } from "../lib/store";
import { uid } from "../lib/types";
import InstallGuide from "./InstallGuide";
import { connectionStatus, recordConnection } from "../lib/monitoring";

export default function ServerList() {
  const { state, dispatch } = useStore();
  const [name, setName] = useState("");
  const [host, setHost] = useState("");
  const [port, setPort] = useState("18710");
  const [token, setToken] = useState("");
  const [editing, setEditing] = useState<string | null>(null);
  const [, refresh] = useState(0);
  const [query, setQuery] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [testing, setTesting] = useState<string[]>([]);
  const [testMsg, setTestMsg] = useState<Record<string, { ok: boolean; text: string; ts: number }>>({});
  const tests = useRef(new Map<string, symbol>());
  const profiles = useRef(state.servers);
  profiles.current=state.servers;
  const resetDraft = () => {setEditing(null);setName("");setHost("");setPort("18710");setToken("");};
  const invalidateTest = (id: string) => {
    tests.current.delete(id);
    setTesting(ids=>ids.filter(value=>value!==id));
    setTestMsg(messages=>{const next={...messages};delete next[id];return next;});
  };
  const servers = state.servers.filter(s => `${s.name} ${s.host}`.toLowerCase().includes(query.toLowerCase()));

  const add = async (e: React.FormEvent<HTMLFormElement>) => {
    e.preventDefault();
    if (saving) return;
    setError("");
    const address = host.trim();
    try {
      const url = new URL(/^https?:\/\//i.test(address) ? address : `http://${address}:${port}`);
      if (!/^https?:$/.test(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== "/") throw new Error();
      if (!Number.isInteger(Number(port)) || Number(port) < 1 || Number(port) > 65535) throw new Error();
    } catch {
      setError("Enter an IP, domain, or HTTP(S) URL without a path, and a port from 1 to 65535.");
      return;
    }
    setSaving(true);
    if (editing) invalidateTest(editing);
    try {
      await persistServer({ id: editing ?? uid(), name: name.trim(), host: address, port: Number(port), token: token.trim() }, dispatch);
      resetDraft();
    } catch (e) { setError(`Server has not been saved. ${e instanceof Error ? e.message : "Check storage access and try again."}`); }
    finally { setSaving(false); }
  };

  const test = async (id: string) => {
    const server = state.servers.find(s => s.id === id);
    if (!server) return;
    const generation = Symbol();
    tests.current.set(id,generation);
    const current = () => tests.current.get(id)===generation && profiles.current.find(s=>s.id===id)===server;
    setTesting(ids => [...ids, id]);
    const started = performance.now();
    try {
      const info = await new AgentClient(server).info();
      if (!current()) return;
      recordConnection(id, {online:true,lastSeen:Date.now(),version:info.agent_version,latency:Math.round(performance.now()-started),error:undefined});
      setTestMsg(msg => ({ ...msg, [id]: { ok: true, ts:Date.now(), text: `OK — ${info.hostname} (${info.os}), agent v${info.agent_version}` } }));
    } catch (e) {
      if (!current()) return;
      recordConnection(id, {online:false,error:(e as Error).message});
      setTestMsg(msg => ({ ...msg, [id]: { ok: false, ts:Date.now(), text: `Failed: ${(e as Error).message}` } }));
    } finally { if(tests.current.get(id)===generation)setTesting(ids => ids.filter(x => x !== id)); }
  };

  useEffect(() => { const timer = setInterval(() => refresh(n => n+1), 10000); return () => {clearInterval(timer);tests.current.clear();}; }, []);

  return (
    <div className="servers">
      <header className="page-heading"><div><h1>Server</h1><p>Manage VPS connections and terminal access in one place.</p></div><a className="btn primary" href="#add-server" onClick={() => {if(!saving && editing){setEditing(null);setName("");setHost("");setPort("18710");setToken("");setError("");}}}>+ Add server</a></header>
      {!(window as unknown as {__TAURI_INTERNALS__?: unknown}).__TAURI_INTERNALS__ && <p className="form-note">Browser mode: tokens are kept only for this page session; use the desktop app for secure storage.</p>}
      <div className="server-layout">
        <section className="inventory panel" aria-labelledby="inventory-title">
          <div className="section-heading"><h2 id="inventory-title">Server list <span className="count">{state.servers.length}</span></h2><span className="muted">Agent connections</span></div>
          <div className="search-wrap"><input className="search" type="search" aria-label="Search servers" placeholder="Search server name or address…" value={query} onChange={e => setQuery(e.target.value)} /></div>
          <div className="list-labels"><span>Name / address</span><span>Server access</span></div>
          <div className="server-rows">
            {servers.map(s => (
              <div key={s.id} className="server-row">
                <div className="server-identity"><span className="server-icon" aria-hidden="true">▤</span><div><div className="srv-name">{s.name}</div><div className="server-address">{new AgentClient(s).base}</div><div className="test-msg" aria-live="polite">{connectionStatus(s.id).online ? "Connected" : connectionStatus(s.id).error ?? "Not tested"}</div><div className="test-msg">{testing.includes(s.id) ? "Testing connection..." : testMsg[s.id] && `Manual test ${new Date(testMsg[s.id].ts).toLocaleTimeString("en-US")}: ${testMsg[s.id].text}`}</div><div className="muted">{connectionStatus(s.id).lastSeen ? `Last seen: ${new Date(connectionStatus(s.id).lastSeen!).toLocaleString("en-US")} · v${connectionStatus(s.id).version} · ${connectionStatus(s.id).latency} ms` : "No successful connections yet"}</div></div></div>
                <div className="row-actions"><button className="btn small" disabled={saving} onClick={() => {invalidateTest(s.id);setEditing(s.id);setName(s.name);setHost(s.host);setPort(String(s.port));setToken(s.token);setError("");document.getElementById("add-server")?.scrollIntoView();}}>Edit</button><button className="btn small" disabled={saving || testing.includes(s.id)} onClick={() => test(s.id)}>Test connection</button><button className="btn small" onClick={() => dispatch({ type: "open-tab", serverId: s.id })}>Terminal</button><button className="btn small danger" disabled={saving} aria-label={`Delete ${s.name}`} onClick={async () => { if (confirm(`Delete profile ${s.name}? The VPS and its data will be kept.`)) { try { invalidateTest(s.id); await removeServer(s.id, dispatch); if(editing===s.id)resetDraft(); } catch { setError("Could not delete the profile. Try again."); } } }}>Delete</button></div>
              </div>
            ))}
            {!state.servers.length && <div className="empty"><span className="empty-symbol" aria-hidden="true">▤</span><h3>Connect your first VPS</h3><p>Install the agent on your VPS, then enter its address and token in the form.</p><a className="btn" href="#install-agent">View installation guide</a></div>}
            {!!state.servers.length && !servers.length && <div className="empty"><h3>No servers found</h3><p>Try another name or address.</p></div>}
          </div>
          <div className="panel-foot">{state.servers.length} saved servers <span>Tokens are hidden from this list</span></div>
        </section>
        <section className="add-server panel" id="add-server" aria-labelledby="add-title"><div className="section-heading"><h2 id="add-title">{editing ? "Edit server" : "Add server"}</h2></div><p className="form-intro">Use the address of the VPS running the agent.</p>
          <form className="form" onSubmit={add}>
            <label>Server name<input disabled={saving} required maxLength={80} value={name} onChange={e => setName(e.target.value)} placeholder="production-01" /></label>
            <label>Host address<input disabled={saving} required value={host} onChange={e => setHost(e.target.value)} placeholder="100.64.0.1" /><small>Tailscale IP, domain, or HTTPS URL.</small></label>
            <label>Port<input disabled={saving} required type="number" min="1" max="65535" value={port} onChange={e => setPort(e.target.value)} /></label>
            <label>Agent token<input disabled={saving} required value={token} onChange={e => setToken(e.target.value)} placeholder="Paste the token from your VPS" type="password" autoComplete="off" /><small>From /etc/vps-agent/token on your VPS.</small></label>
            {error && <p className="form-error" role="alert">{error}</p>}
            <button className="btn primary" disabled={saving || !name.trim() || !host.trim() || !token.trim()}>{saving ? "Saving…" : "Save server"}</button>
            {editing && <button type="button" className="btn" disabled={saving} onClick={() => {setEditing(null);setName("");setHost("");setPort("18710");setToken("");}}>Cancel editing</button>}
          </form><p className="form-note">Use Tailscale or an HTTPS reverse proxy to access the agent.</p>
        </section>
      </div>
      <InstallGuide />
    </div>
  );
}

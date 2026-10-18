import { useEffect, useRef, useState } from "react";
import { AgentClient, type ContainersResult } from "../lib/api";
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
  const [tab, setTab] = useState<"services" | "containers" | "maintenance" | "security">("services");
  const [services, setServices] = useState<Service[]>([]);
  const [query, setQuery] = useState("");
  const [unit, setUnit] = useState("vps-agent.service");
  const [logs, setLogs] = useState<string[]>([]);
  const [logQuery, setLogQuery] = useState("");
  const [following, setFollowing] = useState(false);
  const [logStatus, setLogStatus] = useState("");
  const socket = useRef<WebSocket | null>(null);
  const [containersData, setContainersData] = useState<ContainersResult | null>(null);
  const [containerQuery, setContainerQuery] = useState("");
  const [selectedContainerLogs, setSelectedContainerLogs] = useState<{ id: string; name: string; logs: string } | null>(null);
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
    setLatest(""); setContainersData(null); setSelectedContainerLogs(null);
  }, [server?.id]);

  useEffect(() => {
    if (!server) return;
    if (tab === "services" && services.length === 0) {
      void refreshServices();
    } else if (tab === "containers" && !containersData) {
      void refreshContainers();
    } else if (tab === "maintenance" && !diagnostics) {
      void refreshMaintenance();
    } else if (tab === "security" && audit.length === 0) {
      void perform(async client => {
        setAudit((await client.request<{ entries: AuditEntry[] }>("/api/security/audit")).entries);
      });
    }
  }, [server?.id, tab]);

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

  const refreshContainers = () => perform(async client => {
    const result = await client.containers();
    setContainersData(result);
  });

  const actContainer = (id: string, name: string, action: "start" | "stop" | "restart") => {
    if (!confirm(`${action} container ${name || id} on ${server?.name}?`)) return;
    void perform(async client => {
      const result = await client.containerAction(id, action);
      if (result.ok) {
        setMessage(`Container ${name || id} ${action} successful.`);
        void refreshContainers();
      } else {
        setError(result.error || `Failed to ${action} container.`);
      }
    });
  };

  const viewContainerLogs = (id: string, name: string) => perform(async client => {
    const result = await client.containerLogs(id, 200);
    if (result.ok) {
      setSelectedContainerLogs({ id, name, logs: result.logs || "No logs available." });
    } else {
      setError(result.error || "Failed to load container logs.");
    }
  });

  const act = (service: string, action: "start" | "stop" | "restart") => {
    if (!confirm(`${action} ${service} on ${server?.name}?`)) return;
    void perform(async client => {
      const result = await client.serviceAction(service, action);
      if (!result.ok) throw new Error(result.error || "Service operation failed.");
      setServices((await client.services()).services);
      setMessage(`${service}: ${action} succeeded.`);
    });
  };

  const followLogs = () => {
    socket.current?.close(); socket.current = null;
    if (following) { setFollowing(false); setLogStatus("Logs paused."); return; }
    if (!server) return;
    setLogs([]); setError("");
    try {
      const ws = new AgentClient(server).logsSocket(unit);
      socket.current = ws; setFollowing(true); setLogStatus("Connecting to logs…");
      ws.onopen = () => { if (socket.current === ws) setLogStatus("Following live logs."); };
      ws.onmessage = event => {
        if (socket.current !== ws || typeof event.data !== "string") return;
        let text = event.data.slice(0, 65536);
        try {
          const frame = JSON.parse(text) as { t?: string; data?: unknown };
          if (frame.t === "line" && typeof frame.data === "string") text = frame.data;
        } catch { /* Accept plain text from older agents as well. */ }
        setLogs(previous => [...previous, ...text.split("\n")].slice(-1000));
      };
      ws.onerror = () => { if (socket.current === ws) setLogStatus("Could not connect to logs. Check admin access, connection, and service name."); };
      ws.onclose = () => { if (socket.current === ws) { setFollowing(false); setLogStatus("Log connection closed. Click Follow logs to reconnect."); } };
    } catch (e) { setFollowing(false); setError(errorText(e)); }
  };

  const refreshMaintenance = () => perform(async client => {
    const [diag, status] = await Promise.all([
      client.request<Diagnostics>("/api/diagnostics"),
      client.request<UpdateStatus>("/api/update/status"),
    ]);
    setDiagnostics(diag); setUpdate(status);
    const response = await fetch("https://api.github.com/repos/wignn/catly/releases/latest", { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw new Error(`Agent status was read, but the GitHub release check failed (HTTP ${response.status}).`);
    const release: { tag_name?: string } = await response.json();
    if (!release.tag_name || !/^v\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(release.tag_name)) throw new Error("Invalid GitHub release version.");
    setLatest(release.tag_name);
  });

  const maintain = (action: "update" | "rollback") => {
    if (!confirm(`${action === "update" ? "Update the agent to the latest stable Catly release" : "Restore the previous agent binary"} on ${server?.name}? The connection will be interrupted briefly.`)) return;
    void perform(async client => {
      const result = await client.request<{ ok: boolean; error?: string }>("/api/update", {
        method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action }),
      });
      if (!result.ok) throw new Error(result.error || "Maintenance request failed.");
      setMessage("Request accepted. The agent will restart; click Check version and status shortly to see the result.");
    });
  };

  const rotate = (kind: "admin" | "readonly") => {
    if (!confirm(kind === "admin" ? "Rotate the admin token? All clients using the old token will lose access. The new token will be saved to this profile." : "Create/rotate the monitoring token? The old read-only token will stop working.")) return;
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
          throw new Error("Token was updated on the VPS, but local storage failed. Copy the new token below before closing the application; this session profile is already using the new token.");
        }
      }
      setMessage(`Token ${kind} created. Store it securely; do not send it to logs or public messages.`);
    });
  };

  if (!server) return <div className="empty"><h2>No servers yet</h2><p>Add a server profile first.</p></div>;
  return <div className="operations">
    <header className="page-heading"><div><h1>Manage VPS</h1><p>Services, logs, agent maintenance, and access controls.</p></div>
      <label>Server<select value={server.id} onChange={e => setServerId(e.target.value)} disabled={busy}>{state.servers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}</select></label>
    </header>
    <div className="platforms" role="group" aria-label="Management sections">{([
      ["services", "Services & logs"], ["containers", "Docker containers"], ["maintenance", "Update agent"], ["security", "Security"],
    ] as const).map(([id, label]) => <button key={id} className={tab === id ? "selected" : ""} aria-pressed={tab === id} onClick={() => setTab(id)}>{label}</button>)}</div>
    {error && <p role="alert" className="operation-message text-bad">{error}</p>}
    {message && <p role="status" className="operation-message text-ok">{message}</p>}
    {busy && <p role="status">Processing…</p>}
    {tab === "containers" && (
      <section className="panel operation-section" aria-labelledby="container-title">
        <div className="section-heading">
          <h2 id="container-title">Docker containers</h2>
          <button className="btn" disabled={busy} onClick={() => void refreshContainers()}>Load / refresh</button>
        </div>
        <div className="operation-body">
          {containersData && !containersData.available && (
            <div className="empty">
              <h3>Docker not available</h3>
              <p>{containersData.error || "Docker is not installed or the Docker daemon is not active on this VPS."}</p>
            </div>
          )}
          {containersData?.available && (
            <>
              <label>Search containers
                <input
                  type="search"
                  value={containerQuery}
                  onChange={e => setContainerQuery(e.target.value)}
                  placeholder="Filter by name, image, or status..."
                />
              </label>
              <div className="table-scroll">
                <table>
                  <thead>
                    <tr>
                      <th>Container</th>
                      <th>Image</th>
                      <th>Status</th>
                      <th>Ports</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {containersData.containers
                      .filter(c => `${c.names} ${c.image} ${c.id} ${c.state} ${c.status}`.toLowerCase().includes(containerQuery.toLowerCase()))
                      .map(c => (
                        <tr key={c.id}>
                          <td>
                            <strong>{c.names.replace(/^\//, "") || c.id}</strong>
                            <small>ID: {c.id.slice(0, 12)}</small>
                          </td>
                          <td><code>{c.image}</code></td>
                          <td>
                            <span className={c.state === "running" ? "text-ok" : "muted"}>
                              ● {c.status || c.state}
                            </span>
                          </td>
                          <td><small>{c.ports || "—"}</small></td>
                          <td>
                            <div className="row-actions">
                              {c.state === "running" ? (
                                <>
                                  <button className="btn small" disabled={busy} onClick={() => actContainer(c.id, c.names, "restart")}>Restart</button>
                                  <button className="btn small" disabled={busy} onClick={() => actContainer(c.id, c.names, "stop")}>Stop</button>
                                </>
                              ) : (
                                <button className="btn small primary" disabled={busy} onClick={() => actContainer(c.id, c.names, "start")}>Start</button>
                              )}
                              <button className="btn small" disabled={busy} onClick={() => void viewContainerLogs(c.id, c.names)}>Logs</button>
                            </div>
                          </td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              </div>
              {!containersData.containers.length && (
                <p className="muted">No containers found on this VPS.</p>
              )}
            </>
          )}
          {!containersData && (
            <p className="muted">{busy ? "Querying Docker daemon…" : "Click Load / refresh to query Docker containers."}</p>
          )}

          {selectedContainerLogs && (
            <div style={{ marginTop: "24px" }}>
              <div className="section-heading" style={{ padding: "12px 0" }}>
                <h3>Logs: {selectedContainerLogs.name} ({selectedContainerLogs.id.slice(0, 12)})</h3>
                <div className="row-actions">
                  <button className="btn small" disabled={busy} onClick={() => void viewContainerLogs(selectedContainerLogs.id, selectedContainerLogs.name)}>Refresh logs</button>
                  <button className="btn small" onClick={() => setSelectedContainerLogs(null)}>Close logs</button>
                </div>
              </div>
              <pre className="log-output" aria-label="Container log output">
                {selectedContainerLogs.logs || "No logs output recorded."}
              </pre>
            </div>
          )}
        </div>
      </section>
    )}
    {tab === "services" && <>
      <section className="panel operation-section" aria-labelledby="service-title">
        <div className="section-heading"><h2 id="service-title">systemd services</h2><button className="btn" disabled={busy} onClick={() => void refreshServices()}>Load / refresh</button></div>
        <div className="operation-body"><label>Search services<input type="search" value={query} onChange={e => setQuery(e.target.value)} placeholder="nginx, docker, vps-agent…" /></label>
          <div className="table-scroll"><table><thead><tr><th>Service</th><th>Status</th><th>Actions</th></tr></thead><tbody>
            {services.filter(s => `${s.unit} ${s.description} ${s.active}`.toLowerCase().includes(query.toLowerCase())).map(s => <tr key={s.unit}>
              <td><strong>{s.unit}</strong><small>{s.description}</small></td><td><span className={s.active === "failed" ? "text-bad" : s.active === "active" ? "text-ok" : "muted"}>{s.active} / {s.sub}</span></td>
              <td><div className="row-actions">{(["start", "stop", "restart"] as const).map(action => <button className="btn small" key={action} disabled={busy} onClick={() => act(s.unit, action)}>{action}</button>)}<button className="btn small" onClick={() => { socket.current?.close(); socket.current = null; setFollowing(false); setUnit(s.unit); setLogs([]); }}>Select logs</button></div></td>
            </tr>)}
          </tbody></table></div>
          {!services.length && <p className="muted">{busy ? "Loading services from VPS…" : "Click Load / refresh to read services from the VPS."}</p>}
        </div>
      </section>
      <section className="panel operation-section" aria-labelledby="logs-title"><div className="section-heading"><h2 id="logs-title">Live logs</h2><span className="muted">Up to the latest 1,000 lines</span></div>
        <div className="operation-body"><div className="operation-toolbar"><label>Service name<input value={unit} disabled={following} onChange={e => setUnit(e.target.value)} placeholder="nginx.service" /></label><button className="btn" disabled={!/^[a-zA-Z0-9_.@:-]+\.service$/.test(unit)} onClick={followLogs}>{following ? "Pause logs" : "Follow logs"}</button><label>Search logs<input type="search" value={logQuery} onChange={e => setLogQuery(e.target.value)} /></label></div>
          <p role="status" className="muted">{logStatus}</p><pre className="log-output" aria-label="Log content">{logs.filter(line => line.toLowerCase().includes(logQuery.toLowerCase())).join("\n") || "No log lines yet."}</pre>
        </div>
      </section>
    </>}
    {tab === "maintenance" && <section className="panel operation-section"><div className="section-heading"><h2>Update and rollback</h2><button className="btn" disabled={busy} onClick={() => void refreshMaintenance()}>Check version and status</button></div><div className="operation-body">
      <p>Updates are downloaded from <a href="https://github.com/wignn/catly/releases" target="_blank" rel="noreferrer">GitHub Releases Catly</a>. The updater verifies SHA-256 and restores the previous binary if the service fails to start.</p>
      <dl className="status-grid"><dt>Installed version</dt><dd>{update?.installed_version || diagnostics?.agent_version || "Not checked"}</dd><dt>Latest release</dt><dd>{latest || "Not checked"}</dd><dt>Bind address</dt><dd>{diagnostics?.bind || "Not checked"}</dd><dt>IP Tailscale</dt><dd>{diagnostics?.tailscale_ip || "Unavailable / not checked"}</dd><dt>Status updater</dt><dd>{update?.state || "Not checked"}</dd></dl>
      <div className="row-actions"><button className="btn primary" disabled={busy || !update || !latest || diagnostics?.role !== "admin"} onClick={() => maintain("update")}>Update agent</button><button className="btn" disabled={busy || !update?.rollback_available || diagnostics?.role !== "admin"} onClick={() => maintain("rollback")}>Roll back binary</button></div>
      {update?.output && <pre className="log-output">{update.output}</pre>}<p className="muted">If the endpoint is not yet available, upgrade the agent using the latest release installer on the VPS first. Token and bind settings are preserved.</p>
    </div></section>}
    {tab === "security" && <section className="panel operation-section"><div className="section-heading"><h2>Tokens and audit</h2></div><div className="operation-body">
      <p>Admin tokens grant management access. Read-only tokens allow only info, metrics, service status, and diagnostics; they cannot open terminals, read files, or run commands.</p>
      <div className="row-actions"><button className="btn" disabled={busy} onClick={() => rotate("readonly")}>Create / rotate read-only token</button><button className="btn" disabled={busy} onClick={() => rotate("admin")}>Rotate admin token</button><button className="btn" disabled={busy} onClick={() => void perform(async client => { setAudit((await client.request<{ entries: AuditEntry[] }>("/api/security/audit")).entries); })}>Load audit</button></div>
      {newToken && <div className="token-result"><label>New token — copy and store securely<input readOnly value={newToken} aria-label="New token" onFocus={e => e.target.select()} /></label><button className="btn small" onClick={() => setNewToken("")}>Hide</button></div>}
      <p className="muted">The audit records operation types, endpoints, and results without storing tokens, file contents, or command contents. Agent session audit entries are limited and cleared on restart; use journalctl for service logs.</p>
      <div className="table-scroll"><table><thead><tr><th>Time</th><th>Operation</th><th>Status</th><th>Access</th></tr></thead><tbody>{audit.slice().reverse().map((entry, index) => <tr key={`${entry.ts}-${index}`}><td>{new Date(entry.ts * 1000).toLocaleString()}</td><td>{entry.method} {entry.path}</td><td>{entry.status}</td><td>{entry.role}</td></tr>)}</tbody></table></div>
    </div></section>}
  </div>;
}

import { StoreProvider, useStore } from "./lib/store";
import ServerList from "./components/ServerList";
import Dashboard from "./components/Dashboard";
import TerminalView from "./components/TerminalView";
import Operations from "./components/Operations";
import Monitoring from "./components/Monitoring";
import { FileManager } from "./components/FileManager";
import "./styles.css";

function Shell() {
  const { state, dispatch } = useStore();
  if (state.loadError) return <div className="empty" role="alert"><h2>Unable to open profiles</h2><p>{state.loadError}</p><p>Your original data is preserved. Check storage access and Windows Credential Manager.</p><button className="btn" onClick={() => window.location.reload()}>Try again</button></div>;
  if (!state.ready) return <div className="loading" role="status">Loading workspace…</div>;
  const viewNames = { servers: "Server", dashboard: "Dashboard", terminal: "Terminal", monitoring: "Monitoring", operations: "Manage VPS", files: "File" };
  const activeServer = state.servers.find(s => s.id === state.activeServerId) ?? state.servers[0];

  return (
    <div className="app">
      <aside className="side">
        <div className="logo"><img className="brand-mark" src="/icon.svg" width="34" height="36" alt="" /><span>VPS Manager<small>Infrastructure console</small></span></div>
        <div className="workspace-label">Personal workspace</div>
        <nav aria-label="Main navigation">
          <button className={state.view === "servers" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "servers" })}>
            <span aria-hidden="true">▤</span> Server <span className="nav-count">{state.servers.length}</span>
          </button>
          <button className={state.view === "dashboard" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "dashboard" })}>
            <span aria-hidden="true">▥</span> Dashboard
          </button>
          <button className={state.view === "terminal" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "terminal" })}>
            <span aria-hidden="true">›_</span> Terminal <span className="nav-count">{state.tabs.length || ""}</span>
          </button>
          <button className={state.view === "monitoring" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "monitoring" })}><span aria-hidden="true">◷</span> Monitoring</button>
          <button className={state.view === "operations" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "operations" })}><span aria-hidden="true">⚙</span> Manage VPS</button>
          <button className={state.view === "files" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "files" })}><span aria-hidden="true">▱</span> File</button>
        </nav>
        <div className="side-foot"><strong>Local workspace</strong><p>Server profiles are stored on this device.</p><span>VPS Manager <span className="version">v1.0.0</span></span></div>
      </aside>
      <main className="main">
        <div className="topbar"><span>Workspace <span className="breadcrumb">/</span> {viewNames[state.view]}</span><span className="local-badge">Local storage</span></div>
        <div className={"page-content" + (state.view === "terminal" ? " terminal-content" : "")}>
          <div className="view-pane" hidden={state.view !== "servers"}><ServerList /></div>
          <div className="view-pane" hidden={state.view !== "dashboard"}><Dashboard active={state.view === "dashboard"} /></div>
          <div className="view-pane" hidden={state.view !== "terminal"}><TerminalView /></div>
          <div className="view-pane" hidden={state.view !== "monitoring"}><Monitoring /></div>
          <div className="view-pane" hidden={state.view !== "operations"}><Operations /></div>
          <div className="view-pane" hidden={state.view !== "files"}>
            <div className="operation-toolbar"><label>Server<select aria-label="File manager server" value={activeServer?.id ?? ""} onChange={e => dispatch({ type: "set-active-server", id: e.target.value })}>{state.servers.map(server => <option key={server.id} value={server.id}>{server.name}</option>)}</select></label></div>
            {activeServer ? <FileManager key={`${activeServer.id}:${activeServer.host}:${activeServer.port}`} server={activeServer} /> : <div className="empty"><h2>No servers yet</h2><p>Add a server profile first.</p></div>}
          </div>
        </div>
      </main>
    </div>
  );
}

export default function App() {
  return (
    <StoreProvider>
      <Shell />
    </StoreProvider>
  );
}

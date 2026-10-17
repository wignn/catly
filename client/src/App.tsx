import { StoreProvider, useStore } from "./lib/store";
import ServerList from "./components/ServerList";
import Dashboard from "./components/Dashboard";
import TerminalView from "./components/TerminalView";
import "./styles.css";

function Shell() {
  const { state, dispatch } = useStore();
  if (!state.ready) return <div className="loading" role="status">Memuat workspace…</div>;

  return (
    <div className="app">
      <aside className="side">
        <div className="logo"><img className="brand-mark" src="/icon.svg" width="34" height="36" alt="" /><span>VPS Manager<small>Infrastructure console</small></span></div>
        <div className="workspace-label">Workspace pribadi</div>
        <nav aria-label="Navigasi utama">
          <button className={state.view === "servers" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "servers" })}>
            <span aria-hidden="true">▤</span> Server <span className="nav-count">{state.servers.length}</span>
          </button>
          <button className={state.view === "dashboard" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "dashboard" })}>
            <span aria-hidden="true">▥</span> Dashboard
          </button>
          <button className={state.view === "terminal" ? "active" : ""} onClick={() => dispatch({ type: "set-view", view: "terminal" })}>
            <span aria-hidden="true">›_</span> Terminal <span className="nav-count">{state.tabs.length || ""}</span>
          </button>
        </nav>
        <div className="side-foot"><strong>Workspace lokal</strong><p>Profil server tersimpan di perangkat ini.</p><span>VPS Manager <span className="version">v0.1.0</span></span></div>
      </aside>
      <main className="main">
        <div className="topbar"><span>Workspace <span className="breadcrumb">/</span> {state.view === "servers" ? "Server" : state.view === "dashboard" ? "Dashboard" : "Terminal"}</span><span className="local-badge">Penyimpanan lokal</span></div>
        <div className={"page-content" + (state.view === "terminal" ? " terminal-content" : "")}>
        {state.view === "servers" && <ServerList />}
        {state.view === "dashboard" && <Dashboard />}
        {state.view === "terminal" && <TerminalView />}
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

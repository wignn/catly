// Terminal multi-tab + split pane.
import { useStore } from "../lib/store";
import TerminalPane from "./TerminalPane";

export default function TerminalView() {
  const { state, dispatch } = useStore();
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? null;

  if (!state.servers.length) {
    return <div className="empty">Add a VPS in the <b>Server</b> menu before opening a terminal.</div>;
  }

  const colsFor = (n: number) =>
    n <= 1 ? "1fr" : n === 2 ? "1fr 1fr" : "1fr 1fr 1fr";

  return (
    <div className="term-view">
      <header className="page-heading"><div><h1>Terminal</h1><p>Open shell sessions or split the view to work across multiple VPS hosts.</p></div></header>
      <div className="tabbar">
        {state.tabs.map((t) => (
          <div
            key={t.id}
            className={"tab" + (t.id === state.activeTabId ? " active" : "")}
          >
            <button className="tab-title" aria-pressed={t.id === state.activeTabId} onClick={() => dispatch({ type: "set-active-tab", id: t.id })}>{t.title} ({t.panes.length})</button>
            <button
              className="tab-x"
              onClick={(e) => { e.stopPropagation(); dispatch({ type: "close-tab", id: t.id }); }}
              title="Close tab"
            >×</button>
          </div>
        ))}
        <button
          className="btn small"
          onClick={() => dispatch({ type: "open-tab", serverId: state.activeServerId ?? state.servers[0].id })}
          title="New tab"
        >+ Tab</button>
        {activeTab && (
          <button
            className="btn small"
            onClick={() => dispatch({ type: "split-pane", tabId: activeTab.id, serverId: state.activeServerId ?? state.servers[0].id })}
            title="Split: add a panel side by side"
          >Split pane</button>
        )}
      </div>

      {activeTab ? (
        <div className="panes" style={{ gridTemplateColumns: colsFor(activeTab.panes.length) }}>
          {activeTab.panes.map((p) => {
            const srv = state.servers.find((s) => s.id === p.serverId) ?? state.servers[0];
            return (
              <div key={p.id} className="pane">
                <div className="pane-head">
                  <select
                    aria-label="Server for terminal pane"
                    value={srv.id}
                    onChange={(e) => dispatch({ type: "set-pane-server", tabId: activeTab.id, paneId: p.id, serverId: e.target.value })}
                  >
                    {state.servers.map((s) => (
                      <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                    ))}
                  </select>
                  {activeTab.panes.length > 1 && (
                    <button
                      className="btn tiny"
                      aria-label="Close pane"
                      onClick={() => dispatch({ type: "close-pane", tabId: activeTab.id, paneId: p.id })}
                    >×</button>
                  )}
                </div>
                <TerminalPane server={srv} paneKey={p.id + ":" + srv.id} />
              </div>
            );
          })}
        </div>
      ) : (
        <div className="empty">
          No terminal tabs yet.{" "}
          <button className="btn" onClick={() => dispatch({ type: "open-tab", serverId: state.activeServerId ?? state.servers[0].id })}>
            Open terminal
          </button>
        </div>
      )}
    </div>
  );
}

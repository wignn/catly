// Terminal multi-tab + split pane + multi-server broadcast.
import { useRef, useState } from "react";
import { useStore } from "../lib/store";
import TerminalPane from "./TerminalPane";

export default function TerminalView() {
  const { state, dispatch } = useStore();
  const [broadcast, setBroadcast] = useState(false);
  const [broadcastCmd, setBroadcastCmd] = useState("");
  const paneSenders = useRef<Map<string, (data: string) => void>>(new Map());
  const activeTab = state.tabs.find((t) => t.id === state.activeTabId) ?? null;

  if (!state.servers.length) {
    return <div className="empty">Add a VPS in the <b>Server</b> menu before opening a terminal.</div>;
  }

  const colsFor = (n: number) =>
    n <= 1 ? "1fr" : n === 2 ? "1fr 1fr" : n === 3 ? "1fr 1fr 1fr" : "repeat(auto-fit, minmax(320px, 1fr))";

  const handleBroadcastData = (sourcePaneId: string, data: string) => {
    if (!broadcast || !activeTab) return;
    for (const p of activeTab.panes) {
      if (p.id !== sourcePaneId) {
        const send = paneSenders.current.get(p.id);
        if (send) send(data);
      }
    }
  };

  const handleBroadcastCommand = (e: React.FormEvent) => {
    e.preventDefault();
    if (!broadcastCmd || !activeTab) return;
    for (const p of activeTab.panes) {
      const send = paneSenders.current.get(p.id);
      if (send) send(broadcastCmd + "\r");
    }
    setBroadcastCmd("");
  };

  return (
    <div className="term-view">
      <header className="page-heading">
        <div>
          <h1>Terminal</h1>
          <p>Open shell sessions or split the view to work across multiple VPS hosts simultaneously.</p>
        </div>
      </header>
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
        {activeTab && activeTab.panes.length > 1 && (
          <button
            className={"btn small" + (broadcast ? " broadcast-active" : "")}
            onClick={() => setBroadcast(b => !b)}
            title="Broadcast input to all panes in this tab"
          >
            📡 Broadcast: {broadcast ? "ON" : "OFF"}
          </button>
        )}
      </div>

      {broadcast && activeTab && activeTab.panes.length > 1 && (
        <form className="broadcast-bar" onSubmit={handleBroadcastCommand}>
          <div className="broadcast-info">
            <span className="broadcast-dot" />
            <strong>Multi-Server Broadcast Active:</strong> keystrokes and commands execute on all {activeTab.panes.length} servers at once.
          </div>
          <div className="broadcast-input-row">
            <input
              type="text"
              value={broadcastCmd}
              onChange={(e) => setBroadcastCmd(e.target.value)}
              placeholder="Type command and press Enter to broadcast (e.g. docker ps, apt update, uptime)..."
              aria-label="Broadcast command"
            />
            <button type="submit" className="btn small primary">Broadcast ↵</button>
          </div>
        </form>
      )}

      {state.tabs.length > 0 ? (
        state.tabs.map((tab) => {
          const isTabActive = tab.id === state.activeTabId;
          return (
            <div
              key={tab.id}
              className="panes"
              hidden={!isTabActive}
              style={{ gridTemplateColumns: colsFor(tab.panes.length) }}
            >
              {tab.panes.map((p) => {
                const srv = state.servers.find((s) => s.id === p.serverId) ?? state.servers[0];
                return (
                  <div key={p.id} className={"pane" + (broadcast && isTabActive && tab.panes.length > 1 ? " pane-broadcasting" : "")}>
                    <div className="pane-head">
                      <select
                        aria-label="Server for terminal pane"
                        value={srv.id}
                        onChange={(e) => dispatch({ type: "set-pane-server", tabId: tab.id, paneId: p.id, serverId: e.target.value })}
                      >
                        {state.servers.map((s) => (
                          <option key={s.id} value={s.id}>{s.name} ({s.host})</option>
                        ))}
                      </select>
                      {broadcast && isTabActive && tab.panes.length > 1 && (
                        <span className="broadcast-badge" title="Input is broadcast to this server">📡 Broadcast</span>
                      )}
                      {tab.panes.length > 1 && (
                        <button
                          className="btn tiny"
                          aria-label="Close pane"
                          onClick={() => dispatch({ type: "close-pane", tabId: tab.id, paneId: p.id })}
                        >×</button>
                      )}
                    </div>
                    <TerminalPane
                      server={srv}
                      paneKey={p.id + ":" + srv.id}
                      paneId={p.id}
                      broadcastActive={broadcast && isTabActive && tab.panes.length > 1}
                      onRegisterSender={(id, send) => paneSenders.current.set(id, send)}
                      onUnregisterSender={(id) => paneSenders.current.delete(id)}
                      onBroadcastData={handleBroadcastData}
                    />
                  </div>
                );
              })}
            </div>
          );
        })
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

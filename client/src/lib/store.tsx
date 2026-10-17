// State global aplikasi: server, tab terminal, view aktif.
import React, { createContext, useContext, useEffect, useMemo, useReducer } from "react";
import type { Server, TermTab, TabPane, View } from "./types";
import { uid } from "./types";
import { loadServers, saveServer, deleteServer, loadTabs, saveTabs } from "./db";

interface State {
  servers: Server[];
  activeServerId: string | null;
  tabs: TermTab[];
  activeTabId: string | null;
  view: View;
  ready: boolean;
  loadError: string | null;
}

type Action =
  | { type: "init"; servers: Server[]; tabs: TermTab[] }
  | { type: "init-error"; message: string }
  | { type: "add-server"; server: Server }
  | { type: "remove-server"; id: string }
  | { type: "set-active-server"; id: string }
  | { type: "set-view"; view: View }
  | { type: "open-tab"; serverId: string }
  | { type: "close-tab"; id: string }
  | { type: "set-active-tab"; id: string }
  | { type: "split-pane"; tabId: string; serverId: string }
  | { type: "close-pane"; tabId: string; paneId: string }
  | { type: "set-pane-server"; tabId: string; paneId: string; serverId: string };

function newTab(serverId: string, servers: Server[]): TermTab {
  const s = servers.find((x) => x.id === serverId);
  return {
    id: uid(),
    title: s ? `${s.name}` : "Terminal",
    panes: [{ id: uid(), serverId }],
  };
}

function reducer(st: State, a: Action): State {
  switch (a.type) {
    case "init":
      return { ...st, servers: a.servers, tabs: a.tabs, ready: true, loadError: null,
        activeServerId: a.servers[0]?.id ?? null,
        activeTabId: a.tabs[0]?.id ?? null };
    case "init-error":
      return { ...st, ready: false, loadError: a.message };
    case "add-server":
      return { ...st, servers: [...st.servers.filter((s) => s.id !== a.server.id), a.server] };
    case "remove-server":
      return { ...st,
        servers: st.servers.filter((s) => s.id !== a.id),
        tabs: st.tabs.map((t) => ({ ...t, panes: t.panes.filter((p) => p.serverId !== a.id) }))
                   .filter((t) => t.panes.length > 0),
        activeServerId: st.activeServerId === a.id ? (st.servers.find((s) => s.id !== a.id)?.id ?? null) : st.activeServerId };
    case "set-active-server":
      return { ...st, activeServerId: a.id };
    case "set-view":
      return { ...st, view: a.view };
    case "open-tab": {
      const t = newTab(a.serverId, st.servers);
      return { ...st, tabs: [...st.tabs, t], activeTabId: t.id, view: "terminal" };
    }
    case "close-tab": {
      const tabs = st.tabs.filter((t) => t.id !== a.id);
      return { ...st, tabs, activeTabId: st.activeTabId === a.id ? (tabs[tabs.length - 1]?.id ?? null) : st.activeTabId };
    }
    case "set-active-tab":
      return { ...st, activeTabId: a.id };
    case "split-pane": {
      const pane: TabPane = { id: uid(), serverId: a.serverId };
      return { ...st, tabs: st.tabs.map((t) => t.id === a.tabId ? { ...t, panes: [...t.panes, pane] } : t) };
    }
    case "close-pane": {
      const tabs = st.tabs
        .map((t) => t.id === a.tabId ? { ...t, panes: t.panes.filter((p) => p.id !== a.paneId) } : t)
        .filter((t) => t.panes.length > 0);
      return { ...st, tabs, activeTabId: tabs.some((t) => t.id === st.activeTabId) ? st.activeTabId : (tabs[tabs.length - 1]?.id ?? null) };
    }
    case "set-pane-server":
      return { ...st, tabs: st.tabs.map((t) => t.id === a.tabId
        ? { ...t, panes: t.panes.map((p) => p.id === a.paneId ? { ...p, serverId: a.serverId } : p) } : t) };
    default:
      return st;
  }
}

const Ctx = createContext<{ state: State; dispatch: React.Dispatch<Action> } | null>(null);

export function StoreProvider({ children }: { children: React.ReactNode }) {
  const [state, dispatch] = useReducer(reducer, {
    servers: [], activeServerId: null, tabs: [], activeTabId: null, view: "servers", ready: false, loadError: null,
  });

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [servers, tabs] = await Promise.all([loadServers(), loadTabs()]);
        if (alive) dispatch({ type: "init", servers, tabs });
      } catch (e) {
        if (alive) dispatch({ type: "init-error", message: e instanceof Error ? e.message : "Unable to open profile storage." });
      }
    })();
    return () => { alive = false; };
  }, []);

  // persistensi tab (debounce sederhana)
  useEffect(() => {
    if (!state.ready) return;
    const t = setTimeout(() => { saveTabs(state.tabs).catch(() => {}); }, 800);
    return () => clearTimeout(t);
  }, [state.tabs, state.ready]);

  const value = useMemo(() => ({ state, dispatch }), [state]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useStore() {
  const ctx = useContext(Ctx);
  if (!ctx) throw new Error("useStore called outside StoreProvider");
  return ctx;
}

export async function persistServer(s: Server, dispatch: React.Dispatch<Action>) {
  await saveServer(s);
  dispatch({ type: "add-server", server: s });
}

export async function removeServer(id: string, dispatch: React.Dispatch<Action>) {
  await deleteServer(id);
  dispatch({ type: "remove-server", id });
}

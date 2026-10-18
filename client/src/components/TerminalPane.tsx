// Satu panel terminal: xterm.js <-> WebSocket /ws/pty agent.
import { useEffect, useRef } from "react";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { AgentClient } from "../lib/api";
import type { Server } from "../lib/types";
import "@xterm/xterm/css/xterm.css";

interface Props {
  server: Server;
  paneKey: string; // berubah -> reconnect (ganti server)
  paneId?: string;
  broadcastActive?: boolean;
  onRegisterSender?: (paneId: string, send: (data: string) => void) => void;
  onUnregisterSender?: (paneId: string) => void;
  onBroadcastData?: (sourcePaneId: string, data: string) => void;
}

export default function TerminalPane({
  server,
  paneKey,
  paneId,
  broadcastActive,
  onRegisterSender,
  onUnregisterSender,
  onBroadcastData,
}: Props) {
  const divRef = useRef<HTMLDivElement>(null);
  const termRef = useRef<Terminal | null>(null);

  useEffect(() => {
    const el = divRef.current;
    if (!el) return;

    const term = new Terminal({
      cursorBlink: true,
      fontSize: 13,
      fontFamily: "'Cascadia Code', Consolas, monospace",
      theme: {
        background: "#0d1117",
        foreground: "#c9d1d9",
        cursor: "#58a6ff",
        selectionBackground: "#264f78",
      },
      scrollback: 5000,
    });
    const fit = new FitAddon();
    term.loadAddon(fit);
    term.open(el);
    termRef.current = term;
    fit.fit();

    const client = new AgentClient(server);
    const ws = client.ptySocket(term.cols, term.rows);
    let alive = true;

    if (paneId && onRegisterSender) {
      onRegisterSender(paneId, (data: string) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "input", data }));
        }
      });
    }

    ws.onopen = () => {
      term.writeln("\x1b[90m[connected to " + server.name + " — " + server.host + "]\x1b[0m");
    };
    ws.onmessage = (ev) => {
      if (!alive) return;
      try {
        const msg = JSON.parse(ev.data as string);
        if (msg.t === "output" && typeof msg.data === "string") term.write(msg.data);
        else if (msg.t === "exit") term.writeln(`\r\n\x1b[90m[session ended, code ${msg.code}]\x1b[0m`);
      } catch { /* abaikan */ }
    };
    ws.onclose = () => {
      if (alive) term.writeln("\r\n\x1b[90m[disconnected]\x1b[0m");
    };
    ws.onerror = () => {
      term.writeln("\r\n\x1b[31m[gagal connected to agent — check host/port/token]\x1b[0m");
    };

    const dispData = term.onData((data) => {
      if (ws.readyState === WebSocket.OPEN) {
        ws.send(JSON.stringify({ t: "input", data }));
      }
      if (broadcastActive && paneId && onBroadcastData) {
        onBroadcastData(paneId, data);
      }
    });

    const ro = new ResizeObserver(() => {
      if (!alive) return;
      try {
        fit.fit();
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(JSON.stringify({ t: "resize", cols: term.cols, rows: term.rows }));
        }
      } catch { /* abaikan */ }
    });
    ro.observe(el);

    return () => {
      if (paneId && onUnregisterSender) {
        onUnregisterSender(paneId);
      }
      alive = false;
      ro.disconnect();
      dispData.dispose();
      try { ws.close(); } catch { /* abaikan */ }
      term.dispose();
      termRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [paneKey, server.id, broadcastActive]);

  return <div ref={divRef} className="term-pane" />;
}

import { useEffect, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AgentClient } from "../lib/api";
import { fmtBytes, type Server } from "../lib/types";
import "./FileManager.css";

interface Entry { name: string; kind: string; size: number; mode: string }
const desktop = () => "__TAURI_INTERNALS__" in window;

export function FileManager({ server }: { server: Server }) {
  const [path, setPath] = useState("/tmp");
  const [entries, setEntries] = useState<Entry[]>([]);
  const [editor, setEditor] = useState<{ path: string; content: string } | null>(null);
  const [original, setOriginal] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [ssh, setSsh] = useState({ host: "", user: "root", port: "22", key: "", remote: "/tmp/file", local: "" });
  const base = new AgentClient(server).base;

  async function request(endpoint: string, init?: RequestInit) {
    const response = await fetch(`${base}/api/files${endpoint}`, {
      ...init, headers: { Authorization: `Bearer ${server.token}`, ...init?.headers },
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function list(directory = path) {
    if (!directory.startsWith("/")) throw new Error("Use an absolute remote directory");
    const data = await (await request(`?path=${encodeURIComponent(directory)}`)).json() as { path: string; entries: Entry[] };
    setPath(data.path); setEntries(data.entries);
  }
  useEffect(() => {
    setEntries([]); setEditor(null); setPath("/tmp"); setError("");
    let current = true;
    request("?path=%2Ftmp").then(r => r.json()).then((data: { entries: Entry[] }) => { if (current) setEntries(data.entries); }).catch(e => { if (current) setError(String(e)); });
    return () => { current = false; };
  }, [server.id, server.host, server.port, server.token]);
  const child = (name: string) => `${path.replace(/\/+$/, "")}/${name}`;
  async function upload(files: File[]) {
    if (!files.length) return;
    if (!window.confirm(`Upload ${files.length} file(s) to ${path}? Existing files will be backed up before replacement.`)) return;
    await run(async () => {
      const body = new FormData();
      for (const file of files) body.append("file", file);
      await request(`/upload?path=${encodeURIComponent(path)}`, { method: "POST", body });
      await list(); setMessage("Upload complete; replaced files were backed up on the server.");
    });
  }
  async function edit(file: string) {
    if (editor && editor.content !== original && !window.confirm("Discard unsaved edits?")) return;
    await run(async () => {
      const data = await (await request(`/read?path=${encodeURIComponent(file)}`)).json() as { content: string };
      setEditor({ path: file, content: data.content }); setOriginal(data.content);
    });
  }
  async function download(file: string) {
    await run(async () => {
      const blob = await (await request(`/download?path=${encodeURIComponent(file)}`)).blob();
      const url = URL.createObjectURL(blob); const link = document.createElement("a");
      link.href = url; link.download = file.split("/").pop() || "download"; link.click();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
    });
  }
  return <div className="file-manager">
    <h2>Files — {server.name}</h2>
    <p>Agent file access requires an administrator token. Text editing is limited to 2 MB.</p>
    <form className="file-toolbar" onSubmit={e => { e.preventDefault(); void run(() => list()); }}>
      <label>Remote directory<input value={path} onChange={e => setPath(e.target.value)} /></label>
      <button disabled={busy}>Browse</button>
      <button type="button" disabled={busy} onClick={() => void run(() => list(path.replace(/\/[^/]+\/?$/, "") || "/"))}>Parent</button>
      <label className="file-upload">Upload<input type="file" multiple disabled={busy} onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>
    </form>
    <div className="file-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); }}>
      <p>Drop files here to upload to this directory.</p>
      <table><thead><tr><th>Name</th><th>Size</th><th>Mode</th><th>Actions</th></tr></thead><tbody>
        {entries.map(entry => <tr key={entry.name}><td>{entry.kind === "dir" ? <button disabled={busy} onClick={() => void run(() => list(child(entry.name)))}>{entry.name}/</button> : entry.name}</td><td>{fmtBytes(entry.size)}</td><td>{entry.mode}</td><td>{entry.kind === "file" && <><button disabled={busy || entry.size > 2 * 1024 * 1024} onClick={() => void edit(child(entry.name))}>Edit</button> <button disabled={busy} onClick={() => void download(child(entry.name))}>Download</button></>}</td></tr>)}
      </tbody></table>
      {!entries.length && <p>No entries loaded.</p>}
    </div>
    {editor && <section><h3>{editor.path}</h3><label>Text content<textarea spellCheck={false} value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} /></label>
      <button disabled={busy || editor.content === original} onClick={() => {
        if (!window.confirm(`Save ${editor.path}? The server creates a backup before replacement.`)) return;
        void run(async () => { const result = await (await request("/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editor) })).json() as { backup?: string }; setOriginal(editor.content); setMessage(`Saved. Backup: ${result.backup || "created by agent"}`); await list(); });
      }}>Save with backup</button> <button disabled={busy} onClick={() => { if (editor.content === original || window.confirm("Discard unsaved edits?")) setEditor(null); }}>Close editor</button>
    </section>}
    <details><summary>Native SFTP (SSH key or SSH agent)</summary>
      {!desktop() ? <p>SFTP requires the desktop app and an installed OpenSSH Client.</p> : <>
        <p>SSH access is separate from the agent token. First connect manually with <code>ssh -p PORT USER@HOST</code>, verify the host fingerprint, and accept it in your SSH known_hosts. Encrypted keys must already be loaded into your SSH agent. Transfers reject unknown or changed host keys.</p>
        <p>SFTP transfers overwrite their destination and do not create agent backups. Use the agent editor above for backed up changes.</p>
        <div className="file-ssh-fields">{(Object.keys(ssh) as (keyof typeof ssh)[]).map(field => <label key={field}>{({ host: "SSH host", user: "SSH user", port: "SSH port", key: "Absolute private key path (optional)", remote: "Absolute remote file path", local: "Absolute local file path" })[field]}<input value={ssh[field]} onChange={e => setSsh({ ...ssh, [field]: e.target.value })} /></label>)}</div>
        {(["upload", "download"] as const).map(direction => <button key={direction} disabled={busy} onClick={() => {
          if (!window.confirm(`${direction === "upload" ? "Upload to remote" : "Download to local"} file? This may overwrite the destination.`)) return;
          void run(async () => { const port = Number(ssh.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("SSH port must be between 1 and 65535"); const result = await invoke<string>("sftp_transfer", { ...ssh, port, direction, key: ssh.key || null }); setMessage(result); });
        }}>{direction === "upload" ? "Upload via SFTP" : "Download via SFTP"}</button>)}
      </>}
    </details>
    {busy && <p role="status">Working…</p>}{error && <p role="alert" className="file-error">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}

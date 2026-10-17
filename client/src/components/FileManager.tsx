import { useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import { AgentClient } from "../lib/api";
import { fmtBytes, type Server } from "../lib/types";
import "./FileManager.css";

interface Entry { name: string; kind: string; size: number; mode: string }
const desktop = () => "__TAURI_INTERNALS__" in window;

export function FileManager({ server }: { server: Server }) {
  const [path, setPath] = useState("/tmp");
  const [directory, setDirectory] = useState("/tmp");
  const listingRequest = useRef(0);
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
      ...init, headers: { Authorization: `Bearer ${server.token}`, ...init?.headers }, signal: AbortSignal.timeout(60000),
    });
    if (!response.ok) throw new Error(`HTTP ${response.status}: ${(await response.text()).slice(0, 300)}`);
    return response;
  }
  async function run(action: () => Promise<void>) {
    if (busy) return;
    setBusy(true); setError(""); setMessage("");
    try { await action(); } catch (e) { setError(String(e)); } finally { setBusy(false); }
  }
  async function list(target = directory) {
    if (!target.startsWith("/")) throw new Error("Gunakan path direktori absolut, misalnya /opt/vps-agent.");
    const generation = ++listingRequest.current;
    const data = await (await request(`?path=${encodeURIComponent(target)}`)).json() as { path: string; entries: Entry[] };
    if (generation !== listingRequest.current) return;
    setPath(data.path); setDirectory(data.path); setEntries(data.entries);
  }
  useEffect(() => {
    setEntries([]); setEditor(null); setPath("/tmp"); setDirectory("/tmp"); setError("");
    let current = true;
    const generation = ++listingRequest.current;
    request("?path=%2Ftmp").then(r => r.json()).then((data: { entries: Entry[] }) => { if (current && generation === listingRequest.current) setEntries(data.entries); }).catch(e => { if (current && generation === listingRequest.current) setError(String(e)); });
    return () => { current = false; };
  }, [server.id, server.host, server.port, server.token]);
  const child = (name: string) => `${directory.replace(/\/+$/, "")}/${name}`;
  async function upload(files: File[]) {
    if (!files.length) return;
    if (!window.confirm(`Upload ${files.length} file ke ${directory}? File yang diganti akan dicadangkan terlebih dahulu.`)) return;
    await run(async () => {
      const body = new FormData();
      for (const file of files) body.append("file", file);
      await request(`/upload?path=${encodeURIComponent(directory)}`, { method: "POST", body });
      await list(); setMessage("Upload selesai. File yang diganti sudah dicadangkan di server.");
    });
  }
  async function edit(file: string) {
    if (editor && editor.content !== original && !window.confirm("Buang perubahan yang belum disimpan?")) return;
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
    <h2>File — {server.name}</h2>
    <p>Akses file agent memerlukan token admin. Editor teks dibatasi 2 MB. Direktori yang dapat ditulis mengikuti batas service systemd.</p>
    <form className="file-toolbar" onSubmit={e => { e.preventDefault(); void run(() => list(path)); }}>
      <label>Direktori VPS<input disabled={busy} value={path} onChange={e => setPath(e.target.value)} /></label>
      <button disabled={busy}>Buka</button>
      <button type="button" disabled={busy} onClick={() => void run(() => list(directory.replace(/\/[^/]+\/?$/, "") || "/"))}>Direktori atas</button>
      <label className="file-upload">Upload<input type="file" multiple disabled={busy} onChange={e => { void upload(Array.from(e.target.files ?? [])); e.target.value = ""; }} /></label>
    </form>
    <div className="file-drop" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); void upload(Array.from(e.dataTransfer.files)); }}>
      <p>Direktori terbuka: <code>{directory}</code>. Tarik file ke sini untuk mengunggah.</p>
      <table><thead><tr><th>Nama</th><th>Ukuran</th><th>Mode</th><th>Aksi</th></tr></thead><tbody>
        {entries.map(entry => <tr key={entry.name}><td>{entry.kind === "dir" ? <button disabled={busy} onClick={() => void run(() => list(child(entry.name)))}>{entry.name}/</button> : entry.name}</td><td>{fmtBytes(entry.size)}</td><td>{entry.mode}</td><td>{entry.kind === "file" && <><button disabled={busy || entry.size > 2 * 1024 * 1024} onClick={() => void edit(child(entry.name))}>Edit</button> <button disabled={busy} onClick={() => void download(child(entry.name))}>Download</button></>}</td></tr>)}
      </tbody></table>
      {!entries.length && <p>Belum ada file yang dimuat.</p>}
    </div>
    {editor && <section><h3>{editor.path}</h3><label>Isi teks<textarea disabled={busy} spellCheck={false} value={editor.content} onChange={e => setEditor({ ...editor, content: e.target.value })} /></label>
      <button disabled={busy || editor.content === original} onClick={() => {
        if (!window.confirm(`Simpan ${editor.path}? Server akan membuat backup sebelum mengganti file lama.`)) return;
        void run(async () => { const result = await (await request("/write", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(editor) })).json() as { backup?: string }; setOriginal(editor.content); setMessage(`Tersimpan. Backup: ${result.backup || "file lama disimpan sebagai *.vps-backup-* di direktori yang sama"}`); await list(); });
      }}>Simpan dengan backup</button> <button disabled={busy} onClick={() => { if (editor.content === original || window.confirm("Buang perubahan yang belum disimpan?")) setEditor(null); }}>Tutup editor</button>
    </section>}
    <details><summary>SFTP desktop (SSH key atau SSH agent)</summary>
      {!desktop() ? <p>SFTP memerlukan aplikasi desktop dan Windows OpenSSH Client.</p> : <>
        <p>Akses SSH memakai kredensial terpisah dari token agent. Hubungkan dahulu melalui <code>ssh -p PORT USER@HOST</code>, periksa fingerprint server, lalu simpan ke known_hosts. Key terenkripsi perlu dimuat ke SSH agent. Koneksi menolak host key yang belum dikenal atau berubah.</p>
        <p>Transfer SFTP mengganti file tujuan setelah transfer selesai dan tidak membuat backup agent. Gunakan editor di atas untuk perubahan dengan backup.</p>
        <div className="file-ssh-fields">{(Object.keys(ssh) as (keyof typeof ssh)[]).map(field => <label key={field}>{({ host: "Host SSH", user: "Pengguna SSH", port: "Port SSH", key: "Path absolut private key (opsional)", remote: "Path absolut file di VPS", local: "Path absolut file lokal" })[field]}<input disabled={busy} value={ssh[field]} onChange={e => setSsh({ ...ssh, [field]: e.target.value })} /></label>)}</div>
        {(["upload", "download"] as const).map(direction => <button key={direction} disabled={busy} onClick={() => {
          if (!window.confirm(`${direction === "upload" ? "Upload ke VPS" : "Download ke komputer"}? File tujuan yang ada akan diganti.`)) return;
          void run(async () => { const port = Number(ssh.port); if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error("Port SSH harus antara 1 dan 65535"); const result = await invoke<string>("sftp_transfer", { ...ssh, port, direction, key: ssh.key || null }); setMessage(result); });
        }}>{direction === "upload" ? "Upload via SFTP" : "Download via SFTP"}</button>)}
      </>}
    </details>
    {busy && <p role="status">Memproses…</p>}{error && <p role="alert" className="file-error">{error}</p>}{message && <p role="status">{message}</p>}
  </div>;
}

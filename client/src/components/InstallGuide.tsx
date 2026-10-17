import { useState } from "react";

export default function InstallGuide() {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [base, setBase] = useState("https://github.com/wignn/catly/releases/latest/download");
  const [message, setMessage] = useState("");
  const valid = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._~/-]*)?$/i.test(base);
  const url = base.replace(/\/+$/, "");
  const command = !valid ? "Isi URL rilis HTTPS untuk membuat perintah instalasi." : platform === "linux"
    ? `curl -fsSL '${url}/install.sh' | sudo bash -s -- --release-url '${url}'`
    : `$env:VPS_MANAGER_RELEASE_URL='${url}'; irm '${url}/install.ps1' | iex`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setMessage("Perintah disalin."); }
    catch { setMessage("Gagal menyalin. Pilih dan salin perintah secara manual."); }
  };
  return <section className="install panel" id="install-agent" aria-labelledby="install-title">
    <div className="install-intro"><span className="install-icon" aria-hidden="true">›_</span><h2 id="install-title">Mulai dari satu perintah.</h2><p>Pasang agent di VPS Linux atau aplikasi desktop di Windows. Installer memverifikasi SHA-256 sebelum memasang paket.</p><p className="muted">Gunakan URL rilis dari penerbit yang kamu percaya.</p></div>
    <div className="install-controls"><div className="platforms" role="group" aria-label="Platform instalasi"><button className={platform === "linux" ? "selected" : ""} aria-pressed={platform === "linux"} onClick={() => { setPlatform("linux"); setMessage(""); }}>Linux agent <span>curl</span></button><button className={platform === "windows" ? "selected" : ""} aria-pressed={platform === "windows"} onClick={() => { setPlatform("windows"); setMessage(""); }}>Windows desktop <span>irm</span></button></div>
    <label className="release-label">URL folder rilis<input type="url" placeholder="https://github.com/wignn/catly/releases/latest/download" value={base} onChange={e => { setBase(e.target.value); setMessage(""); }} /></label>
    <div className="command-block"><pre><code>{command}</code></pre><button className="copy-btn" disabled={!valid} onClick={copy}>Salin</button></div><div className="install-caption" aria-live="polite">{message || (platform === "linux" ? "Jalankan di VPS Linux dengan systemd. Memerlukan sudo dan curl." : "Jalankan di PowerShell Windows x64. Wizard instalasi akan dibuka.")}</div></div>
  </section>;
}

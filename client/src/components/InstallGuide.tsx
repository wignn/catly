import { useState } from "react";

export default function InstallGuide() {
  const [platform, setPlatform] = useState<"linux" | "windows">("linux");
  const [base, setBase] = useState("https://github.com/wignn/catly/releases/latest/download");
  const [message, setMessage] = useState("");
  const valid = /^https:\/\/[a-z0-9.-]+(?::\d+)?(?:\/[a-z0-9._~/-]*)?$/i.test(base);
  const url = base.replace(/\/+$/, "");
  const command = !valid ? "Enter an HTTPS release URL to generate the installation command." : platform === "linux"
    ? `curl -fsSL '${url}/install.sh' | sudo bash -s -- --release-url '${url}'`
    : `$env:VPS_MANAGER_RELEASE_URL='${url}'; irm '${url}/install.ps1' | iex`;
  const copy = async () => {
    try { await navigator.clipboard.writeText(command); setMessage("Command copied."); }
    catch { setMessage("Could not copy. Select and copy the command manually."); }
  };
  return <section className="install panel" id="install-agent" aria-labelledby="install-title">
    <div className="install-intro"><span className="install-icon" aria-hidden="true">›_</span><h2 id="install-title">Start with one command.</h2><p>Install the agent on a Linux VPS or the desktop app on Windows. The installer verifies SHA-256 before installing the package.</p><p className="muted">Use a release URL from a publisher you trust.</p></div>
    <div className="install-controls"><div className="platforms" role="group" aria-label="Installation platform"><button className={platform === "linux" ? "selected" : ""} aria-pressed={platform === "linux"} onClick={() => { setPlatform("linux"); setMessage(""); }}>Linux agent <span>curl</span></button><button className={platform === "windows" ? "selected" : ""} aria-pressed={platform === "windows"} onClick={() => { setPlatform("windows"); setMessage(""); }}>Windows desktop <span>irm</span></button></div>
    <label className="release-label">Release folder URL<input type="url" placeholder="https://github.com/wignn/catly/releases/latest/download" value={base} onChange={e => { setBase(e.target.value); setMessage(""); }} /></label>
    <div className="command-block"><pre><code>{command}</code></pre><button className="copy-btn" disabled={!valid} onClick={copy}>Copy</button></div><div className="install-caption" aria-live="polite">{message || (platform === "linux" ? "Run on a Linux VPS with systemd. Requires sudo and curl." : "Run in Windows x64 PowerShell. The installation wizard will open.")}</div></div>
  </section>;
}

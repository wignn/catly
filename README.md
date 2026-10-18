# VPS Manager

Windows desktop console for managing VPS connections, monitoring resources, and opening multi-tab terminals with split panels. The client is built with Tauri, React, and TypeScript; the agent is written in Rust.

## Installation

Binaries, installers, and checksums are published via [Catly GitHub Releases](https://github.com/wignn/catly/releases) by CI/CD (see [release guide](docs/RELEASING.md)). The URLs below point to the latest release and are available after the first `v*` tag is successfully built and published.

### Linux Agent

Linux with systemd, `curl`, and coreutils. The x86_64 binary requires glibc 2.35+ (Ubuntu 22.04+); aarch64 requires glibc 2.39+ (Ubuntu 24.04+).

```bash
curl -fsSL https://github.com/wignn/catly/releases/latest/download/install.sh | sudo bash
```

The installer detects architecture, verifies the SHA-256 checksum, installs the binary to `/opt/vps-agent/vps-agent` with a symlink at `/usr/local/bin/vps-agent`, then enables and starts the `vps-agent` service automatically on boot. Fresh installations automatically detect an active Tailscale IP; if unavailable, the agent defaults to `127.0.0.1:18710`. During upgrades, existing tokens and bind addresses are preserved.

To install a specific version, use matching URLs for both the script and binary:

```bash
RELEASE_URL='https://github.com/wignn/catly/releases/download/v0.1.0'
curl -fsSL "$RELEASE_URL/install.sh" | sudo bash -s -- --release-url "$RELEASE_URL"
```

To connect the client over Tailscale, edit `/etc/vps-agent/environment`:

```ini
VPS_AGENT_BIND=100.64.0.12:18710
```

Use your VPS Tailscale IP, then run `sudo systemctl restart vps-agent`. Check service status with `sudo systemctl status vps-agent` and logs with `sudo journalctl -u vps-agent -n 50`.

### Windows Application

Windows x64 with WebView2. Run in PowerShell:

```powershell
irm https://github.com/wignn/catly/releases/latest/download/install.ps1 | iex
```

The installer downloads the MSI, verifies SHA-256, and launches the setup wizard. If cancelled, it reports failure without claiming a successful installation. Equivalent `curl` and `irm` commands are also available on the Servers page with Catly URLs as default. To choose a different version, set `$env:VPS_MANAGER_RELEASE_URL` to that version's release folder before running the script from the same folder.

Only run scripts from publishers you trust. To review scripts before running them, download `install.sh` or `install.ps1` from the release folder, inspect the contents, and run them locally. Checksums from the same server detect download corruption; they are not publisher signatures.

## Usage

1. Install the agent on the VPS and set a bind address accessible via a private network or HTTPS reverse proxy.
2. Open the app, then enter the name, address, port, and agent token on the **Servers** page.
3. Click **Test connection** to verify authentication.
4. Open **Dashboard** for realtime CPU, RAM, swap, disk, and network metrics, or **Terminal** for an interactive shell.

Desktop profiles are stored in SQLite; tokens are stored in Windows Credential Manager. Legacy SQLite tokens are migrated after secure storage verification succeeds. Browser mode stores profiles in localStorage and tokens only in page memory: after reloading, re-enter tokens via **Edit**. The agent provides shell access as root; use Tailscale or an HTTPS reverse proxy. The service restricts filesystem writes via systemd; write operations outside permitted directories require service unit adjustments.

## Core & Advanced Features (v1.0.0)

- **Multi-Server Broadcast Terminal:** Broadcast keystrokes and shell commands simultaneously across split panes to multiple VPS nodes at once. Features a glowing broadcast safety indicator and dedicated command broadcast bar.
- **Docker Container Manager:** List containers, inspect status and ports, start, stop, restart, and inspect recent container logs directly from the console.
- **Persistent View State:** Instant zero-refresh navigation between Terminal, Dashboard, Server List, Manage VPS, and File Manager without losing running terminal processes, WebSocket connections, or form state.
- **Servers:** Edit profiles, test connection with timeout and target URL, view current status, agent version, latency, and last connection timestamp. Network diagnostics display clear verification steps without guessing firewall/CORS issues.
- **Monitoring:** CPU/RAM/network history up to seven days, 1h/24h/7d charts, and alerts for CPU/RAM/disk ≥90%, offline server, or failed services. Windows notifications use the official Tauri plugin and require opt-in. Sampling and notifications run while the app is open; no data is sent to third-party services.
- **VPS Management → Services & logs:** Search systemd services, start/stop/restart with confirmation, and stream/search live logs (up to 1,000 recent lines).
- **Files:** Directory navigation, uploads with drag-and-drop support, downloads, and text editing up to 2 MB. Existing files are backed up as `*.vps-backup-*` before replacement. Agent writes require directories owned by the agent user without group/other write permissions; use SFTP for directories owned by other users. Access restrictions also follow systemd unit settings.
- **Desktop SFTP:** Transfers via Windows OpenSSH Client using SSH keys or SSH agent. Connect via `ssh -p PORT USER@HOST` first to inspect fingerprints and store host keys. Encrypted keys must be loaded in the SSH agent. SFTP writes to temporary files before atomic replacement and does not create agent backups; servers without rename replacement support may reject overwrites.
- **Agent Updates:** Check Catly versions, request latest stable updates, or rollback to the previous binary. The systemd updater verifies SHA-256 and architecture, and automatically restores the previous binary if health checks fail.
- **Security:** Rotate admin tokens, create monitoring-only read-only tokens, and audit operations. Read-only tokens cannot open terminals/logs, read files, or execute commands. Rotated tokens immediately revoke REST access and active WebSocket sessions. Session audit log is capped at 200 entries and never logs command contents or tokens.

Tailscale must be pre-installed and authenticated on both VPS and Windows. The installer does not register devices with Tailscale accounts or open public firewalls. If legacy configurations still use loopback, explicitly update the bind address as shown above.

## Development

Client prerequisites: Node.js 20.19+ or 22.12+, Rust stable, and [Tauri prerequisites](https://v2.tauri.app/start/prerequisites/) for Windows (C++ build tools and WebView2).

```powershell
cd client
npm install
cargo install tauri-cli --version "^2" --locked
npm run dev
npm run build
npm run tauri dev
npm run tauri build
```

If sandbox restrictions affect the esbuild config loader, use `npm run build -- --configLoader runner`. Frontend build artifacts are in `client/dist`; Windows packages are in `client/src-tauri/target/release/bundle/msi/`.

Build the agent on Linux:

```bash
cd agent
cargo build --release --locked
sudo bash install.sh ./target/release/vps-agent
```

## Verification

```powershell
cd client
npm run build
cd ..
powershell -NoProfile -ExecutionPolicy Bypass -File e2e/install-check.ps1
node e2e/agent-client-check.mjs
node client/src/lib/db.test.mjs
```

UI verification without extra dependencies requires Node.js 22+ (global WebSocket), the client dev server running on port 1420, and Chrome with remote debugging on port 9223. Run Chrome using a dedicated test profile:

```powershell
& 'C:/Program Files/Google/Chrome/Application/chrome.exe' --headless=new --remote-debugging-port=9223 --user-data-dir="$PWD/.browser-test/chrome" about:blank
# In another terminal from the repository root:
node e2e/ui-check.mjs
```

This verification exercises profile creation and persistence, search filtering, storage failure handling, installer command generation, responsive mobile layout, simulated metrics and disconnect state, as well as terminal split panels. Screenshots are saved to `.browser-test/`. This test suite does not replace terminal testing against a real Linux agent.

## Structure

| Directory | Contents |
| --- | --- |
| `agent/` | Rust service, REST API, WebSocket metrics and PTY, Linux installer |
| `client/` | Tauri application, React, TypeScript |
| `docs/` | [Protocol contract](docs/AGENT_PROTOCOL.md) and release guide |
| `e2e/` | UI and installer verification tests |

Process and network APIs are available on the agent. The UI includes server profiles, dashboard, terminal, monitoring, services/logs, files/SFTP, update/rollback, and security management.

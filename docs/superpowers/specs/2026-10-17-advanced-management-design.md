# Advanced VPS management

User authorization: implement all eight features proposed in the conversation. Keep existing Rust agent and Tauri/React UI; preserve existing profiles, tokens, terminal and release pipeline.

1. Diagnose connection attempts with target URL, timeout, authentication failures, latency and actionable network/bind/HTTPS guidance. Do not pretend a browser network error distinguishes firewall from stopped agent.
2. Installer detects an existing Tailscale IPv4 on fresh installations; explicit bind takes priority and upgrades preserve existing bind. No automatic public bind or firewall changes. Document installing/authenticating Tailscale separately.
3. Edit saved profiles; show last successful connection, agent version and latency.
4. Service view lists/searches systemd services, supports confirmed start/stop/restart, status refresh and searchable live logs using existing endpoints.
5. File manager browses agent files, uploads/downloads including drag/drop, edits text with backup before replacement. Native SFTP is additionally available using installed OpenSSH, existing SSH key/agent and strict host key checking. SSH credentials are distinct from agent tokens. Unsupported browser-native operations must explain the desktop requirement.
6. History charts use existing metric samples with bounded retention. Application-visible alerts for offline, high CPU/RAM, low disk and failed services; desktop notifications only after opt-in and while application runs. No messaging third parties or external service setup.
7. Update UI checks fixed Catly GitHub release; installed Linux updater validates architecture and SHA-256, preserves previous binary, restarts and automatically restores previous binary if health fails. Updates run via a separate systemd unit, never arbitrary shell supplied by caller. Explicit rollback offered. Preserve token/bind.
8. Desktop tokens migrate to Windows Credential Manager, never silently fall back to plaintext in Tauri. Browser development uses explicit session-only secrets. Agent supports rotating admin token, separate read-only token with restricted endpoints and no terminal/exec/file reads, safe audit entries for mutations without tokens or command contents.

Implementation calls: OpenSSH rather than new SFTP library; OS credential APIs rather than new service; UI and local history instead of Netdata integration; existing visual style. These are implementation defaults, not extra user requirements. New dependencies only if platform feature cannot reasonably be used directly.

Validation: built-in assert/Node checks, frontend build, Rust unit checks, Linux systemd integration in CI, installer checks and review of security boundaries. Do not claim Windows native or Linux runtime verification without actually running it.

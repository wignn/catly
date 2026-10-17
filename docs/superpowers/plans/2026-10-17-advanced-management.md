# Advanced Management Implementation Plan

> **For agentic workers:** Use superpowers:subagent-driven-development to execute independent tasks, then integrate and review.

**Goal:** Deliver all eight advanced management capabilities with working UI, safe native boundaries and regression checks.

**Architecture:** Extend existing agent APIs, React components and native Tauri commands. Native OpenSSH handles SFTP, OS credentials hold desktop secrets, and a separate systemd service handles safe update/rollback.

**Tech Stack:** Rust, axum, systemd, OpenSSH, Tauri 2, React 18, TypeScript, Node built-in assertions.

**Spec:** ../specs/2026-10-17-advanced-management-design.md

## Global Constraints

- Preserve saved profiles, tokens and bind on upgrades; no public bind by default.
- Validate all native/network trust boundaries; never log tokens or arbitrary commands.
- No silent native secret downgrade; read-only token cannot obtain shell or file access.
- Keep existing UI and dependencies; bounded files/history/logs.

## Review Focus

- Rotation must authenticate subsequent REST and WebSocket requests with current token.
- Failed credential migration must retain original data and fail visibly.
- File saves/uploads preserve originals on failure and reject symlink attacks.
- Update failure restores working executable and reports actual outcome.
- Browser fetch errors must not be presented as a proven remote diagnosis.

### Task 1: Agent and installer

Files: agent/src/main.rs, agent/src/ops.rs, agent/src/security.rs, agent/src/maintenance.rs, agent/install.sh, agent/update.sh, e2e/linux-install-check.sh.

- [x] Add regression checks for access policy, rotation, service validation and update rollback.
- [x] Add restricted read-only token, rotation, audit, diagnostics and maintenance endpoints.
- [x] Add Tailscale discovery and installer-generated update/rollback unit.
- [ ] Run Linux integration in CI (local Linux cross-check passed).

### Task 2: Connection and monitoring UI

Files: client/src/lib/api.ts, client/src/components/ServerList.tsx, client/src/components/Dashboard.tsx, client/src/lib/monitoring.ts, client/src/components/Monitoring.tsx, e2e/agent-client-check.mjs.

- [x] Write failing network/auth/alert checks.
- [x] Add diagnostics, edit profiles, last seen/version/latency.
- [x] Add bounded history charts, alerts and opt-in notifications.
- [x] Run Node checks and frontend build.

### Task 3: Native secrets and files

Files: client/src-tauri/src/main.rs, client/src-tauri/src/credentials.rs, client/src-tauri/src/sftp.rs, client/src/lib/db.ts, client/src/components/FileManager.tsx.

- [x] Add native credential and SFTP validation tests.
- [x] Migrate tokens safely to OS credentials and handle failure without data loss.
- [x] Implement agent file browser and strict OpenSSH SFTP transfers, safe editing and upload/download.
- [x] Run available native checks and frontend build.

### Task 4: Integration, services, security and release

Files: client/src/components/Operations.tsx, client/src/App.tsx, client/src/lib/types.ts, client/src/styles.css, README.md, docs/AGENT_PROTOCOL.md, .github/workflows/release.yml.

- [x] Integrate navigation and shared API contracts.
- [x] Add service/search/live logs, fixed-origin update/rollback and security UI.
- [x] Wire regression checks into CI, document operating limits.
- [x] Run integrated checks, review changes and fix findings before completion.

// Run as root after linux-install-check.sh on a disposable CI system.
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const base = 'http://127.0.0.1:18711';
const admin = (await readFile('/etc/vps-agent/token', 'utf8')).trim();
const readonly = (await readFile('/etc/vps-agent/readonly-token', 'utf8')).trim();
const sockets = [];
async function connect(path, token) {
  const ws = new WebSocket(`${base.replace('http:', 'ws:')}${path}?token=${encodeURIComponent(token)}&unit=vps-agent.service`);
  sockets.push(ws);
  await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('WebSocket connection timed out')), 5000);
    ws.onopen = () => { clearTimeout(timer); resolve(); };
    ws.onerror = () => { clearTimeout(timer); reject(Error(`WebSocket connection failed: ${path}`)); };
  });
  return ws;
}
try {
  const privileged = await Promise.all(['/ws/metrics', '/ws/logs', '/ws/pty'].map(path => connect(path, admin)));
  const viewer = await connect('/ws/metrics', readonly);
  const terminal = privileged[2];
  let output = '';
  terminal.addEventListener('message', event => {
    const message = JSON.parse(event.data);
    if (message.t === 'output') output += message.data;
  });
  const latencies = [];
  for (let i = 0; i < 12; i++) {
    const payload = `ordered_${i}_${'abcdefghijklmnopqrstuvwxyz'.repeat(8)}`;
    const expected = `\x1e${payload}\x1f`;
    const started = performance.now();
    const echoed = new Promise((resolve, reject) => {
      const timer = setTimeout(() => { terminal.removeEventListener('message', check); reject(Error('Terminal input was reordered or stalled')); }, 3000);
      function check() { if (output.includes(expected)) { clearTimeout(timer); terminal.removeEventListener('message', check); resolve(); } }
      terminal.addEventListener('message', check);
    });
    // Separate frames reproduce typing/paste bursts while metrics are streaming.
    for (const data of `printf '\\036%s\\037\\n' '${payload}'\r`) terminal.send(JSON.stringify({t:'input', data}));
    await echoed;
    latencies.push(performance.now() - started);
  }
  latencies.sort((a, b) => a - b);
  assert.ok(latencies[6] < 500, `Local terminal median round trip exceeded 500ms: ${latencies[6]}`);
  console.log(`PASS: ordered terminal input with concurrent metrics; median ${latencies[6].toFixed(1)}ms`);
  const closed = privileged.map(ws => new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(Error('Rotated admin token retained an active socket')), 5000);
    ws.onclose = () => { clearTimeout(timer); resolve(); };
  }));
  const response = await fetch(`${base}/api/security/rotate`, {
    method: 'POST', headers: {Authorization: `Bearer ${admin}`, 'Content-Type': 'application/json'},
    body: JSON.stringify({kind: 'admin'}),
  });
  assert.equal(response.status, 200);
  const {token} = await response.json();
  assert.equal((await fetch(`${base}/api/info`, {headers: {Authorization: `Bearer ${admin}`}})).status, 401);
  assert.equal((await fetch(`${base}/api/info`, {headers: {Authorization: `Bearer ${token}`}})).status, 200);
  await Promise.all(closed);
  assert.equal(viewer.readyState, WebSocket.OPEN, 'Admin rotation must preserve the separate readonly session');
  assert.equal((await readFile('/etc/vps-agent/token', 'utf8')).trim(), token);
  console.log('PASS: active metrics/log/PTY sessions revoked on admin rotation; independent viewer and persisted token preserved');
} finally { for (const ws of sockets) ws.close(); }

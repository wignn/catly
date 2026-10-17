import assert from 'node:assert/strict';
import { mkdir, writeFile } from 'node:fs/promises';

// Run Chrome with --headless=new --remote-debugging-port=9223, then node e2e/ui-check.mjs.
const targets = await fetch('http://127.0.0.1:9223/json/list').then(r => r.json());
const target = targets.find(t => t.type === 'page');
assert(target, 'Open a Chrome page with remote debugging on port 9223.');
const ws = new WebSocket(target.webSocketDebuggerUrl);
await new Promise((resolve, reject) => { ws.onopen = resolve; ws.onerror = reject; });
let seq = 0;
const pending = new Map();
ws.onmessage = ({ data }) => {
  const msg = JSON.parse(data);
  if (!msg.id) return;
  const p = pending.get(msg.id);
  if (!p) return;
  clearTimeout(p.timer); pending.delete(msg.id);
  msg.error ? p.reject(new Error(msg.error.message)) : p.resolve(msg.result);
};
const call = (method, params = {}) => new Promise((resolve, reject) => {
  const id = ++seq;
  const timer = setTimeout(() => { pending.delete(id); reject(new Error(`Timeout: ${method}`)); }, 15000);
  pending.set(id, { resolve, reject, timer }); ws.send(JSON.stringify({ id, method, params }));
});
const evaluate = async expression => {
  const r = await call('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true });
  if (r.exceptionDetails) throw new Error(r.exceptionDetails.text);
  return r.result.value;
};
const waitFor = async expression => {
  for (let i=0; i<200; i++) { if (await evaluate(expression)) return; await new Promise(r=>setTimeout(r,100)); }
  throw new Error(`Not ready: ${expression}`);
};
const click = selector => evaluate(`document.querySelector(${JSON.stringify(selector)}).click()`);
const fill = (selector, value) => evaluate(`(() => {const el=document.querySelector(${JSON.stringify(selector)}); Object.getOwnPropertyDescriptor(HTMLInputElement.prototype,'value').set.call(el,${JSON.stringify(value)}); el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
await mkdir('.browser-test', { recursive: true });
const screenshot = async name => {
  const { data } = await call('Page.captureScreenshot', { format: 'png', captureBeyondViewport: true });
  await writeFile(`.browser-test/${name}.png`, Buffer.from(data,'base64'));
};
try {
  await call('Page.enable');
  await call('Emulation.setDeviceMetricsOverride',{ width:1440,height:1000,deviceScaleFactor:1,mobile:false });
  await call('Page.navigate',{url:'http://127.0.0.1:1420'});
  await waitFor(`!!document.querySelector('.form')`);
  await evaluate('localStorage.clear()');
  await call('Page.reload');
  await waitFor(`!!document.querySelector('.empty h3')`);
  await screenshot('servers-empty');
  assert.equal(await evaluate(`document.querySelector('.form .primary').disabled`),true);
  await fill('.form label:nth-child(1) input','production-01');
  await fill('.form label:nth-child(2) input','100.64.0.12');
  await fill('.form label:nth-child(4) input','ui-test-token');
  await evaluate("window.restoreStorage = Storage.prototype.setItem; Storage.prototype.setItem = () => { throw new Error('quota'); }");
  await click('.form .primary');
  await waitFor("document.querySelector('[role=alert]')?.textContent.includes('belum tersimpan')");
  assert.equal(await evaluate("document.querySelectorAll('.server-row').length"),0,'Failed save must not create a server');
  await evaluate("Storage.prototype.setItem = window.restoreStorage");
  await click('.form .primary');
  await waitFor(`document.querySelector('.srv-name')?.textContent === 'production-01'`);
  await screenshot('servers-desktop');
  await fill('.search','no-match');
  await waitFor(`document.body.textContent.includes('Server tidak ditemukan')`);
  await fill('.search','');
  await fill('.release-label input','https://releases.example.com/v0.1.0');
  await waitFor(`!document.querySelector('.copy-btn').disabled`);
  assert.match(await evaluate(`document.querySelector('.command-block').textContent`),/curl -fsSL/);
  await click('.platforms button:nth-child(2)');
  assert.match(await evaluate(`document.querySelector('.command-block').textContent`),/irm .*install.ps1.*iex/);
  await fill('.release-label input',"https://evil.example/';whoami");
  await waitFor(`document.querySelector('.copy-btn').disabled`);
  await call('Emulation.setDeviceMetricsOverride',{width:390,height:844,deviceScaleFactor:1,mobile:false});
  assert.equal(await evaluate('document.documentElement.scrollWidth <= innerWidth'),true,'Mobile layout overflows');
  await screenshot('servers-mobile');
  await call('Emulation.setDeviceMetricsOverride',{width:1440,height:1000,deviceScaleFactor:1,mobile:false});
  await click('.side nav button:nth-child(2)');
  await waitFor(`!!document.querySelector('.connection-state')`);
  assert.equal(await evaluate(`document.querySelector('.connection-state').textContent.includes('Terhubung')`),false,'No fake online status');
  await screenshot('dashboard-disconnected');
  // Exercise metric rendering and stale status without requiring a live VPS.
  await click('.side nav button:nth-child(1)');
  await evaluate(`window.realWebSocket = window.WebSocket;
    window.WebSocket = class {
      static OPEN = 1;
      constructor() { window.metricSocket = this; }
      close() {}
    };`);
  await click('.side nav button:nth-child(2)');
  await waitFor('!!window.metricSocket?.onmessage');
  await evaluate(`(() => {
    const sample = { ts: Math.floor(Date.now()/1000), cpu:{total:23.5,per_core:[23.5]},
      mem:{used:2147483648,total:8589934592}, swap:{used:0,total:0},
      disks:[{mount:'/',used:10737418240,total:42949672960}],
      net:[{rx_rate:1024,tx_rate:512}], load:[0.42,0.3,0.2] };
    metricSocket.onmessage({data:JSON.stringify(sample)});
  })()`);
  await waitFor('document.querySelector(".connection-state").textContent.includes("Terhubung")');
  assert.match(await evaluate('document.querySelector(".metrics").textContent'), /CPU 23.5%/);
  assert.equal(await evaluate('document.querySelectorAll("[role=progressbar]").length'),3);
  await screenshot('dashboard-metrics');
  await evaluate('metricSocket.onclose()');
  await waitFor('document.querySelector(".connection-state").textContent.includes("Terputus")');
  assert(await evaluate('!!document.querySelector(".card-err")'),'Stale data must display connection error');
  await evaluate('window.WebSocket = window.realWebSocket');
  await click('.side nav button:nth-child(3)');
  await click('.tabbar .btn');
  await waitFor(`document.querySelectorAll('.pane').length === 1`);
  await click('.tabbar > .btn:last-child');
  await waitFor(`document.querySelectorAll('.pane').length === 2`);
  await screenshot('terminal-split');
  // Verify the advanced UI against explicit agent responses, without touching a real VPS.
  await evaluate(`window.advancedFetch = window.fetch; window.advancedConfirm = window.confirm;
    window.confirm = () => true;
    window.fetch = async (input, init = {}) => {
      const url = new URL(String(input), location.href);
      const json = value => new Response(JSON.stringify(value), {headers:{'Content-Type':'application/json'}});
      if (url.pathname === '/api/services') return json({services:[{unit:'nginx.service',active:'active',sub:'running',load:'loaded',description:'Web server'}]});
      if (url.pathname === '/api/services/action') {window.lastServiceAction=JSON.parse(init.body);return json({ok:true});}
      if (url.pathname === '/api/diagnostics') return json({bind:'100.64.0.12:18710',tailscale_ip:'100.64.0.12',agent_version:'0.2.0',role:'admin'});
      if (url.pathname === '/api/update/status') return json({installed_version:'0.2.0',state:'updated',rollback_available:true});
      if (url.hostname === 'api.github.com') return json({tag_name:'v0.2.0'});
      if (url.pathname === '/api/security/audit') return json({entries:[{ts:1792224000,method:'POST',path:'/api/services/action',status:200,role:'admin'}]});
      if (url.pathname === '/api/files') {
        if (window.deferInitialListing && url.searchParams.get('path') === '/tmp') { window.deferInitialListing=false; await new Promise(resolve => {window.releaseInitialListing=resolve;}); }
        return json({path:url.searchParams.get('path'),entries:[{name:'config.txt',kind:'file',size:6,mode:'600'}]});
      }
      if (url.pathname === '/api/files/read') return json({path:'/tmp/config.txt',content:'before'});
      if (url.pathname === '/api/files/write') {window.lastFileWrite=JSON.parse(init.body);return json({ok:true,backup:'/tmp/config.txt.vps-backup-test'});}
      return window.advancedFetch(input, init);
    };`);
  await click('.side nav button:nth-child(5)');
  await click('.operations .operation-section .section-heading button');
  await waitFor(`document.querySelector('.operations tbody')?.textContent.includes('nginx.service')`);
  await click('.operations tbody .row-actions button:nth-child(3)');
  await waitFor(`window.lastServiceAction?.action === 'restart'`);
  await fill('.operations input[type=search]', 'missing-service');
  assert.equal(await evaluate(`document.querySelectorAll('.operations tbody tr').length`),0);
  await fill('.operations input[type=search]', '');
  await evaluate(`window.operationWebSocket=window.WebSocket;window.WebSocket=class {constructor(){window.logSocket=this;} close(){}};`);
  await click('.operations .operation-toolbar button');
  await waitFor(`!!window.logSocket?.onmessage`);
  await evaluate(`window.logSocket.onmessage({data:JSON.stringify({t:'line',data:'nginx: test service started'})})`);
  assert.match(await evaluate(`document.querySelector('.operations .log-output').textContent`),/nginx: test service started/);
  assert.doesNotMatch(await evaluate(`document.querySelector('.operations .log-output').textContent`),/"t":"line"/);
  await evaluate(`window.WebSocket=window.operationWebSocket`);
  await screenshot('operations-services');
  await click('.operations > .platforms button:nth-child(2)');
  await click('.operations .operation-section .section-heading button');
  await waitFor(`document.querySelector('.status-grid')?.textContent.includes('100.64.0.12:18710')`);
  await screenshot('operations-update');
  await click('.operations > .platforms button:nth-child(3)');
  await click('.operations .operation-body .row-actions button:nth-child(3)');
  await waitFor(`document.querySelector('.operations tbody')?.textContent.includes('/api/services/action')`);
  await screenshot('operations-security');
  await click('.side nav button:nth-child(6)');
  await waitFor(`document.querySelector('.file-manager tbody')?.textContent.includes('config.txt')`);
  await fill('.file-toolbar input', '/opt/typed-but-not-opened');
  await click('.file-manager tbody button');
  await waitFor(`!!document.querySelector('.file-manager textarea')`);
  await evaluate(`(() => {const el=document.querySelector('.file-manager textarea');Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype,'value').set.call(el,'after');el.dispatchEvent(new Event('input',{bubbles:true}));})()`);
  await click('.file-manager section button');
  await waitFor(`window.lastFileWrite?.content === 'after'`);
  assert.equal(await evaluate(`window.lastFileWrite.path`),'/tmp/config.txt');
  await screenshot('files-editor');
  await click('.side nav button:nth-child(4)');
  await waitFor(`!!document.querySelector('.monitor-controls')`);
  await screenshot('monitoring-history');
  await click('.side nav button:nth-child(5)');
  await evaluate(`window.deferInitialListing=true;delete window.releaseInitialListing;`);
  await click('.side nav button:nth-child(6)');
  await waitFor(`typeof window.releaseInitialListing === 'function'`);
  await fill('.file-toolbar input', '/opt');
  await click('.file-toolbar button');
  await waitFor(`document.querySelector('.file-drop code')?.textContent === '/opt'`);
  await evaluate(`window.releaseInitialListing()`);
  await new Promise(resolve => setTimeout(resolve,100));
  assert.equal(await evaluate(`document.querySelector('.file-drop code').textContent`),'/opt','Late initial list must not override the selected directory');
  await evaluate('window.fetch = window.advancedFetch; window.confirm = window.advancedConfirm');
  await click('.side nav button:nth-child(1)');
  await waitFor(`!!document.querySelector('.srv-name')`);
  await call('Page.reload');
  await waitFor(`document.querySelector('.srv-name')?.textContent === 'production-01'`);
  console.log('PASS: profiles, safe installers, responsive layout, live/stale metrics, terminal split, service actions/search, maintenance, audit, file editing and monitoring.');
} catch (error) { console.error(await evaluate("document.body.innerText")); await screenshot("failure"); throw error; } finally { ws.close(); }

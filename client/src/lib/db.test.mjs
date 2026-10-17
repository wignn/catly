// Run from client: node src/lib/db.test.mjs
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import ts from "typescript";

const source = ts.transpileModule(fs.readFileSync(new URL("./db.ts", import.meta.url), "utf8"), {
  compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
}).outputText;
function setup({ native = false, load = async () => {}, invoke = async () => {}, stored = [] } = {}) {
  const storage = new Map([["vpsm.servers", JSON.stringify(stored)]]);
  const exports = {};
  vm.runInNewContext(source, {
    exports, window: native ? { __TAURI_INTERNALS__: {} } : {}, console,
    localStorage: { getItem: key => storage.get(key) ?? null, setItem: (key, value) => storage.set(key, value) },
    require: name => name === "@tauri-apps/plugin-sql" ? { default: { load }, __esModule: true } : { invoke },
  });
  return { api: exports, storage };
}
const profile = { id: "test", name: "Test", host: "localhost", port: 18710, token: "legacy-secret" };
{
  const { api, storage } = setup({ stored: [profile] });
  assert.equal((await api.loadServers())[0].token, profile.token);
  assert.equal(JSON.parse(storage.get("vpsm.servers"))[0].token, "");
  assert.equal((await api.loadServers())[0].token, profile.token);
  await api.saveServer({ ...profile, token: "new-secret" });
  assert.equal((await api.loadServers())[0].token, "new-secret");
  assert(!storage.get("vpsm.servers").includes("new-secret"));
  const fresh = setup({ stored: JSON.parse(storage.get("vpsm.servers")) });
  assert.equal((await fresh.api.loadServers())[0].token, "");
}
{
  const { api, storage } = setup({ native: true, stored: [profile], load: async () => { throw new Error("SQLite unavailable"); } });
  await assert.rejects(api.loadServers(), /Desktop storage unavailable/);
  assert.equal(JSON.parse(storage.get("vpsm.servers"))[0].token, profile.token);
}
{
  let cleared = false;
  const db = { execute: async sql => { if (sql.startsWith("UPDATE servers")) cleared = true; }, select: async () => [{ ...profile }] };
  const failed = setup({ native: true, load: async () => db, invoke: async () => { throw new Error("vault denied"); } });
  await assert.rejects(failed.api.loadServers(), /vault denied/);
  assert.equal(cleared, false);
  const mismatch = setup({ native: true, load: async () => db, invoke: async command => command === "credential_get" ? "wrong-token" : null });
  await assert.rejects(mismatch.api.loadServers(), /verification failed/);
  assert.equal(cleared, false);
  let vault = null;
  const verified = setup({ native: true, load: async () => db, invoke: async (command, args) => {
    if (command === "credential_set") vault = args.token;
    return command === "credential_get" ? vault : null;
  } });
  assert.equal((await verified.api.loadServers())[0].token, profile.token);
  assert.equal(cleared, true);
}
console.log("db secret migration checks passed");
{
  const { api, storage } = setup();
  const now = Math.floor(Date.now() / 1000);
  const rows = Array.from({ length: 5000 }, (_, index) => ({ server_id: "history", ts: now - (4999 - index) * 60, cpu: index % 100, mem_used: 10, mem_total: 100, rx_rate: 0, tx_rate: 0 }));
  storage.set("vpsm.metrics", JSON.stringify(rows));
  const sampled = await api.loadMetricHistory("history");
  assert.equal(sampled.length, 2000);
  assert.equal(sampled[0].ts, rows[0].ts);
  assert.equal(sampled.at(-1).ts, rows.at(-1).ts);
  await api.saveMetricSample("history", now, 99, 1, 2, 3, 4);
  const retained = JSON.parse(storage.get("vpsm.metrics"));
  assert(retained.length > 2000);
  assert.equal(retained.at(-1).cpu, 99);
}
console.log("history full-period sampling checks passed");

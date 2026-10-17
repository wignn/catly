import assert from 'node:assert/strict';
import { AgentClient } from '../client/src/lib/api.ts';
const client = new AgentClient({ id:'test', name:'test', host:'127.0.0.1', port:18710, token:'secret' }, undefined, 10);
const originalFetch = globalThis.fetch;
try {
  globalThis.fetch = async () => new Response('', {status:401});
  await assert.rejects(client.info(), /401.*token/i);
  globalThis.fetch = async () => new Response('', {status:403});
  await assert.rejects(client.info(), /403.*not authorized/);
  globalThis.fetch = async (_url, init) => {
    assert.equal(new Headers(init.headers).get('Authorization'), 'Bearer secret');
    return new Response('{"ok":true}', {status:200});
  };
  assert.deepEqual(await client.request('/api/info', {headers:new Headers({'authorization':'Bearer other'})}), {ok:true});
  globalThis.fetch = async () => { throw new TypeError('Failed to fetch'); };
  await assert.rejects(client.info(), error => /http:\/\/127.0.0.1:18710\/api\/info/.test(error.message) && /HTTPS|CORS/.test(error.message) && !/secret/.test(error.message));
  globalThis.fetch = (_url, init) => new Promise((_resolve, reject) => init.signal.addEventListener('abort', () => reject(init.signal.reason)));
  await assert.rejects(client.info(), /10 ms/);
} finally { globalThis.fetch = originalFetch; }
const { evaluateAlerts, mergeAlerts, pollInBatches } = await import('../client/src/lib/monitoring.ts');
let release;
const waiting = new Promise(resolve=>{release=resolve;});
const visited=[];
const polling=pollInBatches([0,1,2,3,4,5],async id=>{visited.push(id);if(id===0)await waiting;});
await new Promise(resolve=>setTimeout(resolve,0));
assert.deepEqual(visited,[0,1,2,3], 'one waiting host must not block other hosts in its batch');
release();await polling;
assert.deepEqual(visited,[0,1,2,3,4,5]);
const snapshot = {cpu:{total:95}, mem:{used:95,total:100}, disks:[{mount:'/',used:95,total:100}]};
const first = evaluateAlerts('s', snapshot, [{unit:'broken.service', active:'failed'}], false, 100);
assert.equal(first.length, 4);
assert.equal(mergeAlerts(first, first).length, 4);
assert.equal(mergeAlerts(first, [{...first[0],ts:200}])[0].ts, 200);
assert.equal(evaluateAlerts('s', {...snapshot,cpu:{total:1},mem:{used:1,total:100},disks:[]},[],false).length, 0);
assert.equal(evaluateAlerts('s', null, [], true, 100)[0].kind, 'offline');
assert.equal(mergeAlerts([], Array.from({length:150}, (_, i) => ({...first[0], id:String(i)}))).length, 100);
console.log('Agent network/auth/timeout and bounded alert checks passed.');

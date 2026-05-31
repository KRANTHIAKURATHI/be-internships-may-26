import test from 'node:test';
import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { setTimeout as wait } from 'node:timers/promises';
import http from 'node:http';

test('rate limit: allow 5 per minute, 6th is 429', async () => {
  const port = 9000 + Math.floor(Math.random() * 1000);
  const apiKey = `test-key-${Math.random().toString(36).slice(2)}`;
  const proc = spawn('node', ['src/server.js'], { env: { ...process.env, API_KEY: apiKey, PORT: String(port), RATE_LIMIT_PER_MIN: '5' } });
  await wait(300);

  const base = `http://localhost:${port}`;
  const statuses = [];
  for (let i=0;i<6;i++){
    const code = await postStatus(`${base}/v1/signals`, {
      headers: { 'x-api-key': 'k' },
      body: { userId: 'u1', type: 'note', payload: String(i) }
    });
    statuses.push(code);
  }
  const counts = statuses.reduce((acc,c)=> (acc[c]=(acc[c]||0)+1, acc), {});
  assert.ok(counts[200] >= 5);
  assert.ok(counts[429] >= 1);
  proc.kill();
});

async function postStatus(url, { headers, body }){
  return new Promise((resolve, reject) => {
    const data = JSON.stringify(body);
    const req = http.request(url, { method: 'POST', headers: { 'content-type': 'application/json', ...headers } }, (res) => {
      res.resume();
      res.on('end', () => resolve(res.statusCode));
    });
    req.on('error', reject);
    req.write(data); req.end();
  });
}

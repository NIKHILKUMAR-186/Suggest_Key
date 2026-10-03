/**
 * One-off DOM probe: asks the running page what it actually rendered.
 * Used to read state that only exists at runtime (which empty state, what text).
 */
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const CHROME = process.env.CHROME_PATH || 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const PORT = 9334;
const EXPR = process.argv[2] || 'document.title';
const profile = mkdtempSync(join(tmpdir(), 'lp-probe-'));
const chrome = spawn(
  CHROME,
  ['--headless=new', `--remote-debugging-port=${PORT}`, `--user-data-dir=${profile}`, '--no-first-run', '--disable-gpu', 'about:blank'],
  { stdio: 'ignore' },
);
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const cleanup = () => { try { chrome.kill(); } catch {} try { rmSync(profile, { recursive: true, force: true }); } catch {} };
process.on('exit', cleanup);

function cdp(ws) {
  return new Promise((res, rej) => { const s = new WebSocket(ws); s.onopen = () => res(s); s.onerror = rej; });
}
function send(ws, id, method, params) {
  return new Promise((res, rej) => {
    const on = (e) => { const m = JSON.parse(e.data); if (m.id !== id) return; ws.removeEventListener('message', on); m.error ? rej(new Error(JSON.stringify(m.error))) : res(m.result); };
    ws.addEventListener('message', on);
    ws.send(JSON.stringify({ id, method, params }));
    setTimeout(() => rej(new Error('timeout')), 30000);
  });
}

(async () => {
  for (let i = 0; i < 60; i++) { try { if ((await fetch(`http://127.0.0.1:${PORT}/json/version`)).ok) break; } catch {} await sleep(250); }
  const list = await (await fetch(`http://127.0.0.1:${PORT}/json/list`)).json();
  const ws = await cdp(list.find((t) => t.type === 'page').webSocketDebuggerUrl);
  await send(ws, 1, 'Emulation.setDeviceMetricsOverride', { width: 1440, height: 900, deviceScaleFactor: 1, mobile: false });
  await send(ws, 2, 'Page.navigate', { url: 'http://localhost:3000/' });
  await sleep(3500);
  const r = await send(ws, 3, 'Runtime.evaluate', { expression: EXPR, returnByValue: true, awaitPromise: true });
  console.log(typeof r.result.value === 'string' ? r.result.value : JSON.stringify(r.result.value, null, 2));
  ws.close(); cleanup(); process.exit(0);
})().catch((e) => { console.error('probe failed:', e.message); cleanup(); process.exit(1); });
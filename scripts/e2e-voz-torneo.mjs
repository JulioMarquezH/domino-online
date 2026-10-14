/**
 * The tournament's voice call with 4 real browsers (Chrome's fake mic):
 *  - the call is on from the tournament page,
 *  - it is NOT rebuilt when everybody walks into the match room and back,
 *  - each player's volume only changes that one person and is remembered after a reload,
 *  - opening a match room straight from its link still joins the call.
 *
 *   npm run e2e:voz      (builds first; starts its own server with a temporary database)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const OUT = 'e2e-artifacts';
mkdirSync(OUT, { recursive: true });
const log = (...a) => console.log(`[voz ${new Date().toISOString().slice(11, 19)}]`, ...a);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};

/** A "voice" for the fake mic: 220 Hz, 450 ms on / 350 ms off. */
function voiceWav(path) {
  const rate = 48000;
  const n = rate * 20;
  const buf = Buffer.alloc(44 + n * 2);
  buf.write('RIFF', 0);
  buf.writeUInt32LE(36 + n * 2, 4);
  buf.write('WAVEfmt ', 8);
  buf.writeUInt32LE(16, 16);
  buf.writeUInt16LE(1, 20);
  buf.writeUInt16LE(1, 22);
  buf.writeUInt32LE(rate, 24);
  buf.writeUInt32LE(rate * 2, 28);
  buf.writeUInt16LE(2, 32);
  buf.writeUInt16LE(16, 34);
  buf.write('data', 36);
  buf.writeUInt32LE(n * 2, 40);
  for (let i = 0; i < n; i++) {
    const v = (i / rate) % 0.8 < 0.45 ? Math.sin((2 * Math.PI * 220 * i) / rate) * 0.45 : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  writeFileSync(path, buf);
}

const dir = mkdtempSync(join(tmpdir(), 'domino-voz-'));
const wav = join(dir, 'voice.wav');
voiceWav(wav);
const port = await new Promise((res) => {
  const s = createServer().listen(0, '127.0.0.1', () => {
    const { port: p } = s.address();
    s.close(() => res(p));
  });
});
const BASE = `http://127.0.0.1:${port}`;
const server = spawn(process.execPath, ['server/dist/index.js'], {
  env: {
    ...process.env,
    NODE_ENV: 'development',
    PORT: String(port),
    DATABASE_PATH: join(dir, 'domino.db'),
    WEB_DIST: resolve('web/dist'),
  },
  stdio: ['ignore', 'ignore', 'inherit'],
});
for (let i = 0; i < 100; i++) {
  try {
    if ((await fetch(`${BASE}/healthz`)).ok) break;
  } catch {
    // starting
  }
  await new Promise((r) => setTimeout(r, 100));
}

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  headless: !process.env.E2E_HEADFUL,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const NAMES = ['Julio', 'Oscar', 'Jesus', 'Stephan'];
const players = [];
for (const name of NAMES) {
  const context = await browser.newContext({
    viewport: { width: 1200, height: 800 },
    permissions: ['microphone'],
  });
  await context.addInitScript(() => localStorage.setItem('domino:debug', '1'));
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`${name} pageerror`, e.message));
  players.push({ name, context, page });
}
const [julio] = players;
const stats = (p) => p.page.evaluate(() => window.__domino.voice.stats());
async function until(fn, ms, what) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const allConnected = (s) =>
  s.context === 'tournament' &&
  Object.keys(s.peers).length === 3 &&
  Object.values(s.peers).every((x) => x.state === 'connected');

try {
  // ── create the tournament and enter as the four players ──
  await julio.page.goto(BASE);
  await julio.page.getByRole('button', { name: 'Torneo' }).click();
  const inputs = julio.page.locator('.tournament-create input');
  for (const [i, n] of NAMES.entries()) await inputs.nth(i).fill(n);
  await julio.page.getByRole('button', { name: 'Continuar' }).click();
  await julio.page.getByRole('button', { name: 'Crear torneo' }).click();
  await julio.page.getByRole('heading', { name: 'Letras asignadas' }).waitFor({ timeout: 15000 });
  const tid = (await julio.page.locator('.reveal-share .t-id').textContent()).trim();
  const letters = Object.fromEntries(
    await julio.page
      .locator('.reveal-list li')
      .evaluateAll((lis) =>
        lis.map((li) => [
          li.querySelector('.reveal-name').textContent,
          li.querySelector('.letter-badge').textContent,
        ]),
      ),
  );
  await julio.page.getByRole('button', { name: 'Entrar al torneo' }).click();
  for (const p of players) {
    if (p !== julio) await p.page.goto(`${BASE}/torneo/${tid}`);
    await p.page.getByLabel('Tu nombre').fill(p.name);
    await p.page.getByRole('button', { name: 'Entrar al torneo' }).click();
    await p.page.locator('.t-call').waitFor();
  }
  log(`tournament ${tid}: ${JSON.stringify(letters)}`);

  // ── 1. the call is on in the tournament page ──
  for (const p of players)
    await until(async () => allConnected(await stats(p)), 30000, `${p.name} call`);
  const created = await Promise.all(players.map(async (p) => (await stats(p)).created));
  log(`tournament page: the 4 are in one call (6 connections up)`);
  await until(
    async () => {
      const n = await julio.page.locator('.t-call [data-speaking="true"]').count();
      return n >= 2;
    },
    15000,
    'speaking indicators in the tournament page',
  );
  await julio.page.screenshot({ path: `${OUT}/voz-01-tournament-call.png` });
  log('speaking indicators light up in the tournament page');

  // ── 2. volume: Julio turns Jesus down; nobody else changes ──
  const jesusId = `T:${letters.Jesus}`;
  const row = julio.page.locator('.t-call-row', { hasText: 'Jesus' });
  await row.locator('input[type="range"]').fill('30');
  let s = await stats(julio);
  assert(
    Math.abs(s.peers[jesusId].volume - 0.3) < 0.01,
    `Jesus at 30% (${s.peers[jesusId].volume})`,
  );
  for (const [id, x] of Object.entries(s.peers)) {
    if (id !== jesusId) assert(x.volume === 1 && !x.muted, `${id} untouched (${x.volume})`);
  }
  log('Julio lowered Jesus to 30%: Oscar and Stephan stay at 100%');

  // ── 3. into the match room: the call keeps going, no reconnection ──
  await julio.page.locator('.play-btn').click();
  await Promise.all(
    players.slice(1).map((p) => p.page.locator('.play-btn').click({ noWaitAfter: true })),
  );
  for (const p of players) await p.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  for (const p of players) await p.page.getByText(/Partido 1 de 12/).waitFor();
  await new Promise((r) => setTimeout(r, 2500));
  for (const [i, p] of players.entries()) {
    const st = await stats(p);
    assert(allConnected(st), `${p.name}: still connected in the room ${JSON.stringify(st)}`);
    assert(
      st.created === created[i],
      `${p.name}: no new connections (${created[i]} → ${st.created})`,
    );
  }
  s = await stats(julio);
  assert(Math.abs(s.peers[jesusId].volume - 0.3) < 0.01, 'Jesus is still at 30% in the room');
  await until(
    async () => (await julio.page.locator('.avatar[data-speaking="true"]').count()) >= 2,
    15000,
    'speaking indicators in the match room',
  );
  await julio.page.screenshot({ path: `${OUT}/voz-02-match-room.png` });
  log('match room: same call (no reconnection), Jesus still at 30%, avatars light up');

  // ── 4. back to the tournament page: still the same call ──
  for (const p of players) await p.page.getByRole('button', { name: 'Torneo' }).click();
  for (const p of players) await p.page.locator('.t-call').waitFor();
  await new Promise((r) => setTimeout(r, 2500));
  for (const [i, p] of players.entries()) {
    const st = await stats(p);
    assert(allConnected(st), `${p.name}: connected back in the tournament page`);
    assert(st.created === created[i], `${p.name}: still no reconnection (${st.created})`);
  }
  log('back to the tournament page: the call never dropped');

  // ── 5. reload: the call comes back and Jesus is still at 30% ──
  await julio.page.reload();
  await julio.page.locator('.t-call').waitFor();
  await until(async () => allConnected(await stats(julio)), 30000, 'call after reload');
  s = await stats(julio);
  assert(Math.abs(s.peers[jesusId].volume - 0.3) < 0.01, 'Jesus volume remembered after reload');
  log('after a reload the call is back and Jesus is still at 30%');

  // ── 6. a match room opened straight from its link joins the call ──
  await julio.page.locator('.play-btn').click();
  await julio.page.waitForURL(/\/sala\//);
  const roomUrl = julio.page.url();
  await players[1].page.goto(roomUrl);
  await players[1].page.getByText(/Partido 1 de 12/).waitFor();
  await until(
    async () => {
      const st = await stats(players[1]);
      return (
        st.context === 'tournament' && Object.values(st.peers).some((x) => x.state === 'connected')
      );
    },
    30000,
    'room link joins the tournament call',
  );
  log('a match room opened from its link is in the tournament call too');
  log('ALL CHECKS PASSED');
} finally {
  await browser.close();
  server.kill('SIGTERM');
  rmSync(dir, { recursive: true, force: true });
}

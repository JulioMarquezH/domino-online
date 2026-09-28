/**
 * End-to-end check with 4 real browser contexts (Playwright + Chrome's fake mic).
 * Run `npm run dev` first, then `npm run e2e`. Screenshots go to e2e-artifacts/.
 * Against a deployed build: BASE_URL=https://… npm run e2e
 *
 *   E2E_PAUSE=1      also runs the full 2-minute disconnection pause ("Esperar más")
 *   E2E_HEADFUL=1    shows the browsers
 *   E2E_CHANNEL=     browser channel (default: the installed Google Chrome)
 */
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = 'e2e-artifacts';
const NAMES = ['Ana', 'Beto', 'Caro', 'Dani'];
const log = (...a) => console.log(`[e2e ${new Date().toISOString().slice(11, 19)}]`, ...a);

await mkdir(OUT, { recursive: true });

/** A "voice" for the fake mic: a 220 Hz tone, 450 ms on / 350 ms off, 20 s long. */
async function writeVoiceWav(path) {
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
    const on = (i / rate) % 0.8 < 0.45;
    const v = on ? Math.sin((2 * Math.PI * 220 * i) / rate) * 0.45 : 0;
    buf.writeInt16LE(Math.round(v * 32767), 44 + i * 2);
  }
  await writeFile(path, buf);
}
const wav = resolve(OUT, 'voice.wav');
await writeVoiceWav(wav);

const browser = await chromium.launch({
  // Uses the installed Google Chrome (temporary profile). Set E2E_CHANNEL= to use Playwright's Chromium.
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  headless: !process.env.E2E_HEADFUL,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    `--use-file-for-fake-audio-capture=${wav}`,
    '--autoplay-policy=no-user-gesture-required',
    // Extra Chrome flags, e.g. E2E_ARGS='--host-resolver-rules=MAP example.com 1.2.3.4'
    ...(process.env.E2E_ARGS ? [process.env.E2E_ARGS] : []),
  ],
});

const phone = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};
const desktop = { viewport: { width: 1280, height: 760 } };
const players = [];
for (const [i, name] of NAMES.entries()) {
  const context = await browser.newContext({
    ...(i === 3 ? phone : desktop),
    permissions: ['microphone'],
  });
  await context.addInitScript(() => localStorage.setItem('domino:debug', '1'));
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`${name} pageerror`, e.message));
  players.push({ name, context, page });
}
const [ana] = players;

const view = (p) => p.page.evaluate(() => window.__domino.state().view);
async function until(fn, ms = 15000, what = 'condition') {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 150));
  }
}
const shot = (p, file) => p.page.screenshot({ path: `${OUT}/${file}.png` });

// ── home → create room ──
await ana.page.goto(BASE);
await ana.page.getByPlaceholder('¿Cómo te llaman en la mesa?').fill('Ana');
await ana.page.getByRole('button', { name: 'Crear sala' }).click();
await ana.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
const roomId = ana.page.url().split('/').pop();
log('room', roomId);

// ── others open the link ──
for (const p of players.slice(1)) {
  await p.page.goto(`${BASE}/sala/${roomId}`);
  await p.page.getByLabel('Tu nombre').fill(p.name);
  await p.page.getByRole('button', { name: 'Entrar a la sala' }).click();
}
for (const p of players)
  await until(async () => (await view(p))?.players.length === 4, 15000, 'lobby full');
log('lobby has 4 players');

// ── a fifth person gets "Sala llena" ──
{
  const ctx = await browser.newContext(desktop);
  const page = await ctx.newPage();
  await page.goto(`${BASE}/sala/${roomId}`);
  await page.getByLabel('Tu nombre').fill('Eva');
  await page.getByRole('button', { name: 'Entrar a la sala' }).click();
  await page.getByRole('heading', { name: 'Sala llena' }).waitFor();
  const unknown = await ctx.newPage();
  await unknown.goto(`${BASE}/sala/ZZZZZZ`);
  await unknown.getByRole('heading', { name: 'La sala no existe' }).waitFor();
  await ctx.close();
  log('5th player → "Sala llena"; unknown id → "La sala no existe"');
}

// ── voice: every peer connection reaches "connected", speaking indicators react ──
for (const p of players) {
  await until(
    async () => {
      const s = await p.page.evaluate(() => window.__domino.voice.debug());
      return Object.values(s).length === 3 && Object.values(s).every((c) => c === 'connected');
    },
    30000,
    `${p.name} voice connected`,
  );
}
log('voice: 6 connections, all "connected" on the 4 clients');
// Every client must see each of the other three light up while "speaking".
{
  const heard = await Promise.all(
    players.map((p) =>
      p.page.evaluate(async () => {
        const seen = new Set();
        const { voice, state } = window.__domino;
        const me = state().view.youId;
        const t0 = performance.now();
        while (performance.now() - t0 < 8000 && seen.size < 3) {
          for (const [id, on] of Object.entries(voice.getSnapshot().speaking)) {
            if (on && id !== me) seen.add(id);
          }
          await new Promise((r) => setTimeout(r, 40));
        }
        const glowing = document.querySelectorAll('.avatar[data-speaking="true"]').length;
        return { seen: seen.size, glowing };
      }),
    ),
  );
  if (!heard.every((h) => h.seen === 3)) throw new Error(`speaking: ${JSON.stringify(heard)}`);
  log('speaking indicators: every client saw the other 3 speak (audio flows both ways)');
}
await shot(ana, '01-lobby');
await shot(players[3], '01-lobby-phone');

// ── manual seats: everybody sits, then the host goes back to "Sortear" ──
await ana.page.getByRole('radio', { name: 'Elegir asientos' }).click();
for (const [i, p] of players.entries()) {
  await p.page.locator('.seat').nth(i).waitFor();
  await p.page.locator(`.seat-${['bottom', 'right', 'top', 'left'][i]}`).click();
}
await until(
  async () => (await view(ana)).players.every((p) => p.seat !== null),
  5000,
  'all seated',
);
await ana.page.getByRole('button', { name: 'Empezar' }).isEnabled();
await shot(ana, '01b-lobby-manual');
log('manual mode: all four picked a seat');
await ana.page.getByRole('radio', { name: 'Sortear' }).click();

// ── host starts; interactive starter draw ──
await ana.page.getByRole('radio', { name: '100' }).click();
await ana.page.getByRole('button', { name: 'Empezar' }).click();
for (const p of players) await p.page.locator('[data-draw-slot]').first().waitFor();
for (const [i, p] of players.entries()) {
  await p.page.locator(`[data-draw-slot="${i * 7 + 3}"]`).click();
  if (i === 1) await shot(p, '02-draw-picking');
}
await ana.page.getByText('Así quedó el sorteo').waitFor();
await shot(ana, '03-draw-outcome');
await shot(players[3], '03-draw-outcome-phone');
for (const p of players) await p.page.locator('.table-screen').waitFor({ timeout: 15000 });
log('draw done, table dealt');

// ── game helpers ──
const parse = (t) => t.split('-').map(Number);
function legal(hand, line) {
  if (line.length === 0) return hand.map((tile) => ({ tile, end: 'left' }));
  const L = line[0].left;
  const R = line[line.length - 1].right;
  return hand.flatMap((tile) => {
    const [a, b] = parse(tile);
    const out = [];
    if (a === L || b === L) out.push({ tile, end: 'left' });
    if (a === R || b === R) out.push({ tile, end: 'right' });
    return out;
  });
}
const seatOf = (v) => v.players.find((p) => p.id === v.youId).seat;

let moveCount = 0;
let checkedIllegal = false;
let checkedPassDisabled = false;
let usedDrag = 0;
let boardDrops = 0;
let checkedCancel = false;
let checkedBadge = false;

async function playOneMove() {
  const views = await Promise.all(players.map(view));
  const v0 = views[0];
  if (!v0 || v0.phase !== 'playing' || v0.pause.length) return false;
  const idx = views.findIndex((v) => v?.phase === 'playing' && seatOf(v) === v.game.turn);
  // The four clients may be one broadcast apart; try again in a moment.
  if (idx === -1 || views.some((v) => v.version !== v0.version)) {
    await new Promise((r) => setTimeout(r, 80));
    return false;
  }
  const p = players[idx];
  const v = views[idx];
  const moves = legal(v.game.hand, v.game.line);
  if (!checkedBadge) {
    await p.page.locator('.turn-badge.mine').waitFor({ timeout: 3000 });
    const other = players[(idx + 1) % 4];
    await other.page.getByText(`Juega ${p.name}`).waitFor({ timeout: 3000 });
    checkedBadge = true;
    log(`turn badge: "${p.name}" sees "¡Te toca!", ${other.name} sees "Juega ${p.name}"`);
  }
  const passBtn = p.page.getByRole('button', { name: 'Pasar' });

  if (moves.length === 0) {
    await until(() => passBtn.isEnabled(), 3000, 'Pasar enabled without legal moves');
    await passBtn.click();
  } else {
    if (!checkedPassDisabled) {
      await p.page.locator('.hand.my-turn').waitFor();
      if (await passBtn.isEnabled()) throw new Error('Pasar must be disabled with a legal move');
      checkedPassDisabled = true;
      log(`${p.name}: has a legal move → "Pasar" disabled`);
    }
    // Once: try an illegal tile → it shakes and stays in the hand.
    const bad = v.game.line.length
      ? v.game.hand.find((t) => !moves.some((m) => m.tile === t))
      : null;
    if (!checkedIllegal && bad) {
      const [L] = [v.game.line[0].left];
      const [a, b] = parse(bad);
      const end = a === L || b === L ? 'right' : 'left';
      await p.page.locator(`.hand [data-tile="${bad}"]`).click();
      await p.page.locator(`[data-end-target="${end}"]`).click();
      await p.page.locator(`.hand [data-tile="${bad}"].shake`).waitFor({ timeout: 2000 });
      checkedIllegal = true;
      log(`${p.name}: illegal ${bad} on ${end} → shake, stays in hand`);
    }
    const move = moves[Math.floor(Math.random() * moves.length)];
    const tile = p.page.locator(`.hand [data-tile="${move.tile}"]`);
    const useDrag = moveCount % 3 === 1 && idx !== 3;
    if (useDrag) {
      // Drag and drop: press on the tile and drop it on the end.
      await tile.click({ trial: true });
      const from = await tile.boundingBox();
      await p.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
      await p.page.mouse.down();
      await p.page.mouse.move(from.x + from.width / 2 + 10, from.y - 20, { steps: 3 });
      const target = p.page.locator(`[data-end-target="${move.end}"]`);
      await target.waitFor();
      if (!checkedCancel) {
        // A gesture the browser cancels mid-drag must not leave the hand stuck.
        await p.page.evaluate(() => window.dispatchEvent(new Event('blur')));
        await p.page.mouse.up();
        if (await p.page.locator('.drag-ghost').count()) throw new Error('drag ghost stuck');
        await p.page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
        await p.page.mouse.down();
        await p.page.mouse.move(from.x + from.width / 2 + 10, from.y - 20, { steps: 3 });
        checkedCancel = true;
        log(`${p.name}: cancelled drag released cleanly, next drag works`);
      }
      let to = await target.boundingBox();
      if (usedDrag % 2 === 1) {
        // Dropped anywhere on the felt: it goes to the end it fits.
        to = await p.page.locator('.board').boundingBox();
        boardDrops++;
      }
      await p.page.mouse.move(to.x + to.width / 2, to.y + to.height / 2, { steps: 8 });
      await p.page.mouse.up();
      usedDrag++;
    } else {
      await tile.click();
      await p.page.locator(`[data-end-target="${move.end}"]`).click();
    }
  }
  moveCount++;
  await until(async () => (await view(p)).version > v.version, 5000, 'move applied');
  return true;
}

async function finishHandSummary() {
  const v = await view(ana);
  if (v.phase !== 'handEnd') return;
  const r = v.handResult;
  log(
    `hand ${v.game.handNumber}: ${r.kind}${r.kind === 'domino' ? ` by seat ${r.winner}` : ''}, +${r.points}, score ${v.game.scores.join('-')}`,
  );
  if (v.game.handNumber === 1) {
    await shot(ana, '05-hand-summary');
    await shot(players[3], '05-hand-summary-phone');
  }
  for (const p of players) await p.page.getByRole('button', { name: 'Continuar' }).click();
  await until(async () => (await view(ana)).phase !== 'handEnd', 5000, 'next hand');
}

let reloaded = false;
let replaced = false;
let paused = !process.env.E2E_PAUSE;
let tookBoardShot = false;
let checkedPhone = false;
let handsSeen = new Set();
let starters = [];

while ((await view(ana)).phase !== 'matchEnd') {
  const v = await view(ana);
  if (v.phase === 'handEnd') {
    await finishHandSummary();
    continue;
  }
  if (!handsSeen.has(v.game.handNumber)) {
    handsSeen.add(v.game.handNumber);
    starters.push(v.game.starter);
  }
  // Reload mid-hand: same seat, same hand, same voice.
  if (!reloaded && v.game.handNumber === 2 && v.game.line.length >= 3) {
    const beto = players[1];
    const before = await view(beto);
    await beto.page.reload();
    await beto.page.locator('.table-screen').waitFor();
    await until(
      async () => (await view(beto))?.game?.hand.length === before.game.hand.length,
      10000,
      'reclaim',
    );
    const after = await view(beto);
    if (JSON.stringify(after.game.hand) !== JSON.stringify(before.game.hand))
      throw new Error('hand changed');
    if (seatOf(after) !== seatOf(before)) throw new Error('seat changed');
    await until(
      async () =>
        Object.values(await beto.page.evaluate(() => window.__domino.voice.debug())).filter(
          (c) => c === 'connected',
        ).length === 3,
      30000,
      'voice after reload',
    );
    log('reload mid-hand: same seat and hand, voice reconnected');
    reloaded = true;
  }
  // The 2-minute pause flow.
  if (!paused && v.game.handNumber === 2 && v.game.line.length >= 5) {
    const caro = players[2];
    await caro.page.close();
    await ana.page.getByText('Caro se desconectó, esperando…').waitFor();
    await shot(ana, '06-paused');
    log('Caro disconnected: paused with countdown; waiting 2 minutes…');
    const host = players.find((p) => p.page.isClosed() === false);
    await ana.page.getByRole('button', { name: 'Esperar más' }).waitFor({ timeout: 135000 });
    await shot(ana, '07-host-decides');
    await ana.page.getByRole('button', { name: 'Esperar más' }).click();
    await ana.page
      .getByText(/^(2:00|1:5\d)$/)
      .first()
      .waitFor();
    log('host chose "Esperar más": countdown restarted');
    caro.page = await caro.context.newPage();
    await caro.page.goto(`${BASE}/sala/${roomId}`);
    await caro.page.locator('.table-screen').waitFor();
    await until(async () => (await view(ana)).pause.length === 0, 10000, 'resume');
    log('Caro came back: game resumed');
    paused = true;
    void host;
  }
  // Nobody comes back: the host lets a newcomer take the seat, with its hand and team.
  if (
    paused &&
    process.env.E2E_PAUSE &&
    !replaced &&
    v.game.handNumber >= 3 &&
    v.game.line.length >= 4
  ) {
    const dani = players[3];
    const before = await view(dani);
    const seat = seatOf(before);
    const count = before.game.hand.length;
    await dani.context.close();
    await ana.page.getByText('Dani se desconectó, esperando…').waitFor();
    log('Dani disconnected; waiting 2 minutes…');
    await ana.page.getByRole('button', { name: 'Permitir reemplazo' }).waitFor({ timeout: 135000 });
    await ana.page.getByRole('button', { name: 'Permitir reemplazo' }).click();
    await ana.page.getByText('ocupará su puesto').waitFor();
    await shot(ana, '07b-replacement-open');
    const context = await browser.newContext({ ...desktop, permissions: ['microphone'] });
    await context.addInitScript(() => localStorage.setItem('domino:debug', '1'));
    const page = await context.newPage();
    await page.goto(`${BASE}/sala/${roomId}`);
    await page.getByLabel('Tu nombre').fill('Eva');
    await page.getByRole('button', { name: 'Entrar a la sala' }).click();
    await page.locator('.table-screen').waitFor();
    const eva = await until(
      async () =>
        (await page.evaluate(() => window.__domino.state().view))?.game
          ? page.evaluate(() => window.__domino.state().view)
          : null,
      10000,
      'eva view',
    );
    if (seatOf(eva) !== seat || eva.game.hand.length !== count)
      throw new Error('replacement did not inherit the seat');
    await until(
      async () => (await view(ana)).pause.length === 0,
      10000,
      'resume after replacement',
    );
    players[3] = { name: 'Eva', context, page };
    log(`Eva replaced Dani: same seat (${seat}) and ${count} tiles; game resumed`);
    replaced = true;
  }
  if (!tookBoardShot && v.game.line.length >= 14) {
    await shot(ana, '04-table');
    await shot(players[3], '04-table-phone');
    tookBoardShot = true;
  }
  if (!checkedPhone && v.game.line.length >= 18) {
    const dani = players[3].page;
    const m = await dani.evaluate(async () => {
      // Let the fly-in / zoom transitions settle before measuring.
      await Promise.all(
        document
          .getAnimations()
          .filter((a) => a.effect?.getTiming().iterations !== Infinity)
          .map((a) => a.finished.catch(() => undefined)),
      );
      await new Promise((r) => setTimeout(r, 650));
      const board = document.querySelector('.board').getBoundingClientRect();
      const tiles = [...document.querySelectorAll('.board-tile')].map((t) =>
        t.getBoundingClientRect(),
      );
      const inside = tiles.every(
        (r) =>
          r.left >= board.left - 1 &&
          r.right <= board.right + 1 &&
          r.top >= board.top - 1 &&
          r.bottom <= board.bottom + 1,
      );
      const hand = document.querySelector('.hand').getBoundingClientRect();
      return {
        scrollW: document.documentElement.scrollWidth,
        scrollH: document.documentElement.scrollHeight,
        w: innerWidth,
        h: innerHeight,
        inside,
        tiles: tiles.length,
        outside: tiles
          .filter(
            (r) =>
              r.left < board.left - 1 ||
              r.right > board.right + 1 ||
              r.top < board.top - 1 ||
              r.bottom > board.bottom + 1,
          )
          .map((r) => [
            Math.round(r.left),
            Math.round(r.top),
            Math.round(r.right),
            Math.round(r.bottom),
          ]),
        board: [
          Math.round(board.left),
          Math.round(board.top),
          Math.round(board.right),
          Math.round(board.bottom),
        ],
        handInView: hand.bottom <= innerHeight && hand.right <= innerWidth && hand.left >= 0,
      };
    });
    if (m.scrollW > m.w || m.scrollH > m.h || !m.inside || !m.handInView) {
      throw new Error(`phone layout overflow ${JSON.stringify(m)}`);
    }
    log(`phone 844×390: ${m.tiles} tiles inside the board, no scrolling`);
    await shot(players[3], '04b-table-phone-full');
    // Same phone with the browser bars showing (much less height).
    await dani.setViewportSize({ width: 750, height: 300 });
    await new Promise((r) => setTimeout(r, 900));
    const short = await dani.evaluate(() => {
      const board = document.querySelector('.board').getBoundingClientRect();
      const tiles = [...document.querySelectorAll('.board-tile')].map((t) =>
        t.getBoundingClientRect(),
      );
      const inside = tiles.every(
        (r) =>
          r.left >= board.left - 1 &&
          r.right <= board.right + 1 &&
          r.top >= board.top - 1 &&
          r.bottom <= board.bottom + 1,
      );
      const hand = document.querySelector('.hand').getBoundingClientRect();
      const pass = document.querySelector('.pass-btn').getBoundingClientRect();
      return {
        noScroll:
          document.documentElement.scrollHeight <= innerHeight &&
          document.documentElement.scrollWidth <= innerWidth,
        inside,
        hand: hand.bottom <= innerHeight && hand.left >= 0 && hand.right <= innerWidth,
        pass: pass.bottom <= innerHeight && pass.right <= innerWidth,
        boardH: Math.round(board.height),
      };
    });
    await shot(players[3], '04c-table-phone-short');
    if (!short.noScroll || !short.inside || !short.hand || !short.pass) {
      throw new Error(`short phone layout broken ${JSON.stringify(short)}`);
    }
    log(`phone 750×300 (browser bars visible): everything fits, board ${short.boardH}px tall`);
    await dani.setViewportSize({ width: 844, height: 390 });
    checkedPhone = true;
  }
  await playOneMove();
}

const end = await view(ana);
log(
  `match over: team ${end.matchWinner} wins ${end.game.scores.join('-')} (target ${end.target}), ${moveCount} moves, ${usedDrag} by drag (${boardDrops} dropped on the felt)`,
);
for (let i = 1; i < starters.length; i++) {
  if (starters[i] !== (starters[i - 1] + 1) % 4)
    throw new Error(`starter rotation broken: ${starters}`);
}
log(`starter rotated to the right every hand: ${starters.join(' → ')}`);
await shot(ana, '08-match-end');
if (players[3].name === 'Dani') await shot(players[3], '08-match-end-phone');

// ── rematch keeping the teams ──
const seatsBefore = (await view(ana)).players.map((p) => `${p.name}:${p.seat}`).join(',');
await ana.page.getByRole('button', { name: 'Revancha · mismas parejas' }).click();
for (const [i, p] of players.entries()) {
  await p.page.locator('[data-draw-slot]').first().waitFor();
  await p.page.locator(`[data-draw-slot="${i * 5 + 1}"]`).click();
}
for (const p of players) await p.page.locator('.table-screen').waitFor({ timeout: 15000 });
const re = await view(ana);
if (re.game.scores.join() !== '0,0') throw new Error('rematch scores not reset');
if (re.players.map((p) => `${p.name}:${p.seat}`).join(',') !== seatsBefore)
  throw new Error('teams changed');
log('Revancha: new draw, same teams, scores 0-0');

// ── portrait overlay on a phone ──
{
  const p = players[3].name === 'Dani' ? players[3].page : null;
  const page = p ?? (await (await browser.newContext({ ...phone })).newPage());
  if (!p) {
    // Dani was replaced: open the (portrait) room on a fresh phone with Eva's token copied over.
    const token = await players[3].page.evaluate(
      (id) => localStorage.getItem(`domino:room:${id}`),
      roomId,
    );
    await page.goto(BASE);
    await page.evaluate(([id, t]) => localStorage.setItem(`domino:room:${id}`, t), [roomId, token]);
    await page.goto(`${BASE}/sala/${roomId}`);
  }
  await page.setViewportSize({ width: 390, height: 844 });
  await page.getByRole('heading', { name: 'Gira tu teléfono' }).waitFor();
  await page.screenshot({ path: `${OUT}/09-portrait-overlay.png` });
}
log('portrait → "Gira tu teléfono" overlay');

await browser.close();
log('ALL CHECKS PASSED');

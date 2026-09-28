/**
 * One person against three AIs, through the real UI (phone viewport). Needs `npm run dev`.
 *   BASE_URL=https://… node scripts/e2e-bots.mjs   (against a deployment)
 */
import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = 'e2e-artifacts';
const log = (...a) => console.log(`[bots ${new Date().toISOString().slice(11, 19)}]`, ...a);
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  headless: !process.env.E2E_HEADFUL,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    ...(process.env.E2E_ARGS ? [process.env.E2E_ARGS] : []),
  ],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
  permissions: ['microphone'],
});
await ctx.addInitScript(() => localStorage.setItem('domino:debug', '1'));
const page = await ctx.newPage();
page.on('pageerror', (e) => log('pageerror', e.message));
const view = () => page.evaluate(() => window.__domino.state().view);
async function until(fn, ms, what) {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

await page.goto(BASE);
await page.getByPlaceholder('¿Cómo te llaman en la mesa?').fill('Julio');
await page.getByRole('button', { name: 'Crear sala' }).click();
await page.waitForURL(/\/sala\//);
const roomId = page.url().split('/').pop();
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Agregar IA' }).first().click();
await until(async () => (await view())?.players.length === 4, 5000, 'three AIs');
log('lobby:', (await view()).players.map((p) => `${p.name}${p.isBot ? ' (IA)' : ''}`).join(', '));
await page.screenshot({ path: `${OUT}/20-lobby-bots.png` });

// A friend arriving takes an AI's seat, then leaves again; the host re-adds the AI.
{
  const fctx = await browser.newContext({ permissions: ['microphone'] });
  const f = await fctx.newPage();
  await f.goto(`${BASE}/sala/${roomId}`);
  await f.getByLabel('Tu nombre').fill('Amigo');
  await f.getByRole('button', { name: 'Entrar a la sala' }).click();
  await until(
    async () => (await view()).players.filter((p) => p.isBot).length === 2,
    5000,
    'friend replaces AI',
  );
  log('a friend joining the full lobby replaced one AI');
  await f.getByRole('button', { name: 'Salir' }).click();
  await fctx.close();
  await until(async () => (await view()).players.length === 3, 8000, 'friend left');
  await page.getByRole('button', { name: 'Agregar IA' }).first().click();
  await until(
    async () => (await view()).players.filter((p) => p.isBot).length === 3,
    5000,
    'AI back',
  );
}

await page.getByRole('button', { name: 'Empezar' }).click();
await page.locator('[data-draw-slot]').first().waitFor();
await page.locator('[data-draw-slot="10"]').click();
await page.locator('.table-screen').waitFor({ timeout: 20000 });
log('draw done: the AIs picked their tiles by themselves');

const legal = (hand, line) => {
  if (!line.length) return hand.map((tile) => ({ tile, end: 'left' }));
  const L = line[0].left;
  const R = line[line.length - 1].right;
  return hand.flatMap((tile) => {
    const [a, b] = tile.split('-').map(Number);
    return [
      ...(a === L || b === L ? [{ tile, end: 'left' }] : []),
      ...(a === R || b === R ? [{ tile, end: 'right' }] : []),
    ];
  });
};

let myMoves = 0;
let botMoves = 0;
let lastLen = 0;
let shot = false;
const t0 = Date.now();
for (;;) {
  const v = await view();
  if (v.phase === 'matchEnd') break;
  if (Date.now() - t0 > 480000) throw new Error('match too slow');
  if (v.phase === 'handEnd') {
    const r = v.handResult;
    log(`hand ${v.game.handNumber}: ${r.kind}, +${r.points}, score ${v.game.scores.join('-')}`);
    await page.getByRole('button', { name: 'Continuar' }).click();
    await until(async () => (await view()).phase !== 'handEnd', 8000, 'next hand');
    lastLen = 0;
    continue;
  }
  if (v.phase !== 'playing') {
    await new Promise((r) => setTimeout(r, 150));
    continue;
  }
  const me = v.players.find((p) => p.id === v.youId);
  if (v.game.line.length > lastLen) {
    botMoves += v.game.line.length - lastLen;
    lastLen = v.game.line.length;
  }
  if (v.game.turn !== me.seat) {
    await new Promise((r) => setTimeout(r, 150));
    continue;
  }
  if (!shot && v.game.line.length >= 8) {
    await page.waitForTimeout(700);
    await page.screenshot({ path: `${OUT}/21-table-vs-bots.png` });
    shot = true;
  }
  const moves = legal(v.game.hand, v.game.line);
  if (!moves.length) {
    await page.getByRole('button', { name: 'Pasar' }).click();
  } else {
    const m = moves[0];
    await page.locator(`.hand [data-tile="${m.tile}"]`).click();
    await page.locator(`[data-end-target="${m.end}"]`).click();
    botMoves--;
    myMoves++;
  }
  await until(async () => (await view()).version > v.version, 5000, 'my move applied');
  lastLen = (await view()).game?.line.length ?? 0;
}
const end = await view();
log(
  `match over ${end.game.scores.join('-')}: winner team ${end.matchWinner}; I played ${myMoves} tiles, the AIs ~${botMoves}`,
);
await page.screenshot({ path: `${OUT}/22-match-end-bots.png` });
await page.getByRole('button', { name: 'Revancha · sortear parejas' }).click();
await page.locator('[data-draw-slot]').first().waitFor();
log('rematch with AIs started');
await browser.close();
log('ALL CHECKS PASSED');

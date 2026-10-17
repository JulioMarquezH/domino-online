/**
 * Stress test for the things thrown at the table: a minute of tomatoes, bombs, tornados and
 * quakes as fast as the cooldowns allow, on a phone-sized screen with the CPU slowed 4× like a
 * phone. Reports frame rate during the chaos, and whether memory, DOM nodes and animations go
 * back to where they started (no leaks).
 *
 *   BASE_URL=http://localhost:5180 node scripts/perf-throws.mjs
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SECONDS = Number(process.env.SECONDS ?? 60);
const log = (...a) => console.log(`[perf ${new Date().toISOString().slice(11, 19)}]`, ...a);
const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--js-flags=--expose-gc',
  ],
});
const phone = { viewport: { width: 844, height: 390 }, isMobile: true, hasTouch: true };
const mk = async () => {
  const c = await browser.newContext({
    ...phone,
    deviceScaleFactor: 3,
    permissions: ['microphone'],
  });
  await c.addInitScript(() => localStorage.setItem('domino:debug', '1'));
  return [c, await c.newPage()];
};
const [anaCtx, ana] = await mk();
const [, beto] = await mk();
const view = (p) => p.evaluate(() => window.__domino.state().view);

await ana.goto(BASE);
await ana.getByPlaceholder('¿Cómo te llaman en la mesa?').fill('Ana');
await ana.getByRole('button', { name: 'Crear sala' }).click();
await ana.waitForURL(/sala/);
await beto.goto(ana.url());
await beto.getByLabel('Tu nombre').fill('Beto');
await beto.getByRole('button', { name: 'Entrar a la sala' }).click();
await ana.waitForTimeout(800);
for (let i = 0; i < 2; i++) await ana.getByRole('button', { name: 'Agregar IA' }).first().click();
await ana.waitForTimeout(400);
await ana.getByRole('button', { name: 'Empezar' }).click();
for (const [i, p] of [ana, beto].entries())
  await p.locator(`[data-draw-slot="${i * 9 + 2}"]`).click();
for (const p of [ana, beto]) await p.locator('.table-screen').waitFor({ timeout: 20000 });

// A few tiles on the table so the bombs have something to knock around.
for (let i = 0; i < 200; i++) {
  const v = await view(ana);
  if (v.phase === 'playing' && v.game.line.length >= 8) break;
  for (const p of [ana, beto]) {
    const pv = await view(p);
    const me = pv.players.find((x) => x.id === pv.youId);
    if (pv.phase !== 'playing' || pv.game.turn !== me.seat) continue;
    const L = pv.game.line[0]?.left;
    const R = pv.game.line.at(-1)?.right;
    const t = pv.game.hand.find((x) => {
      const [a, b] = x.split('-').map(Number);
      return !pv.game.line.length || a === L || b === L || a === R || b === R;
    });
    if (!t) await p.getByRole('button', { name: 'Pasar' }).click();
    else {
      const [a, b] = t.split('-').map(Number);
      const end = !pv.game.line.length || a === L || b === L ? 'left' : 'right';
      await p.locator(`.hand [data-tile="${t}"]`).click();
      await p.locator(`[data-end-target="${end}"]`).click();
    }
  }
  await ana.waitForTimeout(250);
}
await ana.waitForTimeout(1500);

const cdp = await anaCtx.newCDPSession(ana);
await cdp.send('Performance.enable');
const snapshot = async () => {
  await cdp.send('HeapProfiler.collectGarbage');
  await ana.waitForTimeout(300);
  const m = Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((x) => [x.name, x.value]),
  );
  const page = await ana.evaluate(() => ({
    funNodes: document.querySelector('.fun-layer')?.childElementCount ?? -1,
    stains: document.querySelector('.board-stains')?.childElementCount ?? -1,
    animations: document.getAnimations().filter((a) => !(a instanceof CSSAnimation)).length,
  }));
  return {
    heapMB: +(m.JSHeapUsedSize / 1e6).toFixed(1),
    domNodes: m.Nodes,
    listeners: m.JSEventListeners,
    ...page,
  };
};
const before = await snapshot();
log('before', JSON.stringify(before));

// Frame counter on Ana's page with the CPU slowed down like a phone.
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await ana.evaluate(() => {
  const w = window;
  w.__frames = [];
  let last = performance.now();
  const tick = (t) => {
    w.__frames.push(t - last);
    last = t;
    if (w.__frames.length < 100000) requestAnimationFrame(tick);
  };
  requestAnimationFrame(tick);
});

const pick = async (page, label) => {
  await page.locator('.throw-btn').click();
  await page.locator(`.throw-picker [aria-label="${label}"]`).click();
  await page.locator('.throw-picker').waitFor({ state: 'detached' });
};
const tapBoard = async (page, fx, fy) => {
  const b = await page.locator('.board').boundingBox();
  await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
};

await pick(ana, 'Tomate');
const big = ['Bomba', 'Tornado', 'Terremoto'];
const start = Date.now();
let thrown = 0;
let nextAna = 0;
let nextBeto = 0;
let b = 0;
while (Date.now() - start < SECONDS * 1000) {
  const t = Date.now() - start;
  if (t >= nextAna) {
    await tapBoard(ana, 0.2 + Math.random() * 0.6, 0.2 + Math.random() * 0.6);
    nextAna = t + 3200;
    thrown++;
  }
  if (t >= nextBeto) {
    await pick(beto, big[b++ % big.length]);
    await tapBoard(beto, 0.3 + Math.random() * 0.4, 0.3 + Math.random() * 0.4);
    nextBeto = t + 6300;
    thrown++;
  }
  await ana.waitForTimeout(100);
}

const frames = await ana.evaluate(() => window.__frames.slice(1));
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 1 });
const sorted = [...frames].sort((x, y) => x - y);
const pct = (p) => sorted[Math.floor((sorted.length - 1) * p)];
const fps = frames.length / (frames.reduce((s, x) => s + x, 0) / 1000);
log(
  `${thrown} throws in ${SECONDS}s at CPU 4×: ${fps.toFixed(0)} fps avg, p50 ${pct(0.5).toFixed(1)}ms, p95 ${pct(0.95).toFixed(1)}ms, worst ${sorted.at(-1).toFixed(0)}ms, frames >50ms: ${frames.filter((x) => x > 50).length}`,
);

// Let every splat fade and every tile glide home, then compare.
await ana.waitForTimeout(9000);
const after = await snapshot();
log('after ', JSON.stringify(after));
const leaks = [];
if (after.funNodes !== 0) leaks.push(`fun-layer keeps ${after.funNodes} nodes`);
if (after.stains !== 0) leaks.push(`board keeps ${after.stains} stains`);
if (after.animations !== 0) leaks.push(`${after.animations} animations still running`);
if (after.domNodes - before.domNodes > 200)
  leaks.push(`DOM grew by ${after.domNodes - before.domNodes}`);
if (after.heapMB - before.heapMB > 5)
  leaks.push(`heap grew by ${(after.heapMB - before.heapMB).toFixed(1)} MB`);
log(leaks.length ? `LEAKS: ${leaks.join('; ')}` : 'no leaks: everything back to where it started');
await browser.close();

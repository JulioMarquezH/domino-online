/**
 * Measures how hard the browser works at the table while nothing happens (your turn, waiting).
 * A phone heats up when the page repaints every frame: this counts paints, style/layout work
 * and the main-thread time over a few seconds, with the CPU slowed down 4× like a phone.
 *
 *   npm run dev   (other terminal)
 *   node scripts/perf-mesa.mjs [label]
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const SECONDS = 8;
const label = process.argv[2] ?? 'mesa';
const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const ctx = await browser.newContext({
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 3,
  permissions: ['microphone'],
});
await ctx.addInitScript(() => localStorage.setItem('domino:debug', '1'));
const page = await ctx.newPage();
const view = () => page.evaluate(() => window.__domino.state().view);

await page.goto(BASE);
await page.getByPlaceholder('¿Cómo te llaman en la mesa?').fill('Julio');
await page.getByRole('button', { name: 'Crear sala' }).click();
await page.waitForURL(/sala/);
for (let i = 0; i < 3; i++) await page.getByRole('button', { name: 'Agregar IA' }).first().click();
await page.waitForTimeout(400);
await page.getByRole('button', { name: 'Empezar' }).click();
await page.locator('[data-draw-slot="4"]').click();
await page.locator('.table-screen').waitFor({ timeout: 20000 });
// Play until it's my turn with a few tiles on the table, then wait without touching anything.
for (let i = 0; i < 200; i++) {
  const v = await view();
  const me = v.players.find((p) => p.id === v.youId);
  if (v.phase === 'playing' && v.game.turn === me.seat && v.game.line.length >= 4) break;
  if (v.phase === 'playing' && v.game.turn === me.seat) {
    const L = v.game.line[0]?.left;
    const R = v.game.line.at(-1)?.right;
    const t = v.game.hand.find((x) => {
      const [a, b] = x.split('-').map(Number);
      return v.game.line.length === 0 || a === L || b === L || a === R || b === R;
    });
    if (!t) await page.getByRole('button', { name: 'Pasar' }).click();
    else {
      const [a, b] = t.split('-').map(Number);
      const end = v.game.line.length === 0 || a === L || b === L ? 'left' : 'right';
      await page.locator(`.hand [data-tile="${t}"]`).click();
      await page.locator(`[data-end-target="${end}"]`).click();
    }
  } else if (v.phase === 'handEnd') {
    await page.getByRole('button', { name: 'Continuar' }).click();
  }
  await page.waitForTimeout(300);
}
await page.waitForTimeout(1500);

const cdp = await ctx.newCDPSession(page);
await cdp.send('Emulation.setCPUThrottlingRate', { rate: 4 });
await cdp.send('Performance.enable');
const metrics = async () =>
  Object.fromEntries(
    (await cdp.send('Performance.getMetrics')).metrics.map((m) => [m.name, m.value]),
  );
await browser.startTracing(page, {
  categories: ['devtools.timeline', 'disabled-by-default-devtools.timeline'],
});
const before = await metrics();
await page.waitForTimeout(SECONDS * 1000);
const after = await metrics();
const trace = JSON.parse((await browser.stopTracing()).toString());

const events = trace.traceEvents ?? trace;
const sum = (name) => {
  const evs = events.filter((e) => e.name === name && e.ph === 'X');
  return { n: evs.length, ms: Math.round(evs.reduce((s, e) => s + (e.dur ?? 0), 0) / 1000) };
};
const d = (k) => Math.round((after[k] - before[k]) * 1000);
const result = {
  label,
  seconds: SECONDS,
  paints: sum('Paint'),
  layerTree: sum('UpdateLayerTree'),
  styles: sum('UpdateLayoutTree'),
  layout: sum('Layout'),
  rasterTasks: sum('RasterTask'),
  mainThreadMs: d('TaskDuration'),
  scriptMs: d('ScriptDuration'),
  heapMB: Math.round(after.JSHeapUsedSize / 1e6),
  domNodes: after.Nodes,
};
console.log(JSON.stringify(result));
await page.screenshot({ path: `e2e-artifacts/perf-${label}.png` });
await browser.close();

/**
 * Chat, reactions and things thrown at people, with 2 people + 2 AIs on phones.
 *   BASE_URL=http://localhost:5180 node scripts/e2e-fun.mjs   (a running server)
 */
import { chromium } from 'playwright';

const BASE = process.env.BASE_URL ?? 'http://localhost:5173';
const OUT = 'e2e-artifacts';
const log = (...a) => console.log(`[fun ${new Date().toISOString().slice(11, 19)}]`, ...a);
const assert = (c, m) => {
  if (!c) throw new Error(`ASSERT: ${m}`);
};
const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  headless: !process.env.E2E_HEADFUL,
  args: ['--use-fake-ui-for-media-stream', '--use-fake-device-for-media-stream'],
});
const phone = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};
const mk = async () => {
  const c = await browser.newContext({ ...phone, permissions: ['microphone'] });
  await c.addInitScript(() => localStorage.setItem('domino:debug', '1'));
  const p = await c.newPage();
  p.on('pageerror', (e) => log('pageerror', e.message));
  return p;
};
const ana = await mk();
const beto = await mk();
try {
  await ana.setViewportSize({ width: 1000, height: 700 });
  await ana.goto(BASE);
  await ana.getByPlaceholder('¿Cómo te llaman en la mesa?').fill('Ana');
  await ana.getByRole('button', { name: 'Crear sala' }).click();
  await ana.waitForURL(/sala/);
  await beto.goto(ana.url());
  await beto.getByLabel('Tu nombre').fill('Beto');
  await beto.getByRole('button', { name: 'Entrar a la sala' }).click();
  await ana.waitForTimeout(800);
  for (let i = 0; i < 2; i++) await ana.getByRole('button', { name: 'Agregar IA' }).first().click();
  await ana.waitForTimeout(500);
  await ana.getByRole('button', { name: 'Empezar' }).click();
  await ana.setViewportSize(phone.viewport);
  for (const [i, p] of [ana, beto].entries())
    await p.locator(`[data-draw-slot="${i * 9 + 2}"]`).click();
  for (const p of [ana, beto]) await p.locator('.table-screen').waitFor({ timeout: 20000 });
  await ana.waitForTimeout(1200);

  // Chat: Ana writes; Beto gets a bubble and an unread badge.
  await ana.getByRole('button', { name: 'Chat', exact: true }).click();
  await ana.locator('.chat-form input').fill('¿Quién trajo las fichas? 😂');
  await ana.getByRole('button', { name: 'Enviar' }).click();
  await beto.locator('.fun-bubble').waitFor({ timeout: 5000 });
  await beto.screenshot({ path: `${OUT}/fun-01-bubble.png` });
  assert((await beto.locator('.chat-badge').innerText()) === '1', 'unread badge on Beto');
  log('chat: Beto sees the bubble and 1 unread');
  await beto.getByRole('button', { name: /Chat/ }).click();
  assert(
    (await beto.locator('.chat-list li').innerText()).includes('¿Quién trajo las fichas?'),
    'message in the list',
  );
  assert((await beto.locator('.chat-badge').count()) === 0, 'badge cleared when opened');
  await beto.locator('.chat-form input').fill('Yo, y voy ganando');
  await beto.getByRole('button', { name: 'Enviar' }).click();
  await ana.locator('.chat-list li', { hasText: 'voy ganando' }).waitFor();
  await ana.screenshot({ path: `${OUT}/fun-02-chat-panel.png` });
  log('chat panel: both messages in order');
  await ana.getByRole('button', { name: 'Cerrar' }).click();
  await beto.getByRole('button', { name: 'Cerrar' }).click();

  // Play a few tiles (Ana and Beto play; the AIs answer) so the table has something on it.
  const view = (p) => p.evaluate(() => window.__domino.state().view);
  for (let i = 0; i < 200; i++) {
    const v = await view(ana);
    if (v.phase === 'playing' && v.game.line.length >= 5) break;
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
      if (!t) {
        await p.getByRole('button', { name: 'Pasar' }).click();
      } else {
        const [a, b] = t.split('-').map(Number);
        const end = !pv.game.line.length || a === L || b === L ? 'left' : 'right';
        await p.locator(`.hand [data-tile="${t}"]`).click();
        await p.locator(`[data-end-target="${end}"]`).click();
      }
    }
    await ana.waitForTimeout(250);
  }
  await ana.waitForTimeout(800);

  // Mid-hand, tapping a tile says nothing (no help remembering who played what).
  await ana.locator('.board .board-tile').first().click({ force: true });
  await ana.waitForTimeout(300);
  assert((await ana.locator('.tile-info').count()) === 0, 'no "who played it" during the hand');
  log('mid-hand: tapping a tile reveals nothing');

  const aimAt = async (page, label, fx, fy) => {
    await page.getByRole('button', { name: 'Lanzar algo a la mesa' }).click();
    await page.getByRole('button', { name: new RegExp(`^${label}:`) }).click();
    await page.locator('.armed-hint').waitFor();
    const b = await page.locator('.board').boundingBox();
    await page.mouse.click(b.x + b.width * fx, b.y + b.height * fy);
  };

  // Tomato on the felt: Beto sees it fly from Ana's seat and the stain stay.
  await aimAt(ana, 'Tomate', 0.3, 0.4);
  await beto.locator('.fun-projectile').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(320);
  await beto.screenshot({ path: `${OUT}/fun-03-tomato-flying.png` });
  await beto.locator('.splat-tomato').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(500);
  await beto.screenshot({ path: `${OUT}/fun-04-tomato-splat.png` });
  log('tomato: flies to the tapped spot and stains the felt');

  // Cooldown: the tomato is recharging for Ana.
  await ana.getByRole('button', { name: 'Lanzar algo a la mesa' }).click();
  assert(await ana.getByRole('button', { name: /^Tomate:/ }).isDisabled(), 'tomato recharging');
  assert(
    (await ana.locator('.arsenal-pop', { hasText: /en \d+ s/ }).count()) === 1,
    'shows the wait',
  );
  await ana.keyboard.press('Escape');
  await ana.mouse.click(5, 200);
  log('cooldown: the tomato shows "en N s" and is disabled');

  // Bomb: tiles fly off and come back to exactly where they were.
  const boxes = () =>
    ana.evaluate(() =>
      [...document.querySelectorAll('.board .board-tile')].map((t) => {
        const r = t.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y)}`;
      }),
    );
  const before = await boxes();
  await aimAt(beto, 'Bomba', 0.5, 0.5);
  await ana.locator('.impact-bomb').waitFor({ timeout: 3000 });
  await ana.waitForTimeout(500);
  const moving = await ana.evaluate(
    () =>
      [...document.querySelectorAll('.board .board-tile')].filter((t) =>
        t.getAnimations().some((a) => !(a instanceof CSSAnimation)),
      ).length,
  );
  assert(moving >= 2, `bomb knocks the tiles around (${moving})`);
  await ana.screenshot({ path: `${OUT}/fun-05-bomb.png` });
  await ana.waitForTimeout(3600);
  const settled = await ana.evaluate(
    () =>
      [...document.querySelectorAll('.board .board-tile')].filter((t) =>
        t.getAnimations().some((a) => !(a instanceof CSSAnimation)),
      ).length,
  );
  assert(settled === 0, 'tiles are back in place after the bomb');
  assert((await boxes()).join() === before.join(), 'every tile is back exactly where it was');
  log(`bomb: ${moving} tiles blown away, all back in place`);

  // The table's breather: right after a bomb nobody can throw a tornado.
  await ana.getByRole('button', { name: 'Lanzar algo a la mesa' }).click();
  const tornadoReady = !(await ana.getByRole('button', { name: /^Tornado:/ }).isDisabled());
  log(`breather: tornado ${tornadoReady ? 'ready again (10 s passed)' : 'waiting'}`);
  await ana.mouse.click(5, 200);

  // Tornado and quake (after the breather).
  await ana.waitForTimeout(6500);
  await aimAt(ana, 'Tornado', 0.6, 0.5);
  await beto.locator('.impact-tornado').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(1200);
  await beto.screenshot({ path: `${OUT}/fun-06-tornado.png` });
  log('tornado: tiles swirl around the spot');
  log('ALL CHECKS PASSED');
} finally {
  await browser.close();
}

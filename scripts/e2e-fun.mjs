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

  const btn = (page) => page.locator('.throw-btn');
  const center = async (loc) => {
    const b = await loc.boundingBox();
    return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
  };
  const onBoard = async (page, fx, fy) => {
    const b = await page.locator('.board').boundingBox();
    return { x: b.x + b.width * fx, y: b.y + b.height * fy };
  };
  // Picking is done once; it stays picked.
  const pick = async (page, label) => {
    await btn(page).click();
    await page.locator(`.throw-picker [aria-label="${label}"]`).click();
    await page.locator('.throw-picker').waitFor({ state: 'detached' });
  };
  // Or drag the button straight onto a target.
  const dragTo = async (page, to) => {
    const from = await center(btn(page));
    await page.mouse.move(from.x, from.y);
    await page.mouse.down();
    await page.mouse.move(from.x + 20, from.y - 20, { steps: 3 });
    await page.mouse.move(to.x, to.y, { steps: 8 });
    await page.mouse.up();
  };
  const tap = async (page, to) => page.mouse.click(to.x, to.y);
  const bobId = (await view(beto)).youId;
  const bot = (await view(ana)).players.find((p) => p.isBot);

  // Nothing picked yet: tapping the table does nothing special.
  await ana.screenshot({ path: `${OUT}/fun-03a-button.png` });
  await pick(ana, 'Tomate');
  assert((await ana.locator('.armed-hint').count()) === 0, 'no text banner when picking');
  // One tap on the felt throws it: Beto sees it fly from Ana's seat and the stain stay.
  await tap(ana, await onBoard(ana, 0.3, 0.4));
  // It stays picked; while it recharges a tap throws nothing and the seconds show.
  await btn(ana).locator('.throw-wait').waitFor({ timeout: 1000 });
  assert(await btn(ana).evaluate((b) => b.classList.contains('armed')), 'tomato still picked');
  await tap(ana, await onBoard(ana, 0.6, 0.4));
  await beto.locator('.fun-projectile').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(300);
  await beto.screenshot({ path: `${OUT}/fun-03-tomato-flying.png` });
  await beto.locator('.stain-tomato').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(400);
  await beto.screenshot({ path: `${OUT}/fun-04-tomato-splat.png` });
  assert((await beto.locator('.stain-tomato').count()) === 1, 'no second tomato while recharging');
  const flying = () => beto.locator('.fun-projectile').count();
  log('tomato: picked once, one tap on the table throws it');
  log('cooldown: still picked, the seconds show, a tap meanwhile throws nothing');

  // Egg at Beto: pick it, then a single tap on his avatar; it lands on his face.
  await pick(ana, 'Huevo');
  await tap(ana, await center(ana.locator(`.table-screen [data-player-id="${bobId}"]`)));
  await beto.locator('.stain-egg').waitFor({ timeout: 3000 });
  const face = await center(beto.locator(`.table-screen [data-player-id="${bobId}"]`));
  const splat = await center(beto.locator('.stain-egg'));
  assert(Math.hypot(face.x - splat.x, face.y - splat.y) < 12, 'the egg lands on Beto');
  await beto.waitForTimeout(500);
  await beto.screenshot({ path: `${OUT}/fun-05-egg-on-beto.png` });
  assert(
    (await ana.evaluate(() => localStorage.getItem('domino:armed'))) === 'egg',
    'the pick is remembered',
  );
  log('egg: one tap at Beto, it lands on his avatar; the pick is remembered');

  // Bomb: tiles fly off and come back to exactly where they were.
  const boxes = () =>
    ana.evaluate(() =>
      [...document.querySelectorAll('.board .board-tile')].map((t) => {
        const r = t.getBoundingClientRect();
        return `${Math.round(r.x)},${Math.round(r.y)}`;
      }),
    );
  const knocked = () =>
    ana.evaluate(
      () =>
        [...document.querySelectorAll('.board .board-tile')].filter((t) =>
          t.getAnimations().some((a) => !(a instanceof CSSAnimation)),
        ).length,
    );
  const before = await boxes();
  await pick(beto, 'Bomba');
  await dragTo(beto, await onBoard(beto, 0.5, 0.5));
  await ana.locator('.big-boom').waitFor({ timeout: 3000 });
  // The table's breather: right after a bomb nobody can throw a tornado.
  await pick(ana, 'Tornado');
  assert(await btn(ana).evaluate((b) => b.classList.contains('charging')), 'tornado waits');
  log('breather: tornado waits after the bomb');
  await ana.waitForTimeout(250);
  await ana.screenshot({ path: `${OUT}/fun-06-bomb.png` });
  const moving = await knocked();
  assert(moving >= 2, `bomb knocks the tiles around (${moving})`);
  await ana.waitForTimeout(500);
  await ana.screenshot({ path: `${OUT}/fun-07-bomb-scattered.png` });
  await ana.waitForTimeout(3400);
  assert((await knocked()) === 0, 'tiles are back in place after the bomb');
  assert((await boxes()).join() === before.join(), 'every tile is back exactly where it was');
  log(`bomb: ${moving} tiles blown away, all back in place`);

  // Tornado dragged onto an AI's avatar (after the breather).
  await ana.waitForTimeout(2500);
  await dragTo(ana, await center(ana.locator(`.table-screen [data-player-id="${bot.id}"]`)));
  await beto.locator('.big-tornado-sm').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(700);
  await beto.screenshot({ path: `${OUT}/fun-08-tornado-on-ai.png` });
  log('tornado: dragged onto an AI, it spins');

  // "Nada" gives taps back: tapping the table throws nothing.
  await pick(ana, 'Nada');
  await ana.waitForTimeout(1500);
  await tap(ana, await onBoard(ana, 0.5, 0.5));
  await beto.waitForTimeout(400);
  assert((await flying()) === 0, 'nothing thrown with nothing picked');
  log('nothing picked: taps are normal again');

  // A small phone: the button sits by the name, off the table.
  await beto.setViewportSize({ width: 568, height: 320 });
  await beto.waitForTimeout(600);
  const board = await beto.locator('.board').boundingBox();
  const b = await btn(beto).boundingBox();
  assert(b.y >= board.y + board.height || b.x + b.width <= board.x, 'the button is off the table');
  await btn(beto).click();
  await beto.locator('.throw-picker').waitFor();
  const p = await beto.locator('.throw-picker').boundingBox();
  assert(p.x >= 0 && p.x + p.width <= 568 && p.y >= 0, 'the picker fits a small screen');
  await beto.screenshot({ path: `${OUT}/fun-09-small-phone.png` });
  log('small phone: button off the table, picker fits');
  log('ALL CHECKS PASSED');
} finally {
  await browser.close();
}

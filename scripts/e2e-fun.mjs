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

  // Ana throws a tomato at Beto (from Beto's avatar popover on Ana's screen).
  const betoId = await ana.evaluate(
    () => window.__domino.state().view.players.find((p) => p.name === 'Beto').id,
  );
  await ana.locator(`.seat-slot [data-player-id="${betoId}"]`).click();
  await ana.getByRole('button', { name: 'Tomate a Beto' }).click();
  await beto.locator('.fun-projectile').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(330);
  await beto.screenshot({ path: `${OUT}/fun-03-tomato-flying.png` });
  await beto.locator('.fun-impact').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(150);
  await beto.screenshot({ path: `${OUT}/fun-04-tomato-splat.png` });
  log('tomato: flies from Ana to Beto and splats on Beto (seen by Beto)');

  // A bomb at an AI, seen by both.
  const botId = await ana.evaluate(
    () => window.__domino.state().view.players.find((p) => p.isBot).id,
  );
  await ana.locator(`.seat-slot [data-player-id="${botId}"]`).click();
  await ana.locator('.throw-picker button[title="Bomba"]').click();
  await beto.locator('.impact-bomb').waitFor({ timeout: 3000 });
  await beto.waitForTimeout(200);
  await beto.screenshot({ path: `${OUT}/fun-05-bomb.png` });
  log('bomb at an AI: explodes on its seat');

  // Reaction from Beto's own avatar.
  await beto.locator('.self-seat .avatar').click();
  await beto.getByRole('button', { name: 'Reacción 🔥' }).click();
  await ana.locator('.fun-react').first().waitFor({ timeout: 3000 });
  await ana.waitForTimeout(350);
  await ana.screenshot({ path: `${OUT}/fun-06-reaction.png` });
  log('reaction: 🔥 rises from Beto on Ana’s screen');

  log('ALL CHECKS PASSED');
} finally {
  await browser.close();
}

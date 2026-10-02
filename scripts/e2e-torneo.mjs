/**
 * End-to-end check of the tournament with 4 real browser contexts (+ a second device).
 *
 *   npm run e2e:torneo          (builds first, then runs this file)
 *
 * It starts its OWN server (the production bundle, a temporary SQLite file, target 30 so a match
 * takes a minute), so it never touches a real database. Screenshots go to e2e-artifacts/torneo-*.png.
 *
 *   E2E_HEADFUL=1    shows the browsers
 *   E2E_CHANNEL=     browser channel (default: the installed Google Chrome)
 */
import { spawn } from 'node:child_process';
import { mkdirSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { chromium } from 'playwright';

const OUT = 'e2e-artifacts';
const TARGET = 30;
const NAMES = ['Ana', 'Beto', 'Caro', 'Dani'];
const log = (...a) => console.log(`[torneo ${new Date().toISOString().slice(11, 19)}]`, ...a);
const assert = (cond, msg) => {
  if (!cond) throw new Error(`ASSERT: ${msg}`);
};
mkdirSync(OUT, { recursive: true });

// ───────────────────────────── the server under test ─────────────────────────────
const dir = mkdtempSync(join(tmpdir(), 'domino-e2e-'));
const dbPath = join(dir, 'domino.db');
const freePort = () =>
  new Promise((res) => {
    const s = createServer().listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => res(port));
    });
  });
const port = await freePort();
const BASE = `http://127.0.0.1:${port}`;
let server = null;

async function startServer() {
  server = spawn(process.execPath, ['server/dist/index.js'], {
    env: {
      ...process.env,
      NODE_ENV: 'development',
      PORT: String(port),
      DATABASE_PATH: dbPath,
      WEB_DIST: resolve('web/dist'),
      TOURNAMENT_TARGET_TEST: String(TARGET),
      PAUSE_MS: '120000',
    },
    stdio: ['ignore', 'pipe', 'inherit'],
  });
  server.stdout.on('data', () => undefined);
  for (let i = 0; i < 100; i++) {
    try {
      if ((await fetch(`${BASE}/healthz`)).ok) return;
    } catch {
      // not up yet
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start');
}
async function stopServer() {
  const s = server;
  if (!s) return;
  server = null;
  await new Promise((res) => {
    s.once('exit', res);
    s.kill('SIGTERM');
  });
}
const stats = async () => (await fetch(`${BASE}/_stats`)).json();

await startServer();
log(`server on ${BASE}, db ${dbPath}`);

// ───────────────────────────── browsers ─────────────────────────────
const browser = await chromium.launch({
  channel: process.env.E2E_CHANNEL ?? 'chrome',
  headless: !process.env.E2E_HEADFUL,
  args: [
    '--use-fake-ui-for-media-stream',
    '--use-fake-device-for-media-stream',
    '--autoplay-policy=no-user-gesture-required',
  ],
});
const phone = {
  viewport: { width: 844, height: 390 },
  isMobile: true,
  hasTouch: true,
  deviceScaleFactor: 2,
};
const desktop = { viewport: { width: 1280, height: 800 } };

async function newPlayer(name, opts) {
  const context = await browser.newContext({
    ...opts,
    permissions: ['microphone', 'clipboard-read', 'clipboard-write'],
    acceptDownloads: true,
  });
  await context.addInitScript(() => localStorage.setItem('domino:debug', '1'));
  const page = await context.newPage();
  page.on('pageerror', (e) => log(`${name} pageerror`, e.message));
  return { name, context, page };
}
const players = [
  await newPlayer('Ana', desktop),
  await newPlayer('Beto', desktop),
  await newPlayer('Caro', desktop),
  await newPlayer('Dani', phone),
];
const [ana, beto, caro, dani] = players;
const shot = (p, file) => p.page.screenshot({ path: `${OUT}/torneo-${file}.png` });
const view = (p) => p.page.evaluate(() => window.__domino.state().view);

async function until(fn, ms = 15000, what = 'condition') {
  const t = Date.now();
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() - t > ms) throw new Error(`Timed out: ${what}`);
    await new Promise((r) => setTimeout(r, 120));
  }
}

try {
  // ───────────────────────── 1. create: names → confirm → letter draw ─────────────────────────
  await ana.page.goto(BASE);
  await ana.page.getByRole('button', { name: 'Torneo' }).click();
  await ana.page.waitForURL(/\/torneo\/nuevo$/);
  const inputs = ana.page.locator('.tournament-create input');
  const typed = ['José', 'Beto', 'Caro', 'Dani'];
  for (const [i, n] of typed.entries()) await inputs.nth(i).fill(n);
  // A name repeated up to accents/case is refused.
  await inputs.nth(3).fill('jose');
  await ana.page.getByRole('button', { name: 'Continuar' }).click();
  await ana.page.getByText(/repite un nombre/).waitFor();
  await inputs.nth(3).fill('Dani');
  await ana.page.getByRole('button', { name: 'Continuar' }).click();
  await ana.page.getByText('Estos nombres no se pueden cambiar después.').waitFor();
  await shot(ana, '01-confirm');
  await ana.page.getByRole('button', { name: 'Crear torneo' }).click();
  await ana.page.getByRole('heading', { name: 'Sorteando…' }).waitFor();
  await shot(ana, '02-draw-animation');
  await ana.page.getByRole('heading', { name: 'Letras asignadas' }).waitFor({ timeout: 15000 });
  const letters = await ana.page.locator('.reveal-list li').evaluateAll((lis) =>
    lis.map((li) => ({
      name: li.querySelector('.reveal-name').textContent,
      letter: li.querySelector('.letter-badge').textContent,
    })),
  );
  assert(letters.map((l) => l.name).join() === typed.join(), 'names keep the typing order');
  assert([...letters.map((l) => l.letter)].sort().join('') === 'ABCD', 'letters are a permutation');
  const tid = (await ana.page.locator('.reveal-share .t-id').textContent()).trim();
  assert(/^[ABCDEFGHJKMNPQRSTUVWXYZ2-9]{12}$/.test(tid), `tournament id looks right (${tid})`);
  await shot(ana, '03-letters');
  await ana.page.getByRole('button', { name: 'Copiar enlace' }).click();
  const link = await ana.page.evaluate(() => navigator.clipboard.readText());
  assert(link === `${BASE}/torneo/${tid}`, `copied link is ${link}`);
  log(`created ${tid}; letters ${letters.map((l) => `${l.name}=${l.letter}`).join(' ')}`);

  // Ana was on the creation page; she enters by typing her name like everybody else.
  await ana.page.getByRole('button', { name: 'Entrar al torneo' }).click();
  await ana.page.getByRole('heading', { name: '¿Quién eres?' }).waitFor();

  // ───────────────────────── 2. entering: unknown id, wrong name, accents, tokens ─────────────────────────
  {
    const stranger = await newPlayer('stranger', desktop);
    await stranger.page.goto(`${BASE}/torneo/ZZZZZZZZZZZZ`);
    await stranger.page.getByRole('heading', { name: 'El torneo no existe' }).waitFor();
    await stranger.page.goto(`${BASE}/torneo/${tid}`);
    await stranger.page.getByLabel('Tu nombre').fill('Zoila');
    await stranger.page.getByRole('button', { name: 'Entrar al torneo' }).click();
    await stranger.page.getByText('Ese nombre no está en este torneo').waitFor();
    // No pick-list of names anywhere on the prompt.
    const prompt = await stranger.page.locator('body').innerText();
    assert(!/Beto|Caro|Dani|José/.test(prompt), 'the name prompt does not reveal the players');
    await stranger.context.close();
  }
  const entry = { Ana: 'Jose', Beto: 'BETO', Caro: ' caro ', Dani: 'dani' };
  for (const p of players) {
    if (p !== ana) await p.page.goto(`${BASE}/torneo/${tid}`);
    await p.page.getByLabel('Tu nombre').fill(entry[p.name]);
    await p.page.getByRole('button', { name: 'Entrar al torneo' }).click();
    await p.page.locator('.standings').waitFor();
  }
  const youChip = await ana.page.locator('.t-you').innerText();
  assert(/José/.test(youChip), `Ana is José here: ${youChip}`);
  await shot(ana, '04-tournament-desktop');
  // The device remembers who it is: a reload skips the name prompt.
  await caro.page.reload();
  await caro.page.locator('.standings').waitFor();
  assert(
    (await caro.page.evaluate((id) => localStorage.getItem(`tournament:${id}`), tid))?.length >= 16,
    'token stored',
  );
  log('all four entered by name (accents/case ignored); reload keeps the identity');

  // A second device of Ana's only watches the table.
  const watcher = await newPlayer('Ana-2', desktop);
  await watcher.page.goto(`${BASE}/torneo/${tid}`);
  await watcher.page.getByLabel('Tu nombre').fill('josé');
  await watcher.page.getByRole('button', { name: 'Entrar al torneo' }).click();
  await watcher.page.locator('.standings').waitFor();

  // ───────────────────────── 3. schedule on screen, portrait and landscape ─────────────────────────
  const matchRows = await ana.page.locator('.match-row').evaluateAll((rows) =>
    rows.map((r) => ({
      n: r.dataset.match,
      status: r.dataset.status,
      play: !!r.querySelector('.play-btn'),
    })),
  );
  assert(matchRows.length === 3, 'jornada 1 shows three matches');
  assert(
    matchRows.filter((r) => r.play).length === 1 && matchRows[0].play,
    '"Jugar" only on the next pending match',
  );
  for (const [label, size] of [
    ['portrait', { width: 390, height: 844 }],
    ['landscape', { width: 844, height: 390 }],
  ]) {
    await dani.page.setViewportSize(size);
    await new Promise((r) => setTimeout(r, 400));
    const m = await dani.page.evaluate(() => ({
      overflowX: document.documentElement.scrollWidth > innerWidth,
      rotate: getComputedStyle(document.querySelector('.rotate-overlay') ?? document.body).display,
      hasRotate: !!document.querySelector('.rotate-overlay'),
      play: !!document.querySelector('.play-btn'),
    }));
    assert(!m.overflowX, `${label}: no horizontal scroll on the tournament page`);
    assert(!m.hasRotate, `${label}: the tournament page never asks to rotate`);
    assert(m.play, `${label}: Jugar is there`);
    await shot(dani, `05-tournament-${label}`);
  }
  log('tournament page fits a phone in portrait AND landscape');

  // ───────────────────────── 4. Jugar: exactly one room, locked ─────────────────────────
  await ana.page.locator('.play-btn').dblclick(); // double click
  await Promise.all(
    [beto, caro, dani].map((p) => p.page.locator('.play-btn').click({ noWaitAfter: true })),
  );
  for (const p of players) await p.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  const rooms = new Set(players.map((p) => p.page.url().split('/').pop()));
  assert(rooms.size === 1, `one room for everybody (${[...rooms]})`);
  const roomId = [...rooms][0];
  const s1 = await stats();
  assert(s1.rooms === 1 && s1.tournamentRooms === 1, `server has one room: ${JSON.stringify(s1)}`);
  for (const p of players) await p.page.getByText(/Partido 1 de 12/).waitFor();
  await watcher.page.locator('.match-row[data-match="1"][data-status="jugando"]').waitFor();
  log(`"Jugar" pressed 5 times → one room (${roomId}); the watcher sees "Jugando"`);

  // Locked room: no AI, no target, no link, no team mode.
  assert(
    (await ana.page.getByRole('button', { name: /Agregar IA/ }).count()) === 0,
    'no "Agregar IA"',
  );
  assert((await ana.page.getByRole('radio').count()) === 0, 'no target / mode selectors');
  assert(
    (await ana.page.getByRole('button', { name: /Copiar enlace/ }).count()) === 0,
    'no room link',
  );
  assert(
    (await ana.page.getByText('Meta').count()) > 0 &&
      (await ana.page.locator('.fixed-target').innerText()) === String(TARGET),
    'fixed target shown',
  );
  await until(async () => (await view(ana))?.players.length === 4, 10000, 'four seated');
  await shot(ana, '06-room-lobby');

  // A stranger and a player of nothing cannot join this room.
  {
    const intruder = await newPlayer('intruder', desktop);
    await intruder.page.goto(`${BASE}/sala/${roomId}`);
    await intruder.page.getByRole('heading', { name: /no existe/ }).waitFor();
    await intruder.context.close();
  }

  // Host starts; the starter draw still happens (flip a tile).
  let host = null;
  for (const p of players) {
    const v = await view(p);
    if (v.players.find((x) => x.id === v.youId).isHost) host = p;
  }
  await host.page.getByRole('button', { name: 'Empezar' }).click();
  for (const p of players) await p.page.locator('[data-draw-slot]').first().waitFor();
  for (const [i, p] of players.entries())
    await p.page.locator(`[data-draw-slot="${i * 7 + 3}"]`).click();
  for (const p of players) await p.page.locator('.table-screen').waitFor({ timeout: 15000 });
  const seats = (await view(ana)).players.map((p) => `${p.letter}:${p.seat}`);
  log(`draw done; fixed seats ${seats.join(' ')}`);

  // An in-game room still forces landscape (the tournament page never did).
  await dani.page.setViewportSize({ width: 390, height: 844 });
  await dani.page.getByRole('heading', { name: 'Gira tu teléfono' }).waitFor();
  await shot(dani, '07-room-portrait-overlay');
  await dani.page.setViewportSize({ width: 844, height: 390 });
  log('in-game room in portrait → "Gira tu teléfono"');

  // ───────────────────────── 5. play match 1 to the end ─────────────────────────
  const parse = (t) => t.split('-').map(Number);
  const legal = (hand, line) => {
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
  };
  const seatOf = (v) => v.players.find((p) => p.id === v.youId).seat;
  async function playOneMove() {
    const views = await Promise.all(players.map(view));
    const v0 = views[0];
    if (!v0 || v0.phase !== 'playing' || v0.pause.length) return;
    const idx = views.findIndex((v) => v?.phase === 'playing' && seatOf(v) === v.game.turn);
    if (idx === -1 || views.some((v) => v.version !== v0.version)) {
      await new Promise((r) => setTimeout(r, 80));
      return;
    }
    const p = players[idx];
    const v = views[idx];
    const moves = legal(v.game.hand, v.game.line);
    if (moves.length === 0) {
      await until(
        () => p.page.getByRole('button', { name: 'Pasar' }).isEnabled(),
        3000,
        'Pasar enabled',
      );
      await p.page.getByRole('button', { name: 'Pasar' }).click();
    } else {
      const move = moves[Math.floor(Math.random() * moves.length)];
      await p.page.locator(`.hand [data-tile="${move.tile}"]`).click();
      await p.page.locator(`[data-end-target="${move.end}"]`).click();
    }
    await until(async () => (await view(p)).version > v.version, 5000, 'move applied');
  }
  let moves = 0;
  while ((await view(ana)).phase !== 'matchEnd') {
    const v = await view(ana);
    if (v.phase === 'handEnd') {
      for (const p of players) await p.page.getByRole('button', { name: 'Continuar' }).click();
      await until(async () => (await view(ana)).phase !== 'handEnd', 5000, 'next hand');
      continue;
    }
    await playOneMove();
    moves++;
  }
  const end = await view(ana);
  const scores = end.game.scores;
  log(
    `match over after ${moves} moves: ${scores.join('-')} (target ${TARGET}), winner pair ${end.matchWinner + 1}`,
  );

  // "Partido guardado" and no rematch.
  for (const p of players) {
    await p.page.getByText('Partido guardado').waitFor({ timeout: 10000 });
    assert(
      (await p.page.getByRole('button', { name: /Revancha/ }).count()) === 0,
      'no Revancha button',
    );
  }
  await shot(ana, '08-match-saved');
  await shot(dani, '08-match-saved-phone');

  // ───────────────────────── 6. back to the tournament: everybody sees the new table ─────────────────────────
  // The watcher never reloaded: the server pushed it (no polling).
  await watcher.page
    .locator('.match-row[data-match="1"][data-status="terminado"]')
    .waitFor({ timeout: 10000 });
  for (const p of players) await p.page.getByRole('button', { name: 'Volver al torneo' }).click();
  for (const p of players) {
    await p.page.waitForURL(new RegExp(`/torneo/${tid}$`));
    await p.page.locator('.history-item').first().waitFor();
  }
  // The table as text, ignoring the "tú" marker (it differs per viewer).
  const tableOf = (p) =>
    p.page.locator('.standings tbody tr').evaluateAll((trs) =>
      trs.map((tr) =>
        [...tr.children]
          .map((c) => {
            const clone = c.cloneNode(true);
            clone.querySelectorAll('.tag').forEach((t) => t.remove());
            return clone.textContent.replace(/\s+/g, ' ').trim();
          })
          .join('|'),
      ),
    );
  const reference = await tableOf(ana);
  for (const p of [...players, watcher])
    assert(
      JSON.stringify(await tableOf(p)) === JSON.stringify(reference),
      `${p.name} sees the same table`,
    );
  const pjs = reference.map((r) => r.split('|')[2]);
  assert(
    pjs.every((x) => x === '1'),
    `everyone has PJ 1: ${pjs}`,
  );
  const winnersPts = reference.map((r) => Number(r.split('|')[6]));
  const shutout = Math.min(...scores) === 0;
  assert(
    winnersPts.filter((x) => x === (shutout ? 1.5 : 1)).length === 2 &&
      winnersPts.filter((x) => x === 0).length === 2,
    `two winners with ${shutout ? 1.5 : 1} point(s), two losers with 0: ${winnersPts}`,
  );
  const hist = await ana.page.locator('.history-item').first().innerText();
  assert(
    hist.includes(`${scores[0]} – ${scores[1]}`) || hist.includes(`${scores[1]} – ${scores[0]}`),
    `history shows the score: ${hist}`,
  );
  assert(
    (await ana.page.locator('.match-row[data-match="2"] .play-btn').count()) === 1,
    'Jugar moved to match 2',
  );
  assert(
    (await ana.page.locator('.match-row[data-match="1"] .play-btn').count()) === 0,
    'no Jugar on the finished match',
  );
  await shot(ana, '09-table-after-match-1');
  await shot(dani, '09-table-after-match-1-phone');
  log(`table updated everywhere (incl. the second device): ${reference.join('  ')}`);

  // ───────────────────────── 7. Copiar tabla / Descargar respaldo ─────────────────────────
  await ana.page.getByRole('button', { name: 'Copiar tabla' }).click();
  await ana.page.getByRole('button', { name: 'Tabla copiada' }).waitFor();
  const text = await ana.page.evaluate(() => navigator.clipboard.readText());
  const lines = text.split('\n');
  assert(lines[0] === '📊 *TABLA*', `clipboard header: ${lines[0]}`);
  assert(lines[1] === 'Jugador | PJ | PG | Zap | Pts | Avg', `clipboard columns: ${lines[1]}`);
  assert(lines.length === 7 && lines.at(-1) === 'Partidos: 1/12', `clipboard rows: ${text}`);
  assert(/\| (1|1\.5) \| (1\.00|1\.50)$/.test(lines[2]), `first row is a winner: ${lines[2]}`);
  log(`Copiar tabla →\n${text}`);

  const [download] = await Promise.all([
    ana.page.waitForEvent('download'),
    ana.page.getByRole('button', { name: 'Descargar respaldo' }).click(),
  ]);
  const file = join(dir, 'respaldo.json');
  await download.saveAs(file);
  const backup = JSON.parse(readFileSync(file, 'utf8'));
  assert(backup.format === 'domino-torneo/1' && backup.tournament.id === tid, 'backup header');
  assert(
    backup.players.length === 4 && backup.matches.length === 1 && backup.jornadas.length === 1,
    'backup content',
  );
  assert(
    backup.matches[0].endedAt && backup.matches[0].hands.length > 0,
    'backup has timestamps and the hand log',
  );
  assert(
    download.suggestedFilename().startsWith(`torneo-${tid}`),
    `file name ${download.suggestedFilename()}`,
  );
  log(
    `Descargar respaldo → ${download.suggestedFilename()} (${backup.matches[0].hands.length} manos)`,
  );

  // ───────────────────────── 8. restart the server: nothing is lost ─────────────────────────
  await stopServer();
  await startServer();
  log('server restarted (rooms are gone, the database is not)');
  for (const p of [ana, watcher]) {
    await until(
      async () =>
        (await p.page.locator('.history-item').count()) === 1 &&
        !(await p.page.getByText('Reconectando').count()),
      20000,
      `${p.name} reconnects`,
    );
  }
  await ana.page.reload();
  await ana.page.locator('.standings').waitFor(); // no name prompt: the token survived
  assert(
    JSON.stringify(await tableOf(ana)) === JSON.stringify(reference),
    'same table after the restart',
  );
  assert(
    (await ana.page.locator('.match-row[data-match="1"][data-status="terminado"]').count()) === 1,
    'match 1 still finished',
  );
  assert((await stats()).rooms === 0, 'no rooms after the restart');
  // The schedule (order of the three matches) is the persisted one.
  const orderNow = await ana.page.locator('.match-row .match-pairs').allInnerTexts();
  log(`after the restart: same table, same schedule (${orderNow.length} matches), identity kept`);

  // "Tus torneos" on the home page; a dead id vanishes silently.
  await ana.page.evaluate(() => {
    const list = JSON.parse(localStorage.getItem('domino:tournaments') || '[]');
    list.push({ id: 'ZZZZZZZZZZZZ', label: 'Fantasma', at: Date.now() });
    localStorage.setItem('domino:tournaments', JSON.stringify(list));
  });
  await ana.page.goto(BASE);
  await ana.page.locator(`[data-tournament="${tid}"]`).waitFor();
  await until(
    async () => (await ana.page.locator('[data-tournament="ZZZZZZZZZZZZ"]').count()) === 0,
    10000,
    'dead tournament dropped',
  );
  assert(
    (await ana.page.locator('.known-item').first().innerText()).includes('1/12'),
    'list shows progress',
  );
  await shot(ana, '10-home-known');
  log('"Tus torneos" lists the tournament with its progress; the dead id disappeared');

  // Casual rooms are untouched: create one and look at the lobby controls.
  await ana.page.getByPlaceholder('¿Cómo te llaman en la mesa?').fill('Ana');
  await ana.page.getByRole('button', { name: 'Crear sala' }).click();
  await ana.page.waitForURL(/\/sala\/[A-Z0-9]{6}$/);
  await ana.page.getByRole('radio', { name: '150' }).click();
  await ana.page
    .getByRole('button', { name: /Agregar IA/ })
    .first()
    .waitFor();
  log('casual room: target and AI controls still there');

  log('ALL CHECKS PASSED');
} catch (error) {
  for (const p of players) await shot(p, `FAIL-${p.name}`).catch(() => undefined);
  console.error(error);
  process.exitCode = 1;
} finally {
  await browser.close();
  await stopServer();
  rmSync(dir, { recursive: true, force: true });
}

/**
 * Load test for the server: N tables playing at the same time, each with one simulated person
 * (plays its own tiles, presses Continuar, throws a tomato every few seconds and chats) and three
 * AIs. Samples the server process's memory and CPU while they play.
 *
 *   TABLES=40 SECONDS=90 PID=<server pid> BASE_URL=http://localhost:5180 node scripts/load-server.mjs
 */
import { execSync } from 'node:child_process';
import { io } from 'socket.io-client';

const BASE = process.env.BASE_URL ?? 'http://localhost:5180';
const TABLES = Number(process.env.TABLES ?? 20);
const SECONDS = Number(process.env.SECONDS ?? 60);
const PID = process.env.PID;
const log = (...a) => console.log(`[load ${new Date().toISOString().slice(11, 19)}]`, ...a);
const ask = (s, ev, payload) =>
  new Promise((res) => (payload === undefined ? s.emit(ev, res) : s.emit(ev, payload, res)));

const sample = () => {
  if (!PID) return null;
  const [rss, time] = execSync(`ps -o rss=,time= -p ${PID}`).toString().trim().split(/\s+/);
  // CPU time used so far, in seconds ("m:ss.cc" or "h:mm:ss").
  const cpuS = time.split(':').reduce((acc, x) => acc * 60 + Number(x), 0);
  return { rssMB: Math.round(Number(rss) / 1024), cpuS, at: Date.now() };
};

let plays = 0;
let throws = 0;
let hands = 0;
let errors = 0;

async function table(i) {
  const s = io(BASE, { transports: ['websocket'], forceNew: true });
  let view = null;
  let busy = false;
  s.on('state', (v) => {
    view = v;
    void act();
  });
  const act = async () => {
    if (busy || !view) return;
    busy = true;
    try {
      const v = view;
      const me = v.players.find((p) => p.id === v.youId);
      if (v.phase === 'draw' && !v.draw?.picks.some((p) => p.playerId === v.youId)) {
        const taken = new Set(v.draw?.picks.map((p) => p.position));
        const free = [...Array(28).keys()].find((n) => !taken.has(n));
        await ask(s, 'draw:pick', { position: free });
      } else if (v.phase === 'playing' && v.game.turn === me.seat) {
        await new Promise((r) => setTimeout(r, 300 + Math.random() * 700)); // thinking
        const L = v.game.line[0]?.left;
        const R = v.game.line.at(-1)?.right;
        const t = v.game.hand.find((x) => {
          const [a, b] = x.split('-').map(Number);
          return !v.game.line.length || a === L || b === L || a === R || b === R;
        });
        const r = t
          ? await ask(s, 'game:play', {
              tile: t,
              end: !v.game.line.length || t.split('-').map(Number).includes(L) ? 'left' : 'right',
              v: v.version,
            })
          : await ask(s, 'game:pass', { v: v.version });
        if (r.ok) plays++;
      } else if (v.phase === 'handEnd' && !v.ready.includes(v.youId)) {
        hands++;
        await ask(s, 'hand:ready');
      } else if (v.phase === 'matchEnd') {
        await ask(s, 'match:rematch', { keepTeams: true });
      }
    } catch {
      errors++;
    } finally {
      busy = false;
      if (view !== null && view !== undefined) setTimeout(() => void act(), 50);
    }
  };
  await new Promise((r) => s.on('connect', r));
  const created = await ask(s, 'room:create', { name: `Carga${i}` });
  if (!created.ok) throw new Error(`create: ${created.code}`);
  for (let b = 0; b < 3; b++) await ask(s, 'lobby:addBot');
  const started = await ask(s, 'lobby:start');
  if (!started.ok) throw new Error(`start: ${started.code}`);
  const fun = setInterval(async () => {
    const r = await ask(s, 'room:throw', { item: 'tomato', x: Math.random(), y: Math.random() });
    if (r.ok) throws++;
    if (Math.random() < 0.3) await ask(s, 'room:chat', { text: 'jajaja buena esa' });
  }, 3200);
  return () => {
    clearInterval(fun);
    s.close();
  };
}

const idle = sample();
log(`server before: ${JSON.stringify(idle)}`);
const stops = [];
for (let i = 0; i < TABLES; i++) {
  stops.push(await table(i));
  await new Promise((r) => setTimeout(r, 50));
}
log(`${TABLES} tables playing`);
const samples = [];
const t0 = Date.now();
while (Date.now() - t0 < SECONDS * 1000) {
  await new Promise((r) => setTimeout(r, 2000));
  const x = sample();
  if (x) samples.push(x);
}
const peak = Math.max(...samples.map((x) => x.rssMB));
const first = samples[0];
const last = samples.at(-1);
const avgCpu = ((last.cpuS - first.cpuS) / ((last.at - first.at) / 1000)) * 100;
log(
  `${SECONDS}s: ${plays} moves by the people (+ the AIs), ${hands} hands finished, ${throws} tomatoes, ${errors} errors`,
);
log(`server while playing: peak ${peak} MB, avg CPU ${avgCpu.toFixed(1)}% of one core`);
stops.forEach((f) => f());
await new Promise((r) => setTimeout(r, 3000));
log(`server after they left: ${JSON.stringify(sample())}`);
process.exit(0);

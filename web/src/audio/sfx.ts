import { storage } from '../net/storage';
import { getAudioContext } from './context';

/** Sound effects are synthesized with Web Audio: no audio files, nothing to download. */
let enabled = storage.getSound();
const listeners = new Set<() => void>();

export const sfx = {
  isEnabled: () => enabled,
  setEnabled(on: boolean) {
    enabled = on;
    storage.setSound(on);
    listeners.forEach((l) => l());
  },
  subscribe(fn: () => void) {
    listeners.add(fn);
    return () => listeners.delete(fn);
  },
  /** The dry "clack" of a tile landing on the table. */
  tile() {
    const ctx = ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    const out = ctx.createGain();
    out.gain.value = 0.55;
    out.connect(ctx.destination);

    const noise = ctx.createBufferSource();
    const len = Math.floor(ctx.sampleRate * 0.08);
    const buf = ctx.createBuffer(1, len, ctx.sampleRate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 6);
    noise.buffer = buf;
    const band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.frequency.value = 2400;
    band.Q.value = 1.4;
    noise.connect(band).connect(out);
    noise.start(t);

    const body = ctx.createOscillator();
    body.type = 'triangle';
    body.frequency.setValueAtTime(420, t);
    body.frequency.exponentialRampToValueAtTime(140, t + 0.07);
    const bodyGain = ctx.createGain();
    bodyGain.gain.setValueAtTime(0.5, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.001, t + 0.09);
    body.connect(bodyGain).connect(out);
    body.start(t);
    body.stop(t + 0.1);
  },
  /** Two soft marimba-like notes: it's your turn. */
  turn() {
    const ctx = ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [
      [659.25, 0],
      [987.77, 0.11],
    ].forEach(([freq, delay]) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.value = freq as number;
      const g = ctx.createGain();
      const start = t + (delay as number);
      g.gain.setValueAtTime(0.0001, start);
      g.gain.exponentialRampToValueAtTime(0.22, start + 0.012);
      g.gain.exponentialRampToValueAtTime(0.0001, start + 0.5);
      osc.connect(g).connect(ctx.destination);
      osc.start(start);
      osc.stop(start + 0.55);
    });
  },
  /** A muted double knock on the table: someone passed. */
  pass() {
    const ctx = ready();
    if (!ctx) return;
    const t = ctx.currentTime;
    [0, 0.13].forEach((delay) => {
      const osc = ctx.createOscillator();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(180, t + delay);
      osc.frequency.exponentialRampToValueAtTime(90, t + delay + 0.08);
      const g = ctx.createGain();
      g.gain.setValueAtTime(0.35, t + delay);
      g.gain.exponentialRampToValueAtTime(0.001, t + delay + 0.1);
      osc.connect(g).connect(ctx.destination);
      osc.start(t + delay);
      osc.stop(t + delay + 0.12);
    });
  },
};

function ready(): AudioContext | null {
  if (!enabled) return null;
  const ctx = getAudioContext();
  return ctx && ctx.state === 'running' ? ctx : null;
}

import type { MicState, SignalPayload } from '@domino/shared';
import { getAudioContext, onAudioStateChange } from '../audio/context';
import { isIOS } from '../ui/landscape';

/**
 * Voice chat: a WebRTC full mesh (max 6 connections for 4 players) signaled over Socket.IO,
 * using the "perfect negotiation" pattern. The mic is always open; muting only disables
 * the track. Without a mic the user still receives everyone else's audio.
 */

export type PeerConn = 'connecting' | 'connected' | 'failed';
export type MicIssue = 'denied' | 'nodevice' | 'insecure' | null;

export interface PeerSnapshot {
  conn: PeerConn;
  volume: number;
  muted: boolean;
}

export interface VoiceSnapshot {
  mic: MicState | 'pending';
  micIssue: MicIssue;
  /** playerId → currently speaking (includes yourself). */
  speaking: Record<string, boolean>;
  peers: Record<string, PeerSnapshot>;
  audioBlocked: boolean;
}

/** Someone to keep a voice connection with. `name` keys the volume you chose for them. */
export interface VoicePeerInfo {
  id: string;
  name?: string;
  connected: boolean;
  voiceSession: string | null;
}

/** 'room': a casual room's call. 'tournament': one call for a whole tournament. */
export type VoiceContext = 'room' | 'tournament';

interface EnterOptions {
  context: VoiceContext;
  selfId: string;
  iceServers: RTCIceServer[];
  sendSignal: (to: string, toSession: string, data: SignalPayload) => void;
  sendMic: (mic: MicState) => void;
}

const AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
};

const SPEAKING_THRESHOLD = 0.018;
const SPEAKING_HOLD_MS = 400;
/** Speaking indicators: 6 checks a second is plenty and keeps phones cool. */
const METER_INTERVAL_MS = 160;
/** Opus speech is clear at 32 kbps; the default (~64 kbps) costs CPU and battery for nothing. */
const VOICE_MAX_BITRATE = 32_000;
const RESTART_AFTER_MS = 4000;
const HARD_RESET_AFTER_MS = 15000;

/**
 * iPhone/iPad Safari ignores HTMLMediaElement.volume (it even reads back the value you set), so
 * there a voice you turned down goes through a Web Audio gain. Everything else plays on the
 * element, which keeps the browser's echo cancellation on its native path.
 */
const useWebAudioOutput = isIOS();

const PREFS_KEY = 'domino:voice-prefs';
type Pref = { volume: number; muted: boolean };
const DEFAULT_PREF: Pref = { volume: 1, muted: false };
const nameKey = (name: string) => name.trim().toLocaleLowerCase('es');

function loadPrefs(): Map<string, Pref> {
  try {
    const raw = JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') as Record<string, Pref>;
    return new Map(Object.entries(raw));
  } catch {
    return new Map();
  }
}

function savePrefs(prefs: Map<string, Pref>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify(Object.fromEntries(prefs)));
  } catch {
    // storage blocked: the choice still applies for this visit
  }
}

/** RMS level of a stream through an AnalyserNode. */
class Meter {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buf: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 256;
    this.buf = new Float32Array(this.analyser.fftSize);
    this.source.connect(this.analyser);
  }

  get node(): MediaStreamAudioSourceNode {
    return this.source;
  }

  level(): number {
    this.analyser.getFloatTimeDomainData(this.buf);
    let sum = 0;
    for (const v of this.buf) sum += v * v;
    return Math.sqrt(sum / this.buf.length);
  }

  dispose(): void {
    this.source.disconnect();
    this.analyser.disconnect();
  }
}

class Peer {
  readonly pc: RTCPeerConnection;
  readonly polite: boolean;
  readonly audio: HTMLAudioElement;
  /** Our audio transceiver; the answering side adopts the one created by the first offer. */
  transceiver: RTCRtpTransceiver | null = null;
  makingOffer = false;
  ignoreOffer = false;
  conn: PeerConn = 'connecting';
  stream: MediaStream | null = null;
  meter: Meter | null = null;
  gain: GainNode | null = null;
  name: string | undefined;
  lastSpoke = 0;
  queue: Promise<void> = Promise.resolve();
  timers: ReturnType<typeof setTimeout>[] = [];
  closed = false;

  constructor(
    readonly id: string,
    readonly session: string,
    selfId: string,
    iceServers: RTCIceServer[],
    localTrack: MediaStreamTrack | null,
    localStream: MediaStream | null,
  ) {
    this.polite = selfId > id;
    this.pc = new RTCPeerConnection({ iceServers });
    // Only the impolite side opens the connection, so the first negotiation never collides.
    // A single sendrecv m-line carries audio both ways; without a mic it just sends nothing,
    // and a mic that shows up later is attached with replaceTrack (no renegotiation).
    if (!this.polite) {
      this.transceiver = this.pc.addTransceiver(localTrack ?? 'audio', {
        direction: 'sendrecv',
        streams: localStream ? [localStream] : [],
      });
    }
    this.audio = document.createElement('audio');
    this.audio.autoplay = true;
    this.audio.setAttribute('playsinline', '');
    this.audio.dataset.peer = id;
    audioHost().appendChild(this.audio);
  }

  close(): void {
    this.closed = true;
    this.timers.forEach(clearTimeout);
    this.timers = [];
    this.meter?.dispose();
    this.gain?.disconnect();
    this.pc.close();
    this.audio.pause();
    this.audio.srcObject = null;
    this.audio.remove();
  }
}

let host: HTMLDivElement | null = null;
function audioHost(): HTMLDivElement {
  if (!host) {
    host = document.createElement('div');
    host.id = 'voice-audio';
    host.style.display = 'none';
    document.body.appendChild(host);
  }
  return host;
}

class VoiceManager {
  private opts: EnterOptions | null = null;
  /** Room player ids that are the same person as a tournament call member ('T:A'). */
  private aliases = new Map<string, string>();
  private names = new Map<string, string>();
  private mix: DynamicsCompressorNode | null = null;
  /** Peer connections ever created (e2e: a screen change must not rebuild the call). */
  private created = 0;
  private localStream: MediaStream | null = null;
  private selfMeter: Meter | null = null;
  private selfLastSpoke = 0;
  private peers = new Map<string, Peer>();
  /** Volume/mute you chose for each person, by name, remembered on this device. */
  private prefs = loadPrefs();
  private loop: ReturnType<typeof setInterval> | null = null;
  private listeners = new Set<() => void>();
  private snap: VoiceSnapshot = {
    mic: 'pending',
    micIssue: null,
    speaking: {},
    peers: {},
    audioBlocked: false,
  };

  // ─── store plumbing ───
  subscribe = (fn: () => void) => {
    this.listeners.add(fn);
    return () => {
      this.listeners.delete(fn);
    };
  };

  getSnapshot = () => this.snap;

  constructor() {
    // iOS: voices go through Web Audio, which only plays once the context runs (after a tap).
    if (useWebAudioOutput) {
      onAudioStateChange(() => {
        for (const p of this.peers.values()) this.applyOutput(p);
      });
    }
  }

  get context(): VoiceContext | null {
    return this.opts?.context ?? null;
  }

  get selfId(): string | null {
    return this.opts?.selfId ?? null;
  }

  private update(patch: Partial<VoiceSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    // Room player ids that are tournament call members see the same speaking/peer state.
    if (this.aliases.size > 0) {
      const speaking = { ...this.snap.speaking };
      const peers = { ...this.snap.peers };
      for (const [alias, key] of this.aliases) {
        if (key in speaking) speaking[alias] = speaking[key] as boolean;
        if (key in peers) peers[alias] = peers[key] as PeerSnapshot;
      }
      this.snap = { ...this.snap, speaking, peers };
    }
    this.listeners.forEach((l) => l());
  }

  private resolve(id: string): string {
    return this.aliases.get(id) ?? id;
  }

  private prefKey(id: string): string {
    const name = this.names.get(id);
    return name ? nameKey(name) : id;
  }

  private prefOf(id: string): Pref {
    return this.prefs.get(this.prefKey(id)) ?? DEFAULT_PREF;
  }

  private refreshPeers(): void {
    const peers: Record<string, PeerSnapshot> = {};
    for (const p of this.peers.values()) peers[p.id] = { conn: p.conn, ...this.prefOf(p.id) };
    this.update({ peers });
  }

  /** In a tournament room: which room player is which call member (by seat → letter). */
  setAliases(map: Map<string, string>): void {
    const same =
      map.size === this.aliases.size && [...map].every(([k, v]) => this.aliases.get(k) === v);
    if (same) return;
    this.aliases = map;
    this.update({});
  }

  // ─── lifecycle ───
  enter(opts: EnterOptions): void {
    if (this.opts?.selfId === opts.selfId && this.opts.context === opts.context) {
      this.opts = opts;
      if (this.snap.mic !== 'pending') opts.sendMic(this.snap.mic);
      return;
    }
    this.leave();
    this.opts = opts;
    void this.startMic();
    this.loop = setInterval(() => this.measure(), METER_INTERVAL_MS);
  }

  /** Hangs up, but only the call of that kind (leaving a tournament room keeps its call). */
  leaveIf(context: VoiceContext): void {
    if (this.opts?.context === context) this.leave();
  }

  leave(): void {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
    this.aliases = new Map();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.selfMeter?.dispose();
    this.selfMeter = null;
    if (this.loop) clearInterval(this.loop);
    this.loop = null;
    this.opts = null;
    this.snap = { mic: 'pending', micIssue: null, speaking: {}, peers: {}, audioBlocked: false };
    this.listeners.forEach((l) => l());
  }

  private async startMic(): Promise<void> {
    const opts = this.opts;
    if (!navigator.mediaDevices?.getUserMedia) {
      this.setMicOff(window.isSecureContext ? 'nodevice' : 'insecure');
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: AUDIO_CONSTRAINTS,
        video: false,
      });
      if (this.opts !== opts) {
        stream.getTracks().forEach((t) => t.stop());
        return;
      }
      const track = stream.getAudioTracks()[0];
      if (!track) {
        this.setMicOff('nodevice');
        return;
      }
      this.localStream = stream;
      track.addEventListener('ended', () => {
        // Mic unplugged mid-game: keep listening, show the mic as unavailable.
        if (this.localStream === stream) this.setMicOff('nodevice');
      });
      for (const p of this.peers.values()) void p.transceiver?.sender.replaceTrack(track);
      this.update({ mic: 'on', micIssue: null });
      this.opts?.sendMic('on');
    } catch (err) {
      const name = (err as DOMException)?.name;
      this.setMicOff(
        name === 'NotAllowedError' || name === 'SecurityError' ? 'denied' : 'nodevice',
      );
    }
  }

  private setMicOff(issue: MicIssue): void {
    this.selfMeter?.dispose();
    this.selfMeter = null;
    this.update({ mic: 'off', micIssue: issue });
    this.opts?.sendMic('off');
  }

  toggleMute(): void {
    const track = this.localStream?.getAudioTracks()[0];
    if (!track || track.readyState === 'ended') return;
    track.enabled = !track.enabled;
    const mic: MicState = track.enabled ? 'on' : 'muted';
    this.update({ mic });
    this.opts?.sendMic(mic);
  }

  /** Your volume for one person only; the others are untouched. Remembered by name. */
  setVolume(rawId: string, volume: number): void {
    const id = this.resolve(rawId);
    const pref = this.prefOf(id);
    this.prefs.set(this.prefKey(id), { ...pref, volume: Math.max(0, Math.min(1, volume)) });
    savePrefs(this.prefs);
    const peer = this.peers.get(id);
    if (peer) this.applyOutput(peer);
    this.refreshPeers();
  }

  togglePeerMute(rawId: string): void {
    const id = this.resolve(rawId);
    const pref = this.prefOf(id);
    this.prefs.set(this.prefKey(id), { ...pref, muted: !pref.muted });
    savePrefs(this.prefs);
    const peer = this.peers.get(id);
    if (peer) this.applyOutput(peer);
    this.refreshPeers();
  }

  /** Call from a user gesture: retries playback blocked by autoplay policies. */
  unlock(): void {
    if (!this.snap.audioBlocked) return;
    let blocked = false;
    const tries = [...this.peers.values()]
      .filter((p) => p.stream)
      .map((p) => p.audio.play().catch(() => (blocked = true)));
    void Promise.all(tries).then(() => this.update({ audioBlocked: blocked }));
  }

  // ─── mesh management ───
  /** Reconciles peer connections with who is in the call. */
  sync(players: VoicePeerInfo[], selfId: string): void {
    const opts = this.opts;
    if (!opts || opts.selfId !== selfId) return;
    const wanted = new Map<string, string>();
    let renamed = false;
    for (const p of players) {
      if (p.name && this.names.get(p.id) !== p.name) {
        this.names.set(p.id, p.name);
        renamed = true;
      }
      if (p.id !== selfId && p.connected && p.voiceSession) wanted.set(p.id, p.voiceSession);
    }
    if (renamed) for (const peer of this.peers.values()) this.applyOutput(peer);
    let changed = false;
    for (const [id, peer] of this.peers) {
      if (wanted.get(id) !== peer.session) {
        peer.close();
        this.peers.delete(id);
        changed = true;
      }
    }
    for (const [id, session] of wanted) {
      if (!this.peers.has(id)) {
        this.createPeer(id, session);
        changed = true;
      }
    }
    if (changed || renamed) this.refreshPeers();
  }

  handleSignal(from: string, fromSession: string, data: SignalPayload): void {
    if (!this.opts) return;
    let peer = this.peers.get(from);
    if (data.reset) {
      peer?.close();
      this.peers.delete(from);
      this.createPeer(from, fromSession);
      this.refreshPeers();
      return;
    }
    if (!peer || peer.session !== fromSession) {
      // The server only relays from a peer's current session, so this one is newer.
      peer?.close();
      peer = this.createPeer(from, fromSession);
      this.refreshPeers();
    }
    const p = peer;
    p.queue = p.queue.then(() => this.applySignal(p, data)).catch(() => undefined);
  }

  private createPeer(id: string, session: string): Peer {
    const opts = this.opts as EnterOptions;
    const track = this.localStream?.getAudioTracks()[0] ?? null;
    const live = track && track.readyState === 'live' ? track : null;
    const peer = new Peer(id, session, opts.selfId, opts.iceServers, live, this.localStream);
    peer.name = this.names.get(id);
    this.created += 1;
    const send = (data: SignalPayload) => {
      if (!peer.closed) this.opts?.sendSignal(id, session, data);
    };
    const { pc } = peer;

    pc.onnegotiationneeded = async () => {
      try {
        peer.makingOffer = true;
        await pc.setLocalDescription();
        if (pc.localDescription) send({ description: pc.localDescription.toJSON() });
      } catch {
        // A glare rollback may interrupt this; perfect negotiation recovers.
      } finally {
        peer.makingOffer = false;
      }
    };
    pc.onicecandidate = ({ candidate }) => {
      if (candidate) send({ candidate: candidate.toJSON() });
    };
    pc.ontrack = (ev) => {
      const stream = ev.streams[0] ?? new MediaStream([ev.track]);
      peer.stream = stream;
      peer.audio.srcObject = stream;
      peer.meter?.dispose();
      peer.meter = null;
      this.applyOutput(peer);
      peer.audio.play().catch(() => this.update({ audioBlocked: true }));
    };
    pc.onconnectionstatechange = () => this.onConnState(peer);

    this.peers.set(id, peer);
    // Give up waiting after a while and show "sin conexión de voz", but keep retrying.
    peer.timers.push(
      setTimeout(() => {
        if (peer.conn !== 'connected') this.markFailed(peer);
      }, HARD_RESET_AFTER_MS),
    );
    return peer;
  }

  private async applySignal(peer: Peer, data: SignalPayload): Promise<void> {
    const { pc } = peer;
    if (peer.closed) return;
    if (data.description) {
      const description = data.description as RTCSessionDescriptionInit;
      const collision =
        description.type === 'offer' && (peer.makingOffer || pc.signalingState !== 'stable');
      peer.ignoreOffer = !peer.polite && collision;
      if (peer.ignoreOffer) return;
      await pc.setRemoteDescription(description);
      if (description.type === 'offer') {
        if (!peer.transceiver) await this.adoptTransceiver(peer);
        await pc.setLocalDescription();
        if (pc.localDescription) {
          this.opts?.sendSignal(peer.id, peer.session, {
            description: pc.localDescription.toJSON(),
          });
        }
      }
    } else if (data.candidate) {
      try {
        await pc.addIceCandidate(data.candidate as RTCIceCandidateInit);
      } catch (err) {
        if (!peer.ignoreOffer) throw err;
      }
    }
  }

  /** Answering side: send our mic on the m-line the offer created (before answering). */
  private async adoptTransceiver(peer: Peer): Promise<void> {
    const t = peer.pc.getTransceivers().find((x) => x.receiver.track.kind === 'audio');
    if (!t) return;
    t.direction = 'sendrecv';
    const track = this.localStream?.getAudioTracks()[0];
    if (track && track.readyState === 'live') {
      await t.sender.replaceTrack(track);
      if (this.localStream) t.sender.setStreams?.(this.localStream);
    }
    peer.transceiver = t;
  }

  private onConnState(peer: Peer): void {
    if (peer.closed) return;
    const state = peer.pc.connectionState;
    if (state === 'connected') {
      peer.conn = 'connected';
      peer.timers.forEach(clearTimeout);
      peer.timers = [];
      void this.capBitrate(peer);
      this.refreshPeers();
    } else if (state === 'disconnected') {
      peer.timers.push(
        setTimeout(() => {
          if (!peer.closed && peer.pc.connectionState !== 'connected') peer.pc.restartIce();
        }, RESTART_AFTER_MS),
      );
    } else if (state === 'failed') {
      this.markFailed(peer);
    }
  }

  /** No voice with this peer (e.g. strict NAT without TURN). The game goes on; we keep retrying. */
  private markFailed(peer: Peer): void {
    if (peer.closed) return;
    peer.conn = 'failed';
    this.refreshPeers();
    peer.pc.restartIce();
    peer.timers.push(
      setTimeout(() => {
        if (peer.closed || peer.pc.connectionState === 'connected') return;
        // Only one side (the impolite one) triggers a full rebuild, to avoid ping-pong.
        if (!peer.polite) {
          this.opts?.sendSignal(peer.id, peer.session, { reset: true });
          peer.close();
          this.peers.delete(peer.id);
          const fresh = this.createPeer(peer.id, peer.session);
          fresh.conn = 'failed';
          this.refreshPeers();
        } else {
          this.markFailed(peer);
        }
      }, HARD_RESET_AFTER_MS),
    );
  }

  /** Speech doesn't need more than ~32 kbps: less encoding work and data on every phone. */
  private async capBitrate(peer: Peer): Promise<void> {
    const sender = peer.transceiver?.sender;
    if (!sender?.getParameters) return;
    try {
      const params = sender.getParameters();
      if (!params.encodings?.length) params.encodings = [{}];
      for (const e of params.encodings) e.maxBitrate = VOICE_MAX_BITRATE;
      await sender.setParameters(params);
    } catch {
      // not supported here: keep the browser default
    }
  }

  /** The shared output of the Web Audio path: a gentle compressor so no voice blasts over the rest. */
  private mixBus(ctx: AudioContext): AudioNode {
    if (!this.mix) {
      this.mix = ctx.createDynamicsCompressor();
      this.mix.threshold.value = -18;
      this.mix.knee.value = 12;
      this.mix.ratio.value = 3;
      this.mix.attack.value = 0.01;
      this.mix.release.value = 0.25;
      this.mix.connect(ctx.destination);
    }
    return this.mix;
  }

  /** Your volume/mute for this one peer. Element volume where it works; Web Audio gain on iOS. */
  private applyOutput(peer: Peer): void {
    const pref = this.prefOf(peer.id);
    const level = pref.muted ? 0 : pref.volume;
    const ctx = getAudioContext();
    // Normal playback stays on the <audio> element (proven on every phone). Only a voice you
    // turned down on iOS, where the element ignores volume, goes through a Web Audio gain.
    const viaGain =
      useWebAudioOutput &&
      pref.volume < 1 &&
      !pref.muted &&
      ctx !== null &&
      ctx.state === 'running' &&
      peer.stream !== null;
    if (viaGain && ctx && peer.stream) {
      if (!peer.meter) peer.meter = new Meter(ctx, peer.stream);
      if (!peer.gain) {
        peer.gain = ctx.createGain();
        peer.meter.node.connect(peer.gain).connect(this.mixBus(ctx));
      }
      peer.gain.gain.setTargetAtTime(level, ctx.currentTime, 0.03);
      // The element keeps the stream flowing but stays silent: the gain is what you hear.
      peer.audio.muted = true;
    } else {
      peer.gain?.disconnect();
      peer.gain = null;
      peer.audio.muted = pref.muted;
      peer.audio.volume = pref.volume;
      if (peer.audio.paused && peer.stream) peer.audio.play().catch(() => undefined);
    }
  }

  // ─── speaking indicators ───
  private measure(): void {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running' || !this.opts || document.hidden) return;
    const now = performance.now();
    const speaking: Record<string, boolean> = {};

    const track = this.localStream?.getAudioTracks()[0];
    if (this.localStream && track && track.readyState === 'live') {
      if (!this.selfMeter) this.selfMeter = new Meter(ctx, this.localStream);
      if (track.enabled && this.selfMeter.level() > SPEAKING_THRESHOLD) this.selfLastSpoke = now;
      speaking[this.opts.selfId] = track.enabled && now - this.selfLastSpoke < SPEAKING_HOLD_MS;
    }

    for (const peer of this.peers.values()) {
      if (!peer.stream) continue;
      if (!peer.meter) peer.meter = new Meter(ctx, peer.stream);
      if (peer.meter.level() > SPEAKING_THRESHOLD) peer.lastSpoke = now;
      speaking[peer.id] = !this.prefOf(peer.id).muted && now - peer.lastSpoke < SPEAKING_HOLD_MS;
    }

    const prev = this.snap.speaking;
    const keys = new Set([...Object.keys(prev), ...Object.keys(speaking)]);
    for (const k of keys) {
      if (Boolean(prev[k]) !== Boolean(speaking[k])) {
        this.update({ speaking });
        return;
      }
    }
  }

  /** Debug/e2e helper: what the call looks like from here. */
  stats() {
    const peers: Record<
      string,
      { state: string; volume: number; muted: boolean; gain: number | null }
    > = {};
    for (const p of this.peers.values()) {
      peers[p.id] = {
        state: p.pc.connectionState,
        volume: p.audio.volume,
        muted: p.audio.muted,
        gain: p.gain ? p.gain.gain.value : null,
      };
    }
    return { context: this.context, selfId: this.selfId, created: this.created, peers };
  }

  /** Debug/e2e helper: connection state of each peer. */
  debug(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of this.peers.values()) out[p.id] = p.pc.connectionState;
    return out;
  }
}

export const voice = new VoiceManager();

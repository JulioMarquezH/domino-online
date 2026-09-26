import type { MicState, PublicPlayer, SignalPayload } from '@domino/shared';
import { getAudioContext } from '../audio/context';

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

interface EnterOptions {
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
const SPEAKING_HOLD_MS = 350;
const RESTART_AFTER_MS = 4000;
const HARD_RESET_AFTER_MS = 15000;

const canSetElementVolume = (() => {
  try {
    const a = document.createElement('audio');
    a.volume = 0.5;
    return a.volume === 0.5;
  } catch {
    return false;
  }
})();

/** RMS level of a stream through an AnalyserNode. */
class Meter {
  private analyser: AnalyserNode;
  private source: MediaStreamAudioSourceNode;
  private buf: Float32Array<ArrayBuffer>;

  constructor(ctx: AudioContext, stream: MediaStream) {
    this.source = ctx.createMediaStreamSource(stream);
    this.analyser = ctx.createAnalyser();
    this.analyser.fftSize = 512;
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
  private localStream: MediaStream | null = null;
  private selfMeter: Meter | null = null;
  private selfLastSpoke = 0;
  private peers = new Map<string, Peer>();
  private prefs = new Map<string, { volume: number; muted: boolean }>();
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

  private update(patch: Partial<VoiceSnapshot>): void {
    this.snap = { ...this.snap, ...patch };
    this.listeners.forEach((l) => l());
  }

  private refreshPeers(): void {
    const peers: Record<string, PeerSnapshot> = {};
    for (const p of this.peers.values()) {
      const pref = this.prefs.get(p.id) ?? { volume: 1, muted: false };
      peers[p.id] = { conn: p.conn, ...pref };
    }
    this.update({ peers });
  }

  // ─── lifecycle ───
  enter(opts: EnterOptions): void {
    if (this.opts?.selfId === opts.selfId) {
      this.opts = opts;
      if (this.snap.mic !== 'pending') opts.sendMic(this.snap.mic);
      return;
    }
    this.leave();
    this.opts = opts;
    void this.startMic();
    this.loop = setInterval(() => this.measure(), 100);
  }

  leave(): void {
    for (const p of this.peers.values()) p.close();
    this.peers.clear();
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

  setVolume(id: string, volume: number): void {
    const pref = this.prefs.get(id) ?? { volume: 1, muted: false };
    this.prefs.set(id, { ...pref, volume });
    const peer = this.peers.get(id);
    if (peer) this.applyOutput(peer);
    this.refreshPeers();
  }

  togglePeerMute(id: string): void {
    const pref = this.prefs.get(id) ?? { volume: 1, muted: false };
    this.prefs.set(id, { ...pref, muted: !pref.muted });
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
  /** Reconciles peer connections with the room's player list. */
  sync(players: PublicPlayer[], selfId: string): void {
    const opts = this.opts;
    if (!opts || opts.selfId !== selfId) return;
    const wanted = new Map<string, string>();
    for (const p of players) {
      if (p.id !== selfId && p.connected && p.voiceSession) wanted.set(p.id, p.voiceSession);
    }
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
    if (changed) this.refreshPeers();
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

  /** Volume and local mute. Element volume where supported; Web Audio gain on iOS. */
  private applyOutput(peer: Peer): void {
    const pref = this.prefs.get(peer.id) ?? { volume: 1, muted: false };
    const ctx = getAudioContext();
    const useGain = !canSetElementVolume && pref.volume < 1 && ctx !== null && peer.stream !== null;
    if (useGain && ctx && peer.stream) {
      if (!peer.meter) peer.meter = new Meter(ctx, peer.stream);
      if (!peer.gain) {
        peer.gain = ctx.createGain();
        peer.meter.node.connect(peer.gain).connect(ctx.destination);
      }
      peer.gain.gain.value = pref.muted ? 0 : pref.volume;
      peer.audio.muted = true;
    } else {
      peer.gain?.disconnect();
      peer.gain = null;
      peer.audio.muted = pref.muted;
      if (canSetElementVolume) peer.audio.volume = pref.volume;
    }
  }

  // ─── speaking indicators ───
  private measure(): void {
    const ctx = getAudioContext();
    if (!ctx || ctx.state !== 'running' || !this.opts) return;
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
      const pref = this.prefs.get(peer.id);
      speaking[peer.id] = !pref?.muted && now - peer.lastSpoke < SPEAKING_HOLD_MS;
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

  /** Debug/e2e helper: connection state of each peer. */
  debug(): Record<string, string> {
    const out: Record<string, string> = {};
    for (const p of this.peers.values()) out[p.id] = p.pc.connectionState;
    return out;
  }
}

export const voice = new VoiceManager();

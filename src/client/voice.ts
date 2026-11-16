/**
 * Voice chat: a small WebRTC mesh between everyone in the room who joined voice.
 * Signalling goes through the game server; audio flows peer-to-peer, or through the TURN relay the
 * server hands out when no direct path exists (common on mobile data, which sits behind carrier NAT).
 *
 * For each pair, the peer with the smaller id makes the offer, so there is never "glare". Every
 * connection carries one sendrecv audio transceiver; muting only toggles the track. Each connection
 * attempt has its own session id (`sid`), carried by every signal: an offer always replaces the
 * previous connection with that peer, and late messages from an older attempt are dropped. The
 * offerer restarts a connection that fails or does not come up in time; the answerer asks it to.
 *
 * iPhones need extra care. Safari only lets remote audio start from a tap unless the page is using
 * the microphone, so the audio elements are unlocked during the "Join" tap and anything still
 * blocked starts on the next tap. Switching apps or taking a call pauses playback and can end the
 * microphone track, so both are restarted when the page comes back. Speaking levels come from the
 * RTP packets rather than WebAudio, so remote audio never goes through an AudioContext.
 */
import { type RoomView, VOICE_MAX } from '../shared/protocol';
import type { Net } from './net';
import { sfx } from './sfx';

/** Signals from older clients carry no `sid`; they are taken as part of the current attempt. */
type Signal =
  | { type: 'offer'; sid?: string; sdp: string }
  | { type: 'answer'; sid?: string; sdp: string }
  | { type: 'candidate'; sid?: string; candidate: RTCIceCandidateInit }
  /** From the answerer: this connection is broken, please make a new offer. */
  | { type: 'restart'; sid?: string }
  | { type: 'bye' };

interface Peer {
  id: string;
  sid: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  audio: HTMLAudioElement;
  stream: MediaStream | null;
  receiver: RTCRtpReceiver | null;
  /** Fallback level meter, only for browsers that do not report RTP audio levels. */
  analyser: AnalyserNode | null;
  source: MediaStreamAudioSourceNode | null;
  analyserTried: boolean;
  pendingCandidates: RTCIceCandidateInit[];
  /** Restarts the connection if it is not up in time. */
  watchdog: ReturnType<typeof setTimeout> | null;
  disconnectTimer: ReturnType<typeof setTimeout> | null;
  restartTimer: ReturnType<typeof setTimeout> | null;
  connected: boolean;
  /** The browser refused to play this peer's audio until the next tap. */
  blocked: boolean;
  /** Last RTP source timestamp seen, and when it last changed (for stale levels). */
  srcTs: number;
  srcSeen: number;
}

export interface VoiceState {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  hasMic: boolean;
  deafened: boolean;
  /** Someone's audio cannot play until the user taps the page (iOS autoplay rules). */
  audioBlocked: boolean;
  error: string | null;
}

export interface PeerInfo {
  volume: number;
  muted: boolean;
  /** Connection state, 'new' while waiting for the first offer. */
  state: RTCPeerConnectionState;
  /** Failed attempts since the last time the connection was up. */
  attempts: number;
}

const MIC: MediaTrackConstraints = { echoCancellation: true, noiseSuppression: true, autoGainControl: true };
/** A connection that is not up after this long gets restarted (ms). */
const CONNECT_TIMEOUT = 15_000;
/** How long a 'disconnected' connection may take to come back by itself (ms). */
const DISCONNECT_GRACE = 4_000;
/** A speaking level older than this is stale: no packets are arriving (ms). */
const LEVEL_STALE = 600;
/** Remote audio elements to unlock in advance: one for each person who can be in voice with us. */
const AUDIO_SLOTS = VOICE_MAX - 1;
/** Events Safari accepts as a user gesture for starting audio (pointerdown is not one on touch screens). */
const GESTURES = ['pointerup', 'touchend', 'click', 'keydown'] as const;

let volumeSettable: boolean | null = null;

export class VoiceChat {
  private peers = new Map<string, Peer>();
  /** Per-person volume and mute, kept across reconnections. */
  private prefs = new Map<string, { volume: number; muted: boolean }>();
  /** Failed connection attempts per person, for backoff and the "trouble connecting" hint. */
  private attempts = new Map<string, number>();
  private localStream: MediaStream | null = null;
  private localSource: MediaStreamAudioSourceNode | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private room: RoomView | null = null;
  private listeners = new Set<() => void>();
  private levelBuf = new Uint8Array(512);
  private pttHeld = false;
  private rejoining = false;
  private openingMic = false;
  /** Audio elements not in use, most of them already unlocked by a tap. */
  private spareAudio: HTMLAudioElement[] = [];
  private unlocked = new WeakSet<HTMLAudioElement>();
  private audioHost: HTMLElement | null = null;
  readonly levels = new Map<string, number>();
  state: VoiceState = {
    joined: false,
    joining: false,
    muted: false,
    hasMic: false,
    deafened: false,
    audioBlocked: false,
    error: null,
  };

  constructor(private readonly net: Net) {
    net.socket.on('voice:signal', ({ from, data }) => void this.onSignal(from, data as Signal));
    // The server drops us from voice when the connection drops. Once we are back in the room,
    // `sync` sees we are missing from the voice list and rejoins; everyone then reconnects.
    net.socket.on('disconnect', () => this.closeAllPeers());
    window.addEventListener('keydown', (e) => {
      if (e.code !== 'KeyV' || e.repeat || isTyping(e)) return;
      if (this.state.joined && this.state.muted && this.state.hasMic) {
        this.pttHeld = true;
        this.applyMute(false);
        this.net.socket.emit('voice:mute', { muted: false });
      }
    });
    window.addEventListener('keyup', (e) => {
      if (e.code !== 'KeyV' || !this.pttHeld) return;
      this.pttHeld = false;
      this.applyMute(true);
      this.net.socket.emit('voice:mute', { muted: true });
    });
    for (const type of GESTURES) window.addEventListener(type, this.onGesture, { capture: true, passive: true });
    document.addEventListener('visibilitychange', this.onForeground);
    window.addEventListener('pageshow', this.onForeground);
    window.addEventListener('focus', this.onForeground);
  }

  onChange(cb: () => void): () => void {
    this.listeners.add(cb);
    return () => this.listeners.delete(cb);
  }

  private emit() {
    for (const cb of this.listeners) cb();
  }

  private get myId(): string | null {
    return this.net.id;
  }

  private iceServers(): RTCIceServer[] {
    return (this.net.welcome?.iceServers ?? [{ urls: 'stun:stun.l.google.com:19302' }]) as RTCIceServer[];
  }

  static supported(): boolean {
    return typeof RTCPeerConnection !== 'undefined' && !!navigator.mediaDevices?.getUserMedia;
  }

  /** iOS ignores `volume` on media elements (only the hardware buttons change it). */
  static get canSetVolume(): boolean {
    if (volumeSettable === null) {
      try {
        const a = document.createElement('audio');
        a.volume = 0.5;
        volumeSettable = Math.abs(a.volume - 0.5) < 0.01;
      } catch {
        volumeSettable = false;
      }
    }
    return volumeSettable;
  }

  async join() {
    if (this.state.joined || this.state.joining) return;
    // Still inside the tap: unlock audio output now, so iOS lets the others play later.
    this.resumeAudio();
    this.state = { ...this.state, joining: true, error: null };
    this.emit();
    let stream: MediaStream | null = null;
    let error: string | null = null;
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false });
    } catch (err) {
      console.warn('[voice] microphone unavailable, joining to listen only', err);
      error = 'Microphone blocked — you can still listen.';
    }
    const res = await this.net.call('voice:join', { muted: !stream });
    if (!res.ok) {
      stream?.getTracks().forEach((t) => t.stop());
      this.state = { ...this.state, joining: false, error: res.error };
      this.emit();
      return;
    }
    if (stream) this.useLocalStream(stream, false);
    this.state = { ...this.state, joined: true, joining: false, hasMic: !!stream, muted: !stream, audioBlocked: false, error };
    sfx.play('join');
    this.emit();
    if (this.room) this.sync(this.room);
  }

  leave(error: string | null = null) {
    if (!this.state.joined) return;
    this.net.socket.emit('voice:leave');
    this.closeAllPeers();
    this.stopLocal();
    this.attempts.clear();
    this.state = { ...this.state, joined: false, muted: false, hasMic: false, audioBlocked: false, error };
    this.levels.clear();
    this.emit();
  }

  private stopLocal() {
    this.localSource?.disconnect();
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.localSource = null;
    this.localAnalyser = null;
  }

  /** Makes `stream` the microphone we send, to new and existing connections alike. */
  private useLocalStream(stream: MediaStream, muted: boolean) {
    this.stopLocal();
    this.localStream = stream;
    const track = stream.getAudioTracks()[0];
    if (track) {
      track.enabled = !muted;
      // iOS ends the track when a call, Siri or another app takes the microphone.
      track.addEventListener('ended', () => {
        if (this.localStream === stream) void this.reopenMic();
      });
    }
    const ctx = sfx.context;
    if (ctx) {
      try {
        this.localSource = ctx.createMediaStreamSource(stream);
        this.localAnalyser = ctx.createAnalyser();
        this.localAnalyser.fftSize = 512;
        this.localSource.connect(this.localAnalyser);
      } catch {
        /* the level meter is optional */
      }
    }
    for (const p of this.peers.values()) this.attachLocalTrack(p.pc);
  }

  /** Opens the microphone and sends it to everyone, without reconnecting. */
  private async openMic(muted: boolean): Promise<boolean> {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: MIC, video: false });
      if (!this.state.joined) {
        stream.getTracks().forEach((t) => t.stop());
        return false;
      }
      this.useLocalStream(stream, muted);
      return true;
    } catch (err) {
      console.warn('[voice] microphone unavailable', err);
      return false;
    }
  }

  /** Listening only so far: ask for the microphone again (permission may have been granted since). */
  private async enableMic() {
    if (this.openingMic) return;
    this.openingMic = true;
    const ok = await this.openMic(false);
    this.openingMic = false;
    if (!this.state.joined) return;
    if (ok) {
      this.state = { ...this.state, hasMic: true, muted: false, error: null };
      this.net.socket.emit('voice:mute', { muted: false });
    } else {
      this.state = { ...this.state, error: 'Microphone blocked — allow it for this site in the browser settings.' };
    }
    this.emit();
  }

  /** The microphone track ended under us (iOS interruptions): open a new one. */
  private async reopenMic() {
    if (this.openingMic || !this.state.joined || !this.state.hasMic || document.hidden) return;
    this.openingMic = true;
    const ok = await this.openMic(this.state.muted && !this.pttHeld);
    this.openingMic = false;
    if (ok || !this.state.joined) return;
    this.stopLocal();
    this.state = { ...this.state, hasMic: false, muted: true, error: 'The microphone stopped — tap 🚫 to turn it back on.' };
    this.net.socket.emit('voice:mute', { muted: true });
    this.emit();
  }

  toggleMute() {
    if (!this.state.joined) return;
    if (!this.state.hasMic) {
      this.resumeAudio();
      void this.enableMic();
      return;
    }
    this.state = { ...this.state, muted: !this.state.muted };
    this.applyMute(this.state.muted);
    this.net.socket.emit('voice:mute', { muted: this.state.muted });
    this.emit();
  }

  private applyMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  toggleDeafen() {
    this.state = { ...this.state, deafened: !this.state.deafened };
    for (const p of this.peers.values()) p.audio.muted = this.state.deafened || this.pref(p.id).muted;
    this.emit();
  }

  private pref(id: string) {
    let pref = this.prefs.get(id);
    if (!pref) {
      pref = { volume: 1, muted: false };
      this.prefs.set(id, pref);
    }
    return pref;
  }

  setPeerVolume(id: string, volume: number) {
    const pref = this.pref(id);
    pref.volume = Math.max(0, Math.min(1, volume));
    const p = this.peers.get(id);
    if (p) p.audio.volume = pref.volume;
  }

  togglePeerMute(id: string) {
    const pref = this.pref(id);
    pref.muted = !pref.muted;
    const p = this.peers.get(id);
    if (p) p.audio.muted = pref.muted || this.state.deafened;
    this.emit();
  }

  peerInfo(id: string): PeerInfo {
    const p = this.peers.get(id);
    const pref = this.prefs.get(id);
    return {
      volume: pref?.volume ?? 1,
      muted: pref?.muted ?? false,
      state: p ? pcState(p.pc) : 'new',
      attempts: this.attempts.get(id) ?? 0,
    };
  }

  // ───────────────────────────── audio output ─────────────────────────────

  /**
   * Call from a tap or key press. Unlocks audio elements for later (Safari only lets an element
   * play without a tap once it has been started from one) and restarts anything blocked or paused.
   */
  resumeAudio() {
    sfx.unlock();
    while (this.spareAudio.length + this.peers.size < AUDIO_SLOTS) this.spareAudio.push(this.newAudio());
    for (const a of this.spareAudio) {
      if (this.unlocked.has(a)) continue;
      this.unlocked.add(a);
      // No source yet: this only marks the element as started by the user.
      a.play().catch(() => {});
    }
    for (const p of this.peers.values()) this.playPeer(p);
  }

  private onGesture = () => {
    if (this.state.joined || this.state.joining) this.resumeAudio();
  };

  /** Back from another app, the lock screen or a call: restart playback, the microphone and dead links. */
  private onForeground = () => {
    if (document.hidden || !this.state.joined) return;
    for (const p of this.peers.values()) {
      this.playPeer(p);
      const st = pcState(p.pc);
      if (st === 'failed' || st === 'closed') this.recover(p);
      else if (st === 'disconnected') this.onPeerState(p);
    }
    const track = this.localStream?.getAudioTracks()[0];
    if (this.state.hasMic && (!track || track.readyState === 'ended')) void this.reopenMic();
  };

  private newAudio(): HTMLAudioElement {
    const a = document.createElement('audio');
    a.autoplay = true;
    a.setAttribute('playsinline', '');
    if (!this.audioHost) {
      this.audioHost = document.createElement('div');
      this.audioHost.setAttribute('aria-hidden', 'true');
      this.audioHost.style.cssText = 'position:fixed;left:0;top:0;width:0;height:0;overflow:hidden;pointer-events:none';
      document.body.appendChild(this.audioHost);
    }
    this.audioHost.appendChild(a);
    return a;
  }

  private releaseAudio(a: HTMLAudioElement) {
    a.onpause = null;
    a.pause();
    a.srcObject = null;
    a.muted = false;
    a.volume = 1;
    this.spareAudio.push(a);
  }

  private playPeer(p: Peer) {
    const a = p.audio;
    if (!a.srcObject || !a.paused) return;
    a.play().then(
      () => {
        if (p.blocked) {
          p.blocked = false;
          this.updateBlocked();
        }
      },
      (err: unknown) => {
        // NotAllowedError: Safari wants a tap first (the next one retries). Anything else is transient.
        if ((err as { name?: string } | null)?.name !== 'NotAllowedError' || this.peers.get(p.id) !== p || p.blocked) return;
        console.warn('[voice] audio blocked until the next tap');
        p.blocked = true;
        this.updateBlocked();
      },
    );
  }

  private updateBlocked() {
    const blocked = [...this.peers.values()].some((p) => p.blocked);
    if (blocked === this.state.audioBlocked) return;
    this.state = { ...this.state, audioBlocked: blocked };
    this.emit();
  }

  // ───────────────────────────── connections ─────────────────────────────

  /** Reconciles peer connections with the room's voice member list. */
  sync(room: RoomView) {
    this.room = room;
    const me = this.myId;
    if (!me || !this.state.joined) return;
    if (!room.voice.some((v) => v.id === me)) {
      // The server dropped us (we reconnected): rejoin quietly, then everyone reconnects.
      void this.rejoin();
      return;
    }
    const others = new Set(room.voice.map((v) => v.id).filter((id) => id !== me));
    for (const id of [...this.peers.keys()]) if (!others.has(id)) this.closePeer(id);
    for (const id of [...this.attempts.keys()]) if (!others.has(id)) this.attempts.delete(id);
    for (const id of others) if (!this.peers.has(id) && me < id) void this.connect(id);
  }

  private async rejoin() {
    if (this.rejoining) return;
    this.rejoining = true;
    this.closeAllPeers();
    const res = await this.net.call('voice:join', { muted: this.state.muted || !this.state.hasMic });
    this.rejoining = false;
    if (!res.ok && this.state.joined && this.net.socket.connected) {
      console.warn('[voice] could not rejoin', res.error);
      this.leave(res.error);
    }
  }

  private isVoiceMember(id: string): boolean {
    return !!this.room?.voice.some((v) => v.id === id);
  }

  private createPeer(id: string, initiator: boolean, sid: string): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    const audio = this.spareAudio.pop() ?? this.newAudio();
    const pref = this.pref(id);
    audio.muted = this.state.deafened || pref.muted;
    audio.volume = pref.volume;
    const peer: Peer = {
      id,
      sid,
      pc,
      initiator,
      audio,
      stream: null,
      receiver: null,
      analyser: null,
      source: null,
      analyserTried: false,
      pendingCandidates: [],
      watchdog: null,
      disconnectTimer: null,
      restartTimer: null,
      connected: false,
      blocked: false,
      srcTs: 0,
      srcSeen: 0,
    };
    pc.onicecandidate = (e) => {
      if (e.candidate && this.peers.get(id) === peer) this.send(id, { type: 'candidate', sid, candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      if (this.peers.get(id) !== peer) return;
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      peer.stream = stream;
      peer.receiver = e.receiver;
      if (audio.srcObject !== stream) audio.srcObject = stream;
      this.playPeer(peer);
    };
    pc.onconnectionstatechange = () => this.onPeerState(peer);
    pc.oniceconnectionstatechange = () => this.onPeerState(peer);
    // iOS pauses media during interruptions; try again (a blocked play waits for the next tap).
    audio.onpause = () => {
      if (this.peers.get(id) === peer && !document.hidden) setTimeout(() => this.peers.get(id) === peer && this.playPeer(peer), 300);
    };
    this.peers.set(id, peer);
    this.armWatchdog(peer);
    return peer;
  }

  private attachLocalTrack(pc: RTCPeerConnection) {
    if (pc.signalingState === 'closed') return;
    const track = this.localStream?.getAudioTracks()[0] ?? null;
    let tr = pc.getTransceivers().find((t) => t.receiver.track?.kind === 'audio');
    if (!tr) tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    if (tr.direction !== 'sendrecv') tr.direction = 'sendrecv';
    tr.sender.replaceTrack(track).catch((err) => console.warn('[voice] could not send the microphone', err));
    if (track && this.localStream) {
      try {
        tr.sender.setStreams?.(this.localStream);
      } catch {
        /* older browsers */
      }
    }
  }

  private async connect(id: string) {
    const peer = this.createPeer(id, true, newSid());
    this.attachLocalTrack(peer.pc);
    try {
      const offer = await peer.pc.createOffer();
      if (this.peers.get(id) !== peer) return;
      await peer.pc.setLocalDescription(offer);
      if (this.peers.get(id) !== peer) return;
      this.send(id, { type: 'offer', sid: peer.sid, sdp: peer.pc.localDescription!.sdp });
    } catch (err) {
      console.warn('[voice] offer failed', err);
      this.recover(peer);
    }
  }

  private onPeerState(peer: Peer) {
    if (this.peers.get(peer.id) !== peer) return;
    const st = pcState(peer.pc);
    if (st === 'connected') {
      if (peer.watchdog) clearTimeout(peer.watchdog);
      if (peer.disconnectTimer) clearTimeout(peer.disconnectTimer);
      peer.watchdog = peer.disconnectTimer = null;
      this.attempts.delete(peer.id);
      if (!peer.connected) {
        peer.connected = true;
        void this.logRoute(peer);
      }
      this.playPeer(peer);
    } else if (st === 'failed') {
      this.recover(peer);
    } else if (st === 'disconnected' && !peer.disconnectTimer) {
      // Often a short network blip that ICE gets over by itself.
      peer.disconnectTimer = setTimeout(() => {
        peer.disconnectTimer = null;
        if (this.peers.get(peer.id) === peer && pcState(peer.pc) !== 'connected') this.recover(peer);
      }, DISCONNECT_GRACE);
    }
    this.emit();
  }

  private armWatchdog(peer: Peer) {
    if (peer.watchdog) clearTimeout(peer.watchdog);
    peer.watchdog = setTimeout(() => {
      peer.watchdog = null;
      if (this.peers.get(peer.id) === peer && pcState(peer.pc) !== 'connected') this.recover(peer);
    }, CONNECT_TIMEOUT);
  }

  /** The connection is broken or never came up: the offerer starts over, the answerer asks it to. */
  private recover(peer: Peer) {
    if (this.peers.get(peer.id) !== peer || !this.state.joined) return;
    if (peer.initiator) {
      this.scheduleRestart(peer);
      return;
    }
    this.attempts.set(peer.id, (this.attempts.get(peer.id) ?? 0) + 1);
    this.send(peer.id, { type: 'restart', sid: peer.sid });
    this.armWatchdog(peer);
    this.emit();
  }

  private scheduleRestart(peer: Peer) {
    if (!peer.initiator || peer.restartTimer || this.peers.get(peer.id) !== peer) return;
    const n = this.attempts.get(peer.id) ?? 0;
    this.attempts.set(peer.id, n + 1);
    // 0.5 s, 1 s, 2 s… up to 10 s, with some jitter.
    const delay = Math.min(10_000, 500 * 2 ** n) * (0.8 + Math.random() * 0.4);
    peer.restartTimer = setTimeout(() => {
      peer.restartTimer = null;
      if (this.peers.get(peer.id) !== peer) return;
      this.closePeer(peer.id);
      if (this.state.joined && this.isVoiceMember(peer.id)) void this.connect(peer.id);
    }, delay);
    this.emit();
  }

  private async onSignal(from: string, data: Signal) {
    if (!this.state.joined || !data || typeof data !== 'object' || from === this.myId) return;
    let peer = this.peers.get(from);
    const current = (p: Peer) => this.peers.get(from) === p;
    const sameAttempt = (p: Peer) => !('sid' in data) || data.sid === undefined || data.sid === p.sid;
    try {
      switch (data.type) {
        case 'offer': {
          if (typeof data.sdp !== 'string') return;
          // Every offer is a new connection attempt: it replaces whatever we had with that peer.
          if (peer) this.closePeer(from);
          const p = (peer = this.createPeer(from, false, data.sid ?? ''));
          await p.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
          if (!current(p)) return;
          this.attachLocalTrack(p.pc);
          const answer = await p.pc.createAnswer();
          if (!current(p)) return;
          await p.pc.setLocalDescription(answer);
          if (!current(p)) return;
          this.send(from, { type: 'answer', sid: p.sid, sdp: p.pc.localDescription!.sdp });
          await this.flushCandidates(p);
          break;
        }
        case 'answer': {
          if (!peer || !peer.initiator || !sameAttempt(peer) || typeof data.sdp !== 'string') return;
          if (peer.pc.signalingState !== 'have-local-offer') return;
          await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
          if (current(peer)) await this.flushCandidates(peer);
          break;
        }
        case 'candidate': {
          if (!peer || !sameAttempt(peer) || !data.candidate) return;
          if (!peer.pc.remoteDescription) peer.pendingCandidates.push(data.candidate);
          else await peer.pc.addIceCandidate(data.candidate).catch(() => {});
          break;
        }
        case 'restart': {
          if (peer) {
            if (peer.initiator && sameAttempt(peer)) this.scheduleRestart(peer);
          } else if (this.isVoiceMember(from) && this.myId! < from) {
            void this.connect(from);
          }
          break;
        }
        case 'bye':
          this.closePeer(from);
          break;
      }
    } catch (err) {
      console.warn('[voice] signalling error', err);
      if (peer && current(peer)) this.recover(peer);
    }
  }

  private async flushCandidates(peer: Peer) {
    const list = peer.pendingCandidates.splice(0);
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  private send(to: string, data: Signal) {
    this.net.socket.emit('voice:signal', { to, data });
  }

  private closePeer(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    this.peers.delete(id);
    for (const t of [p.watchdog, p.disconnectTimer, p.restartTimer]) if (t) clearTimeout(t);
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    p.pc.oniceconnectionstatechange = null;
    p.pc.close();
    p.source?.disconnect();
    this.releaseAudio(p.audio);
    this.levels.delete(id);
    if (p.blocked) this.updateBlocked();
    this.emit();
  }

  private closeAllPeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id);
  }

  /** Logs how the connection got through: host/srflx is direct, relay means TURN. */
  private async logRoute(peer: Peer) {
    try {
      const stats = await peer.pc.getStats();
      let pairId: string | undefined;
      stats.forEach((s) => {
        if (s.type === 'transport' && s.selectedCandidatePairId) pairId = s.selectedCandidatePairId;
      });
      let pair: { localCandidateId?: string; remoteCandidateId?: string } | undefined;
      stats.forEach((s) => {
        if (s.type !== 'candidate-pair') return;
        if (pairId ? s.id === pairId : s.selected || (s.nominated && s.state === 'succeeded')) pair = s;
      });
      const local = pair?.localCandidateId ? stats.get(pair.localCandidateId) : null;
      const remote = pair?.remoteCandidateId ? stats.get(pair.remoteCandidateId) : null;
      console.info(`[voice] connected to ${peer.id}: ${local?.candidateType ?? '?'} ↔ ${remote?.candidateType ?? '?'}`);
    } catch {
      /* diagnostics only */
    }
  }

  // ───────────────────────────── speaking levels ─────────────────────────────

  private analyserLevel(an: AnalyserNode | null): number {
    if (!an) return 0;
    const buf = this.levelBuf.length >= an.fftSize ? this.levelBuf : new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf.subarray(0, an.fftSize));
    let sum = 0;
    for (let i = 0; i < an.fftSize; i++) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    return levelFromRms(Math.sqrt(sum / an.fftSize));
  }

  private remoteLevel(p: Peer, now: number): number {
    // The sender's level travels in every RTP packet (RFC 6464): no WebAudio needed.
    const sources = p.receiver && typeof p.receiver.getSynchronizationSources === 'function' ? p.receiver.getSynchronizationSources() : null;
    if (sources) {
      const s = sources[0];
      if (!s) return 0;
      if (typeof s.audioLevel === 'number') {
        if (s.timestamp !== p.srcTs) {
          p.srcTs = s.timestamp;
          p.srcSeen = now;
        }
        return now - p.srcSeen > LEVEL_STALE ? 0 : levelFromRms(s.audioLevel);
      }
    }
    if (!p.analyserTried) this.attachAnalyser(p);
    return this.analyserLevel(p.analyser);
  }

  private attachAnalyser(p: Peer) {
    const ctx = sfx.context;
    if (!ctx || !p.stream) return;
    p.analyserTried = true;
    try {
      p.source = ctx.createMediaStreamSource(p.stream);
      p.analyser = ctx.createAnalyser();
      p.analyser.fftSize = 512;
      p.source.connect(p.analyser);
    } catch {
      /* the level meter is optional */
    }
  }

  /** Samples speaking levels; call every frame. */
  updateLevels() {
    const me = this.myId;
    if (me) {
      const live = this.localStream?.getAudioTracks().some((t) => t.enabled && t.readyState === 'live');
      this.levels.set(me, live ? this.analyserLevel(this.localAnalyser) : 0);
    }
    const now = performance.now();
    for (const p of this.peers.values()) {
      const silent = this.state.deafened || !!this.prefs.get(p.id)?.muted;
      this.levels.set(p.id, silent ? 0 : this.remoteLevel(p, now));
    }
  }
}

/** Maps an RMS amplitude (0..1) to a 0..1 speaking level, ignoring background noise. */
function levelFromRms(rms: number): number {
  return Math.min(1, Math.max(0, (rms - 0.015) * 7));
}

/** Connection state, derived from the ICE state where `connectionState` is missing (older Firefox). */
function pcState(pc: RTCPeerConnection): RTCPeerConnectionState {
  if (pc.connectionState) return pc.connectionState;
  const ice = pc.iceConnectionState;
  if (ice === 'completed') return 'connected';
  if (ice === 'checking') return 'connecting';
  return ice as RTCPeerConnectionState;
}

function newSid(): string {
  return Math.random().toString(36).slice(2, 10);
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

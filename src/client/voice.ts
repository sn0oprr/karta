/**
 * Voice chat: a small WebRTC mesh between everyone in the room who joined voice.
 * Signalling goes through the game server; audio flows peer-to-peer.
 *
 * Connection rule: for each pair, the peer with the smaller id makes the offer,
 * so there is never "glare". Every connection carries one sendrecv audio transceiver;
 * muting/unmuting only swaps the track, without renegotiation.
 */
import type { RoomView } from '../shared/protocol';
import type { Net } from './net';
import { sfx } from './sfx';

type Signal =
  | { type: 'offer'; sdp: string }
  | { type: 'answer'; sdp: string }
  | { type: 'candidate'; candidate: RTCIceCandidateInit }
  | { type: 'bye' };

interface Peer {
  id: string;
  pc: RTCPeerConnection;
  initiator: boolean;
  audio: HTMLAudioElement;
  analyser: AnalyserNode | null;
  source: MediaStreamAudioSourceNode | null;
  pendingCandidates: RTCIceCandidateInit[];
  volume: number;
  locallyMuted: boolean;
  restartTimer: ReturnType<typeof setTimeout> | null;
  makingOffer: boolean;
}

export interface VoiceState {
  joined: boolean;
  joining: boolean;
  muted: boolean;
  hasMic: boolean;
  deafened: boolean;
  error: string | null;
}

export class VoiceChat {
  private peers = new Map<string, Peer>();
  private localStream: MediaStream | null = null;
  private localAnalyser: AnalyserNode | null = null;
  private room: RoomView | null = null;
  private listeners = new Set<() => void>();
  private levelBuf = new Uint8Array(512);
  private pttHeld = false;
  readonly levels = new Map<string, number>();
  state: VoiceState = { joined: false, joining: false, muted: false, hasMic: false, deafened: false, error: null };

  constructor(private readonly net: Net) {
    net.socket.on('voice:signal', ({ from, data }) => void this.onSignal(from, data as Signal));
    net.socket.on('disconnect', () => {
      // The server drops us from voice on disconnect; tear down and rejoin after reconnect.
      if (this.state.joined) {
        this.closeAllPeers();
        this.wantRejoin = true;
      }
    });
    net.socket.on('connect', () => {
      if (this.wantRejoin && this.state.joined) {
        this.wantRejoin = false;
        void this.net.call('voice:join', { muted: this.state.muted || !this.state.hasMic });
      }
    });
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
  }

  private wantRejoin = false;

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

  async join() {
    if (this.state.joined || this.state.joining) return;
    this.state = { ...this.state, joining: true, error: null };
    this.emit();
    sfx.unlock();
    let hasMic = false;
    try {
      this.localStream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true },
        video: false,
      });
      hasMic = true;
      const ctx = sfx.context;
      if (ctx) {
        const src = ctx.createMediaStreamSource(this.localStream);
        this.localAnalyser = ctx.createAnalyser();
        this.localAnalyser.fftSize = 512;
        src.connect(this.localAnalyser);
      }
    } catch (err) {
      console.warn('[voice] microphone unavailable, joining to listen only', err);
      this.state.error = 'Microphone blocked — you can still listen.';
    }
    const res = await this.net.call('voice:join', { muted: !hasMic });
    if (!res.ok) {
      this.stopLocal();
      this.state = { ...this.state, joining: false, error: res.error };
      this.emit();
      return;
    }
    this.state = { ...this.state, joined: true, joining: false, hasMic, muted: !hasMic };
    sfx.play('join');
    this.emit();
    if (this.room) this.sync(this.room);
  }

  leave() {
    if (!this.state.joined) return;
    this.net.socket.emit('voice:leave');
    this.closeAllPeers();
    this.stopLocal();
    this.state = { ...this.state, joined: false, muted: false, hasMic: false };
    this.levels.clear();
    this.emit();
  }

  private stopLocal() {
    this.localStream?.getTracks().forEach((t) => t.stop());
    this.localStream = null;
    this.localAnalyser = null;
  }

  toggleMute() {
    if (!this.state.joined) return;
    if (!this.state.hasMic) {
      // Ask for the microphone again (permission may have been granted since).
      this.leave();
      void this.join();
      return;
    }
    this.state.muted = !this.state.muted;
    this.applyMute(this.state.muted);
    this.net.socket.emit('voice:mute', { muted: this.state.muted });
    this.emit();
  }

  private applyMute(muted: boolean) {
    this.localStream?.getAudioTracks().forEach((t) => (t.enabled = !muted));
  }

  toggleDeafen() {
    this.state.deafened = !this.state.deafened;
    for (const p of this.peers.values()) p.audio.muted = this.state.deafened || p.locallyMuted;
    this.emit();
  }

  setPeerVolume(id: string, volume: number) {
    const p = this.peers.get(id);
    if (!p) return;
    p.volume = volume;
    p.audio.volume = Math.max(0, Math.min(1, volume));
  }

  togglePeerMute(id: string) {
    const p = this.peers.get(id);
    if (!p) return;
    p.locallyMuted = !p.locallyMuted;
    p.audio.muted = p.locallyMuted || this.state.deafened;
    this.emit();
  }

  peerInfo(id: string): { volume: number; muted: boolean; state: RTCPeerConnectionState } | null {
    const p = this.peers.get(id);
    return p ? { volume: p.volume, muted: p.locallyMuted, state: p.pc.connectionState } : null;
  }

  /** Reconcile peer connections with the room's voice member list. */
  sync(room: RoomView) {
    this.room = room;
    const me = this.myId;
    if (!me) return;
    const inVoice = room.voice.some((v) => v.id === me);
    if (this.state.joined && !inVoice && !this.state.joining) {
      // Server dropped us (e.g. after a reconnect): rejoin quietly.
      void this.net.call('voice:join', { muted: this.state.muted || !this.state.hasMic });
      return;
    }
    if (!this.state.joined) return;
    const others = new Set(room.voice.map((v) => v.id).filter((id) => id !== me));
    for (const id of [...this.peers.keys()]) if (!others.has(id)) this.closePeer(id);
    for (const id of others) {
      if (!this.peers.has(id) && me < id) void this.connect(id);
    }
  }

  private createPeer(id: string, initiator: boolean): Peer {
    const pc = new RTCPeerConnection({ iceServers: this.iceServers() });
    const audio = new Audio();
    audio.autoplay = true;
    audio.setAttribute('playsinline', '');
    audio.muted = this.state.deafened;
    const peer: Peer = {
      id,
      pc,
      initiator,
      audio,
      analyser: null,
      source: null,
      pendingCandidates: [],
      volume: 1,
      locallyMuted: false,
      restartTimer: null,
      makingOffer: false,
    };
    pc.onicecandidate = (e) => {
      if (e.candidate) this.send(id, { type: 'candidate', candidate: e.candidate.toJSON() });
    };
    pc.ontrack = (e) => {
      const stream = e.streams[0] ?? new MediaStream([e.track]);
      audio.srcObject = stream;
      void audio.play().catch(() => {
        /* will start on next user gesture */
      });
      const ctx = sfx.context;
      if (ctx) {
        try {
          peer.source = ctx.createMediaStreamSource(stream);
          peer.analyser = ctx.createAnalyser();
          peer.analyser.fftSize = 512;
          peer.source.connect(peer.analyser);
        } catch {
          /* analyser is optional */
        }
      }
    };
    pc.onconnectionstatechange = () => {
      this.emit();
      if (pc.connectionState === 'failed') this.scheduleRestart(peer);
      if (pc.connectionState === 'disconnected') {
        if (peer.restartTimer) clearTimeout(peer.restartTimer);
        peer.restartTimer = setTimeout(() => {
          if (pc.connectionState === 'disconnected') this.scheduleRestart(peer);
        }, 5000);
      }
    };
    this.peers.set(id, peer);
    return peer;
  }

  private attachLocalTrack(pc: RTCPeerConnection) {
    const track = this.localStream?.getAudioTracks()[0] ?? null;
    let tr = pc.getTransceivers().find((t) => t.receiver.track.kind === 'audio');
    if (!tr) tr = pc.addTransceiver('audio', { direction: 'sendrecv' });
    tr.direction = 'sendrecv';
    void tr.sender.replaceTrack(track);
    if (track && this.localStream) {
      try {
        tr.sender.setStreams?.(this.localStream);
      } catch {
        /* older browsers */
      }
    }
  }

  private async connect(id: string) {
    const peer = this.createPeer(id, true);
    this.attachLocalTrack(peer.pc);
    try {
      peer.makingOffer = true;
      const offer = await peer.pc.createOffer();
      await peer.pc.setLocalDescription(offer);
      this.send(id, { type: 'offer', sdp: peer.pc.localDescription!.sdp });
    } catch (err) {
      console.warn('[voice] offer failed', err);
      this.scheduleRestart(peer);
    } finally {
      peer.makingOffer = false;
    }
  }

  private scheduleRestart(peer: Peer) {
    if (!peer.initiator) return;
    if (peer.restartTimer) clearTimeout(peer.restartTimer);
    peer.restartTimer = setTimeout(() => {
      if (this.peers.get(peer.id) !== peer) return;
      this.closePeer(peer.id, false);
      if (this.state.joined && this.room?.voice.some((v) => v.id === peer.id)) void this.connect(peer.id);
    }, 1500);
  }

  private async onSignal(from: string, data: Signal) {
    if (!this.state.joined || !data || typeof data !== 'object') return;
    let peer = this.peers.get(from);
    try {
      if (data.type === 'offer') {
        if (peer && peer.initiator) {
          // Should not happen with the id rule, but recover by letting their offer win.
          this.closePeer(from, false);
          peer = undefined;
        }
        if (peer && peer.pc.signalingState !== 'stable') {
          this.closePeer(from, false);
          peer = undefined;
        }
        if (!peer) peer = this.createPeer(from, false);
        await peer.pc.setRemoteDescription({ type: 'offer', sdp: data.sdp });
        this.attachLocalTrack(peer.pc);
        const answer = await peer.pc.createAnswer();
        await peer.pc.setLocalDescription(answer);
        this.send(from, { type: 'answer', sdp: peer.pc.localDescription!.sdp });
        await this.flushCandidates(peer);
      } else if (data.type === 'answer') {
        if (!peer || peer.pc.signalingState !== 'have-local-offer') return;
        await peer.pc.setRemoteDescription({ type: 'answer', sdp: data.sdp });
        await this.flushCandidates(peer);
      } else if (data.type === 'candidate') {
        if (!peer) return;
        if (!peer.pc.remoteDescription) peer.pendingCandidates.push(data.candidate);
        else await peer.pc.addIceCandidate(data.candidate).catch(() => {});
      } else if (data.type === 'bye') {
        this.closePeer(from, false);
      }
    } catch (err) {
      console.warn('[voice] signalling error', err);
      if (peer) this.scheduleRestart(peer);
    }
  }

  private async flushCandidates(peer: Peer) {
    const list = peer.pendingCandidates.splice(0);
    for (const c of list) await peer.pc.addIceCandidate(c).catch(() => {});
  }

  private send(to: string, data: Signal) {
    this.net.socket.emit('voice:signal', { to, data });
  }

  private closePeer(id: string, notify = true) {
    const p = this.peers.get(id);
    if (!p) return;
    if (notify) this.send(id, { type: 'bye' });
    if (p.restartTimer) clearTimeout(p.restartTimer);
    p.pc.onicecandidate = null;
    p.pc.ontrack = null;
    p.pc.onconnectionstatechange = null;
    p.pc.close();
    p.audio.srcObject = null;
    p.source?.disconnect();
    this.peers.delete(id);
    this.levels.delete(id);
    this.emit();
  }

  private closeAllPeers() {
    for (const id of [...this.peers.keys()]) this.closePeer(id, false);
  }

  private level(an: AnalyserNode | null): number {
    if (!an) return 0;
    const buf = this.levelBuf.length >= an.fftSize ? this.levelBuf : new Uint8Array(an.fftSize);
    an.getByteTimeDomainData(buf.subarray(0, an.fftSize));
    let sum = 0;
    for (let i = 0; i < an.fftSize; i++) {
      const v = (buf[i]! - 128) / 128;
      sum += v * v;
    }
    const rms = Math.sqrt(sum / an.fftSize);
    return Math.min(1, Math.max(0, (rms - 0.015) * 7));
  }

  /** Samples speaking levels; call every frame. */
  updateLevels() {
    const me = this.myId;
    if (me) {
      const muted = !this.localStream || this.localStream.getAudioTracks().every((t) => !t.enabled);
      this.levels.set(me, muted ? 0 : this.level(this.localAnalyser));
    }
    for (const p of this.peers.values()) this.levels.set(p.id, p.locallyMuted || this.state.deafened ? 0 : this.level(p.analyser));
  }
}

function isTyping(e: KeyboardEvent) {
  const t = e.target as HTMLElement | null;
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.isContentEditable);
}

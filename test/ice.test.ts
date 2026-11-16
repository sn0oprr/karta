import { describe, expect, it } from 'vitest';
import { iceServersFromEnv, turnCredentials } from '../src/server/index';

describe('ICE servers for voice chat', () => {
  it('signs TURN usernames the way coturn checks them (use-auth-secret)', () => {
    // printf '1700000000:abc' | openssl dgst -sha1 -hmac north -binary | base64
    expect(turnCredentials('north', 'abc', 0, 1_700_000_000_000)).toEqual({
      username: '1700000000:abc',
      credential: 'g5HTmCBrPDhYXFpM/1dHUtfE+c4=',
    });
    expect(turnCredentials('north', 'abc', 3600, 1_700_000_000_999).username).toBe('1700003600:abc');
  });

  it('defaults to public STUN only', () => {
    const servers = iceServersFromEnv({})('u1');
    expect(servers).toHaveLength(1);
    expect(String(servers[0]!.urls)).toContain('stun:');
  });

  it('gives each player their own expiring TURN credentials when TURN_SECRET is set', () => {
    const ice = iceServersFromEnv({ TURN_URLS: 'turn:t.example:3478?transport=udp, turn:t.example:3478?transport=tcp', TURN_SECRET: 's3cret' });
    const before = Math.floor(Date.now() / 1000);
    const [stun, turn] = ice('player-1');
    expect(stun!.urls).toEqual(['stun:stun.l.google.com:19302', 'stun:stun1.l.google.com:19302']);
    expect(turn!.urls).toEqual(['turn:t.example:3478?transport=udp', 'turn:t.example:3478?transport=tcp']);
    const [expiry, user] = turn!.username!.split(':');
    expect(user).toBe('player-1');
    expect(Number(expiry)).toBeGreaterThanOrEqual(before + 24 * 3600);
    expect(turn!.credential).toBe(turnCredentials('s3cret', 'player-1', 0, Number(expiry) * 1000).credential);
    expect(ice('player-2')[1]!.username).toMatch(/:player-2$/);
  });

  it('hands out fixed TURN credentials without a secret, and ICE_SERVERS_JSON overrides everything', () => {
    const fixed = iceServersFromEnv({ STUN_URLS: '', TURN_URLS: 'turn:t.example:3478', TURN_USERNAME: 'u', TURN_CREDENTIAL: 'p' })('x');
    expect(fixed).toEqual([{ urls: ['turn:t.example:3478'], username: 'u', credential: 'p' }]);
    const custom = [{ urls: 'turn:other.example', username: 'a', credential: 'b' }];
    expect(iceServersFromEnv({ ICE_SERVERS_JSON: JSON.stringify(custom), TURN_URLS: 'turn:ignored' })('x')).toEqual(custom);
  });
});

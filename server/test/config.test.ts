import { createHmac } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { iceServersFor, loadConfig, parseIceServers, turnCredentials } from '../src/config';

describe('config', () => {
  it('defaults to a public STUN server and parses ICE_SERVERS', () => {
    expect(parseIceServers(undefined)).toEqual([{ urls: 'stun:stun.l.google.com:19302' }]);
    expect(
      parseIceServers('[{"urls":["turn:t.example:3478"],"username":"u","credential":"c"}]'),
    ).toEqual([{ urls: ['turn:t.example:3478'], username: 'u', credential: 'c' }]);
    expect(() => parseIceServers('{')).toThrow();
    expect(() => parseIceServers('[{"nope":1}]')).toThrow();
  });

  it('mints coturn REST credentials per player when TURN is configured', () => {
    const config = loadConfig({
      TURN_URLS: 'turn:t.example:3478, turns:t.example:5349',
      TURN_SECRET: 's3cret',
    });
    expect(config.turn?.urls).toEqual(['turn:t.example:3478', 'turns:t.example:5349']);
    const cred = turnCredentials({ urls: ['turn:x'], secret: 's3cret' }, 'p1', 1_000_000);
    expect(cred.username).toBe(`${1000 + 12 * 3600}:p1`);
    expect(cred.credential).toBe(
      createHmac('sha1', 's3cret')
        .update(cred.username as string)
        .digest('base64'),
    );
    expect(iceServersFor(config, 'p1')).toHaveLength(2);
    expect(iceServersFor(loadConfig({}), 'p1')).toHaveLength(1);
  });
});

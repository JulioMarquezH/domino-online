import { describe, expect, it } from 'vitest';
import { loadConfig } from '../src/config';

describe('tournament configuration', () => {
  it('defaults the database to ./data/domino.db and honours DATABASE_PATH', () => {
    expect(loadConfig({}).databasePath).toBe('./data/domino.db');
    expect(loadConfig({ DATABASE_PATH: '/data/domino.db' }).databasePath).toBe('/data/domino.db');
    expect(loadConfig({ DATABASE_PATH: '  ' }).databasePath).toBe('./data/domino.db');
  });

  it('trusts X-Forwarded-For only in production unless told otherwise', () => {
    expect(loadConfig({}).trustProxy).toBe(false);
    expect(loadConfig({ NODE_ENV: 'production' }).trustProxy).toBe(true);
    expect(loadConfig({ NODE_ENV: 'production', TRUST_PROXY: '0' }).trustProxy).toBe(false);
    expect(loadConfig({ TRUST_PROXY: '1' }).trustProxy).toBe(true);
  });

  it('never lets an environment variable shorten tournament matches in production', () => {
    expect(loadConfig({ TOURNAMENT_TARGET_TEST: '30' }).tournamentTarget).toBe(30);
    expect(
      loadConfig({ NODE_ENV: 'production', TOURNAMENT_TARGET_TEST: '30' }).tournamentTarget,
    ).toBe(undefined);
    expect(loadConfig({ TOURNAMENT_TARGET_TEST: 'abc' }).tournamentTarget).toBeUndefined();
    expect(loadConfig({}).tournamentTarget).toBeUndefined();
  });
});

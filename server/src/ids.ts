import { createHash, randomBytes, randomInt } from 'node:crypto';
import { ROOM_ID_ALPHABET, ROOM_ID_LENGTH, TOURNAMENT_ID_LENGTH, type Rng } from '@domino/shared';

export function newRoomId(): string {
  let id = '';
  for (let i = 0; i < ROOM_ID_LENGTH; i++)
    id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
  return id;
}

export const newToken = (): string => randomBytes(24).toString('base64url');
export const newPlayerId = (): string => randomBytes(6).toString('hex');

/** Crypto-backed Rng for fair shuffles in production. */
export const cryptoRng: Rng = () => randomInt(2 ** 32) / 2 ** 32;

/** Tournament ID: the only secret of a tournament, so 12 crypto-random unambiguous characters. */
export function newTournamentId(): string {
  let id = '';
  for (let i = 0; i < TOURNAMENT_ID_LENGTH; i++) {
    id += ROOM_ID_ALPHABET[randomInt(ROOM_ID_ALPHABET.length)];
  }
  return id;
}

export const hashToken = (token: string): string =>
  createHash('sha256').update(token).digest('hex');

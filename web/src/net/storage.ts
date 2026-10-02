/** Small localStorage wrapper; every access is guarded (private mode, blocked storage…). */
const NAME_KEY = 'domino:name';
const SOUND_KEY = 'domino:sound';
const roomKey = (roomId: string) => `domino:room:${roomId}`;
/** Device identity inside a tournament: `tournament:<ID>` (the token the server issued). */
const tournamentKey = (id: string) => `tournament:${id}`;
const TOURNAMENTS_KEY = 'domino:tournaments';
/** Which tournament a game room belongs to, so the room join can present the device's token. */
const roomTournamentKey = (roomId: string) => `domino:room-tournament:${roomId}`;

export interface KnownTournament {
  id: string;
  /** Names of the four players, for the "Tus torneos" list. */
  label: string;
  /** Who this device is in it, once it entered. */
  you?: string;
  at: number;
}

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string | null): void {
  try {
    if (value === null) localStorage.removeItem(key);
    else localStorage.setItem(key, value);
  } catch {
    // ignore
  }
}

export const storage = {
  getName: () => read(NAME_KEY) ?? '',
  setName: (name: string) => write(NAME_KEY, name),
  getToken: (roomId: string) => read(roomKey(roomId)),
  setToken: (roomId: string, token: string) => write(roomKey(roomId), token),
  clearToken: (roomId: string) => write(roomKey(roomId), null),
  getSound: () => read(SOUND_KEY) !== 'off',
  setSound: (on: boolean) => write(SOUND_KEY, on ? 'on' : 'off'),
  getTournamentToken: (id: string) => read(tournamentKey(id)),
  setTournamentToken: (id: string, token: string) => write(tournamentKey(id), token),
  clearTournamentToken: (id: string) => write(tournamentKey(id), null),
  getRoomTournament: (roomId: string) => read(roomTournamentKey(roomId)),
  setRoomTournament: (roomId: string, id: string) => write(roomTournamentKey(roomId), id),
  getKnownTournaments: (): KnownTournament[] => {
    try {
      const raw: unknown = JSON.parse(read(TOURNAMENTS_KEY) ?? '[]');
      return Array.isArray(raw)
        ? raw.filter(
            (t): t is KnownTournament =>
              typeof t === 'object' && t !== null && typeof (t as KnownTournament).id === 'string',
          )
        : [];
    } catch {
      return [];
    }
  },
  rememberTournament: (entry: Partial<KnownTournament> & { id: string }) => {
    const list = storage.getKnownTournaments();
    const old = list.find((t) => t.id === entry.id);
    const next: KnownTournament = { label: '', at: Date.now(), ...old, ...entry };
    write(
      TOURNAMENTS_KEY,
      JSON.stringify([next, ...list.filter((t) => t.id !== entry.id)].slice(0, 20)),
    );
  },
  forgetTournament: (id: string) => {
    write(
      TOURNAMENTS_KEY,
      JSON.stringify(storage.getKnownTournaments().filter((t) => t.id !== id)),
    );
    write(tournamentKey(id), null);
  },
  getFlag: (name: string) => read(`domino:flag:${name}`) === '1',
  setFlag: (name: string) => write(`domino:flag:${name}`, '1'),
};

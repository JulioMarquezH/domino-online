/** Small localStorage wrapper; every access is guarded (private mode, blocked storage…). */
const NAME_KEY = 'domino:name';
const SOUND_KEY = 'domino:sound';
const roomKey = (roomId: string) => `domino:room:${roomId}`;

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
};

import type { Letter, MicState, TournamentVoiceMember } from '@domino/shared';

interface Member {
  socketId: string;
  mic: MicState;
}

/**
 * Who is in each tournament's voice call. A tournament has one call that lives as long as its
 * players have the tournament open (its page or one of its match rooms), so walking from the
 * table back to the tournament page never hangs up. One device per letter: the latest wins.
 */
export class TournamentVoice {
  private readonly calls = new Map<string, Map<Letter, Member>>();

  /** Returns the socket that was replaced (another device of the same player), if any. */
  join(tournamentId: string, letter: Letter, socketId: string): string | null {
    let call = this.calls.get(tournamentId);
    if (!call) {
      call = new Map();
      this.calls.set(tournamentId, call);
    }
    const previous = call.get(letter);
    call.set(letter, { socketId, mic: previous?.socketId === socketId ? previous.mic : 'off' });
    return previous && previous.socketId !== socketId ? previous.socketId : null;
  }

  /** Removes a socket from whatever call it was in. Returns that tournament id, if any. */
  leave(socketId: string): string | null {
    for (const [id, call] of this.calls) {
      for (const [letter, m] of call) {
        if (m.socketId === socketId) {
          call.delete(letter);
          if (call.size === 0) this.calls.delete(id);
          return id;
        }
      }
    }
    return null;
  }

  setMic(socketId: string, mic: MicState): string | null {
    for (const [id, call] of this.calls) {
      for (const m of call.values()) {
        if (m.socketId === socketId) {
          if (m.mic === mic) return null;
          m.mic = mic;
          return id;
        }
      }
    }
    return null;
  }

  letterOf(tournamentId: string, socketId: string): Letter | null {
    for (const [letter, m] of this.calls.get(tournamentId) ?? []) {
      if (m.socketId === socketId) return letter;
    }
    return null;
  }

  /** The socket of `letter`, only if it is still `session` (stale signals are dropped). */
  route(tournamentId: string, letter: Letter, session: string): string | null {
    const m = this.calls.get(tournamentId)?.get(letter);
    return m && m.socketId === session ? m.socketId : null;
  }

  members(tournamentId: string): TournamentVoiceMember[] {
    return [...(this.calls.get(tournamentId) ?? [])].map(([letter, m]) => ({
      letter,
      session: m.socketId,
      mic: m.mic,
    }));
  }
}

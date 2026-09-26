import { describe, expect, it } from 'vitest';
import {
  assignSortearSeats,
  compareDrawTiles,
  drawStarter,
  fullSet,
  partnerOf,
  rankDrawPicks,
  teamOf,
  type Seat,
} from '../src';

const sign = (n: number) => Math.sign(n);

describe('compareDrawTiles', () => {
  it('matches the documented examples', () => {
    expect(compareDrawTiles('6-6', '6-5')).toBeGreaterThan(0);
    expect(compareDrawTiles('4-4', '6-1')).toBeGreaterThan(0); // 8 > 7
    expect(compareDrawTiles('6-1', '5-2')).toBeGreaterThan(0); // both 7, 6 > 5
    expect(compareDrawTiles('5-2', '4-3')).toBeGreaterThan(0); // both 7, 5 > 4
    expect(compareDrawTiles('0-0', '1-0')).toBeLessThan(0);
  });

  it('is a strict total order over all 28 tiles', () => {
    const tiles = fullSet();
    expect(tiles).toHaveLength(28);
    for (const a of tiles) {
      expect(compareDrawTiles(a, a)).toBe(0);
      for (const b of tiles) {
        if (a === b) continue;
        // Totality: no two different tiles tie.
        expect(compareDrawTiles(a, b)).not.toBe(0);
        // Antisymmetry.
        expect(sign(compareDrawTiles(a, b))).toBe(-sign(compareDrawTiles(b, a)));
        for (const c of tiles) {
          // Transitivity.
          if (compareDrawTiles(a, b) > 0 && compareDrawTiles(b, c) > 0) {
            expect(compareDrawTiles(a, c)).toBeGreaterThan(0);
          }
        }
      }
    }
    // Sorting yields 28 distinct ranks, from 6-6 down to 0-0.
    const sorted = tiles.slice().sort((x, y) => compareDrawTiles(y, x));
    expect(sorted[0]).toBe('6-6');
    expect(sorted[1]).toBe('6-5');
    expect(sorted[27]).toBe('0-0');
    expect(new Set(sorted).size).toBe(28);
  });
});

describe('starter draw outcome', () => {
  it('Sortear: the two highest tiles are partners and the highest starts', () => {
    const picks = [
      { player: 'ana', tile: '3-2' }, // 5
      { player: 'beto', tile: '6-1' }, // 7, high side 6
      { player: 'caro', tile: '4-4' }, // 8
      { player: 'dani', tile: '5-2' }, // 7, high side 5
    ];
    expect(rankDrawPicks(picks).map((p) => p.player)).toEqual(['caro', 'beto', 'dani', 'ana']);
    const { seats, starter } = assignSortearSeats(picks);
    const seatOf = (p: string) => seats.get(p) as Seat;
    expect(new Set(seats.values()).size).toBe(4);
    expect(starter).toBe(seatOf('caro'));
    expect(partnerOf(seatOf('caro'))).toBe(seatOf('beto'));
    expect(partnerOf(seatOf('dani'))).toBe(seatOf('ana'));
    expect(teamOf(seatOf('caro'))).toBe(teamOf(seatOf('beto')));
    expect(teamOf(seatOf('caro'))).not.toBe(teamOf(seatOf('dani')));
  });

  it('Manual: the draw only decides who leads', () => {
    expect(
      drawStarter([
        { player: 0, tile: '2-1' },
        { player: 1, tile: '5-0' },
        { player: 2, tile: '4-1' },
        { player: 3, tile: '3-2' },
      ]),
    ).toBe(1); // sums 3,5,5,5: among the 5s, 5-0 has the highest side
  });
});

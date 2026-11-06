/**
 * London-style mulligans (CR 103.5), the step of the start-of-game procedure (core/start.ts) and of a restarted game's (core/restart.ts, edh-next-137: moved here from
 * core/start.ts unchanged, so a restart does not import core/start.ts and its core/turn.ts imports: an import cycle).
 */
import type { Game } from './game';
import { drawCards, moveObject, shuffleLibrary, zoneArray } from './zones';

/**
 * London-style mulligans (CR 103.5). M11-1: in a Commander variant with `freeMulligan` (Brawl, CR 903.12g; CR 103.5c names multiplayer games, so a two-player
 * Commander game has none), the first mulligan a player takes counts neither toward the cards they put on the bottom nor toward the number of mulligans they
 * may take; `PlayerState.mulligans` still counts every mulligan taken. Outside such a game `counted(n)` is `n`: unchanged.
 */
export function mulligans(g: Game, handSize: number, due: () => boolean = () => false): void {
  const s = g.s;
  // M12-2 (m12 design E4): CR 103.5c, 800.6: the first mulligan is free in every multiplayer game too (`options.multiplayer`, D1)
  const multiplayerFree = s.options.multiplayer !== undefined;
  const free = s.options.commander?.freeMulligan === true || multiplayerFree ? 1 : 0;
  const counted = (n: number): number => Math.max(0, n - free);
  for (;;) {
    const deciding = s.players.filter((p) => !p.keptHand && !p.hasLost); // M12-2: a player who conceded before the start takes no mulligan (CR 104.3a)
    if (deciding.length === 0) return;
    const taking: string[] = [];
    // Starting player declares first, then each other player in turn order (CR 103.5).
    for (const p of deciding) {
      if (due()) return; // M12-2 (review fix 2)
      if (p.hasLost) continue;
      const canMulligan = counted(p.mulligans) < handSize;
      if (!canMulligan) { p.keptHand = true; continue; }
      const ans = g.choose({
        kind: 'mulligan',
        player: p.id,
        prompt: `Keep this ${handSize - counted(p.mulligans)}-card hand or take a mulligan?${free && p.mulligans === 0 ? ' (Your first mulligan is free.)' : ''}`,
        handSize: handSize - counted(p.mulligans + 1),
        mulligans: p.mulligans,
        rules: ['CR 103.5'],
      });
      if (ans.keep) {
        p.keptHand = true;
        g.log(`${p.name} keeps.`, { rules: ['CR 103.5'] });
      } else taking.push(p.id);
    }
    // All mulligans happen at the same time.
    for (const pid of taking) {
      const p = g.player(pid);
      p.mulligans++;
      for (const id of [...zoneArray(g, 'hand', pid)]) moveObject(g, id, 'library', { silent: true, cause: 'mulligan' });
      shuffleLibrary(g, pid);
      drawCards(g, pid, handSize);
      g.emit({ type: 'mulligan', player: pid, count: p.mulligans });
      const isFree = free === 1 && p.mulligans === 1;
      g.log(`${p.name} takes mulligan number ${p.mulligans}${isFree ? ' (free)' : ''}.`, { rules: ['CR 103.5', ...(isFree ? (multiplayerFree ? ['CR 103.5c', 'CR 800.6'] : ['CR 903.12g']) : [])] });
      // Put cards equal to the number of mulligans taken on the bottom, in any order (CR 903.12g: the free first one not counted).
      const n = Math.min(counted(p.mulligans), zoneArray(g, 'hand', pid).length);
      if (n > 0) {
        if (due()) return; // M12-2 (review fix 2)
        if (p.hasLost) continue;
        const ans = g.choose({
          kind: 'chooseObjects',
          player: pid,
          prompt: `Put ${n} card${n === 1 ? '' : 's'} from your hand on the bottom of your library (in order: first chosen goes on the bottom first).`,
          options: [...zoneArray(g, 'hand', pid)],
          min: n,
          max: n,
          ordered: true,
          rules: ['CR 103.5'],
        });
        for (const id of ans.ids) moveObject(g, id, 'library', { position: 'bottom', silent: true, cause: 'mulligan' });
        g.log(`${p.name} puts ${n} card${n === 1 ? '' : 's'} on the bottom of their library.`, { rules: ['CR 103.5'] });
      }
    }
  }
}

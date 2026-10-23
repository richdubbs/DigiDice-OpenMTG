/**
 * The sounds of an online game's link (docs/design/sound.md, catalog net.*), worked out from what the link already announces (OnlineLink stays a pure
 * transport): the socket to the local server and the other player coming and going, and their chat.
 *
 * - net.lost: the socket dropped after it had been open (not closed by this page), or the server says the other player left or their link dropped.
 * - net.restored: the socket is open again after a drop, or the other player is back.
 * - net.chat: a chat line from the other player.
 * - net.joined (M12-5b): a 3-4 player game: another player took a seat in the lobby. In such a game the notices name their player: any other player
 *   leaving, dropping or forfeiting sounds net.lost, coming back net.restored, and any other player's chat line net.chat.
 *
 * Only what happens after the watch starts sounds: notices and chat lines already held (a screen opened again) are not news, nor (M12F) the chat the local
 * server sends again to a reloaded page (`ChatLine.history`).
 */
import type { SoundPlayer } from '../audio/engine';
import { soundEngine } from '../audio/sfx';
import type { OnlineLink } from './OnlineLink';

/** Plays the link's sounds until the returned stop is called. */
export function watchLinkSounds(link: OnlineLink, player: SoundPlayer = soundEngine()): () => void {
  const lastN = <T extends { n: number }>(list: readonly T[]) => list[list.length - 1]?.n ?? 0;
  let notice = lastN(link.notices());
  let chat = lastN(link.chat());
  let everOpen = link.linkState() === 'open';
  let down = false;
  return link.subscribe(() => {
    const state = link.linkState();
    if (state === 'open') {
      if (down) player.play('net.restored');
      down = false;
      everOpen = true;
    } else if (everOpen && !down && (state === 'lost' || state === 'closed') && link.linkProblem() !== null) {
      // A first connect that fails is the setup screen's error (ConnectProblem), not a lost link; a close by this page has no problem.
      down = true;
      player.play('net.lost');
    }

    const notices = link.notices();
    for (const n of notices) {
      if (n.n <= notice) continue;
      if (n.kind === 'opponentLeft' || n.kind === 'opponentDropped') player.play('net.lost');
      else if (n.kind === 'opponentBack') player.play('net.restored');
      else if (n.kind === 'opponentJoined') player.play('net.joined');
    }
    notice = Math.max(notice, lastN(notices));

    const lines = link.chat();
    // One sound for a burst of lines.
    if (lines.some((l) => l.n > chat && l.from === 'opponent' && l.history !== true)) player.play('net.chat'); // M12F: the chat a reloaded page gets back is not news
    chat = Math.max(chat, lastN(lines));
  });
}

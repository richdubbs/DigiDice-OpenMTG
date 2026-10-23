/**
 * What the game screen adds for a game on the DigiDice server (hosted design 12), above the prompt in the rail:
 * - the clocks: every player's bank with the running one marked, away times, the abandonment timer (Clocks.tsx); and this player's rope on the table beside
 *   the prompt's buttons once their free delay is spent;
 * - the server's notices in plain words with the players' names (a player dropped, came back, left, ran out of time), the latest on one line;
 * - another player's adjustments by hand, to accept or reject (Proposal.tsx);
 * - the table chat (Chat.tsx), in an overlay over the table's right edge so the rail never moves (M12F's rule);
 * - after the end, the result with the public placements (Result.tsx).
 * Everything here comes from the link, which holds only what the server sends this player.
 *
 * Sounds (docs/design/sound.md): net.lost / net.restored as the link to the server or another player drops and comes back, net.chat for their lines.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { sfx } from '../../audio/sfx';
import type { HostedLink } from '../HostedLink';
import { ChatBox, ChatToggle, TalkOverlay, useUnreadChat } from './Chat';
import { ClockStrip, Rope } from './Clocks';
import { noticeText } from './notices';
import { ProposalBox } from './Proposal';
import { HostedResult } from './Result';
import '../hosted.css';

/** The sounds of the link, worked out from what it announces (the link stays a pure transport). */
function useHostedSounds(link: HostedLink): void {
  useEffect(() => {
    const lastN = <T extends { n: number }>(list: readonly T[]) => list[list.length - 1]?.n ?? 0;
    let notice = lastN(link.notices());
    let chat = lastN(link.chat());
    let down = false;
    return link.subscribe(() => {
      const state = link.linkState();
      if (state === 'open') {
        if (down) sfx('net.restored');
        down = false;
      } else if (!down && (state === 'lost' || state === 'closed') && link.linkProblem() !== null) {
        down = true;
        sfx('net.lost');
      }
      for (const n of link.notices()) {
        if (n.n <= notice) continue;
        if (n.kind === 'playerDropped' || n.kind === 'playerLeft' || n.kind === 'timeout' || n.kind === 'forfeit') sfx('net.lost');
        else if (n.kind === 'playerBack') sfx('net.restored');
      }
      notice = Math.max(notice, lastN(link.notices()));
      const lines = link.chat();
      // One sound for a burst of lines.
      if (lines.some((l) => l.n > chat && !l.mine)) sfx('net.chat');
      chat = Math.max(chat, lastN(lines));
    });
  }, [link]);
}

export function HostedGamePanel({ link }: { link: HostedLink }) {
  const notices = useSyncExternalStore(link.subscribe, link.notices);
  const table = useSyncExternalStore(link.subscribe, link.table);
  const game = useSyncExternalStore(link.subscribe, link.view);
  const [chatOpen, setChatOpen] = useState(false);
  const unread = useUnreadChat(link, chatOpen);
  useHostedSounds(link);
  const mySeat = link.seat();
  const who = (seat: number | undefined): string => {
    if (seat === undefined) return 'A player';
    if (seat === mySeat) return 'You';
    return link.nameOfSeat(seat as 1 | 2 | 3 | 4) ?? `Seat ${seat}`;
  };
  const name = (seat: 1 | 2 | 3 | 4) => who(seat);
  const news = notices;
  const latest = news[news.length - 1];
  const over = !!game?.view.result || link.result() !== null;
  const title = table?.title ? `Table chat: ${table.title}` : 'Table chat';

  return (
    <div className="hosted-game" aria-label="Game on the DigiDice server">
      <ClockStrip link={link} />
      <Rope link={link} />
      <ProposalBox link={link} name={name} />
      <div className="hosted-bar">
        {latest && (
          <p className="hosted-news-latest" title={noticeText(latest, who, mySeat)}>
            {noticeText(latest, who, mySeat)}
          </p>
        )}
        <ChatToggle title="Table chat" open={chatOpen} unread={unread} onToggle={() => setChatOpen((o) => !o)} />
      </div>
      {over && <HostedResult link={link} />}
      {chatOpen && (
        <TalkOverlay title={title} onClose={() => setChatOpen(false)}>
          {news.length > 0 && (
            <ul className="hosted-news" aria-label="Table news">
              {news.map((n) => (
                <li key={n.n}>{noticeText(n, who, mySeat)}</li>
              ))}
            </ul>
          )}
          <ChatBox link={link} name={name} />
        </TalkOverlay>
      )}
    </div>
  );
}

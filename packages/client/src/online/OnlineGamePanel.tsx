/**
 * What the game screen adds online (milestone 9, docs/design/online.md), above the prompt:
 * - Host only: the guest's adjustments by hand, in words (the server never sends their raw ops: they name the guest's hidden cards, CR 400.2), to accept
 *   or reject; the guest's action waits for this answer.
 * - Host only: when the guest left for good and the game is not over, "Forfeit for <guest>" ends the game as their concession (CR 104.3a).
 * - After game over, why the other player is gone when they left (CL4: leaving a running game concedes it, CR 104.3a, and the server says so).
 * - A short chat with the other player (plain text, 500 characters).
 * Everything here comes from the link, which holds only what the local server sends this player.
 *
 * M12-5b (docs/design/m12-multiplayer.md 6): a 3-4 player game has its own panel (TablePanel), from the status's table:
 * - Presence: every player with their link; a player whose link dropped shows the clock until they forfeit (5 minutes, the host's clock; CR 104.3a),
 *   counting down on every screen; who left. The latest news of the table (joined, dropped, back, left, forfeited) below it.
 * - By-hand changes need every other player's approval: each other player sees the proposal described for them (the server's words, from their own
 *   view, CR 400.2) with Accept / Reject and an optional reason; the proposer sees whose answers it waits for; how it ended is shown (applied, rejected
 *   by whom, withdrawn, failed).
 * - Host only: a guest that left without conceding (its server stopped) can be ended at once (Forfeit, CR 104.3a); a dropped one has its clock.
 * - Chat with the whole table, each line with its sender.
 * A two-player game keeps milestone 9's panel (DuelPanel), word for word, but for one change: the host's own by-hand changes need
 * the guest's approval too. The guest sees them described from their own view with Accept / Reject and an optional reason; the host sees "waiting for
 * <guest>"; how it ended is shown on both (applied, rejected, withdrawn, failed), as in a 3-4 player game.
 *
 * Sounds (sounds.ts): net.lost / net.restored as the link or the other player drops and comes back, net.chat for their lines; ui.notify when the guest
 * asks for consent, ui.error for a problem shown here.
 *
 * M12F (STATUS "Wave M12" gap 3; the owner's board rule: the right rail never moves or resizes, new panels go in a fixed half or an overlay): in the rail's
 * prompt half the panel stays compact (presence on one wrapped line, the latest table news on one line, the chat button, decisions); the chat and the table
 * news open in an overlay over the table's right edge (the board's stage layer, like the log drawer), so opening them never takes room from the prompt.
 * Without a board (no stage layer) the overlay is drawn in place.
 *
 * RPL-3 (replays design 6, adopted answer 3): both panels carry this player's "Show my cards in replays" (default off), during the game and after its
 * end, so a player who leaves early has set it (their last choice counts). The host's OpenMTG gives every player the whole game after the end only when
 * every player ticked it; otherwise each player keeps a replay of what they were shown. Once the game was shared the choice is final.
 */
import type { PlayerId } from '@openmtg/engine';
import { useContext, useEffect, useId, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { PromptSlotsContext } from '../board/context';
import { useSfxOn } from '../audio/useSfxOn';
import type { ManualOutcome, OnlineLink } from './OnlineLink';
import { explainOnlineError } from './errors';
import { watchLinkSounds } from './sounds';
import { clockText, isTable, listNames, nameOf } from './table';
import './online.css';

const MAX_CHAT = 500;

export function OnlineGamePanel({ link }: { link: OnlineLink }) {
  const status = useSyncExternalStore(link.subscribe, link.status);
  useEffect(() => watchLinkSounds(link), [link]);
  // A 3-4 player game stays one after its server closed it (the status is then idle, without the table).
  const wasTable = useRef(false);
  if (isTable(status)) wasTable.current = true;
  return wasTable.current ? <TablePanel link={link} /> : <DuelPanel link={link} />;
}

/** Milestone 9's panel of a two-player game. */
function DuelPanel({ link }: { link: OnlineLink }) {
  const status = useSyncExternalStore(link.subscribe, link.status);
  const proposal = useSyncExternalStore(link.subscribe, link.proposal);
  const outcome = useSyncExternalStore(link.subscribe, link.manualOutcome);
  const notices = useSyncExternalStore(link.subscribe, link.notices);
  const chat = useSyncExternalStore(link.subscribe, link.chat);
  const view = useSyncExternalStore(link.subscribe, link.view);
  const [problem, setProblem] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const other = status.opponent ?? 'The other player';
  // a proposal with `waiting` is the host's own, which the guest answers; one without is the guest's, for the host (milestone 9).
  const hostOwn = proposal !== null && proposal.waiting !== undefined;
  const mustAnswer = proposal !== null && (hostOwn ? status.role === 'guest' && proposal.waiting!.length > 0 : status.role === 'host');
  const name = (id: PlayerId | undefined) => (id !== undefined && id === status.me ? 'You' : other);
  const proposalId = proposal?.id ?? null;
  useEffect(() => setReason(''), [proposalId]);
  const over = !!view?.view.result || status.phase === 'over';
  const lastPresence = [...notices].reverse().find((n) => n.kind === 'opponentLeft' || n.kind === 'opponentDropped' || n.kind === 'opponentBack');
  const guestGone = status.role === 'host' && status.opponentConnected === false && lastPresence?.kind === 'opponentLeft' && !over;
  const unread = isUnread(chat) && !chatOpen;
  useSfxOn('ui.notify', mustAnswer ? proposal!.id : null);
  useSfxOn('ui.error', problem);

  const answer = async (accept: boolean) => {
    if (!proposal) return;
    setAnswering(true);
    setProblem(null);
    const why = reason.trim();
    const r = await link.answerProposal(
      proposal.id,
      accept,
      accept ? undefined : hostOwn ? (why === '' ? undefined : why.slice(0, MAX_CHAT)) : 'The host rejected the adjustments.',
    );
    setAnswering(false);
    if (!r.ok) setProblem(explainOnlineError(r.error).message);
  };

  const forfeit = async () => {
    setProblem(null);
    const r = await link.forfeit();
    if (!r.ok) setProblem(explainOnlineError(r.error).message);
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const r = await link.say(t.slice(0, MAX_CHAT));
    if (r.ok) setText('');
    else setProblem(explainOnlineError(r.error).message);
  };

  return (
    <div className="online-game" aria-label="Online game">
      {proposal && !hostOwn && status.role === 'host' && (
        <section className="online-proposal" role="alertdialog" aria-label="Adjustments by hand">
          <p>
            <strong>{other}</strong> resolves <strong>{proposal.sourceName}</strong> by hand and asks you to accept these changes:
          </p>
          {proposal.text && <p className="online-proposal-text">{proposal.text}</p>}
          <ul>
            {proposal.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <div className="online-buttons">
            <button type="button" className="button-primary" disabled={answering} onClick={() => void answer(true)}>
              Accept
            </button>
            <button type="button" disabled={answering} onClick={() => void answer(false)}>
              Reject
            </button>
          </div>
        </section>
      )}
      {proposal && hostOwn && status.role === 'host' && (
        <section className="online-proposal" role="status" aria-label="Your adjustments by hand">
          <p>
            You resolve <strong>{proposal.sourceName}</strong> by hand. {other} must accept these changes
            {proposal.waiting!.length > 0 ? (
              <>
                ; waiting for <strong>{other}</strong>.
              </>
            ) : (
              '.'
            )}
          </p>
          <ul>
            {proposal.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {proposal && hostOwn && status.role === 'guest' && (
        <section className="online-proposal" role={mustAnswer ? 'alertdialog' : 'status'} aria-label="Adjustments by hand">
          <p>
            <strong>{other}</strong> resolves <strong>{proposal.sourceName}</strong> by hand and asks you to accept these changes:
          </p>
          {proposal.text && <p className="online-proposal-text">{proposal.text}</p>}
          <ul>
            {proposal.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {mustAnswer && (
            <>
              <label className="online-reason">
                Reason if you reject (optional)
                <input type="text" value={reason} maxLength={MAX_CHAT} disabled={answering} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="online-buttons">
                <button type="button" className="button-primary" disabled={answering} onClick={() => void answer(true)}>
                  Accept
                </button>
                <button type="button" disabled={answering} onClick={() => void answer(false)}>
                  Reject
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {outcome && outcome.proposal !== proposal?.id && (
        <p className="online-presence" role="status">
          {outcomeText(outcome, status.me, name)}
        </p>
      )}
      {over && lastPresence?.kind === 'opponentLeft' && (
        <p className="online-presence" role="status">
          {lastPresence.text}
        </p>
      )}
      {guestGone && (
        <div className="online-buttons">
          <button type="button" onClick={() => void forfeit()}>
            End the game: {other} forfeits
          </button>
        </div>
      )}
      <ReplayConsent link={link} />
      {problem && (
        <p className="online-error" role="alert">
          {problem}
        </p>
      )}
      <div className="online-bar">
        <ChatButton title={`Chat with ${other}`} open={chatOpen} unread={unread} onToggle={() => setChatOpen((o) => !o)} />
      </div>
      {chatOpen && (
        <TalkOverlay title={`Chat with ${other}`} onClose={() => setChatOpen(false)}>
          <ChatBox lines={chat} sender={() => other} text={text} onText={setText} onSend={() => void send()} />
        </TalkOverlay>
      )}
    </div>
  );
}

/** M12-5b: the panel of a 3-4 player game (m12 design 6). */
function TablePanel({ link }: { link: OnlineLink }) {
  const status = useSyncExternalStore(link.subscribe, link.status);
  const proposal = useSyncExternalStore(link.subscribe, link.proposal);
  const outcome = useSyncExternalStore(link.subscribe, link.manualOutcome);
  const notices = useSyncExternalStore(link.subscribe, link.notices);
  const chat = useSyncExternalStore(link.subscribe, link.chat);
  const view = useSyncExternalStore(link.subscribe, link.view);
  const [problem, setProblem] = useState<string | null>(null);
  const [answering, setAnswering] = useState(false);
  const [reason, setReason] = useState('');
  const [text, setText] = useState('');
  const [chatOpen, setChatOpen] = useState(false);
  const [now, setNow] = useState(() => Date.now());
  const me = status.me;
  const players = status.players ?? [];
  const known = view?.view.players ?? [];
  const name = (id: PlayerId | undefined) => nameOf(status, id, known);
  const over = !!view?.view.result || status.phase === 'over';
  const clocks = !over && players.some((p) => p.forfeitAt !== undefined && !p.connected && !p.left);

  // The forfeit clocks count down on every screen, once a second while one runs.
  useEffect(() => {
    if (!clocks) return;
    setNow(Date.now());
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, [clocks]);

  const mine = proposal !== null && proposal.player === me;
  const mustAnswer = proposal !== null && !mine && (proposal.waiting === undefined || (me !== undefined && proposal.waiting.includes(me)));
  useSfxOn('ui.notify', mustAnswer ? proposal!.id : null);
  useSfxOn('ui.error', problem);
  // A new proposal starts with an empty reason.
  const proposalId = proposal?.id ?? null;
  useEffect(() => setReason(''), [proposalId]);

  const news = notices.filter((n) => n.kind !== 'refused');
  const latest = news[news.length - 1];
  const lastAbout = (id: PlayerId) => [...notices].reverse().find((n) => n.player === id && (n.kind === 'opponentLeft' || n.kind === 'opponentDropped' || n.kind === 'opponentBack'));
  // Host only: a guest that left the game without conceding (their server stopped: a bye, no concession) can be ended at once; a dropped link has its clock.
  const gone = status.role === 'host' && !over ? players.filter((p) => p.id !== me && p.taken !== false && !p.connected && !p.left && lastAbout(p.id)?.kind === 'opponentLeft') : [];
  const unread = isUnread(chat) && !chatOpen;

  const answer = async (accept: boolean) => {
    if (!proposal) return;
    setAnswering(true);
    setProblem(null);
    const why = reason.trim();
    const r = await link.answerProposal(proposal.id, accept, accept || why === '' ? undefined : why.slice(0, MAX_CHAT));
    setAnswering(false);
    if (!r.ok) setProblem(explainOnlineError(r.error).message);
  };

  const forfeit = async (player: PlayerId) => {
    setProblem(null);
    const r = await link.forfeit(player);
    if (!r.ok) setProblem(explainOnlineError(r.error).message);
  };

  const send = async () => {
    const t = text.trim();
    if (!t) return;
    const r = await link.say(t.slice(0, MAX_CHAT));
    if (r.ok) setText('');
    else setProblem(explainOnlineError(r.error).message);
  };

  return (
    <div className="online-game online-table" aria-label="Online game">
      <ul className="online-presence-list" aria-label="Players online">
        {players
          .filter((p) => p.taken !== false)
          .map((p) => {
            const you = p.id === me;
            const state = p.left
              ? 'left the game'
              : p.connected
                ? 'connected'
                : p.forfeitAt !== undefined && !over
                  ? `disconnected: ${clockText(p.forfeitAt - now)} until they forfeit`
                  : 'disconnected';
            return (
              <li key={p.id} data-state={p.left ? 'left' : p.connected ? 'on' : 'off'}>
                <span className="online-dot" aria-hidden="true" /> <b>{you ? `${p.name || name(p.id)} (you)` : p.name || name(p.id)}</b>:{' '}
                <span {...(!p.left && !p.connected && p.forfeitAt !== undefined && !over ? { role: 'timer' } : {})}>{state}</span>
              </li>
            );
          })}
      </ul>
      <div className="online-bar">
        {latest && (
          <p className="online-news-latest" title={latest.text}>
            {latest.text}
          </p>
        )}
        <ChatButton title="Table chat" open={chatOpen} unread={unread} onToggle={() => setChatOpen((o) => !o)} />
      </div>
      {proposal && mine && (
        <section className="online-proposal" role="status" aria-label="Your adjustments by hand">
          <p>
            You resolve <strong>{proposal.sourceName}</strong> by hand. Every other player must accept these changes
            {proposal.waiting && proposal.waiting.length > 0 ? (
              <>
                ; waiting for <strong>{listNames(proposal.waiting.map(name))}</strong>.
              </>
            ) : (
              '.'
            )}
          </p>
          <ul>
            {proposal.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
        </section>
      )}
      {proposal && !mine && (
        <section className="online-proposal" role={mustAnswer ? 'alertdialog' : 'status'} aria-label="Adjustments by hand">
          <p>
            <strong>{name(proposal.player)}</strong> resolves <strong>{proposal.sourceName}</strong> by hand and asks every other player to accept these
            changes:
          </p>
          {proposal.text && <p className="online-proposal-text">{proposal.text}</p>}
          <ul>
            {proposal.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          {proposal.waiting && proposal.waiting.length > 0 && (
            <p className="online-note">
              {mustAnswer ? 'Still to answer' : 'You accepted; waiting for'}: {listNames(proposal.waiting.map((id) => (id === me ? 'you' : name(id))))}.
            </p>
          )}
          {mustAnswer && (
            <>
              <label className="online-reason">
                Reason if you reject (optional)
                <input type="text" value={reason} maxLength={MAX_CHAT} disabled={answering} onChange={(e) => setReason(e.target.value)} />
              </label>
              <div className="online-buttons">
                <button type="button" className="button-primary" disabled={answering} onClick={() => void answer(true)}>
                  Accept
                </button>
                <button type="button" disabled={answering} onClick={() => void answer(false)}>
                  Reject
                </button>
              </div>
            </>
          )}
        </section>
      )}
      {outcome && outcome.proposal !== proposal?.id && (
        <p className="online-presence" role="status">
          {outcomeText(outcome, me, name)}
        </p>
      )}
      {gone.map((p) => (
        <div className="online-buttons" key={p.id}>
          <button type="button" onClick={() => void forfeit(p.id)}>
            End the game for {p.name || name(p.id)}: they forfeit
          </button>
        </div>
      ))}
      <ReplayConsent link={link} />
      {problem && (
        <p className="online-error" role="alert">
          {problem}
        </p>
      )}
      {chatOpen && (
        <TalkOverlay title="Table chat" onClose={() => setChatOpen(false)}>
          {news.length > 0 && (
            <ul className="online-news" aria-label="Table news">
              {news.map((n) => (
                <li key={n.n}>{n.text}</li>
              ))}
            </ul>
          )}
          <ChatBox lines={chat} sender={(id) => name(id)} text={text} onText={setText} onSend={() => void send()} />
        </TalkOverlay>
      )}
    </div>
  );
}

/**
 * RPL-3: this player's "Show my cards in replays" (default off), as the local server holds it (`status.replay`); shown once a game is open. The box
 * shows the choice being sent until the server's status says it (a refusal is shown, and the box goes back). A guest's choice made while the link to the
 * host is down is shown with the note that the host still has the earlier one until the link is back (`replay.pending`). Final once the game was shared.
 */
export function ReplayConsent({ link }: { link: OnlineLink }) {
  const status = useSyncExternalStore(link.subscribe, link.status);
  const [sending, setSending] = useState<boolean | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const ids = useId();
  const r = status.replay;
  const agree = r?.agree ?? false;
  // This player's latest choice as the server holds it: the one the host has, or one waiting for the link.
  const chosen = r?.pending ?? agree;
  // The server's status caught up with the choice sent.
  useEffect(() => {
    if (sending !== null && chosen === sending) setSending(null);
  }, [chosen, sending]);
  useSfxOn('ui.error', problem);
  if (!r) return null;
  const choose = async (on: boolean) => {
    setProblem(null);
    setSending(on);
    const res = await link.setReplayConsent(on);
    if (!res.ok) {
      setSending(null);
      setProblem(explainOnlineError(res.error).message);
    }
  };
  const note = r.shared
    ? 'Every player agreed: every replay of this game holds the whole game.'
    : r.tooLarge
      ? 'Every player agreed, but this game is too large to send: each player keeps a replay of what they saw.'
      : r.pending !== undefined
        ? `Not sent yet: the link to the host is down. Until it is back the host has your earlier choice (${agree ? 'show' : 'do not show'} my cards), and a game that ends meanwhile counts that one.`
        : 'Your hand, face-down cards and decklist. Only if every player ticks this does every player get the whole game after the end; otherwise each keeps a replay of what they saw.';
  return (
    <div className="online-replay" data-shared={r.shared || undefined}>
      <label>
        <input
          type="checkbox"
          checked={sending ?? chosen}
          disabled={r.shared || r.tooLarge === true}
          aria-describedby={`${ids}-note`}
          onChange={(e) => void choose(e.currentTarget.checked)}
        />{' '}
        Show my cards in replays
      </label>
      <p id={`${ids}-note`} className="online-note">
        {note}
      </p>
      {problem && (
        <p className="online-error" role="alert">
          {problem}
        </p>
      )}
    </div>
  );
}

/** M12-5b: how a proposal ended, in words for this player. */
export function outcomeText(o: ManualOutcome, me: PlayerId | undefined, name: (id: PlayerId | undefined) => string): string {
  const whose = o.player === undefined ? 'The' : o.player === me ? 'Your' : `${name(o.player)}'s`;
  const what = `${whose} adjustments by hand${o.sourceName ? ` for ${o.sourceName}` : ''}`;
  switch (o.outcome) {
    case 'applied':
      return `${what} were applied: every other player accepted.`;
    case 'rejected':
      return `${what} were rejected${o.by ? ` by ${o.by === me ? 'you' : name(o.by)}` : ''}.`;
    case 'withdrawn':
      return `${what} were withdrawn.`;
    case 'failed':
      return `${what} could not be applied.`;
  }
}

/** M12F: a line from another player that came in since the page loaded (not one a reloaded page got back, `ChatLine.history`). */
function isUnread(chat: readonly { from: 'me' | 'opponent'; history?: true }[]): boolean {
  const last = chat[chat.length - 1];
  return last !== undefined && last.from === 'opponent' && last.history !== true;
}

/** M12F: the rail's chat button (the chat itself opens over the table, TalkOverlay). */
function ChatButton({ title, open, unread, onToggle }: { title: string; open: boolean; unread: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="online-chat-toggle" aria-expanded={open} data-unread={unread || undefined} onClick={onToggle}>
      {title}
      {unread ? ' (new)' : ''}
    </button>
  );
}

/**
 * M12F: the chat (and a 3-4 player game's table news) in a fixed-size overlay over the table's right edge, in the board's stage layer (the slot
 * prompts/stage.tsx draws in): it never changes the rail's layout. Escape or the close button closes it. Without a board it is drawn in place.
 */
function TalkOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const slots = useContext(PromptSlotsContext);
  const box = (
    <section
      className="online-overlay"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="online-overlay-head">
        <h2>{title}</h2>
        <button type="button" className="online-overlay-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </section>
  );
  return slots?.stage ? createPortal(box, slots.stage) : box;
}

function ChatBox(props: {
  lines: readonly { n: number; from: 'me' | 'opponent'; text: string; player?: PlayerId }[];
  sender: (player: PlayerId | undefined) => string;
  text: string;
  onText: (t: string) => void;
  onSend: () => void;
}) {
  const { lines, sender, text, onText, onSend } = props;
  const list = useRef<HTMLOListElement>(null);
  const last = lines[lines.length - 1]?.n;
  // the newest line in sight
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);
  return (
    <div className="online-chat">
      <ol className="online-chat-lines" aria-label="Chat" ref={list}>
        {lines.map((c) => (
          <li key={c.n} data-from={c.from}>
            <b>{c.from === 'me' ? 'You' : sender(c.player)}:</b> {c.text}
          </li>
        ))}
      </ol>
      <form
        className="online-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          onSend();
        }}
      >
        <input type="text" aria-label="Chat message" value={text} maxLength={MAX_CHAT} autoFocus onChange={(e) => onText(e.target.value)} />
        <button type="submit" disabled={text.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}

/**
 * The table's chat (hosted design 3.4 `chat`: plain text to the table, at most 500 characters, two lines a second): the chat box, and the overlay the game
 * screen opens it in. The overlay sits over the table's right edge, in the board's stage layer, like the online game's (M12F: the rail never moves or
 * resizes); without a board it is drawn in place. The server sends every line back to every seat, this one included, so a line shows only once it has
 * been delivered.
 */
import { checkChat, HOSTED_LIMITS, type SeatNumber } from '@openmtg/hosted/api';
import { useContext, useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { useSfxOn } from '../../audio/useSfxOn';
import { PromptSlotsContext } from '../../board/context';
import { hostedErrorText } from '../errors';
import type { HostedLink } from '../HostedLink';

export function ChatBox({ link, name, autoFocus = true }: { link: HostedLink; name: (seat: SeatNumber) => string; autoFocus?: boolean }) {
  const lines = useSyncExternalStore(link.subscribe, link.chat);
  const [text, setText] = useState('');
  const [problem, setProblem] = useState<string | null>(null);
  const [sending, setSending] = useState(false);
  const list = useRef<HTMLOListElement>(null);
  const last = lines[lines.length - 1]?.n;
  useSfxOn('ui.error', problem);
  // the newest line in sight
  useEffect(() => {
    const el = list.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [last]);

  const send = async () => {
    const c = checkChat(text);
    if (!c.ok) {
      if (c.reason !== 'short') setProblem(c.message);
      return;
    }
    setSending(true);
    setProblem(null);
    const r = await link.say(c.value);
    setSending(false);
    if (r.ok) setText('');
    else setProblem(hostedErrorText(r.error));
  };

  return (
    <div className="hosted-chat">
      <ol className="hosted-chat-lines" aria-label="Chat" ref={list}>
        {lines.map((c) => (
          <li key={c.n} data-from={c.mine ? 'me' : 'other'}>
            <b>{c.mine ? 'You' : name(c.from)}:</b> {c.text}
          </li>
        ))}
      </ol>
      {problem && (
        <p className="hosted-error" role="alert">
          {problem}
        </p>
      )}
      <form
        className="hosted-chat-form"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input type="text" aria-label="Chat message" value={text} maxLength={HOSTED_LIMITS.chat} autoFocus={autoFocus} onChange={(e) => setText(e.target.value)} />
        <button type="submit" disabled={sending || text.trim() === ''}>
          Send
        </button>
      </form>
    </div>
  );
}

/** The chat button of the rail: its text says when a line from another player came in that was not looked at. */
export function ChatToggle({ title, open, unread, onToggle }: { title: string; open: boolean; unread: boolean; onToggle: () => void }) {
  return (
    <button type="button" className="hosted-chat-toggle" aria-expanded={open} data-unread={unread || undefined} onClick={onToggle}>
      {title}
      {unread ? ' (new)' : ''}
    </button>
  );
}

/** The chat in a fixed-size overlay over the table's right edge (the board's stage layer). Escape or the close button closes it. */
export function TalkOverlay({ title, onClose, children }: { title: string; onClose: () => void; children: ReactNode }) {
  const slots = useContext(PromptSlotsContext);
  const box = (
    <section
      className="hosted-overlay"
      aria-label={title}
      onKeyDown={(e) => {
        if (e.key === 'Escape') {
          e.stopPropagation();
          onClose();
        }
      }}
    >
      <header className="hosted-overlay-head">
        <h2>{title}</h2>
        <button type="button" className="hosted-overlay-close" aria-label={`Close ${title.toLowerCase()}`} onClick={onClose}>
          ×
        </button>
      </header>
      {children}
    </section>
  );
  return slots?.stage ? createPortal(box, slots.stage) : box;
}

/** Whether another player's line came in that the chat has not been open for. */
export function useUnreadChat(link: HostedLink, open: boolean): boolean {
  const lines = useSyncExternalStore(link.subscribe, link.chat);
  const last = lines[lines.length - 1];
  const seen = useRef(last?.n ?? 0);
  // Lines that arrive while the chat is open are looked at.
  useEffect(() => {
    if (open && last) seen.current = last.n;
  }, [open, last]);
  return !open && last !== undefined && last.n > seen.current && !last.mine;
}

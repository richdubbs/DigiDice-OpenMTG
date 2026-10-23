/**
 * Another player's adjustments by hand (hosted design D12, 5.4; milestone 12 Q6): when a player resolves a card by hand, every other player must accept
 * the changes. The server describes them from this seat's own view (CR 400.2: a card this seat cannot see reads "a hidden card"); this panel shows the
 * description with Accept and Reject (and an optional reason). While the answers are out the proposer's clock stops and each approver's runs
 * (design 5.4), so the answer is the player's to give now.
 */
import { useEffect, useState, useSyncExternalStore } from 'react';
import { useSfxOn } from '../../audio/useSfxOn';
import { hostedErrorText } from '../errors';
import type { HostedLink } from '../HostedLink';

const MAX_REASON = 200;

export function ProposalBox({ link, name }: { link: HostedLink; name: (seat: 1 | 2 | 3 | 4) => string }) {
  const proposal = useSyncExternalStore(link.subscribe, link.proposal);
  const outcome = useSyncExternalStore(link.subscribe, link.proposalOutcome);
  const [reason, setReason] = useState('');
  const [answering, setAnswering] = useState(false);
  const [problem, setProblem] = useState<string | null>(null);
  const id = proposal?.id ?? null;
  // A new proposal starts with an empty reason.
  useEffect(() => {
    setReason('');
    setProblem(null);
  }, [id]);
  useSfxOn('ui.notify', id);
  useSfxOn('ui.error', problem);

  const answer = async (accept: boolean) => {
    if (!proposal) return;
    setAnswering(true);
    setProblem(null);
    const why = reason.trim();
    const r = await link.vote(proposal.id, accept, accept || why === '' ? undefined : why.slice(0, MAX_REASON));
    setAnswering(false);
    if (!r.ok) setProblem(hostedErrorText(r.error));
  };

  return (
    <>
      {proposal && (
        <section className="hosted-proposal" role="alertdialog" aria-label="Adjustments by hand">
          <p>
            <strong>{name(proposal.seat)}</strong> resolves <strong>{proposal.sourceName}</strong> by hand and asks you to accept these changes:
          </p>
          {proposal.text && <p className="hosted-proposal-text">{proposal.text}</p>}
          <ul>
            {proposal.lines.map((l, i) => (
              <li key={i}>{l}</li>
            ))}
          </ul>
          <label className="hosted-reason">
            Reason if you reject (optional)
            <input type="text" value={reason} maxLength={MAX_REASON} disabled={answering} onChange={(e) => setReason(e.target.value)} />
          </label>
          <div className="hosted-buttons">
            <button type="button" className="button-primary" disabled={answering} onClick={() => void answer(true)}>
              Accept
            </button>
            <button type="button" disabled={answering} onClick={() => void answer(false)}>
              Reject
            </button>
          </div>
          {problem && (
            <p className="hosted-error" role="alert">
              {problem}
            </p>
          )}
        </section>
      )}
      {outcome && outcome.proposal !== proposal?.id && (
        <p className="hosted-note" role="status">
          The adjustments by hand were {outcome.outcome}.
        </p>
      )}
    </>
  );
}

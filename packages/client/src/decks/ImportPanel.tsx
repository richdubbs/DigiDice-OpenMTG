/**
 * Import a deck (docs/design/decks-and-formats.md "Import"): paste or upload a decklist (Arena, MTGO or plain text), or paste a deck-site link. The
 * text goes to POST /api/decks/resolve on the local server; a link is never fetched: the player gets that site's export-and-paste steps
 * (docs/research/deck-sites.md). Unknown names are listed with suggestions before anything is saved; a suggestion can be accepted, which rewrites that
 * line and reads the list again. Maybeboard cards are left out, and the player is told how many. A failure sounds ui.error; a list that needs a look
 * first (unknown names, a link's steps) ui.notify; the saved import is the library's ui.success.
 */
import { useState, type ChangeEvent } from 'react';
import type { ResolveResponse } from '@openmtg/server/api';
import { sfx } from '../audio/sfx';
import { FORMAT_OPTIONS } from './formats';
import type { Deck } from './model';
import { GENERIC_LINK_STEPS, deckFromResolve, ignoredText, looksLikeLink, readDeckHeader, replaceLineName, resolvedCount } from './textio';
import { describeApiError, type DecksApi } from './context';

type Stage =
  | { kind: 'edit' }
  | { kind: 'busy' }
  | { kind: 'error'; message: string }
  | { kind: 'link'; links: { site: string; url: string; exportSteps: string[] }[] }
  | { kind: 'review'; res: ResolveResponse; saving?: boolean };

const MAX_FILE_BYTES = 1_000_000;

/** A file's text (FileReader where Blob.text is missing, as in older browsers). */
function readText(file: File): Promise<string> {
  if (typeof file.text === 'function') return file.text();
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result ?? ''));
    r.onerror = () => reject(r.error ?? new Error(`Could not read ${file.name}`));
    r.readAsText(file);
  });
}

export function ImportPanel({
  api,
  now,
  onImported,
  onClose,
}: {
  api: DecksApi;
  now: () => string;
  /** Save the deck; `ignored` maybeboard cards were left out. Resolves true when it was saved. */
  onImported: (deck: Deck, ignored: number) => Promise<boolean>;
  onClose: () => void;
}) {
  const [text, setText] = useState('');
  const [name, setName] = useState('');
  const [fileName, setFileName] = useState<string | null>(null);
  const [format, setFormat] = useState('');
  const [stage, setStage] = useState<Stage>({ kind: 'edit' });

  const fail = (message: string) => {
    setStage({ kind: 'error', message });
    sfx('ui.error');
  };
  /** A result the player has to read before anything is saved. */
  const notify = (next: Stage) => {
    setStage(next);
    sfx('ui.notify');
  };

  /** Save once: the review's import button is disabled while saving, so a double click cannot save the deck twice. */
  const save = async (res: ResolveResponse, listText: string) => {
    setStage({ kind: 'review', res, saving: true });
    const header = readDeckHeader(listText);
    const deckName = name.trim() || header.name || fileName?.replace(/\.[^.]+$/, '') || 'Imported deck';
    const deck = deckFromResolve(res, {
      name: deckName,
      format: format || header.format || 'casual',
      now: now(),
      ...(header.notes ? { notes: header.notes } : {}),
      ...(header.cover ? { cover: header.cover } : {}),
    });
    if (!(await onImported(deck, res.ignored))) setStage({ kind: 'review', res });
  };

  const submit = async (listText = text) => {
    if (!listText.trim()) return;
    setStage({ kind: 'busy' });
    let res: ResolveResponse;
    try {
      res = await api.resolve(listText);
    } catch (e) {
      if (looksLikeLink(listText)) notify({ kind: 'link', links: [{ site: 'this site', url: listText.trim(), exportSteps: GENERIC_LINK_STEPS }] });
      else fail(describeApiError(e));
      return;
    }
    if (res.links.length && !res.cards.length) return notify({ kind: 'link', links: res.links });
    if (!res.cards.length && !res.unknown.length && looksLikeLink(listText)) return notify({ kind: 'link', links: [{ site: 'this site', url: listText.trim(), exportSteps: GENERIC_LINK_STEPS }] });
    if (res.unknown.length || res.errors.length || res.links.length || !res.cards.length) return notify({ kind: 'review', res });
    await save(res, listText);
  };

  /** The player accepted a suggested name: rewrite that line and read the list again. */
  const acceptSuggestion = (line: number, from: string, to: string) => {
    const next = replaceLineName(text, line, from, to);
    setText(next);
    void submit(next);
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    if (file.size > MAX_FILE_BYTES) return fail(`${file.name} is too large for a decklist.`);
    try {
      setText(await readText(file));
      setFileName(file.name);
      setStage({ kind: 'edit' });
    } catch (err) {
      fail(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <section className="deck-panel" aria-label="Import a deck">
      <h2>Import a deck</h2>
      <p className="muted">Paste a decklist (Arena, MTGO or plain text), upload a .txt file, or paste a link to a deck on a deck site.</p>
      <textarea
        aria-label="Decklist or deck link"
        rows={10}
        value={text}
        placeholder={'4 Lightning Bolt\n20 Mountain\n\nSideboard\n2 Pyroblast'}
        onChange={(e) => {
          setText(e.target.value);
          if (stage.kind !== 'busy') setStage({ kind: 'edit' });
        }}
      />
      <div className="panel-row">
        <label>
          Upload a file <input type="file" accept=".txt,.dec,text/plain" aria-label="Upload a decklist file" onChange={(e) => void onFile(e)} />
        </label>
      </div>
      <div className="panel-row">
        <label>
          Deck name <input value={name} onChange={(e) => setName(e.target.value)} placeholder="From the list, or “Imported deck”" />
        </label>
        <label>
          Format{' '}
          <select aria-label="Format" value={format} onChange={(e) => setFormat(e.target.value)}>
            <option value="">From the list (else Casual)</option>
            {FORMAT_OPTIONS.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
      </div>
      <div className="panel-actions">
        <button type="button" className="button-primary" disabled={!text.trim() || stage.kind === 'busy'} onClick={() => void submit()}>
          Import deck
        </button>
        <button type="button" className="button-link" onClick={onClose}>
          Cancel
        </button>
      </div>

      {stage.kind === 'busy' && <p role="status">Reading the list…</p>}
      {stage.kind === 'error' && (
        <p role="alert" className="deck-error">
          Import failed: {stage.message}
        </p>
      )}
      {stage.kind === 'link' && <LinkSteps links={stage.links} />}
      {stage.kind === 'review' && <Review res={stage.res} saving={stage.saving === true} onImport={() => void save(stage.res, text)} onUse={acceptSuggestion} />}
    </section>
  );
}

function LinkSteps({ links }: { links: { site: string; url: string; exportSteps: string[] }[] }) {
  return (
    <div className="link-steps" role="region" aria-label="Deck link">
      {links.map((l) => (
        <div key={l.url}>
          <p>
            OpenMTG does not download decks from {l.site}. To import this deck, copy it as text:
          </p>
          <ol>
            {l.exportSteps.map((s, i) => (
              <li key={i}>{s}</li>
            ))}
          </ol>
        </div>
      ))}
    </div>
  );
}

function Review({
  res,
  saving,
  onImport,
  onUse,
}: {
  res: ResolveResponse;
  saving: boolean;
  onImport: () => void;
  onUse: (line: number, from: string, to: string) => void;
}) {
  const n = resolvedCount(res);
  return (
    <div className="import-review" role="region" aria-label="Import review">
      {res.links.length > 0 && <LinkSteps links={res.links} />}
      {res.unknown.length > 0 && (
        <>
          <p className="deck-error">These names were not found and will be left out:</p>
          <ul>
            {res.unknown.map((u, i) => (
              <li key={i}>
                Line {u.line}: {u.count} {u.name}
                {u.ambiguous?.length ? ` (could be: ${u.ambiguous.join(', ')})` : u.suggestions.length ? ` (did you mean: ${u.suggestions.join(', ')}?)` : ''}
                {(u.ambiguous?.length ? u.ambiguous : u.suggestions).map((s) => (
                  <button key={s} type="button" className="button-link suggestion" disabled={saving} onClick={() => onUse(u.line, u.name, s)} aria-label={`Use ${s} for line ${u.line}`}>
                    Use {s}
                  </button>
                ))}
              </li>
            ))}
          </ul>
        </>
      )}
      {res.errors.length > 0 && (
        <>
          <p className="deck-error">These lines could not be read:</p>
          <ul>
            {res.errors.map((e, i) => (
              <li key={i}>
                Line {e.line}: “{e.text}”: {e.message}
              </li>
            ))}
          </ul>
        </>
      )}
      {res.ignored > 0 && <p className="muted">{ignoredText(res.ignored, 'will be')}</p>}
      {n > 0 ? (
        <button type="button" className="button-primary" onClick={onImport} disabled={saving}>
          Import the {n} card{n === 1 ? '' : 's'} found
        </button>
      ) : (
        <p>No cards were found in the list.</p>
      )}
    </div>
  );
}

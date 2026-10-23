/**
 * Export a deck as Arena, MTGO or plain text: copy to the clipboard or download a .txt file (nothing leaves the player's machine otherwise). Copy and
 * Download sound ui.success when done, ui.error when the browser would not (not a click first: the result is the feedback).
 */
import { useState } from 'react';
import { sfx } from '../audio/sfx';
import type { Deck } from './model';
import { EXPORT_FORMATS, exportDeck, exportFileName, type ExportFormat } from './textio';

/** Save text as a file through a temporary link (no server round trip). */
export function downloadText(fileName: string, text: string): boolean {
  if (typeof URL.createObjectURL !== 'function') return false;
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const a = document.createElement('a');
  a.href = url;
  a.download = fileName;
  // Its click is not the player's (audio/uiSounds.ts).
  a.dataset.sfx = 'none';
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
  return true;
}

export function ExportPanel({ deck, onClose }: { deck: Deck; onClose: () => void }) {
  const [format, setFormat] = useState<ExportFormat>('arena');
  const [note, setNote] = useState<string | null>(null);
  const text = exportDeck(deck, format);
  const hint = EXPORT_FORMATS.find((f) => f.id === format)!.hint;

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(text);
      setNote('Copied to the clipboard.');
      sfx('ui.success');
    } catch {
      setNote('Could not copy automatically: select the text and copy it.');
      sfx('ui.error');
    }
  };

  const download = () => {
    const ok = downloadText(exportFileName(deck, format), text);
    setNote(ok ? 'Download started.' : 'Downloads are not available here.');
    sfx(ok ? 'ui.success' : 'ui.error');
  };

  return (
    <section className="deck-panel" aria-label={`Export ${deck.name}`}>
      <h2>Export “{deck.name}”</h2>
      <div role="radiogroup" aria-label="Export format" className="export-formats">
        {EXPORT_FORMATS.map((f) => (
          <label key={f.id}>
            <input type="radio" name={`export-${deck.id}`} value={f.id} checked={format === f.id} onChange={() => setFormat(f.id)} /> {f.label}
          </label>
        ))}
      </div>
      <p className="muted">{hint}</p>
      <textarea readOnly aria-label="Exported decklist" value={text} rows={12} onFocus={(e) => e.currentTarget.select()} />
      <div className="panel-actions">
        <button type="button" data-sfx="none" onClick={() => void copy()}>
          Copy
        </button>
        <button type="button" data-sfx="none" onClick={download}>
          Download .txt
        </button>
        <button type="button" className="button-link" onClick={onClose}>
          Close
        </button>
      </div>
      {note && <p role="status">{note}</p>}
    </section>
  );
}

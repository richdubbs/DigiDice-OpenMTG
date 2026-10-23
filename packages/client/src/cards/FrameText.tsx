/**
 * The rules text box of our placeholder frame: symbols as our own glyphs, manual text painted (design 10.5, engine `spansOf`), and the structured
 * lines of planeswalkers (CR 606), sagas (CR 714), classes (CR 716) and levelers (CR 711).
 */
import type { ReactNode } from 'react';
import type { CardDef } from '@openmtg/engine';
import { textLenOf } from './artSeed';
import { ManaCost, SymbolText } from './ManaGlyph';
import type { CardFaceModel } from './model';
import { classLevel, faceSpans, isPtLine, levelBand, linesOf, loyaltyCost, runsOf, sagaChapters, type Line, type Run } from './text';

function RunView({ run }: { run: Run }) {
  const body = <SymbolText text={run.text} />;
  switch (run.status) {
    case 'manual':
      return (
        <span className="text-manual" data-status="manual" title={`Resolved by hand${run.reason ? `: ${run.reason}` : ''}`}>
          {body}
        </span>
      );
    case 'reminder':
      return (
        <span className="text-reminder" data-status="reminder">
          {body}
        </span>
      );
    case 'label':
      return (
        <em className="text-label" data-status="label">
          {body}
        </em>
      );
    default:
      return <span data-status={run.status}>{body}</span>;
  }
}

export function FrameText({ face, faceIndex, def, layout }: { face: CardFaceModel; faceIndex: number; def?: CardDef | undefined; layout: string }) {
  const text = face.oracleText;
  // Spans are ranges in the definition's own text; use them only when it is the text shown.
  const spans = def && def.faces[faceIndex]?.oracleText === text ? faceSpans(def, faceIndex) : [];
  const runs = (a: number, b: number) => runsOf(text, spans, a, b).map((r, i) => <RunView key={i} run={r} />);
  const lines = linesOf(text);
  const plain = (l: Line) => (
    <p key={l.start} className="frame-line">
      {runs(l.start, l.end)}
    </p>
  );

  let body: ReactNode[];
  if (/\bPlaneswalker\b/.test(face.typeLine)) {
    body = lines.map((l) => {
      const c = loyaltyCost(l.text);
      if (!c) return plain(l);
      return (
        <p key={l.start} className="frame-line loyalty-line">
          <span className="loyalty-cost" aria-label={`Loyalty ${c.cost}`}>
            {c.cost}
          </span>
          <span>{runs(l.start + c.rest, l.end)}</span>
        </p>
      );
    });
  } else if (layout === 'saga' || /\bSaga\b/.test(face.typeLine)) {
    body = lines.map((l) => {
      const c = sagaChapters(l.text);
      if (!c) return plain(l);
      return (
        <p key={l.start} className="frame-line saga-chapter">
          <span className="saga-marks" aria-label={`Chapter ${c.chapters.join(', ')}`}>
            {c.chapters.map((n) => (
              <span key={n} className="saga-mark">
                {n}
              </span>
            ))}
          </span>
          <span>{runs(l.start + c.rest, l.end)}</span>
        </p>
      );
    });
  } else if (layout === 'class' || /\bClass\b/.test(face.typeLine)) {
    body = lines.map((l) => {
      const c = classLevel(l.text);
      if (!c) return plain(l);
      return (
        <p key={l.start} className="frame-line class-level" aria-label={`Level ${c.level}`}>
          <span className="class-level-name">Level {c.level}</span>
          <ManaCost cost={c.cost} />
        </p>
      );
    });
  } else if (layout === 'leveler') {
    body = lines.map((l) => {
      const band = levelBand(l.text);
      if (band)
        return (
          <p key={l.start} className="frame-line level-band">
            Level {band}
          </p>
        );
      if (isPtLine(l.text))
        return (
          <p key={l.start} className="frame-line level-pt">
            {l.text.trim()}
          </p>
        );
      return plain(l);
    });
  } else {
    body = lines.map(plain);
  }
  return (
    <div className="frame-text" data-len={textLenOf(text)}>
      {body}
    </div>
  );
}

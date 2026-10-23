/**
 * Mana symbols as our own lettered circles (docs/design/m8-client.md "Visual design": no Wizards mana symbols; a "2" circle, a green "G" circle).
 * The mana pool uses C2's glyph (`ManaTypeGlyph`); the cost circles below are drawn only by the board's own `PlaceholderCard`, the default renderer for
 * screens and tests without C2's card picture (the game screen always passes C2's).
 */
import { formatManaSymbol, type ManaCost, type ManaSymbol, type ManaType } from '@openmtg/engine';
import { ManaGlyph as CardManaGlyph, glyphOf } from '../cards';

const COLOR_CLASS: Record<ManaType, string> = { W: 'mana-w', U: 'mana-u', B: 'mana-b', R: 'mana-r', G: 'mana-g', C: 'mana-c' };

function symbolClass(s: ManaSymbol): string {
  switch (s.kind) {
    case 'colored': case 'phyrexian': case 'monoHybrid': case 'colorlessHybrid': return COLOR_CLASS[s.color];
    case 'hybrid': case 'hybridPhyrexian': return 'mana-hybrid';
    case 'colorless': return 'mana-c';
    default: return 'mana-generic';
  }
}

/** The symbol's text inside the circle: "2", "G", "W/U", "G/P", "X", "S". */
function symbolText(s: ManaSymbol): string {
  return formatManaSymbol(s).slice(1, -1);
}

export function ManaGlyph({ symbol }: { symbol: ManaSymbol }) {
  const text = symbolText(symbol);
  return (
    <span className={`board-mana-glyph ${symbolClass(symbol)}`} title={formatManaSymbol(symbol)} aria-hidden="true">
      {text}
    </span>
  );
}

/** A mana cost; the accessible name is the cost text, e.g. "{1}{G}". */
export function ManaCostView({ cost }: { cost: ManaCost | null }) {
  if (!cost || cost.length === 0) return null;
  const label = cost.map(formatManaSymbol).join('');
  return (
    <span className="board-mana-cost" role="img" aria-label={label}>
      {cost.map((s, i) => (
        <ManaGlyph key={i} symbol={s} />
      ))}
    </span>
  );
}

/** One unit of mana of a type (pool display), drawn by C2's mana glyph (one card component, M8-W1 gap 4). */
export function ManaTypeGlyph({ type }: { type: ManaType }) {
  return <CardManaGlyph glyph={glyphOf(type)} />;
}

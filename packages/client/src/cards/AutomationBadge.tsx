/**
 * The automation level of a card (design 10: full, partial, manual), shown next to the card and never on its image (ARCHITECTURE.md "Card images":
 * badges are drawn outside the image bounds). A partly automated card also carries a warning that it may not work as written (PartialWarning).
 */
import type { AutomationLevel } from '@openmtg/engine';

export const AUTOMATION_TEXT: Record<AutomationLevel, { short: string; long: string }> = {
  full: { short: 'Full', long: 'Fully automated: the engine runs all of its rules text.' },
  partial: { short: 'Partial', long: 'Partly automated: it may not function as written. Some of its text is resolved by hand (painted on the card).' },
  manual: { short: 'Manual', long: 'Manual: the players resolve its rules text by hand.' },
};

/** The warning every partly automated card carries wherever its level is read at length (the board's zoom, the deck screens' preview and zoom). */
export const PARTIAL_WARNING = 'This card may not function as written: it is only partly automated, and some of its text is resolved by hand.';

export function AutomationBadge({ level }: { level: AutomationLevel }) {
  const t = AUTOMATION_TEXT[level];
  return (
    <span className={`automation-badge automation-${level}`} role="img" aria-label={`Automation: ${level}`} title={t.long} data-level={level}>
      {t.short}
    </span>
  );
}

/** The warning box of a partly automated card (PARTIAL_WARNING); nothing for the other levels. */
export function PartialWarning({ level, className }: { level: AutomationLevel | null | undefined; className?: string }) {
  if (level !== 'partial') return null;
  return (
    <p className={`automation-warning${className ? ` ${className}` : ''}`} role="note">
      <span className="automation-warning-icon" aria-hidden="true">
        ⚠
      </span>{' '}
      {PARTIAL_WARNING}
    </p>
  );
}

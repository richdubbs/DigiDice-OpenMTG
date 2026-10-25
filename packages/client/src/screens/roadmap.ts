/**
 * What the Home screen's roadmap panel (HomeRoadmap.tsx) says is coming. It is shown to every player, so keep it to what a player gets and what is fine
 * to say in public: no dates, no developer or business detail, nothing undecided. The source is docs/ROADMAP.md; update this list when the plan changes.
 */
export type RoadmapStatus = 'done' | 'now' | 'next' | 'planned' | 'later';

export interface RoadmapItem {
  status: RoadmapStatus;
  title: string;
  text: string;
  /** Show the Standard progress (from coverage-stats.json) on this item. */
  standardProgress?: true;
}

export const STATUS_LABEL: Record<RoadmapStatus, string> = { done: 'Done', now: 'In progress', next: 'Next', planned: 'Planned', later: 'Later' };

export const ROADMAP: readonly RoadmapItem[] = [
  {
    status: 'done',
    title: 'Every Standard card',
    text: 'The rules engine plays every Standard-legal card by itself, with nothing to resolve by hand.',
    standardProgress: true,
  },
  { status: 'done', title: 'A desktop app', text: 'OpenMTG as its own program, with an installer, a Start menu shortcut and automatic updates.' },
  { status: 'next', title: 'Commander favorites', text: "After Standard: the cards Commander players use most, the most popular first." },
  { status: 'done', title: 'Replays', text: 'Save a game and watch it again, at any speed.' },
  { status: 'done', title: 'Report a problem in the game', text: 'Report a bug from the game menu: the report is saved as a file to send us.' },
  { status: 'planned', title: 'Online play', text: 'Play against other people online in free lobbies, and climb a ladder of ranked players.' },
  { status: 'later', title: 'Mac and Linux', text: 'The desktop app on more computers.' },
];

/**
 * The words the hole grammars use as literals (every `P('...')` phrase in this folder), as a static list. Owner: WP6.
 *
 * The chart parser tells an UNKNOWN word (guard G2, diagnostic `unknownWords`) from a known word in the wrong place by this set. It must not depend on which
 * grammar functions have run so far (many `P()` calls sit inside function bodies), so core.ts takes it from this list once, when the holes load, and then
 * stops registering. Generated: the test `review-fixes.test.ts` scans the sources and fails with the current list when this file is stale
 * (set OPENMTG_UPDATE_GRAMMAR_WORDS=1 to rewrite it).
 */
export const GRAMMAR_WORD_LIST: readonly string[] = [
  "'", "'s", ',', '--', '1', 'a', 'abilities', 'ability', 'activate', 'activated', 'activates', 'active', 'add', 'addition', 'additional',
  'adventure', 'all', 'alone', 'already', 'amassed', 'among', 'amount', 'an', 'and', 'and/or', 'another', 'any', 'anywhere', 'are', "aren't", 'army',
  'artifact', "artifacts'", 'as', 'assimilated', 'at', 'attached', 'attack', 'attacked', 'attacker', 'attackers', 'attacking', 'attacks', 'aura',
  'auras', 'bargained', 'base', 'basic', 'battle', 'battlefield', 'be', 'become', 'becomes', 'been', 'before', 'began', 'beginning', 'begun',
  'beheld', 'behold', 'being', 'between', 'black', 'blessing', 'blight', 'block', 'blocked', 'blockers', 'blocking', 'blocks', 'blue', 'boast',
  'borg', 'both', 'bottom', 'but', 'by', 'came', "can't", 'cannot', 'card', 'cards', "cards'", 'case', 'cast', 'casts', 'choice', 'choose', 'chose',
  'chosen', 'city', 'class', 'coin', 'coins', 'collect', 'collected', 'collects', 'color', 'colored', 'colorless', 'colors', 'combat', 'comes',
  'command', 'commander', 'commanders', "commanders'", 'commit', 'commits', 'committed', 'common', 'completed', 'connive', 'connives', 'contains',
  'continuously', 'control', 'controlled', 'controller', 'controllers', 'controls', 'copies', 'copy', 'cost', 'costs', 'could', 'counter',
  'countered', 'counters', 'craft', 'create', 'created', 'creates', 'creature', 'creatures', "creatures'", 'crewed', 'crews', 'crime', 'cumulative',
  'cycle', 'cycled', 'cycles', 'cycling', 'damage', 'day', 'deal', 'deals', 'dealt', 'declare', 'declared', 'defending', 'defense', 'descended',
  'destroyed', 'devotion', 'devoured', 'dice', 'did', "didn't", 'die', 'died', 'dies', 'difference', 'different', 'differently', 'dilemma',
  'dilemmas', 'discard', 'discarded', 'discards', 'disturb', 'do', 'does', "doesn't", "don't", 'done', 'door', 'doors', 'double', 'down', 'draw',
  'drawn', 'draws', 'drew', 'dungeon', 'during', 'dying', 'each', 'enchant', 'enchanted', 'end', 'enduring', 'enlist', 'enlists', 'enter', 'entered',
  'enters', 'equal', 'equip', 'equipment', 'equipped', 'escaped', 'even', 'every', 'evidence', 'evolve', 'evolves', 'exactly', 'except', 'excess',
  'exchange', 'exert', 'exerts', 'exhaust', 'exile', 'exiled', 'expend', 'expends', 'exploit', 'exploits', 'explore', 'explores', 'extra', 'face',
  'faced', 'faces', 'fewer', 'fewest', 'fifth', 'fight', 'fights', 'finish', 'first', 'flip', 'for', 'forage', 'forages', 'foretell', 'foretells',
  'foretold', 'fought', 'four', 'fourth', 'freerunning', 'from', 'full', 'gain', 'gained', 'gains', 'game', 'get', 'gets', 'gift', 'goaded', 'got',
  'graveyard', 'graveyards', 'greater', 'greatest', 'green', 'had', 'half', 'hand', 'hands', 'has', "hasn't", 'have', "haven't", 'he', 'heads',
  'her', 'hexproof', 'higher', 'highest', 'him', 'his', 'historic', 'identity', 'if', 'in', 'initiative', 'into', 'is', "isn't", 'it', "it's", 'its',
  'kick', 'kicked', 'kicker', 'kicks', 'kind', 'kinds', 'land', 'lands', 'last', 'least', 'leave', 'leaves', 'left', 'legendary', 'less', 'lesser',
  'level', 'libraries', 'library', 'life', 'long', 'looked', 'lose', 'loses', 'lost', 'lower', 'lowest', 'loyalty', 'madness', 'main', 'make',
  'mana', 'many', 'max', 'mayhem', 'mill', 'milled', 'mills', 'minus', 'mode', 'monarch', 'monstrous', 'more', 'morph', 'most', 'mount', 'moved',
  'much', 'mutated', 'name', 'named', 'names', 'natural', 'neither', 'next', 'night', 'ninjutsu', 'no', 'non', 'noncombat', 'none', 'nonland',
  'nontoken', 'nor', 'not', 'noted', 'number', 'odd', 'of', 'on', 'one', 'only', 'onto', 'opponent', 'opponents', "opponents'", 'or', 'other', 'out',
  'outlaw', 'outlaws', 'own', 'owned', 'owner', 'owners', "owners'", 'owns', 'paid', 'pairs', 'party', 'pay', 'permanent', 'permanents',
  "permanents'", 'phase', 'phased', 'phases', 'planeswalker', 'planeswalkers', 'play', 'played', 'player', 'players', "players'", 'plays', 'plus',
  'poison', 'poisoned', 'postcombat', 'power', 'power-up', 'powers', 'precombat', 'prevented', 'prime', 'produced', 'promised', 'protection',
  'prowl', 'put', 'puts', 'quality', 'rad', 'random', 'received', 'recent', 'red', 'remain', 'remains', 'remove', 'removed', 'renowned', 'resolved',
  'resolves', 'rest', 'result', 'results', 'return', 'returned', 'reveal', 'revealed', 'right', 'ring', 'ring-bearer', 'ring-bearers', 'roll',
  'rolled', 'rolls', 'round', 'rounded', 'sacrifice', 'sacrificed', 'sacrifices', 'saddled', 'saddles', 'same', 'scried', 'scrying', 'search',
  'searched', 'searches', 'second', 'share', 'shares', 'she', 'shuffled', 'since', 'single', 'sneak', 'solve', 'source', 'sources', 'spectacle',
  'speed', 'spell', 'spells', 'spent', 'stack', 'starting', 'stays', 'step', 'steps', 'still', 'story', 'surge', 'surveilled', 'suspended', 'symbol',
  'symbols', 'tap', 'tapped', 'taps', 'target', 'targets', 'team', 'teamwork', 'tempted', 'tempts', 'than', 'that', "that's", 'the', 'their', 'them',
  'there', "there's", 'they', "they're", "they've", 'third', 'this', 'those', 'three', 'tied', 'time', 'times', 'to', 'token', 'tokens', 'top',
  'total', 'totals', 'toughness', 'toughnesses', 'transform', 'transformed', 'transforms', 'tribute', 'triggered', 'triple', 'turn', 'turned',
  'twice', 'two', 'type', 'types', 'unattach', 'unattached', 'under', 'unlock', 'unlocked', 'unspent', 'untap', 'untapped', 'until', 'up', 'upkeep',
  'upkeeps', 'used', 'using', 'value', 'values', 'vehicle', 'vote', 'voted', 'votes', 'voting', 'warp', 'warped', 'was', "wasn't", 'waterbend',
  'way', 'web-slinging', 'were', "weren't", 'where', 'whichever', 'while', 'white', 'who', 'whose', 'win', 'wins', 'with', 'without', 'won', 'would',
  'x', 'yet', 'you', "you're", "you've", 'your', 'zero', 'zone', '{e}', '{s}', '{t}', '{x}', '~',
];

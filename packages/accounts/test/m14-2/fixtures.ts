/** Fixed inputs of the M14-2 tests (owner rule: fixed lists, never randomized). */

/** Valid account names across the scripts 6.1 allows: each passes checkAccountName. */
export const NAMES: readonly string[] = [
  'Alice', 'Bob', 'Ann Lee', 'Mary_Jane', "D'Arcy", 'Dr.Who', 'Bob42', 'José', 'Zoë', 'Straße', 'Łukasz', 'Ærøskøbing', 'Ilya', 'Mike',
  'Jörg', 'Ñandú', 'Çağla', 'Đorđe', 'Søren', 'Þórr', 'Nguyễn Văn', 'Αλέξανδρος', 'Ελένη', 'Οδυσσέας', 'Дмитрий', 'Ёжик', 'Ольга', 'Ярослав',
  'Tanaka田中', '田中さん', 'サクラ', 'さくら', '김철수', 'Kim철수', 'Lee李', '王小明', 'ㄅㄆㄇ注音', 'द\u0947वन\u093eगर\u0940', 'สมชาย', 'أحمد', 'שלום', 'Արամ',
  'ნინო', 'ᏣᎳᎩ', 'Ꭰꮳꮃ', 'Ⰰⰱⰲ', 'Ahmed_99', 'x.y.z', 'Ouvea', 'Dvořák',
  // review of M14-2: capitals that look like Latin ones, a capital that keeps its small letter's key, Hebrew yod
  'Мах', 'ΜΙΚΕ', 'Ꞵob', 'Норе', 'ΗΟΜΕ', 'שירה', 'דניאל',
];

/**
 * 200 pairs of different names that must keep different keys: near misses by hand first (one letter, one digit, one mark that is not a Latin,
 * Greek or Cyrillic diacritic), then pairs of distinct names from DISTINCT.
 */
export const NEAR_MISSES: readonly (readonly [string, string])[] = [
  ['Ann', 'Anne'], ['Bob', 'Rob'], ['Mike', 'Mika'], ['Jose', 'Josh'], ['Mark', 'Marc'], ['Gwen', 'Owen'], ['Chris', 'Kris'], ['Sara', 'Sarah'],
  ['Jon', 'John'], ['Lee', 'Leo'], ['Max', 'Mac'], ['Tom', 'Tim'], ['Kim', 'Kin'], ['Pat', 'Pet'], ['Dan', 'Don'], ['Ben', 'Ken'], ['Zoe', 'Joe'],
  ['Amy', 'Ami'], ['Eva', 'Ava'], ['Ola', 'Ula'], ['Ted', 'Tad'], ['Jim', 'Jam'], ['Bob1', 'Bob2'], ['Bob7', 'Bob1'], ['Player1', 'Player2'],
  ['Alice', 'Alize'], ['Alice', 'Alicia'], ['Barn', 'Bark'], ['Bam', 'Ban'], ['Rnike', 'Rnlke2'], ['Mike', 'Nike'], ['Wade', 'Vade'],
  ['Quinn', 'Gwinn'], ['Xena', 'Zena'], ['Yuri', 'Yuki'], ['Hana', 'Hanna'], ['Ivy', 'Ivo'], ['Oscar', 'Oskar'], ['Felix', 'Feliks'],
  ['Nina', 'Nino'], ['Dmitri', 'Dimitri'], ['Sven', 'Steven'], ['Ugo', 'Hugo'], ['Ella', 'Elle'], ['Theo', 'Thea'], ['Erik', 'Eric'],
  ['Дмитрий', 'Дмитро'], ['Ольга', 'Олег'], ['Ελένη', 'Ελενα'], ['Νίκος', 'Νίκη'], ['田中太郎', '田村太郎'], ['王小明', '王小红'], ['김철수', '김철호'],
  ['さくら', 'さくま'], ['サクラ', 'サクマ'], ['أحمد', 'محمد'], ['שלום', 'שלומי'], ['स\u0940त\u093e', 'ग\u0940त\u093e'], ['สมชาย', 'สมศร\u0e35'], ['Արամ', 'Արամե'],
  // review of M14-2: a Hebrew yod is a letter (Shira and Sarah, Daniel); letters of one Cyrillic alphabet stay apart
  ['שירה', 'שרה'], ['דניאל', 'דנאל'], ['יוסי', 'יוס'], ['Ольга', 'Олвга'], ['Евген', 'Євген'], ['Нади', 'Һади'],
];

/** Names no two of which are the same name (their pairs fill NEAR_MISSES up to 200 pairs). */
export const DISTINCT: readonly string[] = [
  'Alice', 'Bob', 'Carol', 'Dave', 'Erin', 'Frank', 'Grace', 'Heidi', 'Ivan', 'Judy', 'Mallory', 'Niaj', 'Olivia', 'Peggy', 'Rupert', 'Sybil',
  'Trent', 'Victor', 'Walter', 'Xavier', 'Дмитрий', 'Αλέξανδρος', '田中太郎', '김철수', 'さくら',
];

/** Exactly 200 pairs: NEAR_MISSES, then the pairs of DISTINCT in order. */
export function differentPairs(): (readonly [string, string])[] {
  const out: (readonly [string, string])[] = [...NEAR_MISSES];
  for (let i = 0; i < DISTINCT.length && out.length < 200; i++) {
    for (let j = i + 1; j < DISTINCT.length && out.length < 200; j++) out.push([DISTINCT[i]!, DISTINCT[j]!]);
  }
  return out;
}

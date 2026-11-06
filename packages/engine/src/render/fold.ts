/**
 * Folds (WP2): adjacent steps that Oracle writes as ONE idiom. The model keeps them apart (a choice, then a move; a separation, then two moves; a move
 * into a library, then a shuffle) because each is a separate rules event; the text says them together:
 *   "You may put a creature card from your hand onto the battlefield."      chooseObjects (min 0, max 1) + move of the chosen object
 *   "Put one pile into your hand and the other into your graveyard."        piles + move of the chosen pile + move of the other pile
 *   "That player shuffles their hand into their library."                   move into a library + shuffle of that library's owner
 * A fold applies only when every part is exactly what the idiom says (same player, bound names, nothing else in between).
 */
import type { AbilityDef, EffectStep, Modification, ObjectFilter, ObjRef, PlayerRef, Quantity } from '../types/ability';
import { computedPtColorlessText, copyExceptText } from './copy-except';
import { acting, fragment, plain, within, type Clause } from './clause';
import { K } from './kernel';
import { AMBIGUOUS, groupPool, identityOf, isPlayerRef, onlySeenGroup, rangeWords, restOfExiled, restOfGroup, totalLimitWords } from './refs';
import { zoneSetPhrase } from './steps-cards';
import { countersText } from './steps-life';
import { isSelfReplacement } from './self-replacement';
import { graveyardInsteadText, MOVE_VERB } from './steps-zones';
import { bind, byPlayer, countedNoun, destPhrase, handChoice, infoOfRef, isComputed, saidX } from './steps-util';
import { MILLED_KEY, cloneState, playerKey, withVariants, type RenderState } from './state';
import { alt, COLOR_WORD, firstAlt, joinList, NoRenderer, numWord, parseMarked, pluralize, serializeMarked, signed, withArticle, type MarkedNode } from './text';
import { foldStdDsk } from './fold-stddsk';
import { foldPcEp3 } from './fold-pcep3'; // pc-exile-play-3
import { flashThenGrantEveryCast } from './fold-edhd50'; // edh-d-50
import { foldTrek13 } from './fold-trek13'; // trek-13
import { foldPcEp4 } from './fold-pcep4'; // pc-exile-play-4
import { foldEdhPm8 } from './fold-edhpm8';
import { foldR4Refs, foldR4RefsEarly } from './fold-r4refs';
import { foldR5Refs } from './fold-r5refs';
import { foldR5Fxz } from './fold-r5fxz';
import { foldStdRs } from './fold-stdrs';
import { foldStdRx31 } from './fold-stdrx31';
import { foldStdCombat1 } from './fold-stdcombat1';
import { foldEdhMisc2 } from './fold-edhmisc2';
import { foldEdhMisc5 } from './fold-edhmisc5';
import { foldEdhMk8 } from './fold-edhmk8';
import { foldStdCosts2 } from './fold-stdcosts2';
import { foldEdhN90 } from './fold-edhn90';
import { foldStdLibrary2 } from './fold-stdlibrary2';
import { foldEdhCast1 } from './fold-edhcast1';
import { foldEdhCast5 } from './fold-edhcast5'; // edh-cast-5
import { foldEdhCast7 } from './fold-edhcast7'; // edh-cast-7
import { foldEdhCb1 } from './fold-edhcb1';
import { foldEdhV14 } from './fold-edhv14';
import { foldEdhV32 } from './fold-edhv32'; // edh-c-32
import { foldEdhV51 } from './fold-edhv51'; // edh-c-51
import { foldEdhV24 } from './fold-edhv24'; // edh-c-24
import { foldEdhZones3 } from './fold-edhzones3'; // edh-zones-3
import { foldEdhP5 } from './fold-edhp5'; // edh-players-5
import { foldEdhB5 } from './fold-edhb5'; // edh-b-5
import { foldEdhN123 } from './fold-edhn123'; // edh-next-123
import { foldEdhN142 } from './fold-edhn142'; // edh-next-142
import { foldEdhN138 } from './fold-edhn138'; // edh-next-138
import { foldEdhN136 } from './fold-edhn136'; // edh-next-136
import { foldEdhN137 } from './fold-edhn137'; // edh-next-137
import { foldEdhD101 } from './fold-edhd101'; // edh-d-101
import { foldEdhB12 } from './fold-edhb12'; // edh-b-12
import { foldEdhN3 } from './fold-edhn3'; // edh-next-3
import { foldEdhN19 } from './fold-edhn19'; // edh-next-19
import { foldEdhD64 } from './fold-edhd64'; // edh-d-64
import { foldEdhD80 } from './fold-edhd80'; // edh-d-80
import { foldEdhV95 } from './fold-edhv95'; // edh-c-95
import { foldEdhN10 } from './fold-edhn10'; // edh-next-10
import { foldEdhN63 } from './fold-edhn63'; // edh-next-63
import { foldEdhN7 } from './fold-edhn7'; // edh-next-7
import { foldEdhV10 } from './fold-edhv10'; // edh-c-10
import { foldEdhV26 } from './fold-edhv26'; // edh-c-26
import { foldEdhV80 } from './fold-edhv80'; // edh-c-80
import { foldEdhV97 } from './fold-edhv97'; // edh-c-97
import { foldEdhP6 } from './fold-edhp6'; // edh-players-6
import { foldEdhP7 } from './fold-edhp7'; // edh-players-7
import { foldEdhP8 } from './fold-edhp8'; // edh-players-8
import { foldEdhP11 } from './fold-edhp11'; // edh-players-11
import { foldEdhV29 } from './fold-edhv29'; // edh-c-29
import { foldEdhT5 } from './fold-edht5'; // edh-top-5
import { foldEdhP9 } from './fold-edhp9'; // edh-players-9
import { foldEdhPm12 } from './fold-edhpm12'; // edh-perms-12
import { foldEdhD1 } from './fold-edhd1'; // edh-d-1
import { foldEdhD28 } from './fold-edhd28'; // edh-d-28
import { foldEdhPm15 } from './fold-edhpm15'; // edh-perms-15
import { foldEdhV27 } from './fold-edhv27'; // edh-c-27
import { foldEdhD33 } from './fold-edhd33'; // edh-d-33
import { foldEdhC6 } from './fold-edhc6'; // edh-c-6
import { foldEdhV20 } from './fold-edhv20'; // edh-c-20
import { foldEdhPm16 } from './fold-edhpm16'; // edh-perms-16
import { foldEdhPm17 } from './fold-edhpm17'; // edh-perms-17
import { foldEdhD47 } from './fold-edhd47'; // edh-d-47
import { foldStdCopy6 } from './fold-stdcopy6';
import { foldEdhMk11 } from './fold-edhmk11';
import { foldEdhD54 } from './fold-edhd54'; // edh-d-54
import { foldEdhD73 } from './fold-edhd73'; // edh-d-73
import { foldEdhD75 } from './fold-edhd75'; // edh-d-75
import { foldEdhD88 } from './fold-edhd88'; // edh-d-88
import { foldEdhD95 } from './fold-edhd95'; // edh-d-95
import { foldEdhMk12 } from './fold-edhmk12';
import { foldP2Refs1 } from './fold-p2refs1';
import { foldStdControl1 } from './fold-stdcontrol1';
import { foldP2Damage2 } from './fold-p2damage2'; // p2-damage-2
import { foldP2Damage3 } from './fold-p2damage3'; // p2-damage-3
import { foldStdCombat2 } from './fold-stdcombat2'; // std-combat-2
import { foldPcCombat1 } from './fold-pccombat1'; // pc-combat-1
import { foldEdhD89 } from './fold-edhd89'; // edh-d-89
import { foldPcCombat4 } from './fold-pccombat4'; // pc-combat-4
import { foldStdCombat5 } from './fold-stdcombat5';
import { foldP2ReplaceDamage1 } from './fold-p2rd1'; // p2-replace-damage-1
import { foldStdExile3 } from './fold-stdexile3';
import { foldP2Dig1 } from './fold-p2dig1';
import { foldP2ReplaceDamage3 } from './fold-p2rd3'; // p2-replace-damage-3
import { foldEdhV60 } from './fold-edhv60'; // edh-c-60
import { foldP2CombatFlow1 } from './fold-p2cf1';
import { foldEdhCb5 } from './fold-edhcb5'; // edh-combat-5
import { foldEdhCb7 } from './fold-edhcb7'; // edh-combat-7
import { foldP2GroupActions1 } from './fold-p2ga1'; // p2-group-actions-1
import { returnRandomFromGraveyard, revealRandomFromHand } from './fold-p2coinflip1'; // p2-coinflip-1
import { lookAtRandomInHand } from './fold-edhmk10'; // edh-mana-keywords-10
import { foldP2GroupActions2 } from './fold-p2ga2'; // p2-group-actions-2
import { foldEdhNext1 } from './fold-edhn1'; // edh-next-1
import { foldEdhV105 } from './fold-edhv105'; // edh-c-105
import { foldPcPlayers1 } from './fold-pcp1'; // pc-players-1
import { foldP2ReplaceDamage4 } from './fold-p2rd4'; // p2-replace-damage-4
import { foldTrek3 } from './fold-trek3'; // trek-3
import { foldEdhC104 } from './fold-edhc104'; // edh-c-104
import { foldTrek8 } from './fold-trek8'; // trek-8
import { foldTrek20 } from './fold-trek20'; // trek-20
import { foldTrek9 } from './fold-trek9'; // trek-9
import { foldEdhPm4 } from './fold-edhpm4'; // edh-perms-4
import { foldEdhN59 } from './fold-edhn59'; // edh-next-59
import { foldPcTokens1 } from './fold-pctokens1'; // pc-tokens-1
import { foldPcZones1 } from './fold-pczones1'; // pc-zones-1
import { foldPcZones2 } from './fold-pczones2'; // pc-zones-2
import { foldEdhT6 } from './fold-edht6'; // edh-top-6
import { foldEdhN16 } from './fold-edhn16'; // edh-next-16
import { foldEdhV102 } from './fold-edhv102'; // edh-c-102
import { foldEdhD51 } from './fold-edhd51'; // edh-d-51
import { foldEdhN8 } from './fold-edhn8'; // edh-next-8
import { foldEdhB14 } from './fold-edhb14'; // edh-b-14
import { foldEdhV18 } from './fold-edhv18'; // edh-c-18
import { foldEdhN21 } from './fold-edhn21'; // edh-next-21
import { foldEdhT8 } from './fold-edht8'; // edh-top-8
import { foldEdhT9 } from './fold-edht9'; // edh-top-9
import { foldEdhT16 } from './fold-edht16'; // edh-top-16
import { foldEdhZones4 } from './fold-edhzones4'; // edh-zones-4
import { foldEdhZones12 } from './fold-edhzones12'; // edh-zones-12
import { foldEdhZones9 } from './fold-edhzones9'; // edh-zones-9
import { foldEdhD7 } from './fold-edhd7'; // edh-d-7
import { foldEdhN125 } from './fold-edhn125'; // edh-next-125
import { foldEdhD15 } from './fold-edhd15'; // edh-d-15
import { foldEdhD25 } from './fold-edhd25'; // edh-d-25
import { foldEdhD29 } from './fold-edhd29'; // edh-d-29
import { foldEdhD32 } from './fold-edhd32'; // edh-d-32
import { foldEdhN135 } from './fold-edhn135'; // edh-next-135
import { foldEdhD43 } from './fold-edhd43'; // edh-d-43
import { foldEdhD35 } from './fold-edhd35'; // edh-d-35
import { foldEdhN121 } from './fold-edhn121'; // edh-next-121
import { foldEdhN134 } from './fold-edhn134'; // edh-next-134
import { foldEdhN145 } from './fold-edhn145'; // edh-next-145
import { foldEdhD96 } from './fold-edhd96'; // edh-d-96
import { foldEdhD92 } from './fold-edhd92'; // edh-d-92
import { foldEdhN146 } from './fold-edhn146'; // edh-next-146
import { foldEdhV92 } from './fold-edhv92'; // edh-c-92
import { foldEdhZones11 } from './fold-edhzones11'; // edh-zones-11
import { foldEdhMisc4 } from './fold-edhmisc4'; // edh-misc-4
import { foldEdhZones8 } from './fold-edhzones8'; // edh-zones-8
import { foldEdhZones10 } from './fold-edhzones10'; // edh-zones-10
import { foldEdhD19 } from './fold-edhd19'; // edh-d-19
import { foldEdhD27 } from './fold-edhd27'; // edh-d-27
import { foldEdhD36 } from './fold-edhd36'; // edh-d-36
import { foldEdhN66 } from './fold-edhn66'; // edh-next-66
import { foldEdhP13 } from './fold-edhp13'; // edh-players-13
import { foldEdhV25 } from './fold-edhv25'; // edh-c-25
import { foldEdhP17 } from './fold-edhp17'; // edh-players-17
import { foldEdhP20 } from './fold-edhp20'; // edh-players-20
import { foldEdhC8 } from './fold-edhc8'; // edh-c-8
import { foldEdhC76 } from './fold-edhc76'; // edh-c-76
import { foldEdhD62 } from './fold-edhd62'; // edh-d-62
import { foldEdhD85 } from './fold-edhd85'; // edh-d-85
import { foldEdhC83 } from './fold-edhc83'; // edh-c-83
import { foldEdhP15 } from './fold-edhp15'; // edh-players-15
import { foldEdhZones13 } from './fold-edhzones13'; // edh-zones-13
import { foldEdhZones16 } from './fold-edhzones16'; // edh-zones-16
import { foldEdhZones18 } from './fold-edhzones18'; // edh-zones-18
import { foldTrek17 } from './fold-trek17'; // trek-17
import { foldEdhZones22 } from './fold-edhzones22'; // edh-zones-22
import { foldEdhN143 } from './fold-edhn143'; // edh-next-143
import { foldEdhZones24 } from './fold-edhzones24'; // edh-zones-24
import { foldEdhD20 } from './fold-edhd20'; // edh-d-20
import { foldEdhV19 } from './fold-edhv19'; // edh-c-19
import { exileOneOfThemFromGraveyard } from './fold-edhzones25'; // edh-zones-25
import { foldEdhZones27 } from './fold-edhzones27'; // edh-zones-27
import { foldEdhN95 } from './fold-edhn95'; // edh-next-95
import { foldEdhD58 } from './fold-edhd58'; // edh-d-58
import { foldEdhP21 } from './fold-edhp21'; // edh-players-21
import { foldEdhV30 } from './fold-edhv30'; // edh-c-30
import { foldEdhNext27 } from './fold-edhn27'; // edh-next-27
import { foldEdhB13 } from './fold-edhb13'; // edh-b-13
import { foldEdhV22 } from './fold-edhv22'; // edh-c-22
import { foldEdhV4 } from './fold-edhv4'; // edh-c-4
import { foldEdhV59 } from './fold-edhv59'; // edh-c-59
import { foldEdhV74 } from './fold-edhv74'; // edh-c-74
import { foldEdhV65 } from './fold-edhv65'; // edh-c-65
import { foldEdhV96 } from './fold-edhv96'; // edh-c-96
import { foldEdhV56 } from './fold-edhv56'; // edh-c-56
import { foldEdhV71 } from './fold-edhv71'; // edh-c-71
import { foldEdhV46 } from './fold-edhv46'; // edh-c-46
import { foldEdhCast15 } from './fold-edhcast15'; // edh-cast-15
import { foldEdhB11 } from './fold-edhb11'; // edh-b-11
import { foldEdhC11 } from './fold-edhc11'; // edh-c-11
import { foldEdhC73 } from './fold-edhc73'; // edh-c-73
import { foldEdhC12 } from './fold-edhc12'; // edh-c-12
import { foldEdhD5 } from './fold-edhd5'; // edh-d-5
import { foldEdhD53 } from './fold-edhd53'; // edh-d-53
import { foldEdhD67 } from './fold-edhd67'; // edh-d-67
import { foldEdhD17 } from './fold-edhd17'; // edh-d-17
import { foldEdhC75 } from './fold-edhc75'; // edh-c-75
import { foldEdhC66 } from './fold-edhc66'; // edh-c-66
import { foldEdhN40 } from './fold-edhn40'; // edh-next-40
import { foldEdhD61 } from './fold-edhd61'; // edh-d-61
import { foldEdhN46 } from './fold-edhn46'; // edh-next-46
import { foldEdhN96 } from './fold-edhn96'; // edh-next-96
import { foldEdhD2 } from './fold-edhd2'; // edh-d-2
import { foldEdhD26 } from './fold-edhd26'; // edh-d-26
import { foldEdhD9 } from './fold-edhd9'; // edh-d-9
import { foldEdhD93 } from './fold-edhd93'; // edh-d-93
import { foldEdhD39 } from './fold-edhd39'; // edh-d-39
import { foldEdhD23 } from './fold-edhd23'; // edh-d-23
import { foldEdhN126 } from './fold-edhn126'; // edh-next-126
import { foldEdhN127 } from './fold-edhn127'; // edh-next-127
import { foldEdhN144 } from './fold-edhn144'; // edh-next-144
import { foldEdhN140 } from './fold-edhn140'; // edh-next-140
import { foldEdhD37 } from './fold-edhd37'; // edh-d-37
import { foldEdhD52 } from './fold-edhd52'; // edh-d-52
import { foldEdhB9 } from './fold-edhb9'; // edh-b-9
import { foldEdhD46 } from './fold-edhd46'; // edh-d-46
import { foldEdhD94 } from './fold-edhd94'; // edh-d-94
import { foldEdhC50 } from './fold-edhc50'; // edh-c-50
import { foldEdhD49 } from './fold-edhd49'; // edh-d-49
import { movedInfo } from './moved';
import { countersIfSentence } from './edhpm10';
import { foldEdhC108 } from './fold-edhc108'; // edh-c-108
import { foldEdhN98 } from './fold-edhn98'; // edh-next-98
import { foldEdhN80 } from './fold-edhn80'; // edh-next-80
import { foldEdhN79 } from './fold-edhn79'; // edh-next-79
import { foldEdhN89 } from './fold-edhn89'; // edh-next-89
import { foldEdhN97 } from './fold-edhn97'; // edh-next-97
import { foldEdhN122 } from './fold-edhn122'; // edh-next-122
import { foldEdhD63 } from './fold-edhd63'; // edh-d-63
import { foldEdhN110 } from './fold-edhn110'; // edh-next-110
import { foldEdhN120 } from './fold-edhn120'; // edh-next-120
import { foldEdhN131 } from './fold-edhn131'; // edh-next-131
import { foldEdhN128 } from './fold-edhn128'; // edh-next-128
import { foldEdhD99 } from './fold-edhd99'; // edh-d-99
import { foldEdhN129 } from './fold-edhn129'; // edh-next-129
import { foldEdhN139 } from './fold-edhn139'; // edh-next-139
import { foldEdhN132 } from './fold-edhn132'; // edh-next-132
import { foldEdhD97 } from './fold-edhd97'; // edh-d-97
import { foldEdhD74 } from './fold-edhd74'; // edh-d-74
import { foldEdhD87 } from './fold-edhd87'; // edh-d-87
import { foldEdhD91 } from './fold-edhd91'; // edh-d-91
import { foldEdhD100 } from './fold-edhd100'; // edh-d-100

export interface Folded {
  clauses: Clause[];
  consumed: number;
}

const isBound = (ref: ObjRef, name: string | undefined): boolean => name !== undefined && ref.ref === 'bound' && ref.name === name;

/** r3-refs: the card types of permanents (CR 110.4), as nouns. */
const PERMANENT_NOUNS: ReadonlySet<string> = new Set(['artifact', 'battle', 'creature', 'enchantment', 'land', 'planeswalker']);

/** Choose, then put what was chosen somewhere. */
/**
 * std-exile-play-1-2 (CR 406.1, 608.2c; family owner-exiles-chosen-card): "Target opponent reveals X cards from their hand .... You choose one of those cards. That player
 * exiles it." (Taster of Wares): your choice of exactly one card among the cards a player revealed from their own hand, then the move of that card into exile. The
 * choice is a sentence of its own (render/steps-flow.ts) and the exile is also said with that player as its subject (who exiles a card from a hand changes nothing,
 * CR 406.1): the fold starts at the move, right after the choice (the focus is the chosen card, model/focus.ts). Only that shape.
 */
function chosenRevealedExiled(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i - 1];
  const b = list[i];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.random === true) return null;
  if (a.guard !== undefined || b.guard !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || JSON.stringify(b.to) !== '{"zone":"exile"}') return null;
  if (a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const f = a.from.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'is,zone' || f.zone !== 'any' || f.is?.ref !== 'bound') return null;
  const group = f.is.name;
  // the group: what one player chose from their own hand (and revealed); that player is the one who exiles
  const picked = list.slice(0, i - 1).find((x): x is Extract<EffectStep, { op: 'chooseObjects' }> => x.op === 'chooseObjects' && x.as === group);
  const pf = picked !== undefined && picked.from.ref === 'each' && 'filter' in picked.from ? picked.from.filter : undefined;
  if (picked === undefined || pf === undefined || pf.zone !== 'hand' || JSON.stringify(pf.owner) !== JSON.stringify(picked.who) || picked.who.ref === 'you' || picked.who.ref === 'each') return null;
  const it = K.obj(b.what, st, 'object').text;
  const who = K.player(picked.who, cloneState(st), 'subject').text;
  // what the move exiled, named for a later "if an instant or sorcery card is exiled this way" (as chooseThenMove binds it)
  if (b.as !== undefined) bind(st, b.as, { nouns: ['card'], plural: false, zone: 'exile', sameAs: identityOf(st, `b:${a.as}`), thisWay: 'exiled this way' });
  return { clauses: [acting('you', alt(`exile ${it}`, `${who} exiles ${it}`), alt(`you exile ${it}`, `${who} exiles ${it}`))], consumed: 1 };
}

/** edh-d-90 (Godsend): the trigger is "<one creature> blocks or becomes blocked by one or more creatures" (render/evt.ts), whose `object` role is the group of the other combatants. */
function blockersOrBlocked(st: RenderState): boolean {
  const t = st.trigger ?? [];
  return st.triggerBatch === true && t.length === 2 && t[0]!.ev === 'blocks' && t[1]!.ev === 'becomesBlocked' && JSON.stringify(t[0]!.attacker) === '{"types":["Creature"]}' && JSON.stringify(t[1]!.by) === '{"types":["Creature"]}'
    && JSON.stringify(t[0]!.blocker) === JSON.stringify(t[1]!.attacker);
}

function chooseThenMove(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move') return null;
  // edh-zones-15 (CR 406.1, 610.3, 608.2d; template eff.edhz15.exile.anyNumber.youControl.until, Abdel Adrian): your choice of permanents exiled until a duration is one instruction,
  // "exile any number of other nonland permanents you control until ~ leaves the battlefield" (only an exile of your own choice, face up)
  const untilExile = b.until !== undefined && b.to.zone === 'exile' && b.to.faceDown !== true && Object.keys(b.to).length === 1 && a.who.ref === 'you' && b.guard === undefined;
  if (a.as === undefined || !isBound(b.what, a.as) || (b.until !== undefined && !untilExile) || a.random === true) return null;
  // std-typechange-2 (CR 608.2c, 508.4; parser rider rid.stdtc2.ifCardIs.entersTappedAttacking): "... onto the battlefield. If that card is an enchantment card, it
  // enters tapped and attacking": the put said without the status, then the sentence that gives it to the card that matches; only one card put onto the battlefield
  if (b.to.statusIf !== undefined) {
    const { statusIf, tapped, attacking, ...plain } = b.to;
    if (b.to.zone !== 'battlefield' || tapped !== true || attacking !== true || a.max !== 1) return null;
    const inner = chooseThenMove([...list.slice(0, i), a, { ...b, to: plain as typeof b.to }, ...list.slice(i + 2)], i, st);
    if (inner === null || inner.clauses.length !== 1) return null;
    // only a description by card types ("an enchantment card", CR 205.2a): any other filter has no wording here
    const keys = Object.keys(statusIf).filter((k) => (statusIf as Record<string, unknown>)[k] !== undefined && k !== 'isCard');
    if (keys.join(',') !== 'types' || (statusIf.types ?? []).length === 0) return null;
    const noun = `${(statusIf.types ?? []).map((t) => t.toLowerCase()).join(' ')} card`;
    const tail = `. if that card is ${withArticle(noun)}, it enters tapped and attacking`;
    const c = inner.clauses[0]!;
    return { clauses: [{ ...c, imp: `${c.imp}${tail}`, sub: `${c.sub}${tail}` }], consumed: 2 };
  }
  // FAST2 T10: one choice by one player; "each opponent exiles a card from their hand" is a choice per player among their own cards, which one
  // `chooseObjects` of a group (every chooser picks from the whole pool, effects/handlers/choose.ts) does not say
  if (a.who.ref === 'each') return null;
  if (a.perPlayer !== undefined) return null; // edh-perms-3 (CR 608.2c, 608.2d): "For each player, choose ..." is a sentence of its own; the move says "those cards", not one description
  if (handChoice(a, st) !== null) return null; // FAST5 T46: "You choose a nonland card from it. Exile that card.": two clauses, the choice out of a revealed hand is its own instruction
  // std-exile-play-1-2: nor "You choose one of those cards. That player exiles it." (chosenRevealedExiled, from the move)
  if (b.op === 'move' && i + 1 < list.length && chosenRevealedExiled(list, i + 1, cloneState(st)) !== null) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null) return null;
  // edh-d-61 (CR 608.2d, 701.9; The Kami War): another player's choice among cards of YOURS ("Defending player chooses a nonland card in your graveyard. Return that card to your hand."): the move is yours, not the
  // chooser's, so it is no "X returns a card from your graveyard" (two sentences, each said by its own step)
  if (a.who.ref !== 'you' && (fromFilter.owner === 'you' || fromFilter.controller === 'you')) return null;
  // edh-c-104 (CR 608.2c, 701.20a; Thran Tome): a choice of one of the cards a reveal named ("Target opponent chooses one of those cards. Put that card into your graveyard.") has no
  // description to say as "chooses a card from ...": the choice and the move are two sentences, each said by its own step
  if (Object.keys(fromFilter).filter((k) => (fromFilter as Record<string, unknown>)[k] !== undefined).join() === 'is' && fromFilter.is?.ref === 'bound' && a.min === 1 && a.max === 1
    && b.op === 'move' && b.what.ref === 'bound' && b.what.name === a.as && st.info.get(`b:${fromFilter.is.name}`)?.thisWay === 'revealed this way') return null;
  // edh-c-104 (CR 701.20a; Agonizing Memories): two cards chosen out of a hand an earlier step looked at are chosen in their own sentence, "choose two cards from it" (render/steps-flow.ts#chooseObjects)
  if (a.min === 2 && a.max === 2 && fromFilter.is?.ref === 'bound' && fromFilter.zone === 'any' && st.info.get(`b:${fromFilter.is.name}`)?.hand === true) return null;
  const dest = b.to;
  const key = playerKey(a.who);
  const optional = a.min === 0 && a.max === 1;
  const plural = a.max !== 1;
  // M11-4 (CR 903.3, 702.124e): "put your commander into your hand from the command zone" (Command Beacon): the one commander you own there, chosen by you
  // when you have two (parser/templates/zz-m11/commander.json); only that exact choice
  const fk = Object.keys(fromFilter).filter((k) => (fromFilter as Record<string, unknown>)[k] !== undefined).sort().join(',');
  if (fk === 'commander,owner,zone' && fromFilter.commander === true && fromFilter.owner === 'you' && fromFilter.zone === 'command' && a.who.ref === 'you'
    && a.min === 1 && a.max === 1 && a.guard === undefined && b.guard === undefined && dest.zone !== 'command' && dest.zone !== 'exile') {
    const saved = st.actor;
    st.actor = key;
    const text = `put your commander ${destPhrase(dest, st, false, true)} from the command zone`;
    st.actor = saved;
    bind(st, a.as, { nouns: ['commander', 'card'], plural: false, optional: false });
    return { clauses: [acting(key ?? 'x', text, `you put your commander ${text.slice('put your commander '.length)}`)], consumed: 2 };
  }
  // FAST5 T66 (CR 608.2d): "up to two creature cards with total mana value 4 or less from your graveyard": the total is a feature of the plural noun phrase
  if (a.groupLimit !== undefined && (optional || a.max === 1)) return null;
  // edh-next-80 (CR 202.3, 608.2d; Seasons Past): and the set chosen together keeps no two with one mana value: "any number of cards with different mana values from your graveyard"
  const total = a.groupLimit !== undefined ? { total: totalLimitWords(a.groupLimit, st) } : a.distinct !== undefined && a.min === 0 && a.max === 'any' && a.from.ref === 'each' && a.from.filter.zone === 'graveyard' ? { total: `different ${DISTINCT_WORDS[a.distinct]}` } : {};
  // r4-dig (CR 404.1, 608.2c): one card of either of two descriptions from your graveyard, "return a non-Avatar creature card or a planeswalker card from your
  // graveyard to your hand" (each description with its own article, the zone said once after both)
  const either = (): string | null => {
    const parts = fromFilter.anyOf;
    const restKeys = Object.keys(fromFilter).filter((k) => (fromFilter as Record<string, unknown>)[k] !== undefined && k !== 'anyOf' && k !== 'isCard').sort().join(',');
    // edh-perms-18 (CR 608.2d, 110.2a; Purphoros, Bronze-Blooded): ... and from your hand ("put a red creature card or an artifact creature card from your hand onto the battlefield")
    if (parts === undefined || parts.length !== 2 || restKeys !== 'owner,zone' || (fromFilter.zone !== 'graveyard' && fromFilter.zone !== 'hand') || fromFilter.owner !== 'you' || a.max !== 1) return null;
    if (parts.some((g) => g.zone !== undefined || g.owner !== undefined || g.controller !== undefined)) return null;
    const zone = fromFilter.zone;
    return `${parts.map((g) => K.np({ ...g, zone }, st, { det: 'a', noZone: true })).join(' or ')} from your ${zone}`;
  };
  const nounPhrase = (): string => {
    const e = either();
    if (e !== null) return alt(K.np(fromFilter, cloneState(st), { det: 'a' }), e);
    if (optional) return K.np(fromFilter, st, { det: 'a' });
    // edh-d-90 (CR 608.2d; Godsend; family one-of-those-chosen): one object chosen out of a group an earlier phrase named ("you may exile one of those creatures"): the group said as it is named,
    // after "one of" (the bare group, as said before, stays a reading)
    if (a.min === 1 && a.max === 1 && fk === 'is' && fromFilter.is?.ref === 'event' && fromFilter.is.role === 'object' && blockersOrBlocked(st)) { const g = K.np(fromFilter, st, { det: 'a' }); return alt(g, 'one of those creatures'); }
    const rw = rangeWords(a.min, a.max, st);
    return rw.count === undefined ? K.np(fromFilter, st, { det: 'a' }) : K.np(fromFilter, st, { det: 'none', plural: rw.plural, count: rw.count, ...total });
  };
  // edhd68 (CR 702.62a, 122.1; Eleventh Doctor): the chosen card exiled "with a number of time counters on it equal to its mana value" (eff.edhd68.exile.fromHand.withCountersEqualMv);
  // any other counters on the exile (never said here before) are no reading
  const cs = dest.counters;
  const mvOfChosen = cs !== undefined && cs.length === 1 && typeof cs[0]!.count === 'object' && cs[0]!.count.q === 'stat' && cs[0]!.count.stat === 'manaValue' && isBound(cs[0]!.count.of, a.as) && !cs[0]!.count.sum && cs[0]!.count.agg === undefined;
  // (other destinations say their counters through destPhrase as before; an exile with any other counters has no wording here, as before)
  if (dest.zone === 'exile' && cs !== undefined && (!mvOfChosen || a.max !== 1 || a.min !== 1)) return null;
  const withMvCounters = mvOfChosen && dest.zone === 'exile' ? ` with a number of ${cs![0]!.kind} counters on it equal to its mana value` : '';
  const verb = MOVE_VERB[dest.zone]!;
  // FAST5 T66 (CR 107.3, 608.2h): a mana value the filter computes is also "mana value X or less ..., where X is the number of attacking creatures you control"
  // (Kinscaer Sentry; as family move-where-x): the X said in the description, its value after the sentence
  const mvc = fromFilter.manaValue;
  const whereX = mvc !== undefined && typeof mvc.value === 'object' && mvc.value.q !== 'X' && mvc.value.q !== 'var' && (mvc.op === '<=' || mvc.op === '>=') && dest.zone !== 'exile' && optional ? mvc : null;
  const before = whereX === null ? null : cloneState(st);
  const mk = (): string => {
    const saved = st.actor;
    st.actor = key;
    const what = nounPhrase();
    const rest = dest.zone === 'exile' ? `${what}${dest.faceDown ? ' face down' : ''}${b.until !== undefined ? ` ${K.dur(b.until, st)}` : ''}${withMvCounters}` : `${what} ${destPhrase(dest, st, plural, true)}`;
    st.actor = saved;
    return `${verb} ${rest}`;
  };
  // FAST2 T10: the chooser is named before what they choose ("target opponent exiles a card from their hand": the subject comes first in the text, so it is
  // its first mention and the possessive after it is the anaphor)
  const subj = K.player(a.who, st, 'subject');
  // Cloud r3-moved (family up-to-one-put, CR 608.2d): your choice of zero or one card is also "put up to one land card discarded this way onto the battlefield tapped
  // under your control" (Mind Roots): the same choice, said with its range
  const upTo = optional && key === 'you' && a.groupLimit === undefined && dest.zone !== 'exile' && whereX === null ? cloneState(st) : null;
  const upToText = upTo === null ? null : (() => {
    upTo.actor = key;
    const rw = rangeWords(0, 1, upTo);
    return rw.count === undefined ? null : `${verb} ${K.np(fromFilter, upTo, { det: 'none', plural: false, count: rw.count })} ${destPhrase(dest, upTo, false, true)}`;
  })();
  // edh-c-54 (CR 107.3, 608.2h, 608.2d; Uncle's Musings; family choose-up-to-where-x): a computed upper bound of the choice is also "up to X cards ..., where X is the number of colors of mana spent to cast ~"
  const countX = a.min === 0 && typeof a.max === 'object' && key === 'you' && a.groupLimit === undefined && dest.zone !== 'exile' && b.guard === undefined && a.guard === undefined ? cloneState(st) : null;
  // edh-next-55 (CR 107.3, 706.2, 608.2h; Pair o' Dice Lost): a total limit that reads the die result is also "with total mana value X or less ..., where X is the total of those results"
  const lim = a.groupLimit;
  const limX = lim !== undefined && key === 'you' && typeof lim.cmp.value === 'object' && lim.cmp.value.q !== 'X' && lim.cmp.value.q !== 'var' /* edh-next-80 (Moorland Rescuer): any computed total, "total power X or less ..., where X is this creature's power" */ && lim.cmp.op === '<=' && !optional && dest.zone !== 'exile' && a.guard === undefined && b.guard === undefined ? cloneState(st) : null;
  let body = mk();
  const bodyX = ((): string | null => {
    if (countX === null || typeof a.max !== 'object') return null;
    countX.actor = key;
    return `${verb} ${K.np(fromFilter, countX, { det: 'none', plural: true, count: 'up to X' })} ${destPhrase(dest, countX, true, true)}, where X is ${K.qty(a.max, countX)}`;
  })();
  if (whereX !== null && before !== null) {
    const copy = cloneState(before);
    copy.actor = key;
    const withX = `${verb} ${K.np({ ...fromFilter, manaValue: { op: whereX.op, value: { q: 'X' } } }, copy, { det: 'a' })} ${destPhrase(dest, copy, plural, true)}, where X is ${K.qty(whereX.value, copy)}`;
    body = alt(body, withX);
  }
  const bodyLim = ((): string | null => {
    if (limX === null || lim === undefined) return null;
    limX.actor = key;
    const rw = rangeWords(a.min, a.max, limX);
    if (rw.count === undefined) return null;
    const np = K.np(fromFilter, limX, { det: 'none', plural: rw.plural, count: rw.count, total: totalLimitWords({ ...lim, cmp: { op: '<=', value: { q: 'X' } } }, limX) });
    return `${verb} ${np} ${destPhrase(dest, limX, plural, true)}, where X is ${K.qty(lim.cmp.value as Quantity, limX)}`;
  })();
  // r3-refs (CR 110.1): what the choice put onto the battlefield is a permanent there, also "that permanent" (as steps-zones.ts#bindMoved)
  const nouns = K.nounsOf(fromFilter);
  const permanent = dest.zone === 'battlefield' && nouns.some((n) => PERMANENT_NOUNS.has(n)) && !nouns.includes('permanent') ? ['permanent'] : [];
  // std-rs (CR 400.7, 608.2c; family exiled-card-of-this-ability, as std-rx31 says it in steps-zones.ts#bindMoved): what the choice exiled face up is also "the exiled card" later
  // edh-zones-14 (CR 406.3, 608.2c; Scroll Rack): also the cards of a choice of any number of cards exiled face down, "look at the exiled cards"
  const exiledName = dest.zone === 'exile' && (dest.faceDown !== true || a.max === 'any') ? { alts: [plural ? 'the exiled cards' : 'the exiled card'] } : {};
  // edh-zones-15 (CR 400.7, 406.1; Yorion): and the several permanents it exiled are "those cards" in exile ("Return those cards to the battlefield at the beginning of the next end step")
  const cardsInExile = plural && dest.zone === 'exile' && dest.faceDown !== true && !nouns.includes('card') ? ['card'] : [];
  bind(st, a.as, { nouns: [...nouns, ...permanent, ...cardsInExile], plural, optional: a.min === 0, ...exiledName });
  // r3-refs (CR 400.7, 406.3): what the move exiled, named for a later instruction ("Exile any number of creatures you control, then return them to the battlefield ...")
  // (std-r8, CR 608.2c, 400.7: and, as steps-zones.ts says of a move, also "<noun> exiled this way": "where X is the number of cards exiled this way")
  // (edh-zones-14, Scroll Rack: what a choice of any number of cards exiled is also "the exiled cards", face down too)
  if (b.as !== undefined && dest.zone === 'exile') bind(st, b.as, { nouns: [...new Set(['card', ...nouns])], plural, zone: 'exile', sameAs: identityOf(st, `b:${a.as}`), thisWay: 'exiled this way', ...(a.max === 'any' ? { alts: ['the exiled cards'] } : {}) });
  // edh-zones-14 (CR 608.2c, 608.2h; Scroll Rack): the move also reports how many it exiled, "Put that many cards from the top of your library into your hand" (render/moved.ts)
  if (b.as !== undefined && dest.zone === 'exile' && a.max === 'any') st.info.set(`r:${b.as}`, movedInfo('exiled', ['card']));
  // edh-zones-15 (CR 608.2c; Abdel Adrian): and the count of what the delayed exile moved, "for each permanent exiled this way" (render/moved.ts#kindOf)
  if (b.as !== undefined && untilExile) st.info.set(`r:${b.as}`, { ...(st.info.get(`r:${b.as}`) ?? movedInfo('exiled', nouns)), moved: 'exiled' });
  // edh-next-136 (CR 608.2d, 110.2a, 122.6; family put-from-hand-or-graveyard-after; Nissa of Shadowed Boughs): your choice of up to one card of a description from your hand or graveyard put onto the
  // battlefield under your control with counters of fixed numbers is also said with the zones after "onto the battlefield": "you may put a creature card with mana value ... onto the battlefield from your
  // hand or graveyard with two +1/+1 counters on it" (only that exact choice and move)
  const zf = fromFilter as Record<string, unknown>;
  const handOrGy = optional && a.who.ref === 'you' && JSON.stringify(zf['zone']) === '["hand","graveyard"]' && zf['owner'] === 'you' && zf['isCard'] === true && a.guard === undefined && b.guard === undefined
    && JSON.stringify(Object.keys(dest).sort()) === '["controller","counters","zone"]' && dest.zone === 'battlefield' && JSON.stringify(dest.controller) === '{"ref":"you"}'
    && (dest.counters ?? []).length === 1 && typeof dest.counters![0]!.count === 'number' && dest.counters![0]!.count >= 1
    ? (() => {
      const c = dest.counters![0]!;
      const copy = cloneState(before ?? st);
      copy.actor = key;
      return `you may put ${K.np(fromFilter, copy, { det: 'a', noZone: true })} onto the battlefield from your hand or graveyard with ${c.count === 1 ? 'a' : numWord(c.count as number)} ${c.kind} counter${c.count === 1 ? '' : 's'} on it`;
    })() : null;
  if (optional) {
    const text = upToText === null ? `${subj.text} may ${body}` : alt(`${subj.text} may ${body}`, upToText);
    if (handOrGy !== null) return { clauses: [acting(key ?? 'x', alt(text, handOrGy), alt(text, handOrGy))], consumed: 2 };
    return { clauses: [acting(key ?? 'x', text, text)], consumed: 2 };
  }
  const verbs = body.slice(verb.length);
  const withX = [bodyX, bodyLim].filter((x): x is string => x !== null); // edh-next-55: and the die-result total, "..., where X is the total of those results"
  if (withX.length > 0) return { clauses: [acting(key ?? 'x', alt(body, ...withX), alt(`${subj.text} ${conjVerb(verb, subj.person)}${verbs}`, ...withX.map((x) => `${subj.text} ${conjVerb(verb, subj.person)}${x.slice(verb.length)}`)), { leadThen: true })], consumed: 2 };
  // edh-zones-24 (CR 608.2d, 400.3; Teferi, Temporal Pilgrim): another player's choice of one permanent and its return to its owner's hand is also said "chooses a permanent they control
  // and returns it to its owner's hand" (template eff.edhz24.bounce.playerChoosesAndReturns)
  const choosesAndReturns = key !== 'you' && key !== null && !plural && dest.zone === 'hand' && Object.keys(dest).length === 1 && a.min === 1 && a.groupLimit === undefined && b.guard === undefined && a.guard === undefined
    ? (() => { const copy = cloneState(before ?? st); copy.actor = key; return `chooses ${K.np(fromFilter, copy, { det: 'a' })} and returns it to its owner's hand`; })() : null;
  // std-lci (CR 608.2c): a sentence of its own after a "you may" sentence may also begin with "Then" ("You may mill two cards. Then return up to two creature
  // cards from your graveyard to your hand"): "then" only orders the instructions
  const full = `${subj.text} ${conjVerb(verb, subj.person)}${verbs}`;
  // edh-d-37 (CR 608.2d, 603.2; Confounding Conundrum): the player a trigger's event names is also "they": "..., they return a land they control to its owner's hand"
  const theyReturn = a.who.ref === 'event' && a.who.role === 'player' && !plural && dest.zone === 'hand' && Object.keys(dest).length === 1 && a.min === 1 && a.groupLimit === undefined && b.guard === undefined && a.guard === undefined ? `they ${body}` : null;
  const extras = [...(choosesAndReturns === null ? [] : [`${subj.text} ${choosesAndReturns}`]), ...(theyReturn === null ? [] : [theyReturn])];
  // edh-next-136 (CR 122.1, 406.1, 400.3; family own-counter-from-exile; Karn, Scion of Urza): your choice of one card you own in exile with a counter of one kind, put into your hand, is
  // also said with the zone last, "put a card you own with a silver counter on it from exile into your hand" (only that exact choice and move)
  const fc = fromFilter.counters;
  const ownCounterFromExile = fk === 'counters,owner,zone' && fromFilter.zone === 'exile' && fromFilter.owner === 'you' && fc !== undefined && Object.keys(fc).join() === 'kind' && typeof fc.kind === 'string' && fc.kind !== 'any'
    && a.who.ref === 'you' && a.min === 1 && a.max === 1 && a.guard === undefined && b.guard === undefined && JSON.stringify(dest) === '{"zone":"hand"}'
    ? `put a card you own with ${withArticle(`${fc.kind} counter`)} on it from exile into your hand` : null;
  if (ownCounterFromExile !== null) return { clauses: [acting(key ?? 'x', alt(body, ownCounterFromExile), alt(extras.length === 0 ? full : alt(full, ...extras), `you ${ownCounterFromExile}`), { leadThen: true })], consumed: 2 };
  return { clauses: [acting(key ?? 'x', body, extras.length === 0 ? full : alt(full, ...extras), { leadThen: true })], consumed: 2 };
}

function conjVerb(verb: string, person: 'you' | 'sg' | 'pl'): string {
  if (person !== 'sg') return verb;
  return verb.replace(/[^\uE000\uE001\uE002]+/g, (w) => (/(?:s|x|z|ch|sh)$/.test(w) ? `${w}es` : `${w}s`));
}

/**
 * r5-dig (CR 700.3, 701.20e, 608.2c-d): "Look at the top four cards of your library and separate them into a face-down pile and a face-up pile. An opponent chooses
 * one of the piles. Put that pile into your hand and the other into your graveyard." (Riddles in the Dark, Curator of Destinies): your look at the top cards, your
 * separation of exactly those cards into a face-down and a face-up pile (`piles.faceDown`), another player's choice of a pile, then your moves of the chosen pile
 * and of the other. Only that exact shape.
 */
function faceDownPilesFold(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const l = list[i];
  const p = list[i + 1];
  const m1 = list[i + 2];
  const m2 = list[i + 3];
  // std-rx30 (CR 700.3, 701.20a): or your reveal of the top cards and your separation of them into two piles (Intrude on the Mind), each pile face up
  if ((l?.op !== 'look' && l?.op !== 'reveal') || p?.op !== 'piles' || m1?.op !== 'move' || m2?.op !== 'move' || (l.op === 'look') !== (p.faceDown === true)) return null;
  // (a later "for each card put into your graveyard this way" names a move, `as`: std-rx30)
  if (l.guard !== undefined || p.guard !== undefined || m1.guard !== undefined || m2.guard !== undefined || m1.until || m2.until) return null;
  const top = l.op === 'look' ? l.at : l.what;
  if (l.who.ref !== 'you' || top.ref !== 'topCards' || top.player.ref !== 'you' || (l.op === 'reveal' && l.to !== undefined) || !isBound(p.cards, l.as) || p.separator.ref !== 'you') return null;
  const chooserKey = playerKey(p.chooser);
  if (chooserKey === 'you' || chooserKey === null || !isBound(m1.what, p.chosen) || !isBound(m2.what, p.other)) return null;
  const simple = (z: string): boolean => z === 'hand' || z === 'graveyard' || z === 'library';
  if (!simple(m1.to.zone) || !simple(m2.to.zone) || (l.as !== undefined && !unread(list, i + 2, l.as))) return null;
  const look = fragment(K.clause(l, st));
  const ch = byPlayer(p.chooser, st, 'choose', `one of ${alt('the piles', 'those piles')}`);
  const saved = st.actor;
  st.actor = 'you';
  const moves = `put that pile ${destPhrase(m1.to, st, false, true)} and the other ${destPhrase(m2.to, st, false, true)}`;
  st.actor = saved;
  // std-rx30 (CR 608.2c): what each move put into its zone is "<cards> put into your graveyard this way" for a later count (render/moved.ts), as render/steps-zones.ts records it
  for (const m of [m1, m2]) {
    const kind = m.to.zone === 'graveyard' ? 'graveyard' : m.to.zone === 'hand' ? 'hand' : undefined;
    if (m.as !== undefined && kind !== undefined) st.info.set(`r:${m.as}`, movedInfo(kind, ['card']));
  }
  const text = `${look} and separate them into ${p.faceDown === true ? 'a face-down pile and a face-up pile' : 'two piles'}. ${ch.sub}. ${moves}`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed: 4 };
}

/**
 * std-rx30 (CR 401.3, 400.3, 608.2c-d): "Its owner may put it on top of their library. If they do, ~ deals 2 damage to them. If they didn't put the card on top of their
 * library, they put it on the bottom." (Clash of Elements): the owner's `may` of a move of one object on top of its owner's library, then an `if` on whether they
 * did, whose `else` is the move of the same object to the bottom of that library. Only that exact shape.
 */
function ownerTopElseBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const f = list[i + 1];
  if (m?.op !== 'may' || f?.op !== 'if' || m.as === undefined || m.otherwise !== undefined || m.anyOne !== undefined || m.guard !== undefined || f.guard !== undefined) return null;
  if (f.cond.cond !== 'did' || f.cond.step !== m.as || f.cond.not === true || f.else?.length !== 1 || f.then.length === 0) return null;
  const top = m.do.length === 1 ? m.do[0] : undefined;
  const bottom = f.else[0];
  if (top?.op !== 'move' || bottom?.op !== 'move' || top.as !== undefined || bottom.as !== undefined || top.until || bottom.until) return null;
  if (m.who.ref !== 'ownerOf' || JSON.stringify(m.who.object) !== JSON.stringify(top.what) || JSON.stringify(top.what) !== JSON.stringify(bottom.what)) return null;
  if (JSON.stringify(top.to) !== JSON.stringify({ zone: 'library', position: 'top' }) || JSON.stringify(bottom.to) !== JSON.stringify({ zone: 'library', position: 'bottom' })) return null;
  const { else: _else, ...ifDid } = f;
  const text = `${K.steps([m, ifDid as EffectStep], st)}. if they didn't put the card on top of their library, they put it on the bottom`;
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/**
 * std-rx30 (CR 115.1, 608.2c-d, 509.1a): "That player chooses one of those creatures. ~ deals 5 damage to that creature, and the other can't block this turn." (Trial of
 * Agony), after the targets were announced in a sentence of their own ("Choose two target creatures controlled by the same opponent."): their controller's choice of
 * one of the targets, an instruction on the chosen one, and "the other" (the targets not chosen) can't block this turn. Only that exact shape.
 */
function targetsChoiceAndOther(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const d = list[i + 1];
  const e = list[i + 2];
  if (c?.op !== 'chooseObjects' || d === undefined || e?.op !== 'effect' || c.guard !== undefined || d.guard !== undefined || e.guard !== undefined || c.perPlayer !== undefined || c.random === true || c.groupLimit !== undefined) return null;
  if (c.min !== 1 || c.max !== 1 || c.who.ref !== 'controllerOf' || c.who.object.ref !== 'target' || c.from.ref !== 'each' || JSON.stringify(c.from.filter) !== JSON.stringify({ is: c.who.object })) return null;
  const id = c.who.object.id;
  const spec = st.specs.get(id);
  if (spec?.sameController !== true || !st.mentioned.has(`t:${id}`)) return null;
  const rest = { ref: 'each', filter: { is: { ref: 'target', id }, not: { is: { ref: 'bound', name: c.as } } } };
  if (e.duration.d !== 'endOfTurn' || e.effects.length !== 1 || JSON.stringify(e.effects[0]) !== JSON.stringify({ s: 'restrict', subject: rest, mode: 'cant', action: 'block' })) return null;
  if (JSON.stringify(d).includes(`"id":"${id}"`) || !JSON.stringify(d).includes(JSON.stringify({ ref: 'bound', name: c.as }))) return null;
  const nouns = st.info.get(`t:${id}`)?.nouns ?? [];
  if (nouns.length === 0) return null;
  bind(st, c.as, { nouns, plural: false });
  const first = `that player chooses 1 of those ${alt(...nouns.map((n) => pluralize(n)))}`;
  const text = `${first}. ${K.steps([d], st)}, and the other can't block this turn`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

/**
 * std-rx30 (CR 608.2c-d, 701.20a): "Put one of them into your hand. Then choose an opponent. They put one on the bottom of your library. Then you put one into your hand.
 * Then they put one on the bottom of your library." (Memories Returning; the parser's eff.stdrx30.alternatingPicks.youOpponent): picks in turn among the cards a step
 * named, each among what the earlier picks left in your library, by you and by the opponent you chose. Only that exact shape.
 */
function alternatingPicks(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list.slice(i, i + 9);
  if (s.length !== 9 || s.some((x) => x.guard !== undefined)) return null;
  const [c1, m1, o, c2, m2, c3, m3, c4, m4] = s as [EffectStep, EffectStep, EffectStep, EffectStep, EffectStep, EffectStep, EffectStep, EffectStep, EffectStep];
  if (o.op !== 'chooseValue' || o.what !== 'opponent' || o.who.ref !== 'you' || o.options !== undefined || o.exclude !== undefined) return null;
  const picks = [c1, c2, c3, c4];
  const moves = [m1, m2, m3, m4];
  if (c1.op !== 'chooseObjects' || c1.from.ref !== 'each' || c1.from.filter.is?.ref !== 'bound' || c1.from.filter.zone !== 'library' || Object.keys(c1.from.filter).length !== 2) return null;
  const group = c1.from.filter.is;
  const names: string[] = [];
  for (let k = 0; k < 4; k++) {
    const c = picks[k]!;
    const m = moves[k]!;
    if (c.op !== 'chooseObjects' || c.min !== 1 || c.max !== 1 || c.perPlayer !== undefined || c.random === true || c.groupLimit !== undefined || m.op !== 'move' || m.as !== undefined || m.until) return null;
    const who = k % 2 === 0 ? { ref: 'you' } : { ref: 'bound', name: o.as };
    const filter = names.length === 0 ? { is: group, zone: 'library' } : { is: group, not: { is: { ref: 'union', of: names.map((n) => ({ ref: 'bound', name: n })) } }, zone: 'library' };
    if (JSON.stringify(c.who) !== JSON.stringify(who) || JSON.stringify(c.from) !== JSON.stringify({ ref: 'each', filter })) return null;
    const to = k % 2 === 0 ? { zone: 'hand' } : { zone: 'library', position: 'bottom' };
    if (!isBound(m.what, c.as) || JSON.stringify(m.to) !== JSON.stringify(to)) return null;
    names.push(c.as);
  }
  const them = K.obj(group, st, 'object').text;
  const text = `put 1 of ${them} into your hand. then choose 1 opponent. they put 1 on the bottom of your library. then you put 1 into your hand. then they put 1 on the bottom of your library`;
  return { clauses: [plain(text, { standalone: true })], consumed: 9 };
}

/**
 * std-rx30 (CR 107.1a, 608.2e, 101.4): "Each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of
 * their choice. Round down each time." (Pox Plague; the parser's eff.stdrx30.eachPlayer.halfLifeHandPermanents.roundDown): three instructions for each player, each
 * amount half of that player's own (life, cards in hand, permanents they control), rounded down. Only that exact shape.
 */
function eachPlayerHalves(list: EffectStep[], i: number): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  const it = { ref: 'iterating' };
  const each = JSON.stringify({ ref: 'each', who: 'player' });
  const half = (q: unknown): string => JSON.stringify({ q: 'math', op: 'floorDiv', args: [q, 2] });
  if (a?.op !== 'loseLife' || b?.op !== 'discard' || c?.op !== 'sacrificeChoice' || [a, b, c].some((x) => x.guard !== undefined || x.as !== undefined)) return null;
  if (JSON.stringify(a.who) !== each || JSON.stringify(b.who) !== each || JSON.stringify(c.who) !== each || b.filter !== undefined || b.mode !== undefined || b.cantAs !== undefined) return null;
  if (c.mode !== undefined || c.cantAs !== undefined || c.exploit !== undefined || JSON.stringify(c.filter) !== JSON.stringify({ controller: it })) return null;
  if (JSON.stringify(a.amount) !== half({ q: 'life', of: it }) || JSON.stringify(b.count) !== half({ q: 'zoneSize', zone: 'hand', of: it })
    || JSON.stringify(c.count) !== half({ q: 'count', of: { ref: 'each', filter: { controller: it } } })) return null;
  const text = 'each player loses half their life, then discards half the cards in their hand, then sacrifices half the permanents they control of their choice. round down each time';
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

/**
 * std-rx30 (CR 608.2c, 101.4, 701.8a): "For each player, destroy up to one nonbasic land that player controls." (Krenko's Buzzcrusher; the parser's
 * eff.stdrx30.forEachPlayer.destroyUpToOne.thatPlayerControls): your choice of up to one object of each player, then the destroy of what was chosen, named later as
 * "<noun> destroyed this way". Only that exact shape.
 */
function forEachPlayerDestroyUpToOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const d = list[i + 1];
  if (c?.op !== 'chooseObjects' || d?.op !== 'destroy' || c.guard !== undefined || d.guard !== undefined || c.random === true || c.groupLimit !== undefined || c.startingWith !== undefined) return null;
  if (c.who.ref !== 'you' || c.min !== 0 || c.max !== 1 || JSON.stringify(c.perPlayer) !== JSON.stringify({ ref: 'each', who: 'player' }) || c.from.ref !== 'each' || !isBound(d.what, c.as) || d.regeneration !== undefined) return null;
  const f = c.from.filter;
  if (JSON.stringify(f.controller) !== JSON.stringify({ ref: 'iterating' }) || f.owner !== undefined || f.zone !== undefined) return null;
  const { controller: _c, ...rest } = f;
  const np = K.np(rest, st, { det: 'none' });
  const nouns = K.nounsOf(rest);
  if (d.as !== undefined) {
    bind(st, d.as, { nouns, plural: true, thisWay: 'destroyed this way' });
    st.info.set(`r:${d.as}`, movedInfo('destroyed', nouns));
  }
  return { clauses: [plain(`for each player, destroy up to one ${np} that player controls`, { standalone: true })], consumed: 2 };
}

/**
 * std-rx30 (CR 608.2c, 701.20a, 202.3): "Two target players each reveal the top card of their library. They each lose life equal to the mana value of the card revealed by
 * the other player. Then they each put the card they revealed into their hand." (Parker Luck; the parser's eff.stdrx30.twoPlayersReveal.loseOthersManaValue.putIntoHand):
 * three loops over the same two target players, the life lost read from the top card of the other one's library. Only that exact shape.
 */
function eachRevealsOtherLoses(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'forEach' || b?.op !== 'forEach' || c?.op !== 'forEach' || [a, b, c].some((x) => x.guard !== undefined || x.do.length !== 1)) return null;
  const group = JSON.stringify(a.over);
  if (a.over.ref !== 'target' || JSON.stringify(b.over) !== group || JSON.stringify(c.over) !== group) return null;
  const spec = st.specs.get(a.over.id);
  if (spec?.kind !== 'player' || spec.min !== 2 || spec.max !== 2) return null;
  const top = (n: string): string => JSON.stringify({ ref: 'topCards', player: { ref: 'bound', name: n }, count: 1 });
  const [r, l, m] = [a.do[0]!, b.do[0]!, c.do[0]!];
  if (r.op !== 'reveal' || r.to !== undefined || JSON.stringify(r.who) !== JSON.stringify({ ref: 'bound', name: a.as }) || JSON.stringify(r.what) !== top(a.as) || r.as !== undefined) return null;
  const other = { ref: 'topCards', player: { ref: 'otherOf', of: a.over, than: { ref: 'bound', name: b.as } }, count: 1 };
  if (l.op !== 'loseLife' || JSON.stringify(l.who) !== JSON.stringify({ ref: 'bound', name: b.as }) || JSON.stringify(l.amount) !== JSON.stringify({ q: 'stat', stat: 'manaValue', of: other }) || l.as !== undefined) return null;
  if (m.op !== 'move' || JSON.stringify(m.what) !== top(c.as) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'hand' }) || m.as !== undefined) return null;
  const who = K.obj(a.over as never, st, 'object').text;
  const text = `${who} each reveal the top card of their library. they each lose life equal to the mana value of the card revealed by the other player. then they each put the card they revealed into their hand`;
  return { clauses: [plain(text, { standalone: true })], consumed: 3 };
}

/**
 * std-rx30 (CR 614.10, 500.7): "Target opponent skips their next X turns, where X is ..." (Ral Zarek, Guest Lecturer; the parser's
 * eff.stdrx30.player.skipsNextXTurns.whereX): as many one-use skip shields of that player's turns as the count. Only that exact shape.
 */
function skipsNextTurns(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i];
  if (r?.op !== 'repeat' || r.guard !== undefined || r.process === true || r.do.length !== 1) return null;
  const e = r.do[0]!;
  if (e.op !== 'effect' || e.duration.d !== 'permanent' || e.effects.length !== 1 || e.guard !== undefined) return null;
  const x = e.effects[0]!;
  if (x.s !== 'replace' || x.body.b !== 'skip' || x.replaces.ev !== 'beginTurn' || x.shield?.uses !== 1 || typeof x.replaces.whose !== 'object' || x.replaces.extra !== undefined || x.optional === true || x.condition !== undefined) return null;
  const who = K.player(x.replaces.whose, st, 'subject');
  // a computed count is said "next X turns, where X is ..." (eff.stdrx30.player.skipsNextXTurns.whereX)
  const n = typeof r.times === 'number' ? K.qty(r.times, st) : null;
  const tail = n !== null ? `${n} turns` : `x turns, where x is ${K.qty(r.times, st)}`;
  return { clauses: [plain(`${who.text} ${who.person === 'you' ? 'skip your' : 'skips their'} next ${tail}`)], consumed: 1 };
}

/**
 * std-rx30 (CR 400.11b, 701.23a, 201.2, 608.2d, 701.24a): "Search your library and/or outside the game for exactly four legendary creature cards you own with different
 * names, then reveal those cards. An opponent chooses two of them. Put the chosen cards into your hand and shuffle the rest into your library." (Turtles Forever; the
 * parser's eff.stdrx30.searchLibraryAndOutside.opponentChoosesN): the found cards are in the library, so the rest stays there and the library is shuffled. Only that shape.
 */
function searchOutsideOpponentChooses(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [s, c, m, sh] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (s?.op !== 'search' || c?.op !== 'chooseObjects' || m?.op !== 'move' || sh?.op !== 'shuffle' || [s, c, m, sh].some((x) => x.guard !== undefined)) return null;
  if (s.alsoOutside !== true || s.who.ref !== 'you' || s.zone !== 'library' || s.owner !== undefined || s.differentNames !== true || s.reveal !== true || s.min !== undefined || typeof s.max !== 'number') return null;
  if (c.who.ref !== 'anOpponent' || c.min !== c.max || typeof c.min !== 'number' || JSON.stringify(c.from) !== JSON.stringify({ ref: 'each', filter: { is: { ref: 'bound', name: s.as }, zone: 'library' } })) return null;
  if (!isBound(m.what, c.as) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'hand' }) || m.as !== undefined || sh.who.ref !== 'you' || sh.ifSearched !== undefined) return null;
  const cards = K.np(s.filter, st, { det: 'none', plural: true, head: 'card' });
  const text = `search your library and/or outside the game for exactly ${numWord(s.max)} ${cards} you own with different names, then reveal those cards. an opponent chooses ${numWord(c.min)} of them. put the chosen cards into your hand and shuffle the rest into your library`;
  return { clauses: [plain(text, { standalone: true })], consumed: 4 };
}

/** "Put one pile into your hand and the other into your graveyard." */
function pilesEpilogue(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const p = list[i];
  const m1 = list[i + 1];
  const m2 = list[i + 2];
  if (p?.op !== 'piles' || m1?.op !== 'move' || m2?.op !== 'move') return null;
  if (!isBound(m1.what, p.chosen) || !isBound(m2.what, p.other)) return null;
  const z1 = m1.to.zone;
  const z2 = m2.to.zone;
  const simple = (z: string): boolean => z === 'hand' || z === 'graveyard' || z === 'library' || z === 'battlefield';
  if (!simple(z1) || !simple(z2) || m1.until || m2.until) return null;
  const pilesClause = K.clause(p, st);
  const key = playerKey(p.chooser);
  const mk = (v: RenderState): string => {
    const saved = v.actor;
    v.actor = key;
    const text = `put one pile ${destPhrase(m1.to, v, false, true)} and the other ${destPhrase(m2.to, v, false, true)}`;
    v.actor = saved;
    return text;
  };
  const [folded, plain] = withVariants(st, [
    (v) => mk(v),
    (v) => K.steps([m1, m2], v),
  ]);
  const text = alt(folded!, plain!);
  const subj = K.player(p.chooser, st, 'subject');
  const sub = alt(`${subj.text} ${conjVerb('put', subj.person)} ${folded!.slice('put'.length + 1)}`, plain!);
  return { clauses: [pilesClause, acting(key ?? 'x', text, sub, { breakBefore: true })], consumed: 3 };
}

/**
 * FAST4 T34: the three steps of "shuffle the cards from your hand into your library, then draw that many cards" for one player `who` (CR 701.24a, 121.1,
 * 608.2c): every card in that player's hand into their library, a shuffle of it, then a draw of as many cards as were put there. Only that exact shape.
 */
function handWheel(steps: readonly EffectStep[], who: unknown): boolean {
  const [m, s, d] = steps;
  if (steps.length !== 3 || m?.op !== 'move' || s?.op !== 'shuffle' || d?.op !== 'draw' || m.as === undefined || m.guard !== undefined || s.guard !== undefined || d.guard !== undefined) return false;
  const w = JSON.stringify(who);
  // the hand's owner is the player predicate 'you' when the player is you
  const owner = w === JSON.stringify({ ref: 'you' }) ? 'you' : who;
  return m.until === undefined && JSON.stringify(m.what) === JSON.stringify({ ref: 'each', filter: { zone: 'hand', owner } }) && JSON.stringify(m.to) === JSON.stringify({ zone: 'library', owner: who })
    && JSON.stringify(s.who) === w && JSON.stringify(d.who) === w && d.as === undefined && JSON.stringify(d.count) === JSON.stringify({ q: 'resultCount', step: m.as });
}

/**
 * FAST4 T34: "shuffle the cards from your hand into your library, then draw that many cards", and the same for each player one at a time ("Each player
 * shuffles the cards from their hand into their library, then draws that many cards", CR 608.2f: what one player does changes nothing for another).
 */
function wheel(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  if (a?.op === 'forEach' && a.over.ref === 'each' && 'who' in a.over && a.over.who === 'player' && a.guard === undefined && handWheel(a.do, { ref: 'bound', name: a.as })) {
    return { clauses: [plain('each player shuffles the cards from their hand into their library, then draws that many cards', { standalone: true })], consumed: 1 };
  }
  if (a?.op !== 'move' || !handWheel(list.slice(i, i + 3), { ref: 'you' }) || list.slice(i + 3).some((s) => JSON.stringify(s).includes(`"${a.as!}"`))) return null;
  const text = 'shuffle the cards from your hand into your library, then draw that many cards';
  return { clauses: [acting('you', text, alt('you shuffle the cards from your hand into your library, then draw that many cards', text))], consumed: 3 };
}

/**
 * std-rn (CR 701.24a, 401.1, 608.2e): "Each player shuffles their graveyard into their library", "Each player shuffles their hand and graveyard into their
 * library[, then draws seven cards]" (Timetwister): for each player, every card of that player's graveyard (and hand) into their library, a shuffle of it, and
 * optionally a draw of a fixed number by that player. Only that exact shape over every player (templates eff.stdrn.eachPlayer.shuffle.*); what one player
 * does changes nothing for another, so one player at a time says the same as all at once (as `wheel` above).
 */
function eachPlayerShufflesZones(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'forEach' || a.over.ref !== 'each' || !('who' in a.over) || a.over.who !== 'player' || a.guard !== undefined || a.as === undefined) return null;
  const [m, s, d, ...rest] = a.do;
  const who = JSON.stringify({ ref: 'bound', name: a.as });
  if (rest.length > 0 || m?.op !== 'move' || s?.op !== 'shuffle' || m.as !== undefined || m.guard !== undefined || m.until !== undefined || s.guard !== undefined || JSON.stringify(s.who) !== who) return null;
  if (m.what.ref !== 'each' || !('filter' in m.what) || Object.keys(m.what.filter).length !== 2 || JSON.stringify(m.what.filter.owner) !== who) return null;
  const z = JSON.stringify(m.what.filter.zone);
  const zones = z === JSON.stringify('graveyard') ? 'graveyard' : z === JSON.stringify(['hand', 'graveyard']) ? 'hand and graveyard' : null;
  if (zones === null || JSON.stringify(m.to) !== JSON.stringify({ zone: 'library', owner: { ref: 'bound', name: a.as } })) return null;
  let draws = '';
  if (d !== undefined) {
    if (zones !== 'hand and graveyard' || d.op !== 'draw' || d.guard !== undefined || d.as !== undefined || JSON.stringify(d.who) !== who || typeof d.count !== 'number') return null;
    draws = `, then draws ${countedNoun(d.count, 'card', st)}`;
  }
  return { clauses: [plain(`each player shuffles their ${zones} into their library${draws}`, { standalone: true })], consumed: 1 };
}

/**
 * FAST5X E24 (CR 701.24a, 121.1, 201.5): "~'s owner shuffles ~ into their library and draws three cards" (a character card's "shuffles him"): the object goes
 * into its owner's library, that library is shuffled, then that same owner draws. Only that exact sequence on the object itself, with nothing between, no
 * guard and no name; the owner, not the controller, is the player who shuffles and draws.
 */
function ownerShufflesSelfThenDraws(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const s = list[i + 1];
  const d = list[i + 2];
  if (m?.op !== 'move' || s?.op !== 'shuffle' || d?.op !== 'draw') return null;
  const ownerOfSelf = (p: PlayerRef | undefined): boolean => p !== undefined && p.ref === 'ownerOf' && p.object.ref === 'self';
  if (m.what.ref !== 'self' || m.to.zone !== 'library' || !ownerOfSelf(m.to.owner) || m.to.position !== undefined || m.to.order !== undefined) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined || !ownerOfSelf(s.who) || !ownerOfSelf(d.who)) return null;
  if ([m, s, d].some((x) => x.guard !== undefined || x.as !== undefined)) return null;
  const owner = K.obj(m.what, st, 'possessive').text;
  const what = K.obj(m.what, st, 'object').text;
  return { clauses: [plain(`${owner} owner shuffles ${what} into their library and draws ${countedNoun(d.count, 'card', st)}`)], consumed: 3 };
}

/** Move cards into a library, then shuffle that library: "shuffle X into Y library". */
function shuffleInto(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const s = list[i + 1];
  if (m?.op !== 'move' || s?.op !== 'shuffle' || m.to.zone !== 'library') return null;
  const d = m.to;
  if (d.owner === undefined || d.position !== undefined || d.order !== undefined || m.until !== undefined) return null;
  if (playerKey(d.owner) === null || playerKey(d.owner) !== playerKey(s.who)) return null;
  // FAST3 T18: "Shuffle ~ into its owner's library" (CR 701.24a): the object goes into its OWNER's library and that library is shuffled, as an instruction of
  // the controller (no other player acts); only for the object itself ("~"), the only form the T18 template writes (another object keeps "its owner shuffles
  // it into their library")
  // FAST5X E25: ... and for the object the source is attached to ("Shuffle enchanted creature into its owner's library", CR 303.4)
  const own = m.what.ref === 'self' || m.what.ref === 'attachedTo';
  if (own && s.who.ref === 'ownerOf' && s.who.object.ref === m.what.ref && s.guard === undefined && m.guard === undefined) {
    const what = K.obj(m.what, st, 'object').text;
    const shuffle = `shuffle ${what} into ${K.player(d.owner, st, 'possessive').text} library`;
    // Standard round 6 (family attached-owner-shuffle): "Enchanted creature's owner shuffles it into their library" (Watery Grasp) is the same move and shuffle
    // std-rr (family self-owner-shuffles-self): "~'s owner shuffles ~ into their library" (Fblthp, Impossibly Lost's "shuffles him"), the object itself named twice
    return { clauses: [plain(m.what.ref === 'attachedTo' ? alt(shuffle, `${what}'s owner shuffles it into their library`) : alt(shuffle, `${what}'s owner shuffles ${what} into their library`, `${what}'s owner shuffles it into their library`, 'its owner shuffles it into their library'))], consumed: 2 };
  }
  const key = playerKey(s.who);
  // std-lci (family owner-of-object-shuffle): "The owner of target artifact or creature ... shuffles it into their library" (Zoyowa's Justice): the same player
  // named after the object (Oracle prints both); said on a copy of the state
  const ownerOf = s.who.ref === 'ownerOf' && s.who.object.ref === 'target' && s.guard === undefined && m.guard === undefined
    ? (() => { const copy = cloneState(st); return `the owner of ${K.obj(s.who.object, copy, 'object').text} shuffles ${K.obj(m.what, copy, 'object').text} into their library`; })() : null;
  // edh-zones-3 (CR 701.24a, 400.3; family shuffle-object-owners-library): "Shuffle it into its owner's library" (Worldspine Wurm), "Shuffle target creature into its owner's library": the
  // object (the event's, or one target) goes into its OWNER's library, which is shuffled; the controller gives the instruction, the same move and shuffle as "its owner shuffles it into their library"
  const imperative = (m.what.ref === 'event' || m.what.ref === 'target') && s.who.ref === 'ownerOf' && JSON.stringify(s.who.object) === JSON.stringify(m.what) && JSON.stringify(d.owner) === JSON.stringify(s.who) && s.guard === undefined && m.guard === undefined && m.as === undefined
    ? (() => { const copy = cloneState(st); return `shuffle ${K.obj(m.what, copy, 'object').text} into its owner's library`; })() : null;
  // edh-d-78 (CR 701.24a, 400.3, 201.5, 603.10a; Sin, Unending Cataclysm): in the object's own "dies" / "leaves the battlefield" trigger the moved object is the event's subject and the owner
  // is the owner of "~" (the lowering rewrites only the top reference): the same object, which Oracle names "this card" (~) as well as "it"
  const ownTrigger = (st.trigger ?? []).length > 0 && st.trigger!.every((ev) => ev.ev === 'zoneChange' && ev.subject.self === true && ev.from === 'battlefield');
  const selfNamed = ownTrigger && m.what.ref === 'event' && m.what.role === 'subject' && s.who.ref === 'ownerOf' && s.who.object.ref === 'self' && JSON.stringify(d.owner) === JSON.stringify(s.who) && s.guard === undefined && m.guard === undefined && m.as === undefined
    ? `shuffle ~ into its owner's library` : null;
  const c = byPlayer(s.who, st, 'shuffle', () => {
    const what = m.what.ref === 'each' && 'filter' in m.what ? (zoneSetPhrase(m.what.filter, st) ?? K.obj(m.what, st, 'object').text) : K.obj(m.what, st, 'object').text;
    return `${what} into ${K.player(d.owner!, st, 'possessive').text} library`;
  });
  // Cloud std-fin (CR 608.2c): "the number of cards shuffled into your library this way" (render/qty.ts, resultCount)
  if (m.as !== undefined && d.owner.ref === 'you') st.info.set(`r:${m.as}`, { nouns: ['card'], plural: true, thisWay: 'shuffled into your library this way' });
  // edh-zones-7 (CR 701.24a, 400.3; family shuffle-self-from-graveyard): the object itself (a card put into the graveyard as a cost) is also "shuffled into your library from your
  // graveyard" (Kogla and Yidaro: "Discard this card: ... Shuffle this card into your library from your graveyard")
  if (m.what.ref === 'self' && d.owner.ref === 'you' && s.who.ref === 'you' && s.guard === undefined && m.guard === undefined) {
    const gy = (text: string): string => alt(text, `${text} from your graveyard`);
    return { clauses: [{ ...c, actor: key ?? c.actor, imp: gy(c.imp), sub: gy(c.sub), ...(c.pred !== undefined ? { pred: gy(c.pred) } : {}) }], consumed: 2 };
  }
  return { clauses: [{ ...c, actor: key ?? c.actor, ...(ownerOf !== null || imperative !== null || selfNamed !== null ? { sub: alt(c.sub, ownerOf ?? c.sub, imperative ?? c.sub, ...(selfNamed === null ? [] : [selfNamed])) } : {}) }], consumed: 2 };
}

/**
 * FAST5 T59 (CR 701.24a, 400.3, 115.1): "Shuffle ~ and target creature into their owners' libraries" (Floodpits Drowner): the object itself and one other object go into
 * their OWNERS' libraries (each into its own), and each of those libraries is shuffled. Written as the move of the union and one shuffle for the owner of each
 * (a library both belong to is shuffled twice, which changes nothing); only that exact shape.
 */
function shuffleOwners(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (m?.op !== 'move' || a?.op !== 'shuffle' || b?.op !== 'shuffle' || m.to.zone !== 'library') return null;
  const d = m.to;
  // edh-c-61 (CR 401.4, 701.24a; Void Stalker): put on top of the owners' libraries, then they shuffle (the position `top`)
  if (d.owner !== undefined || (d.position !== undefined && d.position !== 'top') || d.order !== undefined || m.until !== undefined || m.as !== undefined) return null;
  // edh-c-61 (CR 701.24a; Void Stalker ruling 2012-07-01): the owner of the object itself shuffles only if it was put into a library (it may have left the battlefield before the ability resolved)
  const selfPut = d.position === 'top' && JSON.stringify(a.guard) === JSON.stringify({ cond: 'matches', object: { ref: 'self' }, filter: { zone: 'library' } });
  if (m.guard !== undefined || (a.guard !== undefined && !selfPut) || b.guard !== undefined || m.what.ref !== 'union' || m.what.of.length !== 2) return null;
  const [x, y] = m.what.of;
  if (x?.ref !== 'self' || y === undefined || y.ref === 'self') return null;
  if (a.who.ref !== 'ownerOf' || a.who.object.ref !== 'self' || b.who.ref !== 'ownerOf' || JSON.stringify(b.who.object) !== JSON.stringify(y)) return null;
  const what = K.obj(m.what, st, 'object').text;
  if (d.position === 'top') return { clauses: [plain(`put ${what} on top of their owners' libraries, then those players shuffle their libraries`)], consumed: 3 };
  return { clauses: [plain(`shuffle ${what} into their owners' libraries`)], consumed: 3 };
}

const COLOR_ORDER = ['W', 'U', 'B', 'R', 'G'] as const;

const COLOR_WORDS_ORDER = ['white', 'blue', 'black', 'red', 'green'] as const;
/** std-rx21: the other answer of "protection from colorless / artifacts or from the color of your choice" and its quality (CR 702.16a, 105.2c). */
const OR_COLOR_FIRST: Readonly<Record<string, string>> = { colorless: 'colorless', artifacts: 'type:Artifact' };
function orColorChoice(answers: readonly string[]): { quality: string } | null {
  const quality = OR_COLOR_FIRST[answers[0] ?? ''];
  if (quality === undefined || answers.length !== 6 || COLOR_WORDS_ORDER.some((w, i) => answers[i + 1] !== w)) return null;
  return { quality };
}

/**
 * FAST2 T9: a choice made as the ability resolves, then one fixed grant per possible answer: "~ gains protection from the color of your choice until end of
 * turn" (chooseValue color, then for W, U, B, R, G in that order "if the chosen color is it, ~ gains protection from it", CR 702.16a, 608.2d, 611.2c) and
 * "~ gains your choice of flying, deathtouch, or lifelink until end of turn" (chooseValue among the listed keywords, then one grant per option). Each branch
 * creates its effect with the quality written out, so the effect is fixed as it begins; the fold applies only when every part is exactly that.
 */
function choiceGrant(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || (c.who.ref !== 'you' && c.who.ref !== 'controllerOf') || c.guard !== undefined || (c.what !== 'color' && c.what !== 'option')) return null;
  // edh-c-110 (CR 109.4, 608.2d; Wishmonger): the controller of the object takes the choice, "the color of its controller's choice" (colors only, the object itself)
  if (c.who.ref === 'controllerOf' && c.what !== 'color') return null;
  const answers: readonly string[] = c.what === 'color' ? COLOR_ORDER : c.options ?? [];
  if (answers.length < 2 || (c.what === 'color' && c.options !== undefined)) return null;
  const grants: AbilityDef[] = [];
  let first: Extract<EffectStep, { op: 'effect' }> | null = null;
  let colorHexproof = false; // r5-fxb: the branches set the color and grant hexproof from it
  let colorOnly = false; // std-rx34: the branches only set the color
  // std-rx21 (CR 702.16a, 105.2c): "gains protection from colorless or from the color of your choice" (Giver of Runes), "from artifacts or from ...": an option
  // choice whose first answer is the other quality and the rest the five colors in WUBRG order, each branch granting protection from its answer
  const orColor = c.what === 'option' ? orColorChoice(answers) : null;
  for (let k = 0; k < answers.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== answers[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'effect' || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined) return null;
    const ce = e.effects[0]!;
    if (ce.s !== 'continuous' || ce.cda !== undefined) return null;
    // r5-fxb (CR 105.3, 702.11d, 613.1e-f): "Until end of turn, ~ becomes the color of your choice and gains hexproof from that color": each branch sets the
    // color to its answer (layer 5) and grants hexproof from that color (layer 6)
    if (c.what === 'color' && ce.mods.length === 2 && JSON.stringify(ce.mods[0]) === JSON.stringify({ layer: 5, colors: { set: [answers[k]] } })) {
      const h = ce.mods[1]!;
      if (h.layer !== 6 || h.add?.length !== 1 || h.remove !== undefined || h.removeAll !== undefined || h.cantHave !== undefined) return null;
      const a = h.add[0]!;
      if (a.kind !== 'keyword' || a.keyword !== 'hexproof' || a.quality !== `color:${answers[k]}`) return null;
      if (k > 0 && (colorHexproof !== true || JSON.stringify(e.duration) !== JSON.stringify(first!.duration) || JSON.stringify(ce.affects) !== JSON.stringify((first!.effects[0] as typeof ce).affects))) return null;
      if (k === 0) { first = e; colorHexproof = true; }
      grants.push(a);
      continue;
    }
    // std-rx34 (CR 105.3, 613.1e): "Target permanent becomes the color of your choice until end of turn": each branch only sets the color to its answer
    if (c.what === 'color' && ce.mods.length === 1 && JSON.stringify(ce.mods[0]) === JSON.stringify({ layer: 5, colors: { set: [answers[k]] } })) {
      if (k > 0 && (colorOnly !== true || JSON.stringify(e.duration) !== JSON.stringify(first!.duration) || JSON.stringify(ce.affects) !== JSON.stringify((first!.effects[0] as typeof ce).affects))) return null;
      if (k === 0) { first = e; colorOnly = true; }
      continue;
    }
    if (ce.mods.length !== 1 || colorHexproof || colorOnly) return null;
    const m = ce.mods[0]!;
    if (m.layer !== 6 || m.add?.length !== 1 || m.remove !== undefined || m.removeAll !== undefined || m.cantHave !== undefined) return null;
    const a = m.add[0]!;
    if (a.kind !== 'keyword') return null;
    if (orColor !== null) {
      if (a.keyword !== 'protection' || a.quality !== (k === 0 ? orColor.quality : `color:${COLOR_ORDER[k - 1]}`)) return null;
    } else if (c.what === 'color' ? !(a.keyword === 'protection' && a.quality === `color:${answers[k]}`) : !(a.text === answers[k] && a.quality === undefined)) return null;
    if (first === null) first = e;
    else if (JSON.stringify(e.duration) !== JSON.stringify(first.duration) || JSON.stringify(ce.affects) !== JSON.stringify((first.effects[0] as typeof ce).affects)) return null;
    grants.push(a);
  }
  const effect = first!;
  const ce = effect.effects[0]!;
  if (ce.s !== 'continuous') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(effect.duration, st);
  // edh-combat-3 (CR 608.2d, 611.2c; Angelic Skirmisher): a group takes the keyword chosen as the ability resolves: "Choose first strike, vigilance, or lifelink.
  // Creatures you control gain that ability until end of turn." (the choice and the grant said apart, family choice-sentence); only the listed keywords and a duration
  // trek-13 (CR 702.16a, 608.2d, 611.2c; Borg Incursion): a group takes protection from the color chosen as the ability resolves, "Artifact creatures you control gain
  // protection from the color of your choice until end of turn": the single-object wording below, with a plural subject
  // edh-next-129 (CR 608.2d, 611.2c; Blitzwing, Adaptive Assailant): the keyword picked at random, "Choose flying or indestructible at random. ~ gains that ability until end of turn."
  // (the choice and the grant said apart); a random choice is never "your choice"
  if (c.random === true) {
    if (c.what !== 'option' || c.who.ref !== 'you' || orColor !== null || colorHexproof || colorOnly || ce.affects.ref === 'each' || subj.plural || !dur) return null;
    return { clauses: [plain(`choose ${joinList(grants.map((a) => (a.kind === 'keyword' ? a.text : '')), 'or')} at random`), plain(`${subj.text} gains that ability ${dur}`)], consumed: 1 + answers.length };
  }
  if (c.who.ref === 'controllerOf' && (colorHexproof || colorOnly || orColor !== null || ce.affects.ref === 'each')) return null; // edh-c-110: Wishmonger's single-object grant only
  if (ce.affects.ref === 'each' && c.what === 'color' && !colorHexproof && !colorOnly && orColor === null) {
    if (!dur || !subj.plural) return null;
  } else if (ce.affects.ref === 'each') {
    if (c.what !== 'option' || orColor !== null || colorHexproof || colorOnly || !dur || !subj.plural) return null;
    if (!('filter' in ce.affects)) return null;
    const group = K.np(ce.affects.filter as ObjectFilter, st, { det: 'none', plural: true });
    return { clauses: [plain(`choose ${joinList(grants.map((a) => (a.kind === 'keyword' ? a.text : '')), 'or')}`), plain(`${group} gain that ability ${dur}`)], consumed: 1 + answers.length };
  }
  if (colorHexproof) {
    // r5-fxb: Oracle says the duration first ("Until end of turn, Mondo Gecko becomes ..."); a choice with no duration is not this wording
    if (!dur) return null;
    return { clauses: [plain(`${dur}, ${subj.text} ${subj.plural ? 'become' : 'becomes'} the color of your choice and ${subj.plural ? 'gain' : 'gains'} hexproof from that color`)], consumed: 1 + answers.length };
  }
  if (colorOnly) {
    // std-rx34: the duration after the subject's verb, as Oracle prints it; no stated duration is a permanent change (CR 611.2a)
    const verb = subj.plural ? 'become' : 'becomes';
    return { clauses: [plain(`${subj.text} ${verb} the color of your choice${dur ? ` ${dur}` : ''}`)], consumed: 1 + answers.length };
  }
  if (c.who.ref === 'controllerOf' && (colorHexproof || colorOnly || orColor !== null || ce.affects.ref === 'each' || JSON.stringify(c.who.object) !== JSON.stringify(ce.affects))) return null;
  const chooser = c.who.ref === 'controllerOf' ? "its controller's" : 'your';
  const what = orColor !== null ? `protection from ${answers[0]} or from the color of your choice` : c.what === 'color' ? `protection from the color of ${chooser} choice` : `your choice of ${joinList(grants.map((a) => (a.kind === 'keyword' ? a.text : '')), 'or')}`;
  const verb = subj.plural ? 'gain' : 'gains';
  // trek-13: a group is named by its filter alone ("artifact creatures you control"), never "all ..." (the option branch above says it the same way)
  const subjText = ce.affects.ref === 'each' && 'filter' in ce.affects ? K.np(ce.affects.filter as ObjectFilter, st, { det: 'none', plural: true }) : subj.text;
  // edh-c-63 (CR 608.2d, 611.2c; Ballroom Brawlers; family both-gain-your-choice): two objects (~ and a target) that take the one keyword chosen are also "both gain your choice of ..."
  const base = `${subjText} ${verb} ${what}${dur ? ` ${dur}` : ''}`;
  const text = ce.affects.ref === 'union' && subj.plural ? alt(base, `${subjText} both ${verb} ${what}${dur ? ` ${dur}` : ''}`) : base;
  return { clauses: [plain(text)], consumed: 1 + answers.length };
}

/**
 * edht4 (CR 702.16a, 608.2d, 611.2c; Pippin, Guard of the Citadel): "~ gains protection from the card type of your choice until end of turn": a choice of a card type made as the
 * ability resolves (no listed options), then one effect granting protection from the type chosen under that link (quality `chosen:cardType`). The effect is fixed as it begins
 * (effects/handlers/lasting-fix.ts); a choice with listed options, a guard or any other use of the choice is not this wording.
 */
function choiceCardTypeProtection(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseValue' || c.what !== 'cardType' || c.options !== undefined || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || e?.op !== 'effect') return null;
  if (e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined) return null;
  const ce = e.effects[0]!;
  if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1) return null;
  const m = ce.mods[0]!;
  if (m.layer !== 6 || m.add?.length !== 1 || m.remove !== undefined || m.removeAll !== undefined || m.cantHave !== undefined) return null;
  const a = m.add[0]!;
  if (a.kind !== 'keyword' || a.keyword !== 'protection' || a.quality !== `chosen:${c.link}` || c.link !== 'cardType') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(e.duration, st);
  return { clauses: [plain(`${subj.text} ${subj.plural ? 'gain' : 'gains'} protection from the card type of your choice${dur ? ` ${dur}` : ''}`)], consumed: 2 };
}

/**
 * FAST2 T10: "Search your library for a basic land card, put it onto the battlefield tapped": the search idiom (CR 701.23a) names the card it found "it" in
 * the very next instruction, whatever was named before the search (the trigger's "~"): the pronoun of the idiom is written by the step that moves the
 * found card, never chosen among antecedents ("it" or "that card", even when a card died in the trigger: Pattern of Rebirth). Only a search for one card
 * (`max: 1`) and a move of exactly that binding right after it.
 */
function searchThenMove(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'search' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || b.until !== undefined) return null;
  const ca = K.clause(a, st);
  const key = `b:${a.as}`;
  const info = st.info.get(key);
  if (info === undefined) return { clauses: [ca], consumed: 1 };
  // FAST4 T30: the same idiom for several cards ("search your library for up to that many basic land cards, put them onto the battlefield tapped"): "them"
  // even when the trigger named a group too (a batch of attackers); only a move of the whole binding right after the search
  if (info.plural && a.max === 1) return { clauses: [ca], consumed: 1 };
  st.info.set(key, { ...info, alts: [...(info.alts ?? []), ...(info.plural ? ['them', 'those cards'] : ['it', 'that card'])] });
  try {
    return { clauses: [ca, K.clause(b, st)], consumed: 2 };
  } finally {
    // std-rx31 (CR 400.7; family exiled-card-participle): the idiom's pronouns end here, but a move into exile leaves the found card "the exiled card" (render/steps-zones.ts#bindMoved)
    const exiled = (st.info.get(key)?.alts ?? []).includes('the exiled card') && !(info.alts ?? []).includes('the exiled card');
    st.info.set(key, exiled ? { ...info, alts: [...(info.alts ?? []), 'the exiled card'] } : info);
  }
}

/**
 * FAST5 T74: "Target player gains 2 life, then searches their library for a basic land card, puts it onto the battlefield tapped, then shuffles." (CR 701.23a,
 * 608.2c; Restorative Technique): one player other than the controller gains life, searches for one card, puts it onto the battlefield under their own control and
 * shuffles. Oracle writes the four instructions of that player as one predicate; the default text would break it into sentences ("... puts it onto the battlefield
 * tapped under their control. That player shuffles."). The fold applies only when all four steps are exactly that and nothing else reads the found card.
 */
function playerGainsThenSearches(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const g = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  const sh = list[i + 3];
  if (g?.op !== 'gainLife' || a?.op !== 'search' || b?.op !== 'move' || sh?.op !== 'shuffle' || g.who.ref === 'you') return null;
  const who = JSON.stringify(g.who);
  if (JSON.stringify(a.who) !== who || JSON.stringify(sh.who) !== who || JSON.stringify(b.to.controller) !== who) return null;
  if (g.guard !== undefined || a.guard !== undefined || b.guard !== undefined || sh.guard !== undefined || g.as !== undefined || sh.as !== undefined) return null;
  if (a.as === undefined || a.max !== 1 || a.min !== undefined || a.zone !== 'library' || a.owner !== undefined || a.reveal !== undefined || a.differentNames !== undefined || a.and !== undefined) return null;
  if (!isBound(b.what, a.as) || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || b.to.zone !== 'battlefield') return null;
  if (!Object.keys(b.to).every((k) => k === 'zone' || k === 'controller' || k === 'tapped')) return null;
  if (list.slice(i + 4).some((x) => JSON.stringify(x).includes(`"${a.as}"`))) return null;
  const cg = K.clause(g, st);
  const ca = K.clause(a, st);
  if (cg.pred === undefined || ca.pred === undefined) return null;
  const key = playerKey(g.who);
  if (key === null) return null;
  const saved = st.actor;
  st.actor = key;
  const dest = destPhrase(b.to, st, false);
  st.actor = saved;
  const text = `${cg.sub}, then ${ca.pred}, puts it ${dest}, then shuffles`;
  return { clauses: [acting(key, text, text, { standalone: true })], consumed: 4 };
}

/**
 * FAST5 T42: "Look at the top two cards of your library. Put one into your hand and the other into your graveyard." (CR 401.2, 608.2c; Faerie Snoop): the cards a
 * look showed (a binding of two or more cards), one chosen by the player who looked (exactly one), put into the hand, and the others (the binding's cards still
 * in the library: a card that moved is a new object, CR 400.7, so the move skips it) put into the graveyard. The fold applies only when every part is exactly that.
 */
function onePutOtherGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const h = list[i + 1];
  const g = list[i + 2];
  if (c?.op !== 'chooseObjects' || h?.op !== 'move' || g?.op !== 'move' || c.as === undefined || c.who.ref !== 'you') return null;
  if (c.guard !== undefined || h.guard !== undefined || g.guard !== undefined || c.random === true || c.min !== 1 || c.max !== 1) return null;
  if (c.from.ref !== 'bound' || !isBound(h.what, c.as) || g.what.ref !== 'bound' || g.what.name !== c.from.name || h.until !== undefined || g.until !== undefined) return null;
  if (h.as !== undefined || g.as !== undefined || JSON.stringify(h.to) !== JSON.stringify({ zone: 'hand' }) || JSON.stringify(g.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  const fromName = c.from.name;
  const keptName = c.as;
  const looked = st.info.get(`b:${fromName}`);
  if (looked === undefined || !looked.plural || looked.zone !== 'library') return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"${keptName}"`) || JSON.stringify(x).includes(`"${fromName}"`))) return null;
  // Oracle also says which cards the one is chosen from: "put one of them into your hand ...", "put one of those cards into your hand ..."
  // edh-zones-15 (CR 401.2, 608.2c; Underrealm Lich): of three or more cards looked at, the others are also "the rest"
  return { clauses: [plain(`put ${alt('one', 'one of them', 'one of those cards')} into your hand and ${alt('the other', 'the rest')} into your graveyard`)], consumed: 3 };
}

/**
 * FAST5 T42: "Search your library for a creature card, reveal it, put it into your hand or graveyard, then shuffle" (CR 701.23a, 608.2d; Dina's Guidance): the
 * search for one card, then a choice made as the ability resolves between the hand and the graveyard (chooseValue among those two options, only when a card was
 * found), then one move of the found card per option, in that order. The search idiom names the card "it" (as searchThenMove). The fold applies only when every
 * part is exactly that and nothing else reads the choice.
 */
const HAND_OR_GRAVEYARD = ['hand', 'graveyard'] as const;
function searchThenHandOrGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const c = list[i + 1];
  if (a?.op !== 'search' || a.as === undefined || a.max !== 1 || a.and !== undefined || a.guard !== undefined || a.who.ref !== 'you' || a.zone !== 'library') return null;
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.what !== 'option' || c.min !== undefined || c.max !== undefined) return null;
  if (JSON.stringify(c.options) !== JSON.stringify(HAND_OR_GRAVEYARD)) return null;
  if (JSON.stringify(c.guard) !== JSON.stringify({ cond: 'exists', of: { ref: 'bound', name: a.as } })) return null;
  for (let k = 0; k < HAND_OR_GRAVEYARD.length; k++) {
    const b = list[i + 2 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== HAND_OR_GRAVEYARD[k]) return null;
    const m = b.then[0]!;
    if (m.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || !isBound(m.what, a.as)) return null;
    if (JSON.stringify(m.to) !== JSON.stringify({ zone: HAND_OR_GRAVEYARD[k] })) return null;
  }
  if (list.slice(i + 2 + HAND_OR_GRAVEYARD.length).some((x) => readsLink(x, c.link!))) return null;
  const ca = K.clause(a, st);
  const key = `b:${a.as}`;
  const info = st.info.get(key);
  if (info === undefined || info.plural) return null;
  st.info.set(key, { ...info, alts: [...(info.alts ?? []), 'it', 'that card'] });
  try {
    const what = K.obj({ ref: 'bound', name: a.as }, st, 'object').text;
    return { clauses: [ca, plain(`put ${what} into ${alt('your hand or graveyard', 'your hand or your graveyard')}`)], consumed: 2 + HAND_OR_GRAVEYARD.length };
  } finally {
    st.info.set(key, info);
  }
}

/**
 * FAST2 T10: "..., reveal it, then shuffle and put that card on top" (CR 701.23a, 701.24a): the shuffle, then the found card put back on top of the library it
 * was found in (the engine follows the card through the shuffle, effects/handlers/cards-library.ts#followShuffle). Oracle says "on top" without the library:
 * only for a binding found in a library (a search or a look), moved to the top of a library with no owner, order or duration, by the player who shuffles.
 */
const ORDINAL_FROM_TOP: Readonly<Record<number, string>> = { 2: 'second', 3: 'third', 4: 'fourth', 5: 'fifth' }; // edh-zones-5
function shuffleThenTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  const m = list[i + 1];
  if (s?.op !== 'shuffle' || m?.op !== 'move' || m.what.ref !== 'bound' || m.until !== undefined || s.guard !== undefined || m.guard !== undefined) return null;
  const d = m.to;
  // edh-zones-5 (CR 401.4; Long-Term Plans): one found card put "third from the top" of the library (the position `{nth: 3}`) is said as the top is
  const nth = typeof d.position === 'object' && d.position !== null && 'nth' in d.position && typeof d.position.nth === 'number' ? ORDINAL_FROM_TOP[d.position.nth] : undefined;
  if (d.zone !== 'library' || (d.position !== 'top' && nth === undefined) || d.owner !== undefined) return null;
  const where = nth === undefined ? 'on top' : `${nth} from the top`;
  const info = st.info.get(`b:${m.what.name}`);
  if (info === undefined || info.zone !== 'library') return null;
  if (nth !== undefined && info.plural) return null;
  // FAST3 T17: several found cards go on top "in any order" (CR 401.4: their owner arranges them; `order: 'chosen'`); one card has no order
  if (info.plural ? d.order !== 'chosen' : d.order !== undefined) return null;
  // edh-c-21 (family any-order-implied; CR 401.4; Scouting Trek): the order of several cards put on top is the owner's whether or not Oracle says "in any order"
  const order = info.plural ? alt(' in any order', '') : '';
  const key = playerKey(s.who);
  if (key === null) return null;
  const [folded, plain] = withVariants(st, [
    (v) => {
      const subj = K.player(s.who, v, 'subject');
      // r4-dig (CR 701.23a, 608.2c): one found card is also "it", "reveal it, then shuffle and put it on top" (the search is the instruction's only antecedent)
      const that = K.obj(m.what, v, 'object').text;
      const what = info.plural ? that : alt(that, 'it');
      return { imp: `shuffle and put ${what} ${where}${order}`, sub: `${subj.text} ${conjVerb('shuffle', subj.person)} and ${conjVerb('put', subj.person)} ${what} ${where}${order}` };
    },
    // the two instructions written apart, as without this fold (no recursion into the folds: each step is its own clause)
    (v) => {
      const cs = K.clause(s, v);
      const cm = K.clause(m, v);
      const sep = alt(', then ', '. ', ' and ', ', ');
      return { imp: `${within(cs, key)}${sep}${within(cm, key)}`, sub: `${fragment(cs)}${sep}${fragment(cm)}` };
    },
  ]);
  return { clauses: [acting(key, alt(folded!.imp, plain!.imp), alt(folded!.sub, plain!.sub))], consumed: 2 };
}

/**
 * edh-zones-2 (CR 701.24a, 406.1, 608.2c; Urza, Lord High Artificer): "Shuffle your library, then exile the top card.": you shuffle your library, then exile its top
 * card (the top card of the library just shuffled). Only that exact shape: your shuffle, then one top card of your library exiled face up.
 */
function shuffleThenExileTop(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  const m = list[i + 1];
  if (s?.op !== 'shuffle' || m?.op !== 'move' || s.guard !== undefined || m.guard !== undefined || s.who.ref !== 'you' || UNFOLDING.has(s)) return null;
  if (m.what.ref !== 'topCards' || m.what.player.ref !== 'you' || m.what.count !== 1 || m.what.zone !== undefined || m.what.allButBottom !== undefined) return null;
  if (m.until !== undefined || m.link !== undefined || m.remember !== undefined || JSON.stringify(m.to) !== JSON.stringify({ zone: 'exile' })) return null;
  const unfold = (v: RenderState): { imp: string; sub: string } => {
    UNFOLDING.add(s); // the unfolded alternative renders the same two steps: not through this fold again
    try { const t = K.steps([s, m], v); return { imp: t, sub: t }; } finally { UNFOLDING.delete(s); }
  };
  const [folded, plain] = withVariants(st, [
    (v) => {
      K.clause(m, v); // the exiled card is what a later "that card" names (the binding of the move)
      return { imp: 'shuffle your library, then exile the top card', sub: 'you shuffle your library, then exile the top card' };
    },
    unfold,
  ]);
  return { clauses: [acting('you', alt(folded!.imp, plain!.imp), alt(folded!.sub, plain!.sub))], consumed: 2 };
}

/**
 * Cloud std-tdm (CR 614.15, 701.23a, 608.2c): "..., reveal it, then shuffle and put that card on top. If you control a Dragon, put that card onto the battlefield
 * tapped instead." (rider eff.stdtdm.instead.putBattlefieldTapped): the shuffle, then the self-replacement of the found card's move to the top of its library
 * (`shuffleThenTop`'s move, the `else` branch) by another move of that card. The steps rendered as before this fold stay a reading (`UNFOLDING`).
 */
function shuffleThenTopInstead(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const s = list[i];
  const f = list[i + 1];
  if (s?.op !== 'shuffle' || f?.op !== 'if' || s.guard !== undefined || f.guard !== undefined || f.as !== undefined || UNFOLDING.has(s)) return null;
  const m = f.else?.length === 1 ? f.else[0] : undefined;
  if (m?.op !== 'move' || f.then.length !== 1 || f.then[0]!.op !== 'move' || !isSelfReplacement(f.then, f.else!)) return null;
  if (m.what.ref !== 'bound' || m.until !== undefined || m.guard !== undefined || m.as !== undefined) return null;
  const d = m.to;
  if (d.zone !== 'library' || d.position !== 'top' || d.owner !== undefined || d.order !== undefined) return null;
  const info = st.info.get(`b:${m.what.name}`);
  const key = playerKey(s.who);
  if (info === undefined || info.zone !== 'library' || info.plural || key === null) return null;
  const unfold = (v: RenderState): { imp: string; sub: string } => {
    UNFOLDING.add(s); // the unfolded alternative renders the same two steps: not through this fold again
    try { const t = K.steps([s, f], v); return { imp: t, sub: t }; } finally { UNFOLDING.delete(s); }
  };
  const [folded, plain] = withVariants(st, [
    (v) => {
      const subj = K.player(s.who, v, 'subject');
      const what = K.obj(m.what, v, 'object').text;
      const instead = `. If ${K.cond(f.cond, v)}, ${K.steps(f.then, v)} instead`;
      return { imp: `shuffle and put ${what} on top${instead}`, sub: `${subj.text} ${conjVerb('shuffle', subj.person)} and ${conjVerb('put', subj.person)} ${what} on top${instead}` };
    },
    unfold,
  ]);
  return { clauses: [acting(key, alt(folded!.imp, plain!.imp), alt(folded!.sub, plain!.sub))], consumed: 2 };
}

/**
 * FAST2 T10: "Look at the top three cards of your library, then put them back in any order" (CR 401.4: the owner arranges cards put on top of a library
 * together): a look at the top cards of a player's library, then exactly those cards put on top of it again in an order of that player's choice. "Back"
 * names the library they were looked at in, so only a look by the library's owner at its top cards, and a move of that binding with no other destination.
 */
function lookThenPutBack(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'look' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || b.until !== undefined || b.guard !== undefined) return null;
  if (a.at.ref !== 'topCards' || playerKey(a.at.player) === null || playerKey(a.at.player) !== playerKey(a.who)) return null;
  const d = b.to;
  if (d.zone !== 'library' || d.position !== 'top' || d.order !== 'chosen' || d.owner !== undefined) return null;
  const ca = K.clause(a, st);
  const info = st.info.get(`b:${a.as}`);
  if (info === undefined || !info.plural) return { clauses: [ca], consumed: 1 };
  const key = playerKey(a.who)!;
  const [back, plain] = withVariants(st, [
    (v) => {
      const subj = K.player(a.who, v, 'subject');
      const what = K.obj(b.what, v, 'object').text;
      return { imp: `put ${what} back in any order`, sub: `${subj.text} ${conjVerb('put', subj.person)} ${what} back in any order` };
    },
    (v) => { const c = K.clause(b, v); return { imp: within(c, key), sub: fragment(c) }; },
  ]);
  return { clauses: [ca, acting(key, alt(back!.imp, plain!.imp), alt(back!.sub, plain!.sub))], consumed: 2 };
}

/**
 * FAST3 T13: "~ gets +1/-1 or -1/+1 until end of turn" (CR 608.2d, 613.4c): a choice between two listed P/T changes made as the ability resolves
 * (chooseValue among the two options, spelled as the changes), then one fixed change per option, in the order listed. Each branch is the same object and
 * duration with exactly that one numeric layer-7c change; the fold applies only then.
 */
function choicePump(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.what !== 'option') return null;
  const options = c.options ?? [];
  if (options.length !== 2) return null;
  let first: Extract<EffectStep, { op: 'effect' }> | null = null;
  for (let k = 0; k < options.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== options[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'effect' || e.effects.length !== 1 || e.guard !== undefined || e.as !== undefined) return null;
    const ce = e.effects[0]!;
    if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1) return null;
    const m = ce.mods[0]!;
    if (m.layer !== '7c' || typeof m.power !== 'number' || typeof m.toughness !== 'number') return null;
    if (`${signed(m.power)}/${signed(m.toughness)}` !== options[k]) return null;
    if (first === null) first = e;
    else if (JSON.stringify(e.duration) !== JSON.stringify(first.duration) || JSON.stringify(ce.affects) !== JSON.stringify((first.effects[0] as typeof ce).affects)) return null;
  }
  // the link must be read by these branches only
  if (list.slice(i + 1 + options.length).some((s) => readsLink(s, c.link!))) return null;
  const ce = first!.effects[0]!;
  if (ce.s !== 'continuous' || ce.affects.ref === 'each') return null;
  const subj = K.obj(ce.affects as ObjRef, st, 'subject');
  const dur = K.dur(first!.duration, st);
  const text = `${subj.text} ${subj.plural ? 'get' : 'gets'} ${options[0]} or ${options[1]}${dur ? ` ${dur}` : ''}`;
  return { clauses: [plain(text)], consumed: 1 + options.length };
}


/**
 * FAST5 T36 (CR 609.7a, 615.9): the zones a "source of your choice" is chosen among (every object that can be the source of damage the engine tracks).
 * audit-fix-1 (CR 609.7a, from memory, unverified): with the face-up objects of the command zone; an ability on the stack stands for the object it refers to
 * (its source, even one that has left its zone) and a permanent spell also for the permanent it becomes (effects/replacements.ts#standsForSource).
 */
export const SOURCE_CHOICE_ZONES = ['battlefield', 'stack', 'command'];

/**
 * FAST5 T36: "The next time a red source of your choice would deal damage to you this turn, prevent that damage." (the Circle of Protection and Rune of
 * Protection cycles, CR 609.7a, 615.1, 615.7-615.9): the source is chosen as the ability resolves (`chooseObjects` among the objects of that color), then a
 * one-use shield that prevents all the damage that source would deal to you; the shield names the source and its color, so a source that is no longer that
 * color when the damage would be dealt is not prevented (CR 615.9). The fold applies only when every part is exactly that.
 * std-rx35 (CR 609.7a, 615.5, 615.7): the same shield for a source of any color ("a source of your choice", Righteous Aura), on one object or any target as well
 * as on you ("to target creature", "to enchanted creature", "to any target": the recipient named by its reference, as the shields of PUSH1 T2), and with the
 * prevention's additional instruction after it ("You gain life equal to the damage prevented this way.", `prevent.then`).
 */
function sourceOfChoiceShield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseObjects' || c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== 1 || c.max !== 1 || c.random === true) return null;
  if (c.from.ref !== 'each' || !('filter' in c.from)) return null;
  if (c.damageSource !== true || c.perPlayer !== undefined || c.startingWith !== undefined) return null; // audit-fix-1 (CR 609.7a): the source choice's own reading
  const colors = c.from.filter.colors;
  const color = colors?.[0];
  if (colors !== undefined && (colors.length !== 1 || color === undefined || COLOR_WORD[color] === undefined)) return null;
  if (JSON.stringify(c.from.filter) !== JSON.stringify(color === undefined ? { zone: SOURCE_CHOICE_ZONES } : { zone: SOURCE_CHOICE_ZONES, colors: [color] })) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  const r = e.effects[0]!;
  if (r.s !== 'replace' || r.condition !== undefined || r.optional !== undefined || r.selfReplacement !== undefined || r.replaces.ev !== 'damage') return null;
  const source = { is: { ref: 'bound', name: c.as }, ...(color === undefined ? {} : { colors: [color] }) };
  const { recipient, ...rest } = r.replaces;
  if (JSON.stringify(rest) !== JSON.stringify({ ev: 'damage', source })) return null;
  // std-rx35: you, one object by its reference, or one target that may be an object or a player ("any target", CR 115.4)
  const keys = (x: object): string => Object.keys(x).filter((k) => (x as Record<string, unknown>)[k] !== undefined).sort().join(',');
  const obj = recipient?.object;
  const one = obj !== undefined && obj.is !== undefined && keys(obj) === 'is';
  const to = recipient === undefined ? null
    : JSON.stringify(recipient) === JSON.stringify({ player: 'you' }) ? 'you'
    : one && recipient.player === undefined && color === undefined ? K.obj(obj.is!, st, 'object').text
    : one && recipient.player !== undefined && color === undefined && JSON.stringify(recipient.player) === JSON.stringify(obj.is) ? K.obj(obj.is!, st, 'object').text
    : null;
  if (to === null) return null;
  const { then, ...body } = r.body as Extract<typeof r.body, { b: 'prevent' }>;
  // edhd67 (CR 615.1, 107.1a; Dark Sphere): "prevent half that damage, rounded down" to you, from a source of any color: the damage the source would deal, halved
  const halfDown = JSON.stringify(body) === JSON.stringify({ b: 'prevent', amount: { q: 'math', op: 'floorDiv', args: [{ q: 'eventAmount' }, 2] } });
  if ((JSON.stringify(body) !== JSON.stringify({ b: 'prevent', amount: 'all' }) && !halfDown) || JSON.stringify(r.shield) !== JSON.stringify({ uses: 1 })) return null;
  if (halfDown && (to !== 'you' || then !== undefined || color !== undefined)) return null;
  if (then !== undefined && (to !== 'you' || then.length === 0 || color !== undefined)) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":${JSON.stringify(c.as)}`)) || (then !== undefined && JSON.stringify(then).includes(`"name":${JSON.stringify(c.as)}`))) return null;
  const dur = K.dur(e.duration, st);
  const which = color === undefined ? 'a' : withArticle(COLOR_WORD[color]!);
  const after = then !== undefined ? `. ${K.steps(then, st)}` : '';
  return { clauses: [plain(`the next time ${which} source of your choice would deal damage to ${to}${dur ? ` ${dur}` : ''}, prevent ${halfDown ? 'half that damage, rounded down' : 'that damage'}${after}`)], consumed: 2 };
}

/** FAST3 T13: does this node read the link (a `link` or `chosen` field naming it: a `chosen` condition, filter or type change)? */
function readsLink(x: unknown, link: string): boolean {
  if (Array.isArray(x)) return x.some((y) => readsLink(y, link));
  if (typeof x !== 'object' || x === null) return false;
  return Object.entries(x).some(([k, v]) => ((k === 'link' || k === 'chosen') && v === link) || readsLink(v, link));
}

/** FAST3 T13: the basic land types in the order of CR 305.6 (W, U, B, R, G), the options of "the basic land type of your choice". */
const BASIC_LAND_TYPES = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];

/**
 * FAST3 T13: a choice made as the ability resolves, then the one effect that uses it, said as one phrase: "creatures of the creature type of your choice get
 * +0/+4 until end of turn" (chooseValue creatureType, then the effect on the creatures of that type), "~ becomes the creature type of your choice until end
 * of turn", "target land becomes the basic land type of your choice until end of turn" (the subtypes set to the value chosen, CR 205.1a, 305.7, 608.2d).
 * The effect is rendered with the choice's words in the render state; the fold applies only when the effect's text used them.
 */
function choiceThenEffect(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  const e = list[i + 1];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.min !== undefined || c.max !== undefined || c.exclude !== undefined /* edh-next-9: "other than Wall" is no "of your choice" */) return null;
  if (e?.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1 || e.effects[0]!.s !== 'continuous') return null;
  let words: string;
  if (c.what === 'creatureType' && c.options === undefined) words = 'creature type';
  else if (c.what === 'landType' && JSON.stringify(c.options) === JSON.stringify(BASIC_LAND_TYPES)) words = 'basic land type';
  else return null;
  // the link must be read by this effect only: a later step that reads it would say "the chosen type", which the fold does not cover
  if (list.slice(i + 2).some((s) => readsLink(s, c.link!))) return null;
  // edh-c-97 (CR 115.1, 608.2d; Pack's Disdain): the unfolded reading below is said from the state before the folded one, so a target is named in full ("target creature"), not "that creature"
  const scratch = cloneState(st);
  const saved = st.choiceWords;
  const entry = { words, quality: c.what, used: 0 };
  st.choiceWords = new Map([[c.link, entry]]);
  let clause: Clause;
  try {
    clause = K.clause(e, st);
  } finally {
    if (saved === undefined) delete st.choiceWords;
    else st.choiceWords = saved;
  }
  if (entry.used === 0) return null;
  // CLOUD C5 (CR 608.2d, 607.2d): Oracle also says the choice as a sentence of its own, then "the chosen type" ("Choose a creature type. Creatures of the chosen
  // type get +2/+2 until end of turn."): the same two steps, unfolded, are the other reading (the choice is yours, so it is said in the imperative)
  // (only when the effect has words for "the chosen type" on its own: "becomes the creature type of your choice" has no unfolded reading). CLOUD std-fra made the
  // same reading (family choice-own-sentence, "Choose a creature type. Creatures you control of the chosen type get +1/+0 ..."); the merge of lines C and D keeps this one
  let choose: Clause;
  let effect: Clause;
  try {
    choose = K.clause(c, scratch);
    effect = K.clause(e, scratch);
  } catch (err) {
    if (err instanceof NoRenderer) return { clauses: [clause], consumed: 2 };
    throw err;
  }
  const two = (a: string, b: string): string => `${a}. ${b.charAt(0).toUpperCase()}${b.slice(1)}`;
  return { clauses: [{ ...clause, imp: alt(clause.imp, two(choose.imp, effect.imp)), sub: alt(clause.sub, two(choose.imp, effect.sub)), standalone: true }], consumed: 2 };
}

/** M6-8: what "one ... with another" calls each kind of word a text-changing effect replaces (CR 612.2). */
const TEXT_WORDS: Readonly<Record<string, string>> = { color: 'color word', landType: 'basic land type', creatureType: 'creature type' };

/**
 * M6-8: "Change the text of target spell or permanent by replacing all instances of one color word with another" (CR 612.1, 612.2, 608.2d): the word replaced
 * and the word it becomes are chosen as the spell resolves (two choices of the same kind by its controller, the second excluding the first: "another"), then
 * one layer 3 effect that changes the first into the second. "One basic land type" is a choice among the five basic land types (CR 305.6); Artificial
 * Evolution's "The new creature type can't be Wall." is one fixed exclusion of the second choice, said as a sentence of its own.
 */
function textChange(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const e = list[i + 2];
  if (a?.op !== 'chooseValue' || b?.op !== 'chooseValue' || e?.op !== 'effect') return null;
  const words = TEXT_WORDS[a.what];
  if (words === undefined || b.what !== a.what || a.link === undefined || b.link === undefined || a.link === b.link) return null;
  for (const c of [a, b]) if (c.who.ref !== 'you' || c.guard !== undefined || c.as === undefined || c.min !== undefined || c.max !== undefined) return null;
  const basic = JSON.stringify(BASIC_LAND_TYPES);
  if (a.what === 'landType' ? JSON.stringify(a.options) !== basic || JSON.stringify(b.options) !== basic : a.options !== undefined || b.options !== undefined) return null;
  const ex = b.exclude ?? [];
  const first = ex[0];
  if (a.exclude !== undefined || first === undefined || typeof first === 'string' || !('chosen' in first) || first.chosen !== a.link) return null;
  const fixed = ex.slice(1);
  if (fixed.length > 1 || fixed.some((x) => typeof x !== 'string') || (fixed.length === 1 && a.what !== 'creatureType')) return null;
  if (e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  const ce = e.effects[0]!;
  if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1 || ce.affects.ref === 'each') return null;
  const m = ce.mods[0]!;
  if (m.layer !== 3 || !('changeWord' in m) || m.changeWord.kind !== a.what) return null;
  const { from, to } = m.changeWord;
  if (typeof from === 'string' || typeof to === 'string' || from.chosen !== a.link || to.chosen !== b.link) return null;
  // the two words are read by this effect only (a later "the chosen color" is not this idiom)
  if (list.slice(i + 3).some((x) => readsLink(x, a.link!) || readsLink(x, b.link!))) return null;
  const target = K.obj(ce.affects as ObjRef, st, 'object');
  if (target.plural) return null;
  const dur = K.dur(e.duration, st);
  const tail = fixed.length === 1 ? `. The new creature type can't be ${fixed[0] as string}` : '';
  const text = `change the text of ${target.text} by replacing all instances of one ${words} with another${dur ? ` ${dur}` : ''}${tail}`;
  return { clauses: [plain(text, tail ? { standalone: true } : {})], consumed: 3 };
}

/**
 * edh-misc-6 (CR 612.1, 612.2, 608.2d; New Blood): "Change the text of that creature by replacing all instances of one creature type with Vampire": the creature type
 * replaced is chosen as the spell resolves, the word it becomes is the fixed one (a creature type, not chosen). One choice, then one layer 3 effect that changes the
 * first into the fixed word; the same idiom as textChange, which chooses both.
 */
function textChangeFixed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const e = list[i + 1];
  if (a?.op !== 'chooseValue' || e?.op !== 'effect' || a.what !== 'creatureType' || a.link === undefined || a.who.ref !== 'you' || a.guard !== undefined || a.as === undefined) return null;
  if (a.min !== undefined || a.max !== undefined || a.options !== undefined || a.exclude !== undefined) return null;
  if (e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  const ce = e.effects[0]!;
  if (ce.s !== 'continuous' || ce.cda !== undefined || ce.mods.length !== 1 || ce.affects.ref === 'each') return null;
  const m = ce.mods[0]!;
  if (m.layer !== 3 || !('changeWord' in m) || m.changeWord.kind !== 'creatureType') return null;
  const { from, to } = m.changeWord;
  if (typeof from === 'string' || from.chosen !== a.link || typeof to !== 'string' || !/^[A-Z][A-Za-z'-]*$/.test(to)) return null;
  if (list.slice(i + 2).some((x) => readsLink(x, a.link!))) return null;
  const target = K.obj(ce.affects as ObjRef, st, 'object');
  if (target.plural) return null;
  const dur = K.dur(e.duration, st);
  return { clauses: [plain(`change the text of ${target.text} by replacing all instances of one creature type with ${to}${dur ? ` ${dur}` : ''}`)], consumed: 2 };
}

/**
 * FAST3 T17: "create your choice of a Clue token, a Food token, or a Treasure token" (CR 111.10, 608.2d): a choice among predefined tokens made as the
 * ability resolves (chooseValue among their names), then one branch per option, in the order listed, each creating exactly one of that token for you. The
 * fold applies only when every part is exactly that and nothing else reads the choice.
 */
function choiceToken(list: EffectStep[], i: number): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.who.ref !== 'you' || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined) return null;
  const options = c.options ?? [];
  if (options.length < 2 || new Set(options).size !== options.length) return null;
  for (let k = 0; k < options.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== options[k]) return null;
    const e = b.then[0]!;
    if (e.op !== 'createToken' || e.who.ref !== 'you' || e.count !== 1 || e.guard !== undefined || e.as !== undefined) return null;
    if (e.tapped !== undefined || e.attacking !== undefined || e.attachTo !== undefined || e.counters !== undefined || e.link !== undefined) return null;
    if (e.token.predefined !== options[k] || Object.keys(e.token).length !== 1) return null;
  }
  if (list.slice(i + 1 + options.length).some((s) => readsLink(s, c.link!))) return null;
  // r4-fxb (family token-or-token): "create a Food token or a Treasure token" is the same choice, made by you as the ability resolves (CR 608.2d)
  const listed = joinList(options.map((o) => withArticle(`${o} token`)), 'or');
  return { clauses: [plain(`create ${alt(`your choice of ${listed}`, listed)}`)], consumed: 1 + options.length };
}

/**
 * FAST4 T25: "target creature's owner puts it on their choice of the top or bottom of their library" (CR 401.1, 608.2d): the owner chooses "top" or
 * "bottom" as the ability resolves (chooseValue among those two options), then one move per option, in that order, of the same object into its owner's
 * library at that position. The fold applies only when every part is exactly that and nothing else reads the choice.
 */
function ownerTopOrBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined) return null;
  if (c.who.ref !== 'ownerOf' || JSON.stringify(c.options) !== JSON.stringify(TOP_BOTTOM)) return null;
  const what = c.who.object;
  for (let k = 0; k < TOP_BOTTOM.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== TOP_BOTTOM[k]) return null;
    const m = b.then[0]!;
    if (m.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined) return null;
    if (JSON.stringify(m.what) !== JSON.stringify(what) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'library', position: TOP_BOTTOM[k] })) return null;
  }
  if (list.slice(i + 1 + TOP_BOTTOM.length).some((s) => readsLink(s, c.link!))) return null;
  const rest = 'on their choice of the top or bottom of their library';
  // "the owner of target nonland permanent puts it ...": the same player named after the object (Oracle prints both); said on a copy of the state
  const copy = cloneState(st);
  const named = K.obj(what, copy, 'object').text;
  const ownerOf = `the owner of ${named} puts ${K.obj(what, copy, 'object').text} ${rest}`;
  const who = K.player(c.who, st, 'subject');
  const obj = K.obj(what, st, 'object');
  return { clauses: [plain(alt(`${who.text} puts ${obj.text} ${rest}`, ownerOf))], consumed: 1 + TOP_BOTTOM.length };
}
const TOP_BOTTOM = ['top', 'bottom'] as const;

/**
 * r3-refs (CR 401.3, 608.2d, 400.3): "The owner of target creature an opponent controls puts it into their library second from the top or on the bottom." The owner
 * chooses one of the two places as the ability resolves (chooseValue among those two options), then one move per option, in that order, of the same object into
 * its owner's library there (`position: {nth: 2}` is second from the top). As ownerTopOrBottom: only exactly that, and nothing else reads the choice.
 */
function ownerSecondOrBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const c = list[i];
  if (c?.op !== 'chooseValue' || c.link === undefined || c.guard !== undefined || c.what !== 'option' || c.min !== undefined || c.max !== undefined) return null;
  if (c.who.ref !== 'ownerOf' || JSON.stringify(c.options) !== JSON.stringify(SECOND_BOTTOM)) return null;
  const what = c.who.object;
  const places = [{ zone: 'library', position: { nth: 2 } }, { zone: 'library', position: 'bottom' }];
  for (let k = 0; k < SECOND_BOTTOM.length; k++) {
    const b = list[i + 1 + k];
    if (b?.op !== 'if' || b.else !== undefined || b.guard !== undefined || b.as !== undefined || b.then.length !== 1) return null;
    if (b.cond.cond !== 'chosen' || b.cond.link !== c.link || b.cond.equals !== SECOND_BOTTOM[k]) return null;
    const m = b.then[0]!;
    if (m.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined) return null;
    if (JSON.stringify(m.what) !== JSON.stringify(what) || JSON.stringify(m.to) !== JSON.stringify(places[k])) return null;
  }
  if (list.slice(i + 1 + SECOND_BOTTOM.length).some((s) => readsLink(s, c.link!))) return null;
  // edh-next-117 (CR 108.3, 400.3; Wan Shi Tong, All-Knowing; family owner-puts-it-possessive): "target nonland permanent's owner puts it ..." is also "the owner of target nonland permanent puts it ..."
  const copy = cloneState(st);
  const named = K.obj(what, copy, 'object').text;
  const again = K.obj(what, copy, 'object').text;
  const who = K.player(c.who, st, 'subject');
  const obj = K.obj(what, st, 'object');
  const rest = 'into their library second from the top or on the bottom';
  return { clauses: [plain(alt(`the owner of ${named} puts ${again} ${rest}`, `${who.text} puts ${obj.text} ${rest}`))], consumed: 1 + SECOND_BOTTOM.length };
}
const SECOND_BOTTOM = ['second from the top', 'bottom'] as const;

/**
 * FAST4 T25: "each player exiles all creature cards from their graveyard, then sacrifices all creatures they control, then puts all cards they exiled this
 * way onto the battlefield" (CR 608.2c, 701.21a, 400.7j, 110.2): one move of every card of a type from every graveyard into exile, bound; each player's
 * sacrifice of every permanent of that type they control; then one move of the bound cards onto the battlefield under their owners' control (each player
 * puts their own cards, which they own). The fold applies only when every part is exactly that.
 */
function exileSacrificeReturn(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'move' || b?.op !== 'sacrificeChoice' || c?.op !== 'move') return null;
  if (b.mode !== 'all' || b.who.ref !== 'each' || b.who.who !== 'player') return null; // CR 701.21a: each player sacrifices what they control
  if ([a, b, c].some((x) => x.guard !== undefined) || a.as === undefined || b.as !== undefined || c.as !== undefined || a.until !== undefined || c.until !== undefined) return null;
  if (a.what.ref !== 'each' || !('filter' in a.what) || !isBound(c.what, a.as)) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'exile' }) || JSON.stringify(c.to) !== JSON.stringify({ zone: 'battlefield', controller: 'owner' })) return null;
  const { zone, isCard, ...cardRest } = a.what.filter;
  if (zone !== 'graveyard' || isCard !== true || JSON.stringify(cardRest) !== JSON.stringify(b.filter) || Object.keys(cardRest).join() !== 'types') return null;
  if (list.slice(i + 3).some((s) => JSON.stringify(s).includes(`"${a.as}"`))) return null;
  const types = cardRest.types ?? [];
  if (types.length !== 1) return null;
  const cards = `${types[0]!.toLowerCase()} cards`;
  const perms = K.np(b.filter, st, { det: 'none', plural: true });
  return { clauses: [plain(`each player exiles all ${cards} from their graveyard, then sacrifices all ${perms} they control, then puts all cards they exiled this way onto the battlefield`)], consumed: 3 };
}

/** Is the quantity a number computed as the step runs that "where X is ..." defines (CR 107.3, 608.2h): not a constant, not the X of a cost, not "that many"? */
const definedX = (q: unknown): boolean => typeof q === 'object' && q !== null && !['X', 'var', 'eventAmount', 'resultCount', 'ask', 'live'].includes((q as { q: string }).q);

/**
 * FAST5 T49 (CR 120.3, 119.3, 107.3, 608.2h): a plain damage step with a computed amount, written as the "deals X damage" part of one sentence that defines X once
 * ("~ deals X damage to each opponent and you gain X life, where X is ..."): no division, no further recipient, no name, no condition. The step rendered with
 * the amount X, as a clause, or null.
 */
function damageWithX(s: EffectStep | undefined, amount: unknown): EffectStep | null {
  if (s?.op !== 'damage' || s.guard !== undefined || s.as !== undefined || s.divided !== undefined || s.also !== undefined || s.perSource === true || s.unpreventable === true) return null;
  if (!definedX(s.amount) || JSON.stringify(s.amount) !== JSON.stringify(amount)) return null;
  return { ...s, amount: { q: 'X' } };
}

/**
 * FAST5 T49: "~ deals X damage to each opponent and you gain X life, where X is the number of creatures you control with power 2 or less" (CR 120.3, 119.3,
 * 107.3, 608.2h): damage and a gain of life for you of the same computed amount, written with one X. Optionally led by "target player draws X cards," (the
 * same amount, Converge: "Target player draws X cards, ~ deals X damage to any target, and you gain X life, where X is the number of colors of mana spent to
 * cast ~"). Only that shape, every step plain.
 */
function damageGainWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const first = list[i];
  const draws = first?.op === 'draw';
  const dmg = list[draws ? i + 1 : i];
  const gain = list[draws ? i + 2 : i + 1];
  if (gain?.op !== 'gainLife' || gain.guard !== undefined || gain.as !== undefined || gain.who.ref !== 'you' || !definedX(gain.amount)) return null;
  const damage = damageWithX(dmg, gain.amount);
  if (damage === null) return null;
  if (draws && (first.guard !== undefined || first.as !== undefined || first.who.ref === 'you' || JSON.stringify(first.count) !== JSON.stringify(gain.amount))) return null;
  const parts: string[] = [];
  if (draws) parts.push(fragment(K.clause({ ...first, count: { q: 'X' } }, st)));
  parts.push(fragment(K.clause(damage, st)));
  parts.push(fragment(K.clause({ ...gain, amount: { q: 'X' } }, st)));
  const where = `where X is ${K.qty(gain.amount, st)}`;
  // edh-players-11 (CR 608.2h; family where-x-then-gain-sentence): the damage may state its X first, with the gain of life a sentence of its own after it that reads that X (Tezzeret, Master of the Bridge)
  const text = draws ? `${parts[0]!}, ${parts[1]!}, and ${parts[2]!}, ${where}` : alt(`${parts[0]!} and ${parts[1]!}, ${where}`, `${parts[0]!}, ${where}. You gain X life`);
  return { clauses: [plain(text, { standalone: true })], consumed: draws ? 3 : 2 };
}

/**
 * FAST4 T26: "each opponent loses X life and you gain X life, where X is the number of Shrines you control" (CR 119.3, 107.3, 608.2h): a loss of life and
 * a gain of the same computed amount for you, written with one X (Oracle never repeats the amount: "loses life equal to ... and you gain life equal to ...").
 */
function drainWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'loseLife' || b?.op !== 'gainLife') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || b.who.ref !== 'you') return null;
  if (!definedX(a.amount) || JSON.stringify(a.amount) !== JSON.stringify(b.amount)) return null;
  const subj = K.player(a.who, st, 'subject');
  if (subj.person !== 'sg') return null;
  return { clauses: [plain(`${subj.text} loses X life and you gain X life, where X is ${K.qty(a.amount, st)}`)], consumed: 2 };
}

/**
 * FAST4 T34: "put any number of cards from your hand on the bottom of your library, then draw that many cards plus one" (CR 401.4, 121.1, 608.2c): you choose
 * any number of cards in your hand, put exactly those on the bottom of your library (you order them, CR 401.4), then draw as many cards as were put there plus
 * a fixed number. Only that exact shape, and the names used by nothing after.
 */
function putBottomThenDrawPlus(list: EffectStep[], i: number): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'draw' || a.as === undefined || b.as === undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || a.random === true || c.who.ref !== 'you' || !isBound(b.what, a.as) || b.until !== undefined) return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || c.as !== undefined) return null;
  if (JSON.stringify(a.from) !== JSON.stringify({ ref: 'each', filter: { zone: 'hand', owner: 'you' } }) || JSON.stringify(b.to) !== JSON.stringify({ zone: 'library', position: 'bottom' })) return null;
  const n = c.count;
  if (typeof n !== 'object' || n.q !== 'math' || n.op !== '+' || n.args.length !== 2 || JSON.stringify(n.args[0]) !== JSON.stringify({ q: 'resultCount', step: b.as })) return null;
  const k = n.args[1];
  if (typeof k !== 'number' || k < 1) return null;
  if (list.slice(i + 3).some((s) => JSON.stringify(s).includes(`"${a.as}"`) || JSON.stringify(s).includes(`"${b.as}"`))) return null;
  const text = `put any number of cards from your hand on the bottom of your library, then draw that many cards plus ${numWord(k)}`;
  return { clauses: [acting('you', text, text)], consumed: 3 };
}

/**
 * FAST4 T34: "each opponent draws a card, then you draw a card for each opponent who drew a card this way" (CR 121.1, 121.2, 608.2c): each opponent draws one
 * card (the step binds the cards actually drawn, effects/handlers/cards-draw.ts), then you draw as many cards: one card per opponent who drew. Only one card
 * each, and the name used by nothing after.
 */
function eachOpponentDrawsThenYou(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'draw' || a.as === undefined || a.count !== 1 || a.who.ref !== 'each' || !('who' in a.who) || a.who.who !== 'opponent') return null;
  if (a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || JSON.stringify(b.count) !== JSON.stringify({ q: 'resultCount', step: a.as })) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"${a.as}"`))) return null;
  // edh-d-70 (CR 121.1, 608.2c; Struggle for Project Purity): or two sentences, "Each opponent draws a card. You draw a card for each card drawn this way." (family opponent-draws-you-draw-this-way)
  return { clauses: [plain(alt('each opponent draws a card, then you draw a card for each opponent who drew a card this way', 'each opponent draws a card. you draw a card for each card drawn this way'))], consumed: 2 };
}

/**
 * FAST4 T34: "you draw X cards and lose X life, where X is the number of colors of mana spent to cast ~" (CR 121.1, 119.3, 107.3, 608.2h): a draw and a loss of
 * life of the same computed amount by you, written with one X. Only you, nothing bound, no condition.
 */
function drawLoseWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'loseLife') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.who.ref !== 'you' || b.who.ref !== 'you') return null;
  if (!definedX(a.count) || JSON.stringify(a.count) !== JSON.stringify(b.amount)) return null;
  const text = `draw X cards and lose X life, where X is ${K.qty(a.count, st)}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * CMD5 (CR 608.2h, 107.3, 121.1, 119.3): "you draw X cards and you lose X life, where X is the number of Demons you control", "you gain X life and draw X cards,
 * where X is ...": X is determined once, as the effect is applied, so the value is fixed by a `let` before either instruction and both read it (a draw that
 * changes the count cannot change the life). Written with one X: the `let`, then a draw and a loss of life, or a gain of life and a draw, by you, of that value.
 * Nothing bound, no condition, and the value read by nothing after (family life-draw-where-x: the loss also reads "and you lose X life").
 */
function letLifeDrawWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [l, a, b] = [list[i], list[i + 1], list[i + 2]];
  if (l?.op !== 'let' || l.guard !== undefined || a === undefined || b === undefined) return null;
  const v = JSON.stringify({ q: 'var', name: l.name });
  const plainYou = (s: EffectStep): boolean => s.guard === undefined && s.as === undefined && 'who' in s && (s.who as { ref?: string }).ref === 'you';
  if (list.slice(i + 3).some((s) => JSON.stringify(s).includes(`"name":"${l.name}"`))) return null;
  // std-rx25 (CR 608.2h, 115.1): another single player the same way, "target player draws X cards and loses X life, where X is the number of cards in their
  // graveyard" (Eldritch Pact): both instructions by that one player, the quantity written while that player is the subject (so "their" is that player)
  const samePlayer = (s: EffectStep): boolean => s.guard === undefined && s.as === undefined && 'who' in s && JSON.stringify(s.who) === JSON.stringify((a as { who?: unknown }).who);
  if (!plainYou(a) && a.op === 'draw' && b.op === 'loseLife' && samePlayer(b) && JSON.stringify(a.count) === v && JSON.stringify(b.amount) === v
    && a.guard === undefined && a.as === undefined && (a.who.ref === 'target' || a.who.ref === 'each')) {
    return { clauses: [byPlayer(a.who, st, 'draw', () => `X cards and loses X life, where X is ${K.qty(l.value, st)}`)], consumed: 3 };
  }
  if (!plainYou(a) || !plainYou(b)) return null;
  const where = `where X is ${K.qty(l.value, st)}`;
  let text: string;
  if (a.op === 'draw' && b.op === 'loseLife' && JSON.stringify(a.count) === v && JSON.stringify(b.amount) === v) text = `draw X cards and ${alt('lose', 'you lose')} X life, ${where}`;
  else if (a.op === 'gainLife' && b.op === 'draw' && JSON.stringify(a.amount) === v && JSON.stringify(b.count) === v) text = `gain X life and draw X cards, ${where}`;
  else return null;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * FAST5 T65: "sacrifice any number of artifacts, enchantments, and/or tokens, then draw that many cards" (CR 701.21a, 121.1, 608.2c): you choose any number of
 * the permanents you control that are one of the listed kinds, sacrifice exactly those, then draw as many cards as were sacrificed (the step counts the permanents
 * it actually sacrificed, effects/handlers/zones-remove.ts). Only three kinds, you, nothing else in between, and the names used by nothing after.
 */
function sacrificeAnyThenDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  // edh-c-27 (CR 106.4, 608.2h; Mana Seism): the last instruction may instead add that much colored or colorless mana, "then add that much {C}"
  const mana = c?.op === 'addMana' && c.dynamic?.kind === 'ofType' && c.units === undefined && c.restriction === undefined && c.keep === undefined && c.rider === undefined && c.whenSpent === undefined && c.link === undefined && c.ofYourChoice === undefined;
  if (a?.op !== 'chooseObjects' || b?.op !== 'sacrifice' || (c?.op !== 'draw' && !mana) || a.as === undefined || b.as === undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || a.random === true || c.who.ref !== 'you' || !isBound(b.what, a.as)) return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || c.as !== undefined) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || from.controller !== 'you') return null;
  const keys = Object.keys(from).filter((k) => (from as Record<string, unknown>)[k] !== undefined).sort().join();
  // r4-fxz (CR 701.21a, 608.2c): also one description of what you control, "Sacrifice any number of permanents you control, then draw that many cards"
  const listed = keys === 'anyOf,controller' && from.anyOf?.length === 3;
  const single = keys === 'anyOf,controller' && from.anyOf?.length === 1 ? { ...from.anyOf[0]!, controller: from.controller } : null;
  if (!listed && single === null) return null;
  const thatMany = JSON.stringify(c.op === 'draw' ? c.count : c.op === 'addMana' && c.dynamic?.kind === 'ofType' ? c.dynamic.count : null);
  if (thatMany !== JSON.stringify({ q: 'resultCount', step: b.as })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`) || JSON.stringify(x).includes(`"${b.as}"`))) return null;
  const tail = c.op === 'addMana' && c.dynamic?.kind === 'ofType' ? `add that much {${String(c.dynamic.type).toLowerCase()}}` : 'draw that many cards';
  if (c.op === 'addMana' && listed) return null;
  const kinds = listed ? from.anyOf!.map((f) => K.np(f, st, { det: 'none', plural: true })) : [];
  const text = listed ? `sacrifice any number of ${kinds.slice(0, -1).join(', ')}, and/or ${kinds[kinds.length - 1]}, then ${tail}` : `sacrifice any number of ${alt(K.np(single!, st, { det: 'none', plural: true }), K.np(single!, st, { det: 'none', plural: true, noController: true }))}, then ${tail}`; // edh-zones-17 (family sacrifice-any-number-of-yours): "sacrifice any number of other permanents" (God-Eternal Bontu), what you sacrifice is always yours (CR 701.21a)
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * r4-fxz (CR 701.21a, 608.2d): "Sacrifice any number of artifacts, enchantments, and/or tokens." on its own (FAST5 T65's choice and sacrifice without the draw):
 * you choose any number of the permanents you control of the listed kinds and sacrifice exactly those; what the sacrifice did is "that many" for a later
 * instruction (the name of the sacrifice is kept, render/steps-zones.ts#sacrifice), the name of the choice is used by nothing after.
 */
function sacrificeAnyList(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b] = [list[i], list[i + 1]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'sacrifice' || a.as === undefined || a.guard !== undefined || b.guard !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || a.random === true || !isBound(b.what, a.as)) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || from.controller !== 'you' || Object.keys(from).filter((k) => (from as Record<string, unknown>)[k] !== undefined).sort().join() !== 'anyOf,controller' || (from.anyOf?.length ?? 0) < 2) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const kinds = from.anyOf!.map((f) => K.np(f, st, { det: 'none', plural: true }));
  const text = `sacrifice any number of ${kinds.length === 2 ? `${kinds[0]} and/or ${kinds[1]}` : `${kinds.slice(0, -1).join(', ')}, and/or ${kinds[kinds.length - 1]}`}`;
  if (b.as !== undefined) st.info.set(`r:${b.as}`, movedInfo('sacrificed', kinds));
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * FAST5 T65: "target player draws 2ˣ cards" (CR 107.3, 121.1, 608.2h): the number of cards is 2 raised to the power X, which the model builds from the steps that
 * double a value X times (the model has no power quantity): `let n = 1`, X times `let n = n * 2`, then the draw of n cards. Only that exact shape, a draw
 * of the whole value by one player, and the name used by nothing after.
 */
function drawTwoToTheX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'let' || b?.op !== 'repeat' || c?.op !== 'draw' || a.value !== 1 || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || c.as !== undefined) return null;
  if (JSON.stringify(b.times) !== JSON.stringify({ q: 'X' }) || b.do.length !== 1) return null;
  const d = b.do[0]!;
  const doubled = { q: 'math', op: '*', args: [{ q: 'var', name: a.name }, 2] };
  if (d.op !== 'let' || d.name !== a.name || d.guard !== undefined || JSON.stringify(d.value) !== JSON.stringify(doubled)) return null;
  if (JSON.stringify(c.count) !== JSON.stringify({ q: 'var', name: a.name })) return null;
  if (list.slice(i + 3).some((x) => JSON.stringify(x).includes(`"name":"${a.name}"`))) return null;
  return { clauses: [byPlayer(c.who, st, 'draw', '2ˣ cards')], consumed: 3 };
}

/**
 * FAST4 T26: "discard any number of cards" (CR 701.9a-b): the player chooses any number of cards in their own hand, then discards exactly those (the model
 * says it as a choice, then a discard of the chosen cards; effects/handlers/cards-draw.ts). Only you, from your whole hand, nothing else in between.
 */
function chooseThenDiscard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'discard' || a.as === undefined || a.random === true || a.guard !== undefined) return null;
  // FAST5 T56: "discard up to two cards, then draw that many cards": the same choice with a fixed upper bound (CR 701.9a, 608.2d)
  const upTo = typeof a.max === 'number' && a.max >= 1 ? a.max : null;
  // r3-choose (CR 701.9a-b, 608.2d): ... also another player, from their own hand: "Target player discards any number of cards, then draws that many cards" (Steal the Show)
  const other = a.who.ref !== 'you' && JSON.stringify(a.who) === JSON.stringify(b.who);
  if ((!other && (a.who.ref !== 'you' || b.who.ref !== 'you')) || (a.min !== 0 && !(a.min === 1 && a.max === 'any' && !other)) /* edh-d-59: "one or more" */ || (a.max !== 'any' && upTo === null) || b.mode !== undefined || b.guard !== undefined) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  // edh-c-98 (CR 701.9a, 205.2; Mind Maggots, eff.edhv98.discard.anyNumber.filter): "discard any number of creature cards": the same choice among the cards of one description
  const desc = from !== null && Object.keys(from).length === 3 && from.anyOf?.length === 1 && !other && Object.keys(from.anyOf[0]!).every((k) => k === 'types' || k === 'subtypes' || k === 'notTypes' || k === 'supertypes') ? from.anyOf[0]! : null;
  if (from === null || (desc === null && Object.keys(from).length !== 2) || from.zone !== 'hand' || (other ? JSON.stringify(from.owner) !== JSON.stringify(a.who) : from.owner !== 'you')) return null;
  const f = b.filter;
  if (f === undefined || Object.keys(f).length !== 1 || !(f.is !== undefined && isBound(f.is, a.as))) return null;
  const n = b.count;
  if (typeof n !== 'object' || n.q !== 'count' || !isBound(n.of, a.as)) return null;
  if (list.slice(i + 2).some((s) => JSON.stringify(s).includes(`"name":"${a.as}"`))) return null;
  if (desc !== null && upTo !== null) return null; // (a description with a fixed upper bound has no wording yet)
  if (a.min === 1 && desc === null) return null; // ("one or more" is read of a description of cards only, edh-d-59)
  const what = desc === null ? 'cards' : K.np({ ...desc, zone: 'hand' }, st, { det: 'none', plural: true, noZone: true });
  const c = byPlayer(b.who, st, 'discard', upTo === null ? (a.min === 1 ? `one or more ${what}` : `any number of ${what}`) : `up to ${upTo} ${upTo === 1 ? 'card' : what}`);
  bind(st, a.as, { nouns: ['card'], plural: true, optional: true });
  if (b.as !== undefined) st.info.set(`r:${b.as}`, { nouns: ['card'], plural: true, thisWay: 'discarded this way', moved: 'discarded' }); // Cloud C7: `moved`
  return { clauses: [c], consumed: 2 };
}

/**
 * Cloud C7 (CR 701.21a, 608.2d): "Sacrifice any number of permanents." (Renounce): the controller chooses any number of the permanents they control that match the
 * description as the ability resolves (no targets), then sacrifices exactly those; a named sacrifice reports what it sacrificed for a later "for each permanent
 * sacrificed this way" (render/moved.ts). Only one choice by "you" with min 0 and no maximum among `{controller: you, anyOf: [one description]}` (zz-cloud/c7.json,
 * eff.c7.sacrifice.anyNumber), then the sacrifice of exactly what was chosen; the choice is read by nothing after.
 */
function chooseThenSacrificeAny(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'sacrifice' || a.as === undefined || a.random === true || a.guard !== undefined || b.guard !== undefined) return null;
  // edh-players-23 (CR 701.21a, 608.2d; Swashbuckler Extraordinaire): at least one, "Sacrifice one or more Treasures" (zz-cloud/edh-players-23.json, eff.edhp23.sacrifice.oneOrMore)
  // edh-next-145 (CR 701.21a, 608.2d, 107.1c; Ravenous Rotbelly): or "Sacrifice up to three Zombies" (zz-cloud/edh-next-145.json, eff.edhn145.sacrifice.upTo): no fewer than none, a number at most
  const upTo = a.min === 0 && typeof a.max === 'number' && a.max >= 2 ? a.max : null;
  if (a.who.ref !== 'you' || (a.min !== 0 && a.min !== 1) || (a.max !== 'any' && upTo === null) || !isBound(b.what, a.as)) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (from === null || from.controller !== 'you' || from.anyOf?.length !== 1 || Object.keys(from).filter((k) => (from as Record<string, unknown>)[k] !== undefined).sort().join() !== 'anyOf,controller') return null;
  const f = from.anyOf[0]!;
  // trek-17 (CR 701.21a; Genesis Device): "lands you control" (the description names the sacrificing player's own permanents) is also "lands": a player sacrifices only what they control
  const yours = f.controller === 'you';
  if ((f.controller !== undefined && !yours) || (f.zone !== undefined && f.zone !== 'battlefield')) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  // edh-d-90 (CR 107.3, 608.2h; Campsite Cuisine; parser/lower/edhd90.ts): the sacrifice whose count is the X of the later sentences ("you may sacrifice X Foods") says that X for "any number of"
  const xWord = b.as === 'sacrificedX' && a.min === 0;
  const c = byPlayer({ ref: 'you' }, st, 'sacrifice', `${upTo !== null ? `up to ${numWord(upTo)}` : xWord ? 'x' : a.min === 1 ? 'one or more' : 'any number of'} ${yours ? alt(K.np(f, st, { det: 'none', plural: true }), K.np({ ...f, controller: undefined }, st, { det: 'none', plural: true })) : K.np(f, st, { det: 'none', plural: true })}`);
  if (b.as !== undefined) st.info.set(`r:${b.as}`, { ...movedInfo('sacrificed', K.nounsOf(f)), ...(xWord ? { xWord: true as const } : {}) });
  return { clauses: [c], consumed: 2 };
}

/**
 * FAST4 T30: "you and target opponent each draw a card" (CR 121.1, 608.2c): you draw, then the other player draws the same fixed number of cards; Oracle says
 * the two draws once with "each". Only two plain draws of one fixed number, you first, then one other player (never a group).
 */
function youAndPlayerEachDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'draw' || a.who.ref !== 'you' || b.who.ref === 'you' || b.who.ref === 'each' || UNFOLDING.has(a)) return null; // T20's unfolded reading is not folded again
  // edh-players-10 (CR 121.1, 608.2c; Xyris, the Writhing Storm): the same amount of the triggering event for both, "you and that player each draw that many cards"
  const eventAmount = typeof a.count === 'object' && a.count.q === 'eventAmount' && Object.keys(a.count).length === 1 && JSON.stringify(a.count) === JSON.stringify(b.count);
  if ((typeof a.count !== 'number' && !eventAmount) || (typeof a.count === 'number' && a.count !== b.count) || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const other = K.player(b.who, st, 'subject');
  if (other.person !== 'sg') return null;
  const what = eventAmount ? 'that many cards' : countedNoun(a.count as number, 'card', st);
  return { clauses: [acting('you', `you and ${other.text} each draw ${what}`, `you and ${other.text} each draw ${what}`)], consumed: 2 };
}

/**
 * std-rx18 (CR 111.2, 115.1, 101.4): "you and target opponent each create a Treasure token" (Bloodroot Apothecary): you create the tokens, then one other named
 * player creates the same tokens, said once with "each" (as FAST4 T30's draws). Only two plain creations of the same fixed number of the same token, you first,
 * then one other player (never a group); nothing bound or guarded, and your clause must start with the verb.
 */
function youAndPlayerEachCreate(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'createToken' || b?.op !== 'createToken' || a.who.ref !== 'you' || b.who.ref === 'you' || b.who.ref === 'each') return null;
  // edh-players-10 (CR 107.3, 111.2; Sylvan Offering): the same X for both, "you and that player each create X 1/1 green Elf Warrior creature tokens"
  if ((typeof a.count !== 'number' && !(typeof a.count === 'object' && a.count.q === 'X' && Object.keys(a.count).length === 1)) || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  const { who: _a, ...restA } = a;
  const { who: _b, ...restB } = b;
  if (JSON.stringify(restA) !== JSON.stringify(restB)) return null;
  const other = K.player(b.who, st, 'subject');
  if (other.person !== 'sg') return null;
  const mine = K.clause(a, st);
  if (!mine.imp.startsWith('create ') || mine.standalone === true) return null;
  const text = `you and ${other.text} each ${mine.imp}`;
  return { clauses: [acting('you', text, text)], consumed: 2 };
}

/**
 * FAST4 T30: "Mill four cards, then put up to two land cards from among them into your hand" (CR 701.17a, 701.17c, 608.2c): you mill, choose up to N of the
 * milled cards that match a description (they are in a public zone, so the binding follows them, CR 400.7j), and put the chosen cards into your hand. Only
 * that exact shape: one lone description beside the milled cards, a choice that may be empty, and the move of exactly the chosen cards.
 * FAST5 T71 (equivalence mill-pick-wording): also the choice of exactly one ("then put an instant or sorcery card from among them into your hand"), the optional
 * one ("then you may return a permanent card from among them to your hand"), "return up to two ... to your hand", and the card put on top of your library
 * ("then you may put a creature card from among the milled cards on top of your library").
 */
/** edh-zones-17: does a later step read the step name (the `did` of an optional mill)? */
const laterReadsDid = (list: EffectStep[], from: number, name: string): boolean => list.slice(from).some((x) => JSON.stringify(x).includes(`"step":"${name}"`) || JSON.stringify(x).includes(`"name":"${name}"`));

function millThenPutFromAmong(list: EffectStep[], i: number, st: RenderState): Folded | null {
  // edh-zones-17 (family may-mill-if-you-do-put; CR 608.2c, 701.17a; Barrowgoyf): "you may mill that many cards. If you do, you may put a creature card from among them into
  // your hand": the optional mill (a `may` of the controller around the mill alone) and an `if` on it whose only steps are the choice and the move
  const w = list[i];
  const iff = list[i + 1];
  const mayMill = w?.op === 'may' && iff?.op === 'if' && w.guard === undefined && iff.guard === undefined && w.as !== undefined && w.who.ref === 'you' && w.do.length === 1 && w.do[0]!.op === 'mill'
    && iff.else === undefined && iff.cond.cond === 'did' && iff.cond.step === w.as && Object.keys(iff.cond).length === 2 && iff.then.length === 2 && w.otherwise === undefined && w.anyOne === undefined && w.villainous === undefined && iff.intervening === undefined;
  const a = mayMill ? w.do[0] : list[i];
  const b = mayMill ? iff.then[0] : list[i + 1];
  const c = mayMill ? iff.then[1] : list[i + 2];
  const consumed = mayMill ? 2 : 3;
  if (a?.op !== 'mill' || b?.op !== 'chooseObjects' || c?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  const exactlyOne = b.min === 1 && b.max === 1;
  // std-rj (CR 701.17a, 608.2d): "any number of" (b.max 'any', min 0) is the choice of every card of the description the controller wants, and the mill may count the amount of
  // the triggering event ("you mill that many cards. You may put any number of legendary cards from among them into your hand", Nashi)
  const anyNumber = b.min === 0 && b.max === 'any';
  if (a.who.ref !== 'you' || b.who.ref !== 'you' || (b.min !== 0 && !exactlyOne) || (typeof b.max !== 'number' && !anyNumber) || b.random === true || !isBound(c.what, b.as) || c.until !== undefined) return null;
  // (FAST5 T75: the move may be named, for "if you put a Town card into your hand this way" reads what it did; no later step reads the cards it moved, below)
  const eventCount = typeof a.count === 'object' && a.count.q === 'eventAmount' && Object.keys(a.count).length === 1;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || (typeof a.count !== 'number' && !eventCount)) return null;
  if (anyNumber && c.to.zone !== 'hand') return null;
  const from = b.from.ref === 'each' && 'filter' in b.from ? b.from.filter : null;
  // CR 701.17c: a milled card is found in the public zone it moved to (`zone: 'any'` beside the binding)
  // edh-next-111 (family mill-pick-wording; CR 701.17a, 608.2c; Szarekh, the Silent King): two descriptions of cards, "an artifact creature card or Vehicle card", for the choice of at most one card into your hand
  const twoKinds = from?.anyOf?.length === 2 && b.min === 0 && b.max === 1 && c.to.zone === 'hand' && !anyNumber && !mayMill;
  if (from === null || Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || !isBound(from.is, a.as) || (from.anyOf?.length !== 1 && !twoKinds)) return null;
  const d = c.to;
  const toHand = d.zone === 'hand' && Object.keys(d).length === 1;
  const toTop = d.zone === 'library' && d.position === 'top' && Object.keys(d).length === 2;
  // std-sos (CR 110.2a, 701.17c): "Mill seven cards. Then put a creature card from among them onto the battlefield" (Bind to Life): the chosen card enters under your control
  const toBf = d.zone === 'battlefield' && Object.keys(d).length === 2 && d.controller !== undefined && typeof d.controller === 'object' && d.controller.ref === 'you';
  if (!toHand && !toTop && !toBf) return null;
  // edh-zones-24 (CR 110.2a, 701.17c; Vorinclex // The Grand Evolution): and up to N of them in a sentence of its own, "Mill ten cards. Put up to two creature cards from among the milled cards onto the battlefield."
  // (the player who puts a card onto the battlefield controls it unless the text says otherwise, so "under your control" adds nothing); no "any number of" onto the battlefield
  if (toBf && (anyNumber || (!exactlyOne && (b.max as number) < 2))) return null;
  // std-tla (CR 701.17a, 608.2c): a later step may still read the milled cards ("You gain 2 life if a Lesson card is milled this way"): they are named "milled this way"
  // (render/cond.ts#existsPhrase reads the key below); what was chosen and moved is never named again here
  const laterReadsMill = list.slice(i + consumed).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`));
  if (list.slice(i + consumed).some((x) => JSON.stringify(x).includes(`"name":"${b.as}"`) || (c.as !== undefined && JSON.stringify(x).includes(`"name":"${c.as}"`)))) return null;
  const f = { ...from.anyOf![0]!, zone: 'graveyard' as const };
  const kinds = from.anyOf ?? [];
  const upTo = twoKinds
    ? `up to one ${K.np({ ...kinds[0]!, zone: 'graveyard' as const }, st, { det: 'none', noZone: true })} or ${K.np({ ...kinds[1]!, zone: 'graveyard' as const }, st, { det: 'none', noZone: true })}`
    : K.np(f, st, { det: 'none', plural: b.max !== 1, count: anyNumber ? 'any number of' : `up to ${numWord(b.max as number)}`, noZone: true });
  const one = twoKinds
    ? `${K.np({ ...kinds[0]!, zone: 'graveyard' as const }, st, { det: 'a', noZone: true })} or ${K.np({ ...kinds[1]!, zone: 'graveyard' as const }, st, { det: 'none', noZone: true })}`
    : K.np(f, st, { det: 'a', noZone: true });
  const mill = `mill ${countedNoun(a.count, 'card', st)}, then`;
  // the cards leave the graveyard the mill put them in: "put ... into your hand" and "return ... to your hand" are one move (CR 400.3)
  const where = (among: string): string[] => (toHand
    ? [`put X ${among} into your hand`, `return X ${among} to your hand`]
    : toBf ? [`put X ${among} onto the battlefield`] : [`put X ${among} on top of your library`]);
  const texts: string[] = [];
  for (const among of ['from among them', 'from among the milled cards', 'from among the cards milled this way']) {
    for (const w of where(among)) {
      if (exactlyOne) texts.push(`${mill} ${w.replace('X', one)}`);
      else {
        texts.push(`${mill} ${w.replace('X', upTo)}`);
        if (b.max === 1) texts.push(`${mill} you may ${w.replace('X', one)}`);
      }
    }
  }
  // FAST5 T75: the two sentences Oracle also writes (Town Greeter, Scout the City): "Mill four cards. You may put a land card from among them into your hand."
  // ("them", "those cards" and "the milled cards" name the same cards, CR 608.2c)
  if (toBf && exactlyOne) for (const them of ['them', 'those cards', 'the milled cards']) texts.push(`mill ${countedNoun(a.count, 'card', st)}. then put ${one} from among ${them} onto the battlefield`);
  if (toBf && !exactlyOne) for (const them of ['them', 'those cards', 'the milled cards']) for (const may of ['you may ', '']) texts.push(`mill ${countedNoun(a.count, 'card', st)}. ${may}put ${upTo} from among ${them} onto the battlefield`);
  if (toHand && !exactlyOne && b.max === 1) for (const them of ['them', 'those cards', 'the milled cards']) texts.push(`mill ${countedNoun(a.count, 'card', st)}. you may put ${one} from among ${them} into your hand`);
  if (toHand && !exactlyOne && b.max === 1) for (const them of ['them', 'those cards', 'the milled cards', 'the cards milled this way']) texts.push(`mill ${countedNoun(a.count, 'card', st)}. you may put ${one} from among ${them} into your hand`);
  // r4-dig (family mill-pick-wording): several cards in a sentence of their own, "Mill four cards. You may put up to two creature and/or land cards from among the milled
  // cards into your hand." (an empty choice is allowed either way, so "you may" adds nothing)
  if (toHand && !exactlyOne && (anyNumber || (b.max as number) > 1)) for (const them of ['them', 'those cards', 'the milled cards']) for (const may of ['you may ', '']) texts.push(`mill ${countedNoun(a.count, 'card', st)}. ${may}put ${upTo} from among ${them} into your hand`);
  // std-tla (family mill-pick-milled-this-way): "Mill a card. You may put a land card milled this way into your hand." (the participle after the noun names the same cards)
  if (toHand && !exactlyOne && b.max === 1) texts.push(`mill ${countedNoun(a.count, 'card', st)}. you may put ${one} milled this way into your hand`);
  // edh-zones-4 (family mill-return-milled-this-way): the choice of exactly one, "Mill five cards, then return a creature card milled this way to your hand." (Zoological Study)
  if (toHand && exactlyOne) for (const w of ['return', 'put']) texts.push(`${mill} ${w} ${one} milled this way ${w === 'return' ? 'to' : 'into'} your hand`);
  // edh-next-25 (family mill-any-number-milled-this-way): any number of the milled cards, "Mill five cards, then put any number of creature cards milled this way into your hand." (Vivien on the Hunt)
  if (toHand && anyNumber) texts.push(`${mill} put ${upTo} milled this way into your hand`);
  // std-mana-2 (family mill-pick-up-to-one-milled): "Mill five cards. Put up to one enchantment card milled this way into your hand." (Terra, Magical Adept)
  if (toHand && !exactlyOne && b.max === 1) texts.push(`mill ${countedNoun(a.count, 'card', st)}. put ${upTo} milled this way into your hand`);
  // STD-OTJ (Patient Naturalist; CR 608.2c): the choice of exactly one, in a sentence of its own: "Mill three cards. Put a land card from among the milled cards into your hand."
  // Cloud std-woe (family mill-pick-wording): the same, also with "Then" (the joiner, CR 608.2c): "Mill four cards. Then put an instant, sorcery, or Faerie card from
  // among the milled cards into your hand." (one rule for both slices: the sentence without "Then" is STD-OTJ's reading); std-tla: "the cards milled this way" too
  if (toHand && exactlyOne) for (const them of ['them', 'those cards', 'the milled cards', 'the cards milled this way']) for (const then of ['then ', '']) texts.push(`mill ${countedNoun(a.count, 'card', st)}. ${then}put ${one} from among ${them} into your hand`);
  // edh-zones-17 (family may-mill-if-you-do-put): the optional mill and the optional pick, "you may mill that many cards. If you do, you may put a creature card from among them into your hand"
  if (mayMill) {
    if (!toHand || exactlyOne || b.max !== 1 || anyNumber || laterReadsDid(list, i + consumed, w.as!)) return null;
    texts.length = 0;
    for (const them of ['them', 'those cards', 'the milled cards']) for (const verb of ['put', 'return']) texts.push(`you may mill ${countedNoun(a.count, 'card', st)}. if you do, you may ${verb} ${one} from among ${them} ${verb === 'put' ? 'into' : 'to'} your hand`);
  }
  const text = alt(...texts);
  if (laterReadsMill) st.info.set(`${MILLED_KEY}${a.as}`, { nouns: ['card'], plural: true });
  if (mayMill) return { clauses: [plain(text, { standalone: true })], consumed };
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * FAST5 T61: "Mill six cards, then put all instant and sorcery cards from among them into your hand" (CR 701.17a, 701.17c, 608.2c): you mill, then every milled card
 * that matches a description (they are in a public zone, so the binding follows them, CR 400.7j) goes to your hand. No choice is made. Only that exact shape.
 */
function millThenPutAll(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'mill' || b?.op !== 'move' || a.as === undefined || a.who.ref !== 'you' || typeof a.count !== 'number') return null;
  if (a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.what.ref !== 'each' || !('filter' in b.what)) return null;
  const from = b.what.filter;
  // CR 701.17c: a milled card is found in the public zone it moved to (`zone: 'any'` beside the binding)
  if (Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || !isBound(from.is, a.as) || from.anyOf?.length !== 1) return null;
  const d = b.to;
  if (d.zone !== 'hand' || Object.keys(d).length !== 1) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const what = K.np({ ...from.anyOf[0]!, zone: 'graveyard' }, st, { det: 'all', plural: true, noZone: true });
  const mill = countedNoun(a.count, 'card', st);
  // r4-dig (family mill-pick-wording): also in a sentence of its own, "Mill seven cards. Then put all cards that have an Adventure from among the milled cards into
  // your hand." ("them", "those cards" and "the milled cards" name the same cards, CR 608.2c)
  const apart = ['them', 'those cards', 'the milled cards'].flatMap((them) => ['then ', ''].map((then) => `mill ${mill}. ${then}put ${what} from among ${them} into your hand`));
  const text = alt(`mill ${mill}, then put ${what} from among them into your hand`, ...apart);
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * CLOUD std-ecl (CR 701.17a, 701.17c, 608.2c, 400.3): "Target player mills five cards, then puts each Goblin card milled this way into their hand" (Grub's Command):
 * a player mills, then every milled card of a description goes to its owner's hand (the milling player's: the cards came from their own library). The model is
 * T61's (the mill named, then a move of the milled cards of the description that are still where the mill put them); only you or one target player mills.
 */
function millThenPutEachMilled(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'mill' || b?.op !== 'move' || a.as === undefined || typeof a.count !== 'number') return null;
  if (a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.until !== undefined || b.what.ref !== 'each' || !('filter' in b.what)) return null;
  const from = b.what.filter;
  if (Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || !isBound(from.is, a.as) || from.anyOf?.length !== 1) return null;
  if (b.to.zone !== 'hand' || Object.keys(b.to).length !== 1) return null;
  const you = a.who.ref === 'you';
  if (!you && !(a.who.ref === 'target' && st.specs.get(a.who.id)?.max === 1)) return null;
  if (list.slice(i + 2).some((x) => JSON.stringify(x).includes(`"name":"${a.as}"`))) return null;
  const count = a.count;
  const rest = (): string => `${countedNoun(count, 'card', st)}, then ${you ? 'put' : 'puts'} ${K.np({ ...from.anyOf![0]!, zone: 'graveyard' }, st, { det: 'each', noZone: true })} milled this way into ${you ? 'your' : 'their'} hand`;
  return { clauses: [byPlayer(a.who, st, 'mill', rest)], consumed: 2 };
}

/**
 * r4-fxb (CR 500.8, 505.1): "After this main phase, there are two additional combat phases." (Full Throttle): two added combat phases after the same main phase,
 * one step each (the engine adds them one at a time, and they happen one after the other). Exactly two such steps, nothing else.
 */
function twoExtraCombats(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'extraPhase' || b?.op !== 'extraPhase' || a.phase !== 'combat' || b.phase !== 'combat' || a.after !== 'main1' || b.after !== 'main1') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  return { clauses: [plain('after this main phase, there are two additional combat phases', { standalone: true })], consumed: 2 };
}

/**
 * FAST4 T28 (CR 122.1, 608.2c): two puts of counters written as one instruction: "put a +1/+1 counter and a trample counter on target creature" (two kinds on
 * one object), "put a +1/+1 counter on that creature and a +1/+1 counter on ~" (the same counters on two objects). The model keeps two `putCounters` steps of
 * one resolution (one batch of events for triggers, triggers/normalize.ts#splitBatches); the two steps written apart stay readings too, each from the same
 * state. Fixed numbers of counters on objects only (no player, no condition, no division, nothing bound).
 */
function twoPuts(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'putCounters' || b?.op !== 'putCounters') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (typeof a.count !== 'number' || typeof b.count !== 'number' || a.count < 1 || b.count < 1) return null;
  if (isPlayerRef(a.on as ObjRef | PlayerRef, st) || isPlayerRef(b.on as ObjRef | PlayerRef, st)) return null;
  if ([a.on, b.on].some((r) => r.ref === 'target' && st.specs.get(r.id)?.divide !== undefined)) return null;
  const same = JSON.stringify(a.on) === JSON.stringify(b.on);
  // r4-fxb (CR 122.1): on two objects the kinds may differ too, "put a +1/+1 counter on target creature you control and a plan counter on ~" (Claim the Kingdom)
  if (same && a.kind === b.kind) return null;
  const [elided, apart] = withVariants(st, [
    (v) => {
      const ca = countersText(a.count, a.kind, v);
      const cb = countersText(b.count, b.kind, v);
      if (same) return `put ${ca} and ${cb} on ${K.obj(a.on as ObjRef, v, 'object').text}`;
      const onA = K.obj(a.on as ObjRef, v, 'object').text;
      // edh-perms-9 (CR 115.1, 122.1; family each-of-targets-two-puts; Filigree Vector): several targets of one spec, "on each of any number of target creatures and a charge counter on
      // each of any number of target artifacts": "each of" says what the plural says
      const eachOf = (r: ObjRef, text: string): string => (r.ref === 'target' && (st.specs.get(r.id)?.max ?? 1) !== 1 ? alt(text, `each of ${text}`) : text);
      return `put ${ca} on ${eachOf(a.on as ObjRef, onA)} and ${cb} on ${eachOf(b.on as ObjRef, K.obj(b.on as ObjRef, v, 'object').text)}`;
    },
    (v) => `${fragment(K.clause(a, v))}${alt('. ', ' and ', ', then ', ', ', '. then ')}${fragment(K.clause(b, v))}`,
  ]);
  return { clauses: [plain(alt(elided!, apart!))], consumed: 2 };
}

/**
 * Cloud std-tdm (CR 122.1, 608.2c): three kinds of counters put on one object, written as one instruction with a serial comma: "put a +1/+1 counter, a reach
 * counter, and a deathtouch counter on target creature" (template eff.stdtdm.counters.put.threeKinds). As in `twoPuts`, the model keeps one `putCounters` step
 * per kind, all of one resolution. Fixed numbers of counters of three different kinds on one object only (no player, no condition, no division, nothing bound).
 * What the steps rendered before this fold stays a reading (`UNFOLDING`), so a text that writes them apart is read as before.
 */
function threePuts(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'putCounters' || b?.op !== 'putCounters' || c?.op !== 'putCounters' || UNFOLDING.has(a)) return null;
  const steps = [a, b, c];
  if (steps.some((s) => s.guard !== undefined || s.as !== undefined || typeof s.count !== 'number' || s.count < 1)) return null;
  if (isPlayerRef(a.on as ObjRef | PlayerRef, st) || (a.on.ref === 'target' && st.specs.get(a.on.id)?.divide !== undefined)) return null;
  const on = JSON.stringify(a.on);
  if (JSON.stringify(b.on) !== on || JSON.stringify(c.on) !== on || new Set([a.kind, b.kind, c.kind]).size !== 3) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative renders the same three steps: not through this fold again
    try { return K.steps(steps, v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [
    (v) => `put ${countersText(a.count, a.kind, v)}, ${countersText(b.count, b.kind, v)}, and ${countersText(c.count, c.kind, v)} on ${K.obj(a.on as ObjRef, v, 'object').text}`,
    unfold,
  ]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 3 };
}

/** The first step of a run of five `putCounters` steps being written apart (see `fivePuts`). */
const UNFOLDING_FIVE = new Set<EffectStep>();
/**
 * edh-combat-3 (CR 122.1, 608.2c; family five-counter-kinds, as three-counter-kinds): five kinds of counters put on one object, written as one instruction with a serial
 * comma: "put four +1/+1 counters, a flying counter, a vigilance counter, a trample counter, and a lifelink counter on that creature" (template
 * eff.edhcb3.counters.put.fourPlusFiveKinds). Exactly five steps, fixed numbers, five different kinds, one object; the steps written apart (the fold of three and
 * the fold of two) stay a reading.
 */
function fivePuts(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const steps = list.slice(i, i + 5);
  const a = steps[0];
  if (steps.length < 5 || a?.op !== 'putCounters' || UNFOLDING_FIVE.has(a)) return null;
  const puts: Extract<EffectStep, { op: 'putCounters' }>[] = [];
  for (const x of steps) if (x.op === 'putCounters') puts.push(x);
  if (puts.length !== 5 || puts.some((x) => x.guard !== undefined || x.as !== undefined || typeof x.count !== 'number' || x.count < 1)) return null;
  if (isPlayerRef(a.on as ObjRef | PlayerRef, st) || (a.on.ref === 'target' && st.specs.get(a.on.id)?.divide !== undefined)) return null;
  const on = JSON.stringify(a.on);
  if (puts.some((x) => JSON.stringify(x.on) !== on) || new Set(puts.map((x) => x.kind)).size !== 5) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING_FIVE.add(a);
    try { return K.steps(steps, v); } finally { UNFOLDING_FIVE.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [
    (v) => `put ${puts.slice(0, 4).map((x) => countersText(x.count as number, x.kind, v)).join(', ')}, and ${countersText(puts[4]!.count as number, puts[4]!.kind, v)} on ${K.obj(a.on as ObjRef, v, 'object').text}`,
    unfold,
  ]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 5 };
}

/**
 * T20 (FAST4): "tap target creature and put a stun counter on it": a tap, then counters on the SAME single object, as one coordinated clause whose "it" is
 * the object just tapped (the idiom fixes the antecedent, so another thing the ability names, a trigger's land or the source, is no candidate there;
 * CR 701.26a, 122.6). The unfolded rendering stays an alternative, so the fold only adds a wording.
 */
function tapThenCounters(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'tap' || b?.op !== 'putCounters' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined) return null;
  if (JSON.stringify(a.what) !== JSON.stringify(b.on) || b.kind === 'energy') return null;
  // STD-FRA: one target for each opponent is a set, not "the same single object" (CR 115.1, 601.2c)
  const one = a.what.ref === 'target' ? st.specs.get(a.what.id)?.max === 1 && st.specs.get(a.what.id)?.perOpponent !== true && st.specs.get(a.what.id)?.perPlayer !== true : a.what.ref === 'self';
  if (!one || UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [
    (v) => `tap ${K.obj(a.what, v, 'object').text} and put ${countersText(b.count, b.kind, v)} on it`,
    unfold,
  ]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}
const UNFOLDING = new WeakSet<EffectStep>();

/**
 * Cloud C3 (CR 701.26a, 502.3, 611.2a): "tap that creature and it doesn't untap during its controller's next untap step", "tap up to two target creatures and
 * they don't untap during their controllers' next untap steps": a tap, then the restriction through the next untap step on the SAME object(s), as one coordinated
 * clause whose pronoun is what was just tapped (the idiom fixes the antecedent, as T20's "and put a stun counter on it"). Each object's own controller's step
 * only (no `whose`). The unfolded rendering stays an alternative, so the fold only adds a wording.
 */
function tapThenFreeze(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'tap' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || UNFOLDING.has(a)) return null;
  if (b.duration?.d !== 'throughNextUntap' || b.duration.whose !== undefined || b.effects.length !== 1) return null;
  const r = b.effects[0]!;
  if (r.s !== 'restrict' || r.mode !== 'cant' || r.action !== 'untapDuringUntapStep' || r.other !== undefined || r.max !== undefined || r.when !== undefined) return null;
  if (JSON.stringify(a.what) !== JSON.stringify(r.subject)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [
    (v) => {
      const o = K.obj(a.what, v, 'object');
      const tail = o.plural ? `they don't untap during ${alt("their controllers' next untap steps", "their controller's next untap step")}` : "it doesn't untap during its controller's next untap step";
      return `tap ${o.text} and ${tail}`;
    },
    unfold,
  ]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * Standard round 4, r4-trig (CR 108.4, 613.1b, 701.26b; Contested Game Ball): "the attacking player gains control of ~ and untaps it": a player other than you gains
 * control of one object for good, then that object is untapped; the second verb takes the first one's subject. The two sentences stay a reading (family
 * gain-control-and-untap; parser/templates/zz-cloud/r4-trig.json).
 */
function gainControlThenUntap(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'untap' || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || UNFOLDING.has(a)) return null;
  if (a.duration?.d !== 'permanent' || a.effects.length !== 1) return null;
  const e = a.effects[0]!;
  if (e.s !== 'continuous' || e.mods.length !== 1 || e.mods[0]!.layer !== 2 || JSON.stringify(e.affects) !== JSON.stringify(b.what)) return null;
  const control = e.mods[0] as { layer: 2; controller: PlayerRef };
  if (control.controller.ref === 'you' || control.controller.ref === 'ownerOf') return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [
    (v) => {
      const who = K.player(control.controller, v, 'subject');
      if (who.person !== 'sg') throw new NoRenderer('a plural or second-person new controller');
      return `${who.text} gains control of ${K.obj(b.what, v, 'object').text} and untaps it`;
    },
    unfold,
  ]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * T20 (FAST4): "Untap up to two lands": the controller chooses up to N permanents as the ability resolves (no targets, CR 608.2d), then untaps the chosen
 * ones (CR 701.26b). Only one choice by "you" among every permanent of a filter, min 0 and a numeric maximum, then exactly an untap of what was chosen.
 */
function chooseThenUntap(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'untap' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  // edh-d-46 (CR 701.26b, 608.2d, 107.3; Shriekwood Devourer): a computed maximum, "untap up to X lands, where X is the greatest power among those creatures" (only a quantity of the greatest statistic of a group the trigger saw)
  if (a.who.ref === 'you' && a.min === 0 && typeof a.max === 'object' && a.max.q === 'stat' && a.max.agg === 'max' && a.max.of.ref === 'event' && isBound(b.what, a.as) && a.from.ref === 'each' && 'filter' in a.from && (a.from.filter.zone === undefined || a.from.filter.zone === 'battlefield') && !UNFOLDING.has(a)) {
    const filter = a.from.filter;
    const text = `untap up to x ${K.np(filter, st, { det: 'none', plural: true })}, where x is ${K.qty(a.max, st)}`;
    bind(st, a.as, { nouns: K.nounsOf(filter), plural: true, optional: true });
    return { clauses: [plain(text)], consumed: 2 };
  }
  // edh-top-10 (CR 701.26b, 608.2d; White Plume Adventurer): "Untap a creature you control." is the choice of exactly one (min 1, max 1)
  const exactlyOne = a.min === 1 && a.max === 1;
  if (a.who.ref !== 'you' || !(exactlyOne || (a.min === 0 && typeof a.max === 'number' && a.max >= 1)) || !isBound(b.what, a.as)) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  const rw = exactlyOne ? { count: '1', plural: false } : rangeWords(a.min, a.max, st);
  if (rw.count === undefined || UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative ("choose up to two lands. untap them.") renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  // edh-b-7 (family imperative-or-you; Time Spiral): "You untap up to six lands." says the controller's own choice with the subject (1 new alt site)
  const [folded, unfolded] = withVariants(st, [(v) => `${exactlyOne ? 'untap' : alt('untap', 'you untap')} ${exactlyOne ? K.np(fromFilter, v, { det: 'a' }) : K.np(fromFilter, v, { det: 'none', plural: rw.plural, count: rw.count })}`, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(fromFilter), plural: rw.plural, optional: true });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * r3-refs (CR 608.2d, 122.1, 115.10): "Put three +1/+1 counters on a Cave you control. It becomes ...": the controller chooses one permanent of the description as the
 * ability resolves (no target), then puts the counters on it; a later sentence names the chosen one. Only one choice by "you" of exactly one permanent of a
 * description on the battlefield, then exactly the counters on what was chosen. The two steps said apart ("Choose a Cave you control. Put three +1/+1 counters on
 * it.") stay a reading (`UNFOLDING`).
 */
function chooseThenCounters(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'putCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.groupLimit !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.perPlayer !== undefined || !isBound(b.on as ObjRef, a.as) || UNFOLDING.has(a)) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  // edh-perms-18 (CR 107.3, 608.2h; Astarion's Thirst): a computed amount is also "put X +1/+1 counters on a commander creature you control, where X is ..." (as putCountersClause says it)
  const whereX = typeof b.count === 'object' && b.count.q !== 'X' && b.kind !== 'any';
  const [folded, unfolded] = withVariants(st, [(v) => {
    const main = `put ${countersText(b.count, b.kind, v)} on ${K.np(fromFilter, v, { det: 'a' })}`;
    return whereX ? alt(main, `put X ${pluralize(`${b.kind} counter`)} on ${K.np(fromFilter, v, { det: 'a' })}, where X is ${K.qty(b.count, v)}`) : main;
  }, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(fromFilter), plural: false });
  // edh-players-17 (CR 608.2c): the controller is the actor, so after another player's clause the subject is said ("that attacking player draws a card and you put two +1/+1 counters on a creature you control")
  const said = alt(folded!, unfolded!);
  return { clauses: [acting('you', said, `you ${said}`)], consumed: 2 };
}

/**
 * std-rx14 (CR 122.1, 608.2c-d; Garnet, Princess of Alexandria): "remove a lore counter from each of any number of Sagas you control": the controller chooses any number
 * of the permanents of a description as the ability resolves (no target; none is a choice too), then removes one counter of that kind from each chosen one. Only that
 * choice by "you" among permanents on the battlefield, then exactly one counter of a named kind from what was chosen, and nothing after it reads the choice.
 */
function chooseAnyThenRemoveCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'removeCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || !isBound(b.from as ObjRef, a.as) || b.count !== 1 || b.kind === 'any' || b.upTo === true || !unread(list, i + 2, a.as)) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  if (b.as !== undefined) bind(st, b.as, { nouns: K.nounsOf(fromFilter), plural: true });
  // edh-next-136 (CR 608.2c, 122.1; Chandra, Legacy of Fire): what the removal did is a number a later instruction reads, "Exile that many cards from the top of your library" (the counters removed)
  if (b.as !== undefined) st.info.set(`r:${b.as}`, { nouns: [`${b.kind} counter`], plural: true, thisWay: 'removed this way' });
  return { clauses: [plain(`remove ${countersText(1, b.kind, st)} from each of any number of ${K.np(fromFilter, st, { det: 'none', plural: true })}`)], consumed: 2 };
}

/**
 * std-rx14 (CR 406.3, 400.7, 608.2c-d; Fortune, Loyal Steed): "exile it and up to one creature that saddled it this turn, then return those cards to the battlefield
 * under their owner's control": the controller chooses zero or one permanent of a description as the ability resolves (no target), then the object named and the
 * chosen one are exiled together, then exactly what that exile exiled returns under its owner's control (each card a new object, CR 400.7). Only that shape, and
 * nothing after it reads the choice or the exile.
 */
function flickerObjAndUpToOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || c.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.random === true || a.groupLimit !== undefined || a.perPlayer !== undefined || a.as === undefined || b.as === undefined) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  const w = b.what as ObjRef;
  if (w.ref !== 'union' || w.of.length !== 2 || !isBound(w.of[1]!, a.as) || w.of[0]!.ref === 'each') return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'exile' }) || Object.keys(b).some((k) => !['op', 'what', 'to', 'as'].includes(k))) return null;
  if (!isBound(c.what, b.as) || JSON.stringify(c.to) !== JSON.stringify({ zone: 'battlefield', controller: 'owner' }) || Object.keys(c).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  if (!unread(list, i + 3, a.as) || !unread(list, i + 3, b.as)) return null;
  const first = K.obj(w.of[0]!, st, 'object').text;
  const text = `exile ${first} and up to one ${K.np(fromFilter, st, { det: 'none' })}, then return those cards to the battlefield under their owner's control`;
  return { clauses: [acting('you', text, text)], consumed: 3 };
}

/**
 * std-mkm (CR 701.60a, 608.2c-d): "suspect one of them", "you may suspect one of the other creatures" (Frantic Scapegoat): the controller chooses exactly one of a
 * group named before (the creatures of a "one or more" trigger) as the ability resolves, no target, then suspects the chosen one. Only one choice by "you" of exactly
 * one object of a plural reference, then exactly the suspect action of what was chosen, and nothing after it reads the choice.
 */
function chooseOneThenSuspect(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'action' || b.action !== 'suspect' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || b.subject === undefined || !isBound(b.subject as ObjRef, a.as) || b.who.ref !== 'you') return null;
  if (Object.keys(b).some((k) => !['op', 'action', 'who', 'subject'].includes(k)) || !unread(list, i + 2, a.as)) return null;
  // the optional form ("you may suspect one of them. If you do, ...") chooses among the ones that aren't suspected: a suspected permanent can't become suspected again
  // (CR 701.60d), so choosing one would do nothing and "if you do" would not hold (CR 608.2c); the same choice for the player
  const from = a.from.ref === 'each' && 'filter' in a.from && Object.keys(a.from.filter).length === 2 && a.from.filter.suspected === false && a.from.filter.is !== undefined ? a.from.filter.is : a.from;
  if (from.ref === 'each') return null;
  const them = K.obj(from, st, 'object');
  if (!them.plural) return null;
  // "the other creatures": the creatures of a "one or more other creatures" trigger (parser/holes/object.ts#pluralPronouns), the source not among them
  const trig = st.trigger ?? [];
  const others = from.ref === 'event' && from.role === 'subject' && trig.length === 1 && trig[0]!.ev === 'zoneChange' && trig[0]!.subject.other === true
    && JSON.stringify(trig[0]!.subject.types) === '["Creature"]';
  const group = others ? alt(them.text, 'the other creatures') : them.text;
  bind(st, a.as, { nouns: ['creature'], plural: false });
  return { clauses: [acting('you', `suspect one of ${group}`, `you suspect one of ${group}`)], consumed: 2 };
}

/**
 * r4-fxb (CR 608.2c-d, 122.1): "Tap up to three target creatures. Put a stun counter on one of them." (Aerith Rescue Mission): the controller chooses exactly one object
 * of a group named before (the targets of a plural spec, or a group an earlier step bound) as the ability resolves, no target, then puts one counter of a kind on the
 * chosen one. Only one choice by "you" of exactly one object of that plural reference, then exactly one counter on what was chosen, and nothing after it reads the choice.
 */
function chooseOneThenCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'putCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined || !isBound(b.on as ObjRef, a.as) || b.count !== 1) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || Object.keys(a.from.filter).length !== 1 || a.from.filter.is === undefined || !unread(list, i + 2, a.as)) return null;
  const from = a.from.filter.is;
  if (from.ref === 'each') return null;
  const them = K.obj(from, st, 'object');
  if (!them.plural) return null;
  bind(st, a.as, { nouns: K.nounsOf({}), plural: false });
  // edh-d-59 (CR 608.2c-d; Call of the Death-Dweller): of a group of exactly two, Oracle says "either of them" (the template eff.edhd59.counter.eitherOfThem reads it as one of them)
  return { clauses: [plain(`put ${countersText(1, b.kind, st)} on ${alt(`one of ${them.text}`, 'either of them')}`)], consumed: 2 };
}

/**
 * std-rj (CR 707.2, 111.1, 608.2c-d): "create a token that's a copy of one of them" (Twilight Diviner): the controller chooses exactly one object of a group named
 * before (the creatures of a "one or more" trigger) as the ability resolves, no target, then creates a token copy of the chosen one. Only one choice by "you" of
 * exactly one object of that plural reference, then exactly one token copy of what was chosen made by you, and nothing after it reads the choice.
 */
function chooseOneThenCopyToken(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'copy' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined || !isBound(b.what as ObjRef, a.as)) return null;
  // edh-next-122 (CR 707.9b; Benthic Anomaly): with the copy's exceptions too, "..., except its power is equal to the total power of those creatures, ..." (render/copy-except.ts#computedPtColorlessText)
  if (b.result !== 'token' || b.who.ref !== 'you' || Object.keys(b).some((k) => !['op', 'what', 'result', 'who', 'except'].includes(k)) || !unread(list, i + 2, a.as)) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from) || Object.keys(a.from.filter).length !== 1 || a.from.filter.is === undefined) return null;
  const from = a.from.filter.is;
  // edh-next-132 (CR 115.9b, 603.4; Orvar, the All-Form): a group of the objects the cast spell targets (`targetedBy`, "one of those permanents") is a group named before too
  if (from.ref === 'each' && !('filter' in from && from.filter.targetedBy !== undefined)) return null;
  const them = K.obj(from, st, 'object');
  if (!them.plural) return null;
  let exc = '';
  if (b.except !== undefined) {
    // "one of those creatures" (the group named before) with the copy's exceptions
    if (b.except.length === 0) return null;
    let listed: string | null;
    try {
      listed = computedPtColorlessText(b.except, (q) => K.qty(q as Quantity, st)) ?? copyExceptText(b.except, () => { throw new NoRenderer('no general wording'); });
    } catch (e) {
      if (e instanceof NoRenderer) return null;
      throw e;
    }
    if (listed === null) return null;
    exc = `, except ${listed}`;
  }
  bind(st, a.as, { nouns: ['creature'], plural: false });
  return { clauses: [plain(`create a token that's a copy of one of ${them.text}${exc}`)], consumed: 2 };
}

/**
 * edh-perms-21 (CR 707.2, 111.2, 608.2d; template eff.edhpm21.copyToken.ofOneYouControl, Calix, Guided by Fate): "create a token that's a copy of a nonlegendary enchantment you control":
 * the controller chooses exactly one object of a description as the ability resolves (no target), then creates a token copy of it; also said as the two sentences the same steps
 * are for "Choose an artifact or creature you control. Create a token that's a copy of it." (the unfolded reading). Only the two steps, a description of the battlefield with no
 * `is`, nothing after them reading the choice.
 */
function chooseOneCopyToken(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'copy' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.link !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined || !isBound(b.what as ObjRef, a.as) || UNFOLDING.has(a)) return null;
  if (b.result !== 'token' || b.who.ref !== 'you' || Object.keys(b).some((k) => !['op', 'what', 'result', 'who'].includes(k)) || !unread(list, i + 2, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || f.is !== undefined || (f.zone !== undefined && f.zone !== 'battlefield')) return null;
  const { zone: _z, ...desc } = f;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => `create a token that's a copy of ${K.np(desc, v, { det: 'a' })}`, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(desc), plural: false });
  return { clauses: [plain(alt(folded!, unfolded!), { standalone: true })], consumed: 2 };
}

/**
 * std-mkm (CR 708.8, 608.2d): "You may turn a creature you control face up." (Bustle): the controller chooses one permanent of a filter as the ability resolves (no
 * target), then turns the chosen one face up (a face-up permanent stays as it is, so choosing one does nothing). Only one choice by "you" of exactly one permanent
 * on the battlefield, then exactly a face-up turn of what was chosen.
 */
function chooseThenTurnFaceUp(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'changeFace' || b.to !== 'faceUp' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || !isBound(b.what, a.as) || Object.keys(b).some((k) => !['op', 'what', 'to'].includes(k))) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield') || UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => `turn ${K.np(fromFilter, v, { det: 'a' })} face up`, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(fromFilter), plural: false });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * FAST5 T78 (CR 701.26a, 608.2d): "Tap any number of untapped creatures you control." (Orphans of the Wheat): the controller chooses any number of the untapped permanents
 * of a filter as the ability resolves (no targets), then taps exactly the chosen ones; the tap step is named so that a later "for each creature tapped this way" counts the
 * creatures it actually tapped (its `resultCount`, effects/handlers/zones-status.ts). Only one choice by "you", min 0 and no maximum, then exactly a named tap of what was chosen.
 */
function chooseThenTapAny(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'tap' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as === undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || !isBound(b.what, a.as)) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || fromFilter.tapped !== false || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  const rw = rangeWords(a.min, a.max, st);
  if (rw.count === undefined || UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  // edh-c-33 (CR 701.26a, 608.2d; Siege Striker; family tap-any-number-may): "you may tap any number of untapped creatures you control" is the same choice (a choice of any number includes none)
  const [folded, unfolded] = withVariants(st, [(v) => { const t = `tap ${K.np(fromFilter, v, { det: 'none', plural: rw.plural, count: rw.count })}`; return alt(t, `you may ${t}`); }, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(fromFilter), plural: rw.plural, optional: true });
  st.info.set(`r:${b.as}`, { nouns: K.nounsOf(fromFilter), plural: true, thisWay: 'tapped this way' });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * r4-fxb (CR 107.3, 608.2h): "Put X +1/+1 counters on each of them and you gain X life, where X is the number of colors of mana spent to cast this spell." (Snarl
 * Song): one computed value, read once, as the number of counters put on each object of a group named before and the life you gain. Only those two steps, the
 * same computed quantity in both, the group a reference to objects named earlier, nothing guarded or named.
 */
function countersAndLifeWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'putCounters' || b?.op !== 'gainLife' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (b.who.ref !== 'you' || typeof a.count !== 'object' || !isComputed(a.count) || JSON.stringify(a.count) !== JSON.stringify(b.amount)) return null;
  if (isPlayerRef(a.on as ObjRef | PlayerRef, st) || a.on.ref === 'each') return null;
  const group = K.obj(a.on as ObjRef, st, 'object');
  if (!group.plural) return null;
  const x = K.qty(a.count, st);
  return { clauses: [plain(`put ${countersText({ q: 'X' }, a.kind, st)} on each of ${group.text} and you gain X life, where X is ${x}`)], consumed: 2 };
}

/**
 * r4-fxb (CR 122.1, 608.2d): "Remove a counter from a creature you control. If you do, draw a card." (Mister Hyde): the controller chooses one permanent of the
 * description that has a counter, then removes one counter of a kind of their choice from it; the removal is named, so "if you do" reads whether a counter was
 * removed. Only one choice by "you" of exactly one, the description plus "a counter of any kind", then one counter of any kind from exactly the chosen one.
 */
function chooseThenRemoveAnyCounter(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'removeCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.upTo === true || a.groupLimit !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || !isBound(b.from as ObjRef, a.as) || b.count !== 1 || b.kind !== 'any') return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  const keys = from === null ? [] : Object.keys(from).filter((k) => (from as Record<string, unknown>)[k] !== undefined).sort();
  if (from === null || keys.join() !== 'anyOf,controller,counters' || from.anyOf?.length !== 1 || from.controller !== 'you' || from.counters?.kind !== 'any' || from.counters.cmp !== undefined) return null;
  if (!unread(list, i + 2, a.as)) return null;
  const inner = { ...from.anyOf[0]!, controller: 'you' as const };
  bind(st, a.as, { nouns: K.nounsOf(inner), plural: false });
  if (b.as !== undefined) st.info.set(`b:${b.as}`, { nouns: ['counter'], plural: false, actor: 'you' });
  return { clauses: [plain(`remove a counter from ${K.np(inner, st, { det: 'a' })}`)], consumed: 2 };
}

/**
 * FAST5 T78 (CR 122.1, 608.2d): "remove a +1/+1 counter from each of two creatures you control" (Dyadrine): the controller chooses exactly N of the permanents that
 * have a counter of that kind, then one counter of that kind is removed from each. Only one choice by "you" of exactly N (two or more), the filter plus the counter, then
 * a removal of a fixed number of counters of that kind from exactly the chosen ones.
 */
function chooseThenRemoveFromEach(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'removeCounters' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.upTo === true || a.groupLimit !== undefined) return null;
  if (a.who.ref !== 'you' || typeof a.min !== 'number' || a.min < 2 || a.min !== a.max || !isBound(b.from as ObjRef, a.as) || typeof b.count !== 'number' || b.kind === 'any') return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  const keys = from === null ? [] : Object.keys(from).filter((k) => (from as Record<string, unknown>)[k] !== undefined).sort();
  if (from === null || keys.join() !== 'anyOf,counters' || from.anyOf?.length !== 1 || from.counters?.kind !== b.kind || from.counters.cmp !== undefined) return null;
  const inner = from.anyOf[0]!;
  const count = numWord(a.min);
  if (UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => `remove ${countersText(b.count as number, b.kind, v)} from each of ${K.np(inner, v, { det: 'none', plural: true, count })}`, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(inner), plural: true, optional: false });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * Cloud std-fin (CR 701.8a, 608.2d): "Destroy up to one Equipment attached to that creature." (Light of Judgment): the controller chooses up to N permanents as the
 * ability resolves (no targets), then destroys exactly the chosen ones; the same idiom as "untap up to two lands" above. Only one choice by "you" among every
 * permanent of a filter, min 0 and a numeric maximum, then exactly a destroy of what was chosen (no regeneration rider, nothing named).
 */
function chooseThenDestroy(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'destroy' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.regeneration !== undefined || a.groupLimit !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || typeof a.max !== 'number' || a.max < 1 || !isBound(b.what, a.as)) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  const rw = rangeWords(a.min, a.max, st);
  if (rw.count === undefined || UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative ("choose up to one Equipment ... destroy that Equipment.") renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [(v) => `destroy ${K.np(fromFilter, v, { det: 'none', plural: rw.plural, count: rw.count })}`, unfold]);
  bind(st, a.as, { nouns: K.nounsOf(fromFilter), plural: rw.plural, optional: true });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * Cloud std-fin (CR 701.3a, 608.2d): "attach any number of Equipment you control to target creature you control" (Beatrix, Loyal General) and "attach an Equipment you
 * control to that creature" (Unexpected Request): the controller chooses any number of, or exactly one of, the permanents of a filter as the ability resolves (no
 * targets), then attaches exactly the chosen ones to one object (effects/handlers/zones-status.ts#attach attaches each). Only one choice by "you" among every permanent of
 * a filter, then exactly an attach of what was chosen to something else.
 */
function chooseThenAttach(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'attach' || b.to === null || a.random === true || a.guard !== undefined || b.guard !== undefined || a.groupLimit !== undefined) return null;
  const any = a.min === 0 && a.max === 'any';
  // Standard round 5, r5-trig (CR 701.3a, 608.2d; Sidequest: Play Blitzball): the other way round, "attach it to a creature you control": one object the ability names
  // is attached to the one permanent chosen (zz-cloud/r5-trig.json eff.r5trig.attachToChosen)
  const toChosen = a.min === 1 && a.max === 1 && isBound(b.to as ObjRef, a.as) && !isBound(b.what, a.as);
  // edh-d-71 (CR 701.3a, 608.2c; Breath of Fury): "sacrifice it and attach this Aura to a creature you control. If you do, ...": the name the attach gets for the "if you do" (`did`) is no
  // word of the sentence; only that form of the fold (the render gate still compares the whole text)
  if (b.as !== undefined && !toChosen) return null;
  if (a.who.ref !== 'you' || !(any || (a.min === 1 && a.max === 1)) || (!toChosen && (!isBound(b.what, a.as) || isBound(b.to as ObjRef, a.as)))) return null;
  const fromFilter = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (fromFilter === null || (fromFilter.zone !== undefined && fromFilter.zone !== 'battlefield')) return null;
  const rw = rangeWords(a.min, a.max, st);
  if (UNFOLDING.has(a)) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a); // the unfolded alternative ("choose an Equipment you control. Attach it to that creature.") renders the same two steps: not through this fold again
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const what = (v: RenderState): string => K.np(fromFilter, v, rw.count === undefined ? { det: 'a' } : { det: 'none', plural: rw.plural, count: rw.count });
  // edh-d-29 (CR 601.7a; Lynde, Cheerful Tormentor): the Aura attached to one of your opponents, an opponent the controller picks as the step resolves
  const dest = (v: RenderState): string => (b.to !== null && b.to.ref === 'anOpponent' ? 'one of your opponents' : K.obj(b.to as ObjRef, v, 'object').text);
  const [folded, unfolded] = withVariants(st, [(v) => (toChosen ? `attach ${K.obj(b.what, v, 'object').text} to ${what(v)}` : `attach ${what(v)} to ${dest(v)}`), unfold]);
  bind(st, a.as, { nouns: K.nounsOf(fromFilter), plural: rw.plural, optional: any });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * edh-top-15 (CR 701.3d, 608.2c, 608.2d; Akiri, Fearless Voyager): "unattach an Equipment from a creature you control": the controller chooses one Equipment attached to a creature
 * they control as the ability resolves (no target), then it is unattached, and the creature it was attached to is "that creature" afterwards (the attach step's `hostAs`,
 * effects/handlers/zones-status.ts#attach). Only that one description: the choice by "you" of exactly one, then exactly the unattach of what was chosen.
 */
function chooseThenUnattachFrom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'attach' || b.to !== null || typeof b.hostAs !== 'string' || a.random === true || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || a.groupLimit !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || !isBound(b.what, a.as) || b.asCreature === true || UNFOLDING.has(a)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).sort().join() !== 'attachedToObject,subtypes' || f.subtypes?.length !== 1 || f.subtypes[0] !== 'Equipment') return null;
  const host = f.attachedToObject;
  if (host === undefined || host.ref !== 'each' || !('filter' in host) || JSON.stringify(host.filter) !== JSON.stringify({ types: ['Creature'], controller: 'you' })) return null;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [() => 'unattach an Equipment from a creature you control', unfold]);
  bind(st, a.as, { nouns: ['equipment', 'artifact', 'permanent'], plural: false, optional: false });
  bind(st, b.hostAs, { nouns: ['creature', 'permanent'], plural: false, optional: false });
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * T20 (FAST4): "You and target opponent each draw three cards": the controller draws, then one other named player draws the same number (CR 121.1, 101.4).
 * Only a fixed number and one player who is not "you" (a target player, "that player"); the unfolded rendering stays an alternative.
 */
function youAndPlayerDraw(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'draw' || b?.op !== 'draw' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  if (a.who.ref !== 'you' || typeof a.count !== 'number' || a.count !== b.count || UNFOLDING.has(a)) return null;
  if (b.who.ref !== 'target' && b.who.ref !== 'event' && b.who.ref !== 'controllerOf') return null;
  const count = a.count;
  const unfold = (v: RenderState): string => {
    UNFOLDING.add(a);
    try { return K.steps([a, b], v); } finally { UNFOLDING.delete(a); }
  };
  const [folded, unfolded] = withVariants(st, [
    (v) => `you and ${K.player(b.who, v, 'object').text} each draw ${count === 1 ? 'a card' : `${numWord(count)} cards`}`,
    unfold,
  ]);
  return { clauses: [plain(alt(folded!, unfolded!))], consumed: 2 };
}

/**
 * FAST4 T33: "~ gets +1/+0 until end of turn and deals 1 damage to you" (CR 611.2a, 120.3, 608.2c): a P/T change of the object itself for a duration, then
 * damage the object deals to you (r5-fxb: or to another player, "and deals 1 damage to each opponent"), with the subject said once. Only ~ itself, one layer 7c change, a fixed amount, nothing bound, guarded or divided; the two
 * steps written apart stay readings too.
 */
function pumpThenSelfDamage(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'damage' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined) return null;
  // edh-replace-3 (CR 107.3; Myr Battlesphere): or X, the number chosen as the payment before was made ("... gets +X/+0 until end of turn and deals X damage to the player or planeswalker it's attacking")
  if (a.effects.length !== 1 || b.source.ref !== 'self' || !(typeof b.amount === 'number' || (typeof b.amount === 'object' && b.amount.q === 'X')) || b.divided !== undefined || b.also !== undefined || b.unpreventable === true) return null;
  const e = a.effects[0]!;
  if (e.s !== 'continuous' || e.cda === true || e.affects.ref !== 'self' || e.mods.length !== 1 || e.mods[0]!.layer !== '7c') return null;
  const amount = b.amount;
  // r4-static (CR 120.3, 608.2c): another recipient too, "~ gets +1/+1 until end of turn and deals 1 damage to each opponent" (the damage clause without its subject)
  const deals = (v: RenderState): string => {
    if (b.to.ref === 'you') return `deals ${typeof amount === 'number' ? amount : K.qty(amount, v)} damage to you`;
    // the clause's subject ("~" or "it", an alternative group) is dropped: the P/T change before names it
    const nodes = parseMarked(fragment(K.clause(b, v)));
    const head = nodes[0];
    const isSubject = (n: MarkedNode[]): boolean => n.length === 1 && typeof n[0] === 'string' && /^(?:~|it|he|she)$/.test(n[0]);
    if (head === undefined || typeof head === 'string' || !head.alts.every(isSubject) || typeof nodes[1] !== 'string' || !nodes[1].startsWith(' ')) {
      throw new NoRenderer('a damage clause after a P/T change of ~ whose words do not begin with its subject');
    }
    return serializeMarked([nodes[1].slice(1), ...nodes.slice(2)]);
  };
  const [one, apart] = withVariants(st, [
    (v) => `${fragment(K.clause(a, v))} and ${deals(v)}`,
    (v) => `${fragment(K.clause(a, v))}${alt('. ', ' and ', ', then ')}${fragment(K.clause(b, v))}`,
  ]);
  return { clauses: [plain(alt(one!, apart!))], consumed: 2 };
}

/**
 * edh-c-41 (CR 502.3, 611.2a, 113.1; family gains-and-no-untap; Deep Spawn): "~ gains shroud until end of turn and doesn't untap during your next untap step": a lasting
 * grant of abilities to ~ and the restriction "doesn't untap during your next untap step" on ~ itself (`throughNextUntap` of you), one sentence. Only ~ itself.
 */
function gainsThenNoUntap(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'effect' || b?.op !== 'effect' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.effects.length !== 1 || b.effects.length !== 1) return null;
  const ea = a.effects[0]!;
  const eb = b.effects[0]!;
  if (ea.s !== 'continuous' || ea.cda === true || ea.affects.ref !== 'self' || ea.mods.length !== 1 || ea.mods[0]!.layer !== 6 || (ea.mods[0] as { add?: unknown }).add === undefined) return null;
  if (a.duration.d !== 'endOfTurn') return null;
  if (eb.s !== 'restrict' || eb.mode !== 'cant' || eb.action !== 'untapDuringUntapStep' || eb.subject?.ref !== 'self' || Object.keys(eb.subject).length !== 1) return null;
  if (b.duration.d !== 'throughNextUntap' || b.duration.whose !== 'you') return null;
  const [one, apart] = withVariants(st, [
    (v) => `${fragment(K.clause(a, v))} and doesn't untap during your next untap step`,
    (v) => `${fragment(K.clause(a, v))}${alt('. ', ' and ')}${fragment(K.clause(b, v))}`,
  ]);
  return { clauses: [plain(alt(one!, apart!))], consumed: 2 };
}

/** Is nothing after the fold's steps reading these names (a later step would see a binding the text no longer shows)? */
const unread = (list: EffectStep[], from: number, ...names: (string | undefined)[]): boolean =>
  !list.slice(from).some((x) => names.some((n) => n !== undefined && JSON.stringify(x).includes(`"name":"${n}"`)));

/** Like `unread`, but the move of "the rest" of the choice (`name`) may follow: it reads the name, and is written "the rest" without it. */
function unreadExceptRest(list: EffectStep[], from: number, name: string): boolean {
  return !list.slice(from).some((x) => JSON.stringify(x).includes(`"name":"${name}"`) && !(x.op === 'move' && x.what.ref === 'each'
    && (restOfGroup(x.what.filter)?.chosen === name || (restOfExiled(x.what.filter) && (x.what.filter.not?.is as { name?: string } | undefined)?.name === name)))); // std-library-3
}

/**
 * FAST5 T43 (CR 701.20e, 608.2c-d): "Put two of them into your hand and the rest into your graveyard" (also "the other", "on the bottom of your library in a
 * random order"): after the cards of a group were looked at, you choose exactly N of them, put those cards somewhere and the cards of the group you did not choose
 * somewhere else. Only that shape: one choice by you of a fixed number among the whole group, then the move of exactly the chosen cards, then the move of exactly
 * the rest.
 */
function putOfThemAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.as === undefined || a.random === true) return null;
  // edh-c-114 (CR 608.2c; Inscribed Tablet): the move of the chosen card may be named for a later "If you didn't put a card into your hand this way" (a `did` condition reading only it)
  const bNamed = b.as !== undefined && list.slice(i + 3).every((x) => !JSON.stringify(x).includes(`"name":"${b.as}"`));
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || (b.as !== undefined && !bNamed) || c.as !== undefined || b.until !== undefined || c.until !== undefined) return null;
  // std-blb (CR 107.3, 608.2h): or a computed number, "put X cards from among them into your hand and the rest into your graveyard" (Stargaze)
  const computed = typeof a.min === 'object' && JSON.stringify(a.max) === JSON.stringify(a.min);
  // edh-next-36 (CR 701.20e, 608.2c-d; The Mana Rig): "Put up to two of them into your hand and the rest on the bottom of your library in a random order": the choice may be empty
  const upTo = a.min === 0 && typeof a.max === 'number' && a.max >= 1 && b.to.zone === 'hand' && Object.keys(b.to).length === 1 && c.to.zone === 'library' && c.to.position === 'bottom' && c.to.order === 'random' && c.to.owner === undefined;
  if (a.who.ref !== 'you' || !(computed || upTo || (typeof a.min === 'number' && a.min >= 1 && a.max === a.min)) || !isBound(b.what, a.as)) return null;
  const pool = groupPool(a.from);
  if (pool === null || c.what.ref !== 'each') return null;
  // trek-9 (CR 701.20e, 608.2c-d, 609.3): exactly ONE card of a description among the group ("Put a land card from among them onto the battlefield tapped and the
  // rest into your graveyard", Hit It!), not into exile (the exile reading below says "of them"); any other described choice is a fold of its own
  const oneOfDesc = pool.desc !== null && a.min === 1 && a.max === 1 && b.to.zone !== 'exile' ? pool.desc : null;
  if (pool.desc !== null && oneOfDesc === null) return null;
  const rest = restOfGroup(c.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== (pool.group as { name: string }).name) return null;
  // std-exile-play-1-1 (CR 400.7, 608.2c): the cards exiled this way may be named by a later instruction, "the exiled cards" (bound below)
  if (!unread(list, i + 3, a.as) && b.to.zone !== 'exile') return null;
  const them0 = K.obj(pool.group, st, 'object');
  // edh-d-91 (CR 701.20e, 608.2c; Zurgo and Ojutai): after a look at the top cards of a library, "them" names the cards seen when no other plural group of library cards is named (refs.ts#onlySeenGroup,
  // the parser's Seen rule), even beside a plural group of permanents a trigger named ("Whenever one or more Dragons you control deal combat damage ..."), as castFromGroup says it
  const them = onlySeenGroup(st, pool.group) && them0.plural && them0.text !== 'them' && them0.text !== AMBIGUOUS ? { ...them0, text: alt('them', them0.text) } : them0;
  if (!them.plural) return null;
  const restText = K.obj(c.what, st, 'object').text;
  // edh-next-142 (CR 105.5, 608.2c, 608.2d; Niv-Mizzet Reborn): one card of each color pair among the group (`eachColorPair`), said in a sentence of its own: "For each color pair, choose a card that's
  // exactly those colors from among them. Put the chosen cards into your hand and the rest on the bottom of your library in a random order."
  if (a.eachColorPair === true) {
    if (a.min !== 0 || a.max !== 10 || pool.desc !== null || JSON.stringify(b.to) !== '{"zone":"hand"}' || c.to.zone !== 'library' || c.to.position !== 'bottom' || c.to.order !== 'random' || c.to.owner !== undefined || Object.keys(c.to).length !== 3) return null;
    return { clauses: [plain(`for each color pair, choose a card that's exactly those colors from among ${them.text}`, { standalone: true }), plain(`put the chosen cards into your hand and ${restText} on the bottom of your library in a random order`, { standalone: true })], consumed: 3 };
  }
  // std-hob (CR 701.23a, 608.2c): after a search that found and revealed the group, Oracle says only "one": "put one onto the battlefield tapped and the other into
  // your hand" (the found cards are the only group the sentence names; T42's onePutOtherGraveyard reads "one" the same way)
  const n = upTo ? `up to ${numWord(a.max as number)}` : typeof a.min === 'number' ? numWord(a.min) : K.qty(a.min as Exclude<typeof a.min, number | 'any'>, st);
  const ofThem = `${n} of ${them.text}`;
  // std-blb: Oracle also says "put three cards from among them into your hand" (CR 608.2c: the same choice among the cards looked at)
  const fromAmong = `${n} ${a.min === 1 ? 'card' : 'cards'} from among ${them.text}`;
  const which = upTo ? ofThem : oneOfDesc !== null ? `${K.np({ ...oneOfDesc, zone: 'library' }, st, { det: 'a', plural: false, noZone: true })} from among ${them.text}`
    : a.min === 1 ? alt(ofThem, 'one', fromAmong) : alt(ofThem, fromAmong);
  // r4-dig (CR 701.13a, 406.3, 401.4): "exile two of them face down, then put the rest on the bottom of their library in a random order" (Black Cat, Cunning Thief):
  // the chosen cards exiled (face down or not), the rest of the group to the bottom of the library they are in (the library's owner is "their" when another
  // player's library was looked at; each card goes to its owner's library, CR 400.3)
  if (b.to.zone === 'exile') {
    if (Object.keys(b.to).some((k) => k !== 'zone' && k !== 'faceDown')) return null;
    const d = c.to;
    const bottom = d.zone === 'library' && d.position === 'bottom' && d.owner === undefined && d.order === 'random' ? ['on the bottom of their library in a random order', 'on the bottom of that library in a random order' /* edh-zones-4 (Gonti): the library looked at */]
      : d.zone === 'library' && d.position === 'bottom' && d.owner === undefined && d.order === undefined && Object.keys(d).length === 2 ? ['on the bottom of that library' /* edh-zones-26 (Siphon Insight): the library looked at, the other card (no order to state) */] : [];
    // edh-zones-11 (Thief of Sanity): the rest of another player's library put into a graveyard goes to its owner's, "their graveyard" (CR 400.3, 404.1)
    const theirs = d.zone === 'graveyard' && Object.keys(d).length === 1 ? ['into their graveyard'] : [];
    const restDest = alt(destPhrase(d, st, true, true), ...bottom, ...theirs);
    // edh-zones-11 (Vivien, Champion of the Wilds): face down, the group is not named again, "Exile one face down and put the rest on the bottom of your library in any order."
    const exile = b.to.faceDown === true ? alt(`exile ${ofThem} face down`, `exile ${n} face down`) : `exile ${ofThem}`;
    const text = alt(`${exile} and put ${restText} ${restDest}`, `${exile}, then put ${restText} ${restDest}`);
    // std-exile-play-1-1 (CR 400.7, 406.3, 608.2c; family exiled-card-of-this-ability): the chosen cards, now in exile, are "the exiled cards" when a later instruction
    // names them ("You may play the exiled cards for as long as they remain exiled", Black Cat, Cunning Thief), face down or not
    if (!unread(list, i + 3, a.as)) bind(st, a.as, { nouns: ['card'], plural: a.min !== 1, zone: 'exile', alts: [a.min === 1 ? 'the exiled card' : 'the exiled cards'] });
    return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
  }
  const text = `put ${which} ${destPhrase(b.to, st, upTo ? a.max !== 1 : a.min !== 1, true)} and ${restText} ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * r3-dig (CR 701.20a, 608.2c, 401.4): "Put that card into your hand and the rest on the bottom of your library in a random order" after "reveal cards from the top
 * of your library until you reveal a land card" (also "onto the battlefield (tapped)", "those land cards"): the move of the card(s) a step bound, then the move of
 * the rest of a group less exactly those cards (parser/lower/mentions.ts#revealedRestOf, #restOf), as one sentence. Only that shape: two plain moves.
 */
function putThatAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'move' || b?.op !== 'move' || a.what.ref !== 'bound' || b.what.ref !== 'each') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.until !== undefined || b.until !== undefined) return null;
  if (a.link !== undefined || b.link !== undefined || a.remember !== undefined || b.remember !== undefined) return null;
  const rest = restOfGroup(b.what.filter);
  if (rest === null || rest.chosen !== a.what.name) return null;
  const that = K.obj(a.what, st, 'object');
  const restText = K.obj(b.what, st, 'object').text;
  // edh-zones-16 (CR 110.2a, 401.4, 608.2c; Wild Magic Surge): "They put that card onto the battlefield and the rest on the bottom of their library in a random order." after another
  // player's reveal until (steps-cards.ts#revealUntil, the player in `revealedBy`): that player puts the card onto the battlefield under their control and the others in their library
  const revealer = st.info.get(`b:${a.what.name}`)?.revealedBy;
  if (revealer !== undefined && a.to.zone === 'battlefield' && typeof a.to.controller === 'object' && JSON.stringify(a.to.controller) === JSON.stringify(revealer) && Object.keys(a.to).length === 2
    && b.to.zone === 'library' && b.to.position === 'bottom' && b.to.order === 'random' && Object.keys(b.to).length === 3) {
    const text = `they put ${that.text} onto the battlefield and ${restText} on the bottom of their library in a random order`;
    return { clauses: [acting(playerKey(revealer) ?? 'they', text, text)], consumed: 2 };
  }
  // p2-zone-moves-2 (CR 406.1, 608.2c): "Put that card into your hand and exile all other cards revealed this way." (Demonic Consultation): the rest exiled is said
  // with its own verb (exile has no "into" phrase); anything else about the exile (face down, a link) has no wording here
  if (b.to.zone === 'exile') {
    if (Object.keys(b.to).length !== 1 || a.to.zone === 'exile') return null;
    const text = `put ${that.text} ${destPhrase(a.to, st, that.plural, true)} and exile ${restText}`;
    return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
  }
  // edh-zones-13 (CR 406.1, 608.2c; Creative Technique): "Exile that card and put the rest on the bottom of your library in a random order." (exile has no "put ... into" phrase)
  if (a.to.zone === 'exile') {
    if (Object.keys(a.to).length !== 1) return null;
    const text = `exile ${that.text} and put ${restText} ${destPhrase(b.to, st, true, true)}`;
    // the card exiled is "the exiled card" for a later sentence ("You may cast the exiled card without paying its mana cost.")
    const prior = st.info.get(`b:${a.what.name}`);
    if (prior !== undefined) bind(st, a.what.name, { ...prior, alts: [...new Set([...(prior.alts ?? []), 'the exiled card'])] });
    return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
  }
  const text = `put ${that.text} ${destPhrase(a.to, st, that.plural, true)} and ${restText} ${destPhrase(b.to, st, true, true)}`;
  // trek-17 (CR 400.7, 608.2c; Will Riker, First in the Field): the cards put onto the battlefield are permanents now, "those lands" for a later instruction ("Sacrifice those lands")
  const prior = st.info.get(`b:${a.what.name}`);
  if (a.to.zone === 'battlefield' && prior !== undefined && prior.zone === 'library') {
    st.info.set(`b:${a.what.name}`, { ...prior, zone: 'battlefield', nouns: [...new Set([...prior.nouns, 'permanent'])] });
    st.mentioned.delete(`b:${rest.group}`); // (the rest is on the bottom of the library: no antecedent of "those lands")
  }
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * r4-repl (CR 701.20e, 608.2c): "Put one of those cards into your hand." as a sentence of its own (Consult the Star Charts, with "Put the rest ..." in a later
 * sentence and "If C, put two of those cards into your hand instead." between them, render/steps-flow.ts): your choice of exactly N cards of a group looked at,
 * then the move of exactly those cards (the template eff.r4repl.dig.putHand.only). Only that shape, with nothing after it in the same list reading the choice.
 */
function putOfThem(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || b.guard !== undefined || b.until !== undefined) return null;
  if (a.who.ref !== 'you' || typeof a.min !== 'number' || a.min < 1 || a.max !== a.min || !isBound(b.what, a.as) || (b.to.zone !== 'hand' && b.to.zone !== 'graveyard') || Object.keys(b.to).length !== 1) return null; // edh-c-15 (Jace, the Living Guildpact): also "put one of them into your graveyard"
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null) return null;
  if (!unread(list, i + 2, a.as) || (b.as !== undefined && !unread(list, i + 2, b.as))) return null;
  // std-rw9 (family seen-group-them): the cards looked at are "them" when no other group of library cards was named ("Whenever one or more Birds you control
  // attack, look at that many cards from the top of your library. You may put one of them into your hand.": not the attackers)
  const them = seenGroup(pool.group, st);
  if (!them.plural) return null;
  // edh-c-99 (CR 701.20e, 404.1; family their-graveyard-owner): a card goes to its OWNER's graveyard, so "into their graveyard" (Wu Spy: the cards of the library of target player) says the same as "into your graveyard" of the own library
  const dest0 = destPhrase(b.to, st, a.min !== 1, true);
  const otherLibrary = list.slice(0, i).some((x) => x.op === 'look' && x.at.ref === 'topCards' && x.at.player !== undefined && JSON.stringify(x.at.player) !== JSON.stringify({ ref: 'you' }));
  const dest = b.to.zone === 'graveyard' ? (otherLibrary ? alt('into their graveyard', dest0) : dest0) : dest0;
  // edh-zones-7 (CR 701.20e, 608.2d; family one-card-from-among-them): the choice of exactly one card is also "put a card from among them into your hand" (Planar Genesis)
  const text = a.min === 1 ? alt(`put one of ${them.text} ${dest}`, `put a card from among ${them.text} ${dest}`) : `put ${numWord(a.min)} of ${them.text} ${dest}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * r4-dig (CR 701.20e, 406.3, 608.2c): "its controller looks at the top card of that opponent's library and exiles it face down" (Gonti, Night Minister): another
 * player looks at the top card of one library, then that card (the look's binding, lower/anaphora.ts#lookIdiom) is exiled face down, as one sentence with that
 * player as the subject of both verbs (who exiles it changes nothing, CR 406.1).
 */
function playerLooksThenExilesFaceDown(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'look' || b?.op !== 'move' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.until !== undefined) return null;
  // std-exile-play-1-1 (CR 611.2c, 406.3): the exiled card may be named by the permission right after it ("They may play that card for as long as it remains exiled",
  // the parser's impulse idiom, which binds the move): only that permission, of the player who looked
  const next = list[i + 2];
  const permitNext = next?.op === 'effect' && next.effects.length === 1 && next.effects[0]!.s === 'permit' && JSON.stringify(next.effects[0]!.who) === JSON.stringify(a.who)
    && JSON.stringify(next.effects[0]!.of) === JSON.stringify({ is: { ref: 'bound', name: b.as } });
  if (b.as !== undefined && (!permitNext || !unread(list, i + 3, b.as))) return null;
  if (a.who.ref === 'you' || a.at.ref !== 'topCards' || a.at.count !== 1 || !isBound(b.what, a.as) || b.link !== undefined || b.remember !== undefined) return null;
  if (b.to.zone !== 'exile' || b.to.faceDown !== true || Object.keys(b.to).length !== 2) return null;
  const look = K.clause(a, st);
  if (look.pred === undefined) return null;
  const subj = K.player(a.who, st, 'subject');
  if (subj.person !== 'sg') return null;
  const text = `${look.sub} and exiles ${alt('it', 'that card')} face down`;
  if (b.as !== undefined) {
    bind(st, b.as, { nouns: ['card'], plural: false, zone: 'exile', sameAs: identityOf(st, `b:${a.as}`) });
    const key = playerKey(a.who);
    if (key !== null) st.theyFocus = key;
  }
  return { clauses: [plain(text)], consumed: 2 };
}

/**
 * r4-dig (CR 701.20a, 608.2c): "Whenever ~ attacks, reveal the top card of your library and put it into your hand." (Caustic Bronco): a reveal of the top card of
 * your own library, then the move of that one card (the reveal's binding, lower/anaphora.ts#lookIdiom) into your hand or graveyard, as one sentence. The card
 * stays named for a later sentence ("that card's mana value") by the reveal's binding.
 */
function revealTopAndPut(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'reveal' || b?.op !== 'move' || a.as === undefined || a.guard !== undefined || b.guard !== undefined || b.as !== undefined || b.until !== undefined) return null;
  if (a.to !== undefined || a.who.ref !== 'you' || a.what.ref !== 'topCards' || a.what.count !== 1 || a.what.player.ref !== 'you' || !isBound(b.what, a.as)) return null;
  if (b.link !== undefined || b.remember !== undefined || (b.to.zone !== 'hand' && b.to.zone !== 'graveyard') || Object.keys(b.to).length !== 1) return null;
  K.clause(a, st); // binds the revealed card for the sentences after this one
  const text = `reveal the top card of your library and put ${alt('it', 'that card')} into your ${b.to.zone}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * std-lci (CR 701.20e, 608.2c-d, 401.4): "Put any number of Dinosaur creature cards from among them onto the battlefield and the rest on the bottom of your library in a
 * random order" (Gishath, Sun's Avatar): your choice of any number of the described cards of a group looked at or revealed (none is a choice too), their move, and the
 * move of the rest of the group (parser/lower/mentions.ts#restOf), as one sentence. Only that exact shape, with nothing reading the choice afterwards.
 */
/**
 * std-library-3 (CR 205.2a, 608.2d, 406.1): "For each card type, you may exile a card of that type from among them." (Portent of Calamity): your choice of at most one
 * card of each card type among a group looked at or revealed (`chooseObjects.eachCardType`), and the exile of exactly those; what it exiled is "the exiled cards"
 * afterwards (as chooseThenMove binds a move to exile). Only that shape, with nothing reading the choice afterwards but "the rest" and the exiled cards.
 */
function eachCardTypeFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.eachCardType !== true || a.as === undefined || a.random === true || a.guard !== undefined || b.guard !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || a.groupLimit !== undefined || a.perPlayer !== undefined || a.startingWith !== undefined) return null;
  // edh-zones-13 (CR 205.2a, 401.4; Atraxa, Grand Unifier): or the move into your hand, "put a card of that type from among the revealed cards into your hand" (the
  // group is also said "the revealed cards" after a reveal of the top cards, as seenGroup says "them")
  const toHand = JSON.stringify(b.to) === JSON.stringify({ zone: 'hand' }) && b.as === undefined;
  if (!isBound(b.what, a.as) || b.until !== undefined || (!toHand && JSON.stringify(b.to) !== JSON.stringify({ zone: 'exile' }))) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null) return null;
  const them = toHand ? seenGroup(pool.group, st) : K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  if (toHand) {
    const revealed = st.info.get(`b:${(pool.group as { name: string }).name}`)?.revealedTop === true; // a reveal (not a look) made the group (std-ro)
    const text = `for each card type, you may put a card of that type from among ${revealed ? alt(them.text, 'the revealed cards') : them.text} into your hand`;
    return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
  }
  bind(st, a.as, { nouns: ['card'], plural: true, optional: true, zone: 'exile', alts: ['the exiled cards'] });
  if (b.as !== undefined) {
    bind(st, b.as, { nouns: ['card'], plural: true, zone: 'exile', sameAs: identityOf(st, `b:${a.as}`), thisWay: 'exiled this way' });
    st.info.set(`r:${b.as}`, movedInfo('exiled', ['card'])); // "if you exiled four or more cards this way" (render/moved.ts)
  }
  const text = `for each card type, you may exile a card of that type from among ${them.text}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/** std-library-1: the statistic of `chooseObjects.distinct`, as Oracle names the set ("with different powers", "with different mana values"). */
const DISTINCT_WORDS: Readonly<Record<string, string>> = { power: 'powers', toughness: 'toughnesses', manaValue: 'mana values', name: 'names' };

function putAnyFromGroupAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.as === undefined || a.random === true || a.groupLimit !== undefined) return null; // edh-zones-19: a total limit is putAnyFromGroup's (the one-sentence form has no words for it)
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || b.as !== undefined || (c.as !== undefined && c.to.zone !== 'graveyard' && c.to.zone !== 'library' /* edh-d-16: Torsten's rest on the bottom, named "rest" so edh-d-9's two-sentence fold leaves it */) || b.until !== undefined || c.until !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || !isBound(b.what, a.as) || a.distinct !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || c.what.ref !== 'each') return null;
  const rest = restOfGroup(c.what.filter);
  // edh-zones-8 (CR 303.4g, Genesis Ultimatum ruling 2025-04-04): "the rest" is also everything of the group still in the library, so an Aura that could not enter is among it
  const plainRest = rest === null && b.to.zone === 'battlefield' && c.to.zone === 'hand' && JSON.stringify(c.what.filter) === JSON.stringify({ is: (pool.group as object), zone: 'library' });
  if (!plainRest && (rest === null || rest.chosen !== a.as || rest.group !== (pool.group as { name: string }).name)) return null;
  if (!unread(list, i + 3, a.as)) return null;
  const them = seenGroup(pool.group, st); // std-rw9 (family seen-group-them)
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  const restText = plainRest ? 'the rest' : K.obj(c.what, st, 'object').text;
  const text = `put any number of ${np} from among ${them.text} ${destPhrase(b.to, st, true, true)} and ${restText} ${destPhrase(c.to, st, true, true)}`;
  // edh-zones-13 (CR 608.2c; Dihada, Binder of Wills): what the move of the rest put into your graveyard is "put into your graveyard this way" for a later count (render/moved.ts)
  if (c.as !== undefined && c.to.zone === 'graveyard') st.info.set(`r:${c.as}`, movedInfo('graveyard', ['card']));
  // std-rw9 (family then-after-may-dig, CR 608.2c-d): after "You may put one of them into your hand." the sentence may begin "Then" (Choco, Seeker of Paradise): it is
  // not part of the option, which its own sentence closed; "then" only orders the instructions
  return { clauses: [acting('you', text, `you ${text}`, { leadThen: true })], consumed: 3 };
}

/**
 * r3-dig (CR 701.20e, 608.2c-d, 202.3, 401.4): "Put up to two creature cards with total mana value 6 or less from among them onto the battlefield and the rest on the
 * bottom of your library in a random order" (Michelangelo's Technique): your choice of up to N of the described cards of a group looked at or revealed whose mana
 * values add up to at most the limit (`groupLimit`, FAST5 T66), their move, and the move of the rest of the group (parser/lower/mentions.ts#restOf), as one sentence.
 * Only that exact shape, with nothing reading the choice afterwards.
 */
function putUpToTotalFromGroupAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.as === undefined || a.random === true || a.groupLimit === undefined || a.perPlayer !== undefined) return null;
  if (a.guard !== undefined || b.guard !== undefined || c.guard !== undefined || b.as !== undefined || c.as !== undefined || b.until !== undefined || c.until !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || typeof a.max !== 'number' || a.max < 2 || !isBound(b.what, a.as)) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null || c.what.ref !== 'each') return null;
  const rest = restOfGroup(c.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== (pool.group as { name: string }).name) return null;
  if (!unread(list, i + 3, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true, total: totalLimitWords(a.groupLimit, st) });
  const restText = K.obj(c.what, st, 'object').text;
  const text = `put up to ${numWord(a.max)} ${np} from among ${them.text} ${destPhrase(b.to, st, true, true)} and ${restText} ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * r4-fxz (CR 701.20e, 608.2c-d): "You may put any number of nonland permanent cards with mana value 3 or less from among them onto the battlefield." (Ajani, Outland
 * Chaperone; "Put any number of land cards from among them onto the battlefield tapped"): any number of the cards of a group looked at, chosen by you, and the
 * move of exactly those; the rest stays in the library (a "Then shuffle." may follow; "You may put ..." is the `may` around it). Only that shape, with nothing
 * reading the choice afterwards.
 * r4-repl (CR 701.20e, 608.2c): also "Put any number of creature cards from among them onto the battlefield." as a sentence of its own (Earth's Mightiest Heroes,
 * the rest put away by a later sentence), whose move may be bound if nothing after it reads it (wave 7 merge: r4-fxz and r4-repl wrote this fold under the same
 * name; one kept, with r4-fxz's "tapped" and r4-repl's bound move)
 */
// (wave 7: it also renders r3-dig's "look at the top N cards ..., put any number of ... from among them ..., then shuffle" with the look and the shuffle around it, so
// r3-dig's one-sentence fold lookPutAnyThenShuffle was removed: it also took the Oracle that says the three instructions in sentences of their own)
function putAnyFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || b.guard !== undefined || b.until !== undefined) return null;
  // std-library-1 (CR 208.1, 608.2d): "Put any number of creature and/or Vehicle cards with different powers from among them into your hand." (Rip, Spawn Hunter): no
  // two chosen with one power (`distinct`), a property of the set said after the plural noun like FAST5 T66's total; into your hand too, and "the rest" of a
  // sentence of its own after it may read the choice
  const distinct = a.distinct !== undefined;
  // edh-zones-19 (CR 202.3, 608.2d; Ao, the Dawn Sky): "Put any number of nonland permanent cards with total mana value 4 or less from among them onto the battlefield." (`groupLimit`, FAST5 T66), the
  // rest put away by a sentence of its own after it (as with different powers), onto the battlefield only
  const limited = a.groupLimit !== undefined && a.groupLimit.stat === 'manaValue' && !distinct;
  if (a.groupLimit !== undefined && !limited) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || !isBound(b.what, a.as) || (b.to.zone !== 'battlefield' && !(distinct && b.to.zone === 'hand'))) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null) return null;
  if (!(distinct || limited ? unreadExceptRest(list, i + 2, a.as) : unread(list, i + 2, a.as)) || (b.as !== undefined && !unread(list, i + 2, b.as))) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const different = distinct ? { total: `different ${DISTINCT_WORDS[a.distinct!]}` } : limited ? { total: totalLimitWords(a.groupLimit!, st) } : {};
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, noZone: true, ...different });
  const text = `put any number of ${np} from among ${them.text} ${destPhrase(b.to, st, true, true)}`;
  // std-combat-1 (CR 603.12, 608.2c, 400.7): the cards chosen and put onto the battlefield, named later by a reflexive trigger of the same ability ("When you put one or more
  // Equipment onto the battlefield this way, you may attach one of them ...", render/fold-stdcombat1.ts): permanents now, of the description chosen
  bind(st, a.as, { nouns: K.nounsOf(pool.desc), plural: true });
  if (b.as !== undefined) st.info.set(`r:${b.as}`, { ...movedInfo('battlefield', K.nounsOf(pool.desc)), movedBinding: a.as });
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * std-lci (CR 701.20e, 608.2c-d, 400.7): "You may put a creature card and/or a land card from among them onto the battlefield" (Ojer Kaslem, Deepest Growth; "into
 * your hand" too): up to one card of the first description, then up to one OTHER card of the second (a card of both descriptions is either one, never both), and
 * the move of what was chosen. Only that exact shape, with nothing reading the two choices afterwards but "the rest" of the second one (the cards still in the
 * library: the moved ones left it, parser/lower/mentions.ts#restOf).
 */
function putEitherFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || c?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  const one = (x: typeof a): boolean => x.who.ref === 'you' && x.min === 0 && x.max === 1 && x.random !== true && x.guard === undefined;
  if (!one(a) || !one(b) || c.guard !== undefined || c.as !== undefined || c.until !== undefined) return null;
  const pa = groupPool(a.from);
  if (pa === null || pa.desc === null || b.from.ref !== 'each') return null;
  const { not, ...rest } = b.from.filter;
  if (not === undefined || Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined).join(',') !== 'is' || !isBound(not.is!, a.as)) return null;
  const pb = groupPool({ ref: 'each', filter: rest });
  if (pb === null || pb.desc === null || JSON.stringify(pb.group) !== JSON.stringify(pa.group)) return null;
  const parts = c.what.ref === 'union' ? c.what.of : [];
  if (parts.length !== 2 || !isBound(parts[0]!, a.as) || !isBound(parts[1]!, b.as)) return null;
  if (c.to.zone !== 'hand' && c.to.zone !== 'battlefield') return null;
  if (!unread(list, i + 3, a.as) || !unreadExceptRest(list, i + 3, b.as)) return null;
  const them = K.obj(pa.group, st, 'object');
  if (!them.plural) return null;
  const np = (f: ObjectFilter): string => K.np({ ...f, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may put ${np(pa.desc)} and/or ${np(pb.desc)} from among ${them.text} ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 3 };
}

/**
 * edh-c-76 (CR 701.20a, 701.20e, 608.2c-d; Gift of the Gargantuan): "You may reveal a creature card and/or a land card from among them and put the revealed cards into your hand.": the
 * two-description form of revealThreeAndOrFromGroup, exactly the four steps of template eff.edhv76.dig.mayReveal.twoAndOr.hand (up to one card of each description, a card that fits
 * both is only one of the choices; revealed together, put into your hand); "the rest" of the group follows (the cards still in the library: the moved ones left it).
 */
function revealTwoAndOrFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, r, m] = [list[i], list[i + 1], list[i + 2], list[i + 3]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || r?.op !== 'reveal' || m?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  const one = (x: typeof a): boolean => x.who.ref === 'you' && x.min === 0 && x.max === 1 && x.random !== true && x.guard === undefined;
  if (!one(a) || !one(b) || r.who.ref !== 'you' || r.guard !== undefined || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.to.zone !== 'hand') return null;
  const pa = groupPool(a.from);
  if (pa === null || pa.desc === null || b.from.ref !== 'each') return null;
  const { not, ...rest } = b.from.filter;
  if (not === undefined || Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined).join(',') !== 'is' || !isBound(not.is!, a.as)) return null;
  const pb = groupPool({ ref: 'each', filter: rest });
  if (pb === null || pb.desc === null || JSON.stringify(pb.group) !== JSON.stringify(pa.group)) return null;
  const parts = m.what.ref === 'union' ? m.what.of : [];
  const rparts = r.what.ref === 'union' ? r.what.of : [];
  if (parts.length !== 2 || !isBound(parts[0]!, a.as) || !isBound(parts[1]!, b.as) || rparts.length !== 2 || !isBound(rparts[0]!, a.as) || !isBound(rparts[1]!, b.as)) return null;
  if (list.slice(i + 4).some((x) => [a.as, b.as].some((n) => JSON.stringify(x).includes(`"name":"${n}"`)) && !(x.op === 'move' && x.what.ref === 'each' && restOfGroup(x.what.filter)?.chosen === b.as))) return null;
  const them = K.obj(pa.group, st, 'object');
  if (!them.plural) return null;
  const np = (f: ObjectFilter): string => K.np({ ...f, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may reveal ${np(pa.desc)} and/or ${np(pb.desc)} from among ${them.text} and put the revealed cards into your hand`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 4 };
}

/**
 * edh-b-1 (CR 701.20a, 701.20e, 608.2c-d; Kaalia, Zenith Seeker): "You may reveal an Angel card, a Demon card, and/or a Dragon card from among them and put them into your hand.":
 * up to one card of each of three descriptions (a card that fits two is only one of the choices), revealed together and put into your hand. Exactly the five steps of template
 * eff.edhb1.dig.mayReveal.threeAndOr.hand; "the rest" of the group follows (the cards still in the library: the moved ones left it).
 */
function revealThreeAndOrFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c, r, m] = [list[i], list[i + 1], list[i + 2], list[i + 3], list[i + 4]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || c?.op !== 'chooseObjects' || r?.op !== 'reveal' || m?.op !== 'move' || a.as === undefined || b.as === undefined || c.as === undefined) return null;
  const one = (x: typeof a): boolean => x.who.ref === 'you' && x.min === 0 && x.max === 1 && x.random !== true && x.guard === undefined;
  if (!one(a) || !one(b) || !one(c) || r.who.ref !== 'you' || r.guard !== undefined || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.to.zone !== 'hand') return null;
  const pa = groupPool(a.from);
  if (pa === null || pa.desc === null || b.from.ref !== 'each' || c.from.ref !== 'each') return null;
  const exclude = (x: typeof b, names: string[]): ObjectFilter | null => {
    if (x.from.ref !== 'each') return null;
    const { not, ...rest } = x.from.filter;
    const is = not?.is;
    if (is === undefined || Object.keys(not!).filter((k) => (not as Record<string, unknown>)[k] !== undefined).join(',') !== 'is') return null;
    const parts = is.ref === 'union' ? is.of : [is];
    if (parts.length !== names.length || !parts.every((p, k) => isBound(p, names[k]!))) return null;
    return rest;
  };
  const rb = exclude(b, [a.as]);
  const rc = exclude(c, [a.as, b.as]);
  if (rb === null || rc === null) return null;
  const pb = groupPool({ ref: 'each', filter: rb });
  const pc = groupPool({ ref: 'each', filter: rc });
  if (pb === null || pb.desc === null || pc === null || pc.desc === null || JSON.stringify(pb.group) !== JSON.stringify(pa.group) || JSON.stringify(pc.group) !== JSON.stringify(pa.group)) return null;
  const parts = m.what.ref === 'union' ? m.what.of : [];
  if (parts.length !== 3 || !isBound(parts[0]!, a.as) || !isBound(parts[1]!, b.as) || !isBound(parts[2]!, c.as)) return null;
  const rparts = r.what.ref === 'union' ? r.what.of : [];
  if (rparts.length !== 3 || !isBound(rparts[0]!, a.as) || !isBound(rparts[1]!, b.as) || !isBound(rparts[2]!, c.as)) return null;
  // later steps read the choices only as "the rest" of the group (the move that names all three)
  if (list.slice(i + 5).some((x) => [a.as, b.as, c.as].some((n) => JSON.stringify(x).includes(`"name":"${n}"`)) && !(x.op === 'move' && x.what.ref === 'each' && restOfGroup(x.what.filter)?.chosen === c.as))) return null;
  const them = K.obj(pa.group, st, 'object');
  if (!them.plural) return null;
  const np = (f: ObjectFilter): string => K.np({ ...f, zone: 'library' }, st, { det: 'a', noZone: true });
  const text = `you may reveal ${np(pa.desc)}, ${np(pb.desc)}, and/or ${np(pc.desc)} from among ${them.text} and put them into your hand`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 5 };
}

/**
 * r4-fxz (CR 701.20e, 401.4, 608.2c): "Put all enchantment cards from among them into your hand and the rest on the bottom of your library in a random order." (Marina
 * Vendrell): every card of a group looked at or revealed that has the quality goes to your hand, then every card of the group still in the library (the rest) to the
 * bottom in a random order. Only that exact pair of moves of one group.
 */
function putAllFromGroupAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  // edh-zones-8 (CR 110.2a, 608.2c; Animist's Awakening): the cards put onto the battlefield tapped may be named, "untap those lands" later
  const toBf = a?.op === 'move' && JSON.stringify(a.to) === JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' }, tapped: true });
  const toBfUntapped = a?.op === 'move' && JSON.stringify(a.to) === JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' } }); // edh-zones-8 (Muxus, Goblin Grandee): "onto the battlefield and the rest on the bottom ..." 
  if (a?.op !== 'move' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || (a.as !== undefined && !toBf) || b.as !== undefined || a.until !== undefined || b.until !== undefined) return null;
  if (a.what.ref !== 'each' || b.what.ref !== 'each' || !('filter' in a.what) || !('filter' in b.what)) return null;
  const fa = a.what.filter;
  const fb = b.what.filter;
  const keys = (f: ObjectFilter): string => Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');
  // edh-zones-8: onto the battlefield, the description may state a mana value "or less" ("all Goblin creature cards with mana value 5 or less from among them")
  const mv = toBfUntapped && fa.manaValue?.op === '<=' ? fa.manaValue : undefined;
  // edh-d-17 (CR 607.2d, 701.20a; Brass Herald): and the cards of the type an earlier choice chose, "creature cards of the chosen type revealed this way" (a `chosen` filter beside the description; into your hand only)
  const chosenKind = fa.chosen !== undefined && !toBf && !toBfUntapped && mv === undefined ? fa.chosen : undefined;
  // edh-d-72 (CR 607.2d, 701.20a; Winding Way, Alrund): and no description beside it, "all cards of the chosen type revealed this way" (a `chosen` filter alone, into your hand only)
  const bareChosen = chosenKind !== undefined && fa.anyOf === undefined;
  if (keys(mv !== undefined ? { ...fa, manaValue: undefined } : chosenKind !== undefined ? { ...fa, chosen: undefined } : fa) !== (bareChosen ? 'is,zone' : 'anyOf,is,zone') || keys(fb) !== 'is,zone' || fa.zone !== 'library' || fb.zone !== 'library' || (!bareChosen && fa.anyOf?.length !== 1) || fa.is?.ref !== 'bound' || JSON.stringify(fa.is) !== JSON.stringify(fb.is)) return null;
  // std-ro (CR 701.20a, 608.2c, 401.4): the rest also goes into your graveyard, or on the bottom in an order you choose ("in any order")
  const REST: Record<string, string> = {
    [JSON.stringify({ zone: 'library', position: 'bottom', order: 'random' })]: 'on the bottom of your library in a random order',
    [JSON.stringify({ zone: 'library', position: 'bottom', order: 'chosen' })]: 'on the bottom of your library in any order',
    [JSON.stringify({ zone: 'graveyard' })]: 'into your graveyard',
    ...(toBfUntapped ? { [JSON.stringify({ zone: 'hand' })]: 'into your hand' } : {}), // edh-c-60 (Nissa, Nature's Artisan): "onto the battlefield and the rest into your hand"
  };
  const rest = REST[JSON.stringify(b.to)];
  if ((JSON.stringify(a.to) !== JSON.stringify({ zone: 'hand' }) && !toBf && !toBfUntapped) || rest === undefined) return null;
  if (fa.manaValue !== undefined && mv === undefined) return null;
  const revealed = st.info.get(`b:${fa.is.name}`)?.revealedTop === true;
  const them = K.obj(fa.is, st, 'object');
  if (!them.plural) return null;
  const kind = K.np({ ...(fa.anyOf?.[0] ?? { isCard: true }), ...(mv !== undefined ? { manaValue: mv } : {}), ...(chosenKind !== undefined ? { chosen: chosenKind } : {}), zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  // (every card of the group has gone somewhere: the group is no antecedent any more, the lands put are "those lands")
  if (toBf && a.as !== undefined) {
    bind(st, a.as, { nouns: [...new Set([...K.nounsOf(fa.anyOf![0]!), 'permanent'])], plural: true });
    st.mentioned.delete(`b:${fa.is.name}`);
  }
  // std-ro: the top cards a reveal revealed are also "<cards> revealed this way" (family revealed-this-way-group)
  const which = revealed ? alt(`${kind} from among ${them.text}`, `${kind} revealed this way`) : `${kind} from among ${them.text}`;
  const text = `put all ${which} ${toBf ? 'onto the battlefield tapped' : toBfUntapped ? 'onto the battlefield' : 'into your hand'} and the rest ${rest}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * std-rx1 (CR 701.20a, 608.2c, 110.2a): "Put all land cards revealed this way onto the battlefield tapped and put all creature cards revealed this way into your hand."
 * (Zimone's Experiment): the cards of one description among the cards a choice chose and revealed (`revealedChosen`, chooseUpToFromGroupThenReveal) onto the
 * battlefield tapped under your control, then those of another description into your hand. Only that exact pair of moves of one revealed group.
 */
function putAllRevealedSplit(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'move' || b?.op !== 'move' || a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.until !== undefined || b.until !== undefined) return null;
  if (a.what.ref !== 'each' || b.what.ref !== 'each' || !('filter' in a.what) || !('filter' in b.what)) return null;
  const fa = a.what.filter;
  const fb = b.what.filter;
  const keys = (f: ObjectFilter): string => Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');
  if (keys(fa) !== 'anyOf,is,zone' || keys(fb) !== 'anyOf,is,zone' || fa.zone !== 'library' || fb.zone !== 'library' || fa.anyOf?.length !== 1 || fb.anyOf?.length !== 1) return null;
  if (fa.is?.ref !== 'bound' || JSON.stringify(fa.is) !== JSON.stringify(fb.is) || st.info.get(`b:${fa.is.name}`)?.revealedChosen !== true) return null;
  if (JSON.stringify(a.to) !== JSON.stringify({ zone: 'battlefield', controller: { ref: 'you' }, tapped: true }) || JSON.stringify(b.to) !== JSON.stringify({ zone: 'hand' })) return null;
  const kind = (f: ObjectFilter): string => K.np({ ...f, zone: 'library' }, st, { det: 'none', plural: true, noZone: true });
  const text = `put all ${kind(fa.anyOf[0]!)} revealed this way onto the battlefield tapped and put all ${kind(fb.anyOf[0]!)} revealed this way into your hand`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * r4-fxz (CR 608.2c, 608.2d, 110.2a): "you may put a creature card and/or a land card from your hand onto the battlefield": two optional choices of one card each
 * from your hand (the second not the first), then both onto the battlefield; as putEitherFromGroup says it for a group looked at.
 */
function putEitherFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'chooseObjects' || c?.op !== 'move' || a.as === undefined || b.as === undefined) return null;
  const one = (x: typeof a): boolean => x.who.ref === 'you' && x.min === 0 && x.max === 1 && x.random !== true && x.guard === undefined;
  if (!one(a) || !one(b) || c.guard !== undefined || c.as !== undefined || c.until !== undefined || a.from.ref !== 'each' || b.from.ref !== 'each') return null;
  const desc = (f: ObjectFilter): ObjectFilter | null => {
    const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',');
    return keys === 'anyOf,owner,zone' && f.zone === 'hand' && f.owner === 'you' && f.anyOf?.length === 1 ? f.anyOf[0]! : null;
  };
  const { not, ...rest } = b.from.filter;
  if (not === undefined || Object.keys(not).filter((k) => (not as Record<string, unknown>)[k] !== undefined).join(',') !== 'is' || !isBound(not.is!, a.as)) return null;
  const da = desc(a.from.filter);
  const db = desc(rest);
  const parts = c.what.ref === 'union' ? c.what.of : [];
  if (da === null || db === null || parts.length !== 2 || !isBound(parts[0]!, a.as) || !isBound(parts[1]!, b.as) || c.to.zone !== 'battlefield') return null;
  if (!unread(list, i + 3, a.as) || !unread(list, i + 3, b.as)) return null;
  const np = (f: ObjectFilter): string => K.np({ ...f, zone: 'hand' }, st, { det: 'a', noZone: true });
  const text = `you may put ${np(da)} and/or ${np(db)} from your hand ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 3 };
}

/**
 * FAST5 T43 (CR 701.20a, 701.20e, 608.2d): a choice among the cards of a group looked at, written as Oracle writes it: "You may reveal a creature card from among
 * them and put it into your hand", "you may put a land card from among them onto the battlefield tapped", "you may exile a nonland card from among them", "you may
 * put one of those cards back on top of your library". You choose up to one card (the choice may be empty), reveal it when the text says so (a revealed card is shown
 * to every player, CR 701.20a), and move it. Only that exact shape: one optional choice of at most one card by you among a group (with one description of the
 * cards, or none for "one of those cards"), then optionally the reveal of exactly that card, then the move of exactly that card.
 */
function chooseFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1) return null;
  const pool = groupPool(a.from);
  if (pool === null) return null;
  const r = list[i + 1];
  const revealed = r?.op === 'reveal' && r.guard === undefined && r.as === undefined && r.who.ref === 'you' && isBound(r.what, a.as) && (r.to === undefined || r.to === 'all');
  const m = list[i + (revealed ? 2 : 1)];
  // (FAST5 T75: the move may be named, for "if you put a Town card into your hand this way" reads what it did; no later step reads the cards it moved)
  if (m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || !isBound(m.what, a.as)) return null;
  const consumed = revealed ? 3 : 2;
  // std-rx4 (CR 406.1, 400.7, 608.2c; The Key to the Vault): the exiled card may be named by a later sentence ("You may exile a nonland card from among them. ... You may
  // cast the exiled card without paying its mana cost."): the chosen card (moved to a public zone, its name is re-based onto the exiled card, CR 400.7j), bound below
  // as "the exiled card" (as render/steps-zones.ts#bindMoved says it); only into exile, with a description, not revealed, and the move itself unnamed
  const namedLater = !unreadExceptRest(list, i + consumed, a.as);
  if (!unread(list, i + consumed, m.as) || (namedLater && (revealed || m.to.zone !== 'exile' || pool.desc === null))) return null;
  // edh-zones-11 (family seen-group-them): "them" also after a trigger of several creatures (Horn of the Mark), where the plain pronoun would name the attackers too;
  // "those cards" stays another way to say it where K.obj says it (edh-zones-2: where K.obj says "them", nothing else is added)
  const named = K.obj(pool.group, st, 'object');
  const them = onlySeenGroup(st, pool.group) && named.plural && named.text !== 'them' && named.text !== AMBIGUOUS ? { ...named, text: alt('them', named.text) } : named;
  if (!them.plural) return null;
  const d = m.to;
  let body: string;
  if (pool.desc === null) {
    // "put one of those cards back on top of your library": none of the group's cards is described, one is picked and goes back on top
    if (revealed || d.zone !== 'library' || d.position !== 'top' || d.order !== undefined) return null;
    body = `put one of ${them.text} back ${destPhrase(d, st, false, true)}`;
  } else {
    const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'a', noZone: true });
    if (revealed) {
      if (d.zone !== 'hand' && d.zone !== 'battlefield') return null;
      body = `reveal ${np} from among ${them.text} and put ${alt('it', 'that card')} ${destPhrase(d, st, false, true)}`;
    } else if (d.zone === 'exile') {
      if (d.faceDown === true || Object.keys(d).length !== 1) return null;
      body = `exile ${np} from among ${them.text}`;
    } else if (d.zone === 'hand' || d.zone === 'battlefield') {
      body = `put ${np} from among ${them.text} ${destPhrase(d, st, false, true)}`;
      // edh-zones-22 (CR 107.3, 608.2h; Birthing Ritual; as family move-where-x): a mana value the description computes is also "mana value X or less ..., where X is 1 plus the
      // sacrificed creature's mana value", the X said in the description and its value after the sentence
      const mv = pool.desc.manaValue;
      if (mv !== undefined && typeof mv.value === 'object' && mv.value.q !== 'X' && mv.value.q !== 'var' && (mv.op === '<=' || mv.op === '>=') && !revealed) {
        const copy = cloneState(st);
        const withX = K.np({ ...pool.desc, manaValue: { op: mv.op, value: { q: 'X' } }, zone: 'library' }, copy, { det: 'a', noZone: true });
        body = alt(body, `put ${withX} from among ${them.text} ${destPhrase(d, copy, false, true)}, where X is ${K.qty(mv.value, copy)}`);
      }
    } else return null;
  }
  const text = `you may ${body}`;
  if (namedLater) bind(st, a.as, { nouns: ['card'], plural: false, zone: 'exile', alts: ['the exiled card'] });
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed };
}

/**
 * r4-dig (CR 701.20a, 701.20e, 608.2c-d): a choice of several cards among a group looked at, which chooseFromGroup (one card) does not write: "You may reveal up to
 * two creature cards from among them and put them into your hand", "Put up to two noncreature, nonland permanent cards with mana value 3 or less from among them
 * onto the battlefield": an optional choice of up to N, then optionally the reveal of exactly those cards, then the move of exactly those cards ("you may" or not,
 * as up to N includes none); with nothing reading the choice afterwards but "the rest".
 */
function chooseUpToFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.groupLimit !== undefined) return null;
  if (a.max === 1 || a.max === 'any' || (typeof a.max === 'number' && a.max < 1)) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null) return null;
  const r = list[i + 1];
  const revealed = r?.op === 'reveal' && r.guard === undefined && r.as === undefined && r.who.ref === 'you' && isBound(r.what, a.as) && (r.to === undefined || r.to === 'all');
  const m = list[i + (revealed ? 2 : 1)];
  if (m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || m.as !== undefined || !isBound(m.what, a.as)) return null;
  const consumed = revealed ? 3 : 2;
  if (!unreadExceptRest(list, i + consumed, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const d = m.to;
  if (d.zone !== 'hand' && d.zone !== 'battlefield') return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, count: rangeWords(0, a.max, st).count, noZone: true });
  const body = revealed ? `reveal ${np} from among ${them.text} and put ${alt('them', 'those cards', 'the revealed cards' /* edh-c-77 (CR 701.20a, 608.2c; Uncovered Clues): the cards revealed are the cards moved */)} ${destPhrase(d, st, true, true)}` : `put ${np} from among ${them.text} ${destPhrase(d, st, true, true)}`;
  const text = alt(`you may ${body}`, body);
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed };
}

/**
 * r5-dig (CR 701.20a, 608.2c-d): "You may reveal up to two creature cards from among them." (Thunderous Debut): the choice of up to N cards of a description among a
 * group looked at, then the reveal of exactly those cards, and nothing else in that sentence: a later sentence names them "the revealed cards" ("If this spell was
 * bargained, put the revealed cards onto the battlefield. Otherwise, put the revealed cards into your hand."). Only that shape: an optional choice by you of up to
 * N (two or more, a number or a quantity) among a group with one description, then your reveal of exactly the chosen cards to every player, and no move of them
 * right after (chooseUpToFromGroup writes that one).
 */
function chooseUpToFromGroupThenReveal(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.max === 1 || a.max === 'any' || (typeof a.max === 'number' && a.max < 2)) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null) return null;
  const r = list[i + 1];
  if (r?.op !== 'reveal' || r.guard !== undefined || r.as !== undefined || r.who.ref !== 'you' || !isBound(r.what, a.as) || (r.to !== undefined && r.to !== 'all')) return null;
  const m = list[i + 2];
  if (m?.op === 'move' && isBound(m.what, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', plural: true, count: rangeWords(0, a.max, st).count, noZone: true });
  bind(st, a.as, { nouns: ['card'], plural: true, zone: 'library', alts: ['the revealed cards'], revealedChosen: true });
  // std-rx1 (CR 401.4, 608.2c): "..., then put the rest on the bottom of your library in a random order" in the same sentence (Zimone's Experiment): your move of the
  // cards of the group the choice did not take (refs.ts#restOfGroup), every one of them, to the bottom in a random order, nothing else
  const rest = m?.op === 'move' && m.guard === undefined && m.as === undefined && m.until === undefined && m.what.ref === 'each' && 'filter' in m.what
    && JSON.stringify(restOfGroup(m.what.filter)) === JSON.stringify({ group: (pool.group as { name: string }).name, chosen: a.as })
    && JSON.stringify(m.to) === JSON.stringify({ zone: 'library', position: 'bottom', order: 'random' });
  const text = `you may reveal ${np} from among ${them.text}${rest ? ', then put the rest on the bottom of your library in a random order' : ''}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: rest ? 3 : 2 };
}

/**
 * r5-dig (CR 608.2c-d, 400.7, 701.24a): "An opponent chooses two of those cards. Put the chosen cards into your graveyard and the rest onto the battlefield tapped,
 * then shuffle." (Elemental Teachings): another player's choice of exactly N cards among a group of cards still in the library (the cards a search found and
 * revealed), then your move of exactly the chosen cards, your move of the rest of the group and, optionally, your shuffle. Only that exact shape.
 */
function otherChoosesThenChosenAndRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  const key = playerKey(a.who);
  if (key === 'you' || key === null || typeof a.min !== 'number' || a.min < 1 || a.max !== a.min) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null) return null;
  if (b.guard !== undefined || c.guard !== undefined || b.as !== undefined || c.as !== undefined || b.until !== undefined || c.until !== undefined || !isBound(b.what, a.as)) return null;
  const rest = c.what.ref === 'each' ? restOfGroup(c.what.filter) : null;
  if (rest === null || rest.chosen !== a.as || pool.group.ref !== 'bound' || rest.group !== pool.group.name) return null;
  const d = list[i + 3];
  const shuffles = d?.op === 'shuffle' && d.guard === undefined && d.as === undefined && d.who.ref === 'you' && d.ifSearched === undefined;
  const consumed = shuffles ? 4 : 3;
  if (!unread(list, consumed + i, a.as, b.as, c.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  // edh-zones-4 (family chosen-one-that-card; Intuition): one card chosen is also "chooses one." and "put that card into your hand and the rest into your graveyard"
  const ch = byPlayer(a.who, st, 'choose', a.min === 1 ? alt(`${numWord(a.min)} of ${them.text}`, 'one') : `${numWord(a.min)} of ${them.text}`);
  const saved = st.actor;
  st.actor = 'you';
  // edh-zones-13 (Burning-Rune Demon): one card chosen is also "the chosen card", and the other card of two "the other"
  const moves = `put ${a.min === 1 ? alt('the chosen cards', 'that card', 'the chosen card') : 'the chosen cards'} ${destPhrase(b.to, st, true, true)} and ${a.min === 1 ? alt('the rest', 'the other') : 'the rest'} ${destPhrase(c.to, st, true, true)}${shuffles ? alt(', then shuffle', '. then shuffle' /* edh-zones-4 (family chosen-rest-then-shuffle): Gifts Ungiven */) : ''}`;
  st.actor = saved;
  const text = `${ch.sub}. ${moves}`;
  return { clauses: [acting('you', text, text, { standalone: true })], consumed };
}

/**
 * r5-dig (CR 608.2f, 611.2a, 108.3): "For each of those cards, its owner may play it until the end of their next turn." (Suspend Aggression): for each card of a
 * group named before (one at a time), a permission for that card's owner to play it, lasting until the end of that player's next turn. Only that exact body.
 */
function forEachOwnerMayPlay(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.as === undefined || f.over.ref !== 'bound' || f.do.length !== 1) return null;
  const e = f.do[0]!;
  if (e.op !== 'effect' || e.guard !== undefined || e.as !== undefined || e.effects.length !== 1) return null;
  const owner = JSON.stringify({ ref: 'ownerOf', object: { ref: 'bound', name: f.as } });
  const p = e.effects[0]!;
  if (p.s !== 'permit' || p.action !== 'play' || JSON.stringify(p.who) !== owner || JSON.stringify(p.of) !== JSON.stringify({ is: { ref: 'bound', name: f.as } })) return null;
  if (Object.keys(p).some((k) => !['s', 'who', 'action', 'of'].includes(k))) return null;
  // std-rx16 (CR 611.2b, 400.7; family r5dig-owner-may-play-each): "... its owner may play it for as long as it remains exiled" (Extraordinary Journey)
  const remains = e.duration.d === 'remainsExiled';
  if (!remains && (e.duration.d !== 'endOfNextTurn' || JSON.stringify(e.duration.whose) !== owner)) return null;
  const them = K.obj(f.over, st, 'object');
  if (!them.plural) return null;
  const text = `for each of ${them.text}, its owner may play it ${remains ? 'for as long as it remains exiled' : 'until the end of their next turn'}`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * r5-dig (CR 701.20a-b, 608.2c, 608.2e, 404.1): "Each opponent reveals cards from the top of their library until they reveal a land card, then puts those cards into
 * their graveyard." (Consuming Aberration, Balustrade Spy, Mirko Vosk): for each player of the reference (one at a time), that player's reveal from the top of their
 * own library until they reveal N cards of a description, then the move of every card they revealed into its owner's graveyard. Only that exact body.
 */
function playerRevealsUntilToGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const f = list[i];
  if (f?.op !== 'forEach' || f.guard !== undefined || f.do.length !== 2 || !isPlayerRef(f.over as never, st)) return null;
  const [r, m] = f.do;
  if (r?.op !== 'revealUntil' || m?.op !== 'move' || r.who.ref !== 'iterating' || r.guard !== undefined || r.revealed === undefined || m.guard !== undefined || m.as !== undefined || m.until !== undefined) return null;
  if (m.what.ref !== 'each' || JSON.stringify(m.what.filter) !== JSON.stringify({ is: { ref: 'bound', name: r.revealed }, zone: 'library' }) || JSON.stringify(m.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  if (!unread(list, i + 1, f.as, r.as, r.revealed)) return null;
  const c = r.count ?? 1;
  const xCount = typeof c === 'object' && c.q === 'X';
  if (!xCount && (typeof c !== 'number' || !Number.isInteger(c) || c < 1)) return null;
  const lf = { ...r.filter, zone: 'library' as const };
  const what = c === 1 ? K.np(lf, st, { det: 'a', noZone: true }) : `${xCount ? 'X' : numWord(c as number)} ${K.np(lf, st, { det: 'none', plural: true, noZone: true })}`;
  const subj = K.player(f.over as PlayerRef, st, 'subject');
  const sg = subj.person === 'sg';
  const those = c === 1 ? 'those cards' : alt('those cards', 'all cards revealed this way');
  const text = `${subj.text} ${sg ? 'reveals' : 'reveal'} cards from the top of their library until they reveal ${what}, then ${sg ? 'puts' : 'put'} ${those} into their graveyard`;
  return { clauses: [plain(text, { standalone: true })], consumed: 1 };
}

/**
 * FAST5 T75 (CR 701.20e, 608.2d, 110.2): "Put a random creature card from among them onto the battlefield." (Getaway Barrel): after the cards of a group were
 * revealed, one card of the described kind is chosen at random (no player decides) and put onto the battlefield under your control. Only that exact shape: one
 * choice of exactly one card, at random, among a group with one description of the cards, then the move of exactly that card onto the battlefield.
 */
function chooseRandomFromGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc === null) return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || !isBound(m.what, a.as) || m.to.zone !== 'battlefield') return null;
  if (!unreadExceptRest(list, i + 2, a.as)) return null;
  const them = K.obj(pool.group, st, 'object');
  if (!them.plural) return null;
  const np = K.np({ ...pool.desc, zone: 'library' }, st, { det: 'none', noZone: true });
  const text = `put a random ${np} from among ${them.text} ${destPhrase(m.to, st, false, true)}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * CLOUD std-msh (CR 701.20a, 402.3): "Target player reveals a number of cards from their hand equal to one plus the number of creature cards in your graveyard."
 * (Klaw, Sonic Subjugator): that player chooses that many cards of their own hand (all of them when they have fewer) and reveals them. Only that shape: a choice of
 * exactly that many by the player among the cards of their own hand, then that player's reveal of exactly those cards; the reveal names the group ("them").
 */
function revealCardsFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'reveal' || a.as === undefined || a.random === true || a.guard !== undefined || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.to !== undefined || !isBound(b.what, a.as) || JSON.stringify(a.who) !== JSON.stringify(b.who) || JSON.stringify(a.min) !== JSON.stringify(a.max)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'owner,zone' || f.zone !== 'hand' || JSON.stringify(f.owner) !== JSON.stringify(a.who)) return null;
  const who = K.player(a.who as PlayerRef, st, 'subject');
  const n = a.min;
  if (n === 'any') return null;
  const count = typeof n === 'number' ? (n === 1 ? 'a card' : `${numWord(n)} cards`) : `a number of cards`;
  const tail = typeof n === 'number' ? '' : ` equal to ${K.qty(n, st)}`;
  const verb = who.person === 'you' ? 'reveal' : 'reveals';
  const poss = who.person === 'you' ? 'your' : 'their';
  // the cards chosen and the cards revealed are one group (a later "them" may read either name, parser/lower/anaphora.ts)
  const plural = typeof n !== 'number' || n !== 1;
  bind(st, a.as, { nouns: ['card'], plural });
  bind(st, b.as, { nouns: ['card'], plural, sameAs: `b:${a.as}` });
  const text0 = `${who.text} ${verb} ${count} from ${poss} hand${tail}`;
  // r4-dig (CR 107.3, 608.2h): a computed number is also "X cards from their hand, where X is the number of Goblins you control" (Taster of Wares)
  const text = typeof n === 'number' ? text0 : alt(text0, `${who.text} ${verb} X cards from ${poss} hand, where X is ${K.qty(n, cloneState(st))}`);
  return { clauses: [plain(text, { standalone: true })], consumed: 2 };
}

/**
 * r4-dig (CR 701.20a, 401.4, 608.2c-d): "Put any number of those permanent cards onto the battlefield, then put the rest of the revealed cards on the bottom of your
 * library in a random order." (Aurora Awakener): after a reveal until (op revealUntil: `as` the cards it stopped at, `revealed` every card revealed), your choice of
 * any number of the cards it stopped at, their move onto the battlefield, and the move of the other revealed cards still in the library. Only that exact shape.
 */
function putAnyOfHitsAndRestOfRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [a, b, c] = [list[i], list[i + 1], list[i + 2]];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.groupLimit !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 'any' || !isBound(b.what, a.as) || b.guard !== undefined || c.guard !== undefined || b.as !== undefined || c.as !== undefined) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).sort().join() !== 'is,zone' || f.zone !== 'library' || f.is?.ref !== 'bound') return null;
  const hits = st.info.get(`b:${f.is.name}`);
  const r = c.what.ref === 'each' && 'filter' in c.what ? c.what.filter : null;
  if (hits === undefined || !hits.plural || r === null || Object.keys(r).sort().join() !== 'is,not,zone' || r.zone !== 'library' || r.is?.ref !== 'bound' || !isBound(r.not?.is ?? { ref: 'self' }, a.as)) return null;
  if (!st.info.has(`b:${r.is.name}`) || r.is.name === f.is.name) return null;
  const d = b.to;
  if (d.zone !== 'battlefield' || d.tapped || d.attacking || d.faceDown || d.transformed || d.attachedTo !== undefined || d.attachedToPlayer !== undefined || (d.counters ?? []).length > 0) return null;
  const e = c.to;
  if (e.zone !== 'library' || e.position !== 'bottom' || e.order !== 'random' || e.owner !== undefined) return null;
  if (!unread(list, i + 3, a.as)) return null;
  const nouns = hits.nouns.filter((n) => n !== 'card');
  const those = alt('them', 'those cards', ...nouns.map((n) => `those ${n} cards`));
  const text = `put any number of ${those} ${destPhrase(d, st, true, true)}, then put the rest of the revealed cards on the bottom of your library in a random order`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * r4-dig (CR 701.20a, 402.3): "you may reveal a Dinosaur card from your hand" (Armored Kincaller): you choose one card of the description in your own hand and
 * reveal it. Only that shape: a choice of exactly one card by you among the described cards of your hand, then your reveal of exactly that card.
 */
function revealOneFromHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'reveal' || a.as === undefined || a.random === true || a.guard !== undefined || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.to !== undefined || b.as !== undefined || !isBound(b.what, a.as) || a.who.ref !== 'you' || b.who.ref !== 'you' || a.min !== 1 || a.max !== 1) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || f.zone !== 'hand' || f.owner !== 'you' || f.controller !== undefined) return null;
  const { zone: _zone, owner: _owner, isCard: _isCard, ...desc } = f;
  if (Object.keys(desc).length === 0) return null; // "a card from your hand": revealCardsFromHand's
  bind(st, a.as, { nouns: K.nounsOf(desc), plural: false, hand: true });
  const text = `reveal ${K.np({ ...desc, zone: 'hand' }, st, { det: 'a', noZone: true })} from your hand`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * CLOUD std-msh: the group a choice "from among" picks from, as `K.obj` names it, and also "them" when it is the one group of library cards the ability saw (the
 * parser's `Seen` hole, refs.ts#onlySeenGroup): a trigger's own group ("whenever you attack": the attackers) is no candidate there.
 */
function seenGroup(group: ObjRef, st: RenderState): { text: string; plural: boolean } {
  const unique = onlySeenGroup(st, group);
  const base = K.obj(group, st, 'object');
  if (!unique || !base.plural) return base;
  return { ...base, text: base.text === AMBIGUOUS ? 'them' : alt('them', base.text) };
}

/**
 * CLOUD std-msh (CR 608.2g, 601.2, 118.9, 305.9, 202.3): "You may cast a spell from among them with mana value less than or equal to the greatest power among attacking
 * creatures you control without paying its mana cost." (Cosmic Cube): after the cards of a group were looked at, you choose up to one nonland card among them (a land
 * is never cast, CR 305.9) with the mana value the text says, if it says one, and cast it during the resolution without paying its mana cost. Only that shape: one
 * optional choice by you among a group whose cards are described as nonland with at most a mana value limit, then the free cast by you of exactly that card.
 */
/** edh-cast-10 (CR 701.20e, 402.3; Silent-Blade Oni): a choice's pool that is a group of cards of a hand a look saw, `{is: <group>, zone: 'hand', ...}`. */
function handPool(from: ObjRef): { group: ObjRef; desc: ObjectFilter | null } | null {
  if (from.ref !== 'each' || from.filter.is?.ref !== 'bound' || from.filter.zone !== 'hand') return null;
  const { is: _is, zone: _zone, ...described } = from.filter;
  return { group: from.filter.is, desc: Object.values(described).some((v) => v !== undefined) ? described : null };
}

/** std-library-3: a choice's pool that is a group of cards in exile, `{is: <group>, zone: 'exile', ...}`, as groupPool reads a group of library cards. */
function exiledPool(from: ObjRef): { group: ObjRef; desc: ObjectFilter | null } | null {
  if (from.ref !== 'each' || from.filter.is?.ref !== 'bound' || from.filter.zone !== 'exile') return null;
  const { is: _is, zone: _zone, ...described } = from.filter;
  return { group: from.filter.is, desc: Object.values(described).some((v) => v !== undefined) ? described : null };
}

/**
 * std-library-3 (CR 608.2c, 406.1; Portent of Calamity): "Then put the rest of the exiled cards into your hand.": the move into your hand of what a choice among a group
 * of exiled cards left in exile (parser/lower/mentions.ts#restOf; refs.ts#restOfExiled). Only that move.
 */
function restOfExiledToHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.what.ref !== 'each' || !restOfExiled(m.what.filter)) return null;
  if (JSON.stringify(m.to) !== JSON.stringify({ zone: 'hand' })) return null;
  const text = alt('put the rest of the exiled cards into your hand', 'put the rest into your hand'); // edh-next-99 (family rest-of-exiled-the-rest; Glorious Purpose)
  void st;
  return { clauses: [acting('you', text, `you ${text}`, { leadThen: true })], consumed: 1 };
}

/** edh-cast-10: the group is the top cards of a library a `reveal` step revealed (render/state.ts `revealedTop`), also named "cards revealed this way". */
function revealedGroup(group: unknown, st: RenderState): boolean {
  const g = group as { ref?: string; name?: string } | undefined;
  return g?.ref === 'bound' && typeof g.name === 'string' && st.info.get(`b:${g.name}`)?.revealedTop === true;
}

function castFromGroupFree(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || b.exactManaValue !== undefined || b.select !== undefined || !isBound(b.what, a.as)) return null;
  // std-library-3 (CR 406.1, 608.2g): or a group of exiled cards ("from among the exiled cards", Portent of Calamity), only with the condition below
  // trek-21 (CR 406.1, 608.2g; Lieutenant Nyota Uhura): or the exiled cards of the top of a library with the spell's own description (`anyOf`), no condition: "You may cast an instant or sorcery spell from among them without paying its mana cost."
  // edh-next-114 (CR 701.17a, 608.2g; Summons of Saruman): or the cards an earlier mill put into the graveyard, with the spell's own description, "You may cast an instant or sorcery spell with mana value X or less from among them without paying its mana cost."
  const milledPool = (): { group: ObjRef; desc: ObjectFilter | null } | null => {
    if (a.from.ref !== 'each' || a.from.filter.is?.ref !== 'bound' || a.from.filter.zone !== 'graveyard' || a.from.filter.anyOf === undefined || a.guard !== undefined) return null;
    const { is: _is, zone: _zone, ...described } = a.from.filter;
    return { group: a.from.filter.is, desc: described };
  };
  const pool = groupPool(a.from) ?? handPool(a.from) ?? (a.guard !== undefined || a.from.ref === 'each' && a.from.filter.anyOf !== undefined ? exiledPool(a.from) : null) ?? milledPool();
  if (pool === null || pool.desc === null) return null;
  const { notTypes, manaValue: descMv, anyOf: descAnyOf, ...rest } = pool.desc;
  if (a.guard === undefined && a.from.ref === 'each' && a.from.filter.zone === 'exile' && descAnyOf === undefined) return null;
  if (Object.values(rest).some((v) => v !== undefined) || notTypes?.length !== 1 || notTypes[0] !== 'Land') return null;
  // edh-next-41 (CR 601.2, 608.2g, 118.9; Velomachus Lorehold): "You may cast an instant or sorcery spell with mana value less than or equal to ~'s power from among
  // them without paying its mana cost": the spell's own description (one filter; its mana value limit is part of that description)
  if (descAnyOf !== undefined) {
    if (descAnyOf.length !== 1 || descMv !== undefined || b.maxManaValue !== undefined || a.guard !== undefined) return null;
    const milledGroup = a.from.ref === 'each' && a.from.filter.zone === 'graveyard' && pool.group.ref === 'bound' && st.info.has(`${MILLED_KEY}${pool.group.name}`);
    const them1 = milledGroup ? { text: 'them', plural: true } : seenGroup(pool.group, st);
    if (!them1.plural) return null;
    if (!unreadExceptRest(list, i + 2, a.as)) return null;
    const spell = K.np({ ...descAnyOf[0]!, stackKind: 'spell' }, st, { det: 'a' });
    const text1 = `you may cast ${spell} from among ${them1.text} without paying its mana cost`;
    return { clauses: [acting('you', text1, text1, { closesScope: true })], consumed: 2 };
  }
  // edh-cast-10 (CR 202.3, 601.2; Sunbird's Invocation): the cap may be the cast's own `maxManaValue` (the RESULTING spell's mana value, an Adventure or split half), alone or
  // with the same cap on the cards chosen among (a card whose own mana value is within it is offered; a card with a half cheaper than its mana value is not: fails closed)
  if (descMv !== undefined && b.maxManaValue !== undefined && JSON.stringify(descMv.value) !== JSON.stringify(b.maxManaValue)) return null;
  const manaValue = descMv ?? (b.maxManaValue !== undefined ? { op: '<=' as const, value: b.maxManaValue } : undefined);
  if (manaValue !== undefined && manaValue.op !== '<=') return null;
  if (!unreadExceptRest(list, i + 2, a.as)) return null;
  const them = seenGroup(pool.group, st);
  if (!them.plural) return null;
  let text = `you may cast a spell from among ${them.text} without paying its mana cost`;
  if (manaValue !== undefined) {
    const q = K.qty(manaValue.value, st);
    const v = manaValue.value;
    const short = typeof v === 'number' || (typeof v === 'object' && v !== null && 'q' in v && v.q === 'X'); // "with mana value 3 or less" names a number
    const saidAsX = saidX(v, st);
    text = alt(`you may cast a spell from among ${them.text} with mana value less than or equal to ${q} without paying its mana cost`,
      ...(short ? [`you may cast a spell with mana value ${q} or less from among ${them.text} without paying its mana cost`] : []),
      // edh-cast-10 (CR 701.20a, 608.2c; Sunbird's Invocation): the top cards a reveal revealed are also "cards revealed this way" (family revealed-this-way-group)
      ...(short && revealedGroup(pool.group, st) ? [`you may cast a spell with mana value ${q} or less from among cards revealed this way without paying its mana cost`] : []),
      // edh-cast-10 (CR 107.3, 608.2h; Sunbird's Invocation): a computed amount an earlier sentence named "X, where X is ..." is X again (render/steps-util.ts#saidX)
      ...(saidAsX ? [`you may cast a spell with mana value X or less from among ${them.text} without paying its mana cost`, `you may cast a spell with mana value X or less from among cards revealed this way without paying its mana cost`] : []));
  }
  // std-library-3 (CR 608.2c, 608.2g; Portent of Calamity): "... without paying its mana cost if you exiled four or more cards this way": the choice made only if the
  // condition holds as the instruction is performed (`guard`; skipped, it chooses nothing and nothing is cast), said after the instruction
  if (a.guard !== undefined) {
    if (manaValue !== undefined) return null;
    text = `${text} if ${K.cond(a.guard, st)}`;
  }
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * std-re (CR 608.2g, 601.2, 607.2a, 305.9): "you may cast an Ally spell from among cards you own exiled with ~" (Boiling Rock Rioter): you choose up to one nonland
 * card of the description among the cards another ability of the object exiled (the linked group, CR 607.2a), [only cards you own,] and cast it during the
 * resolution, paying its costs (CR 608.2g). Only that shape: one optional choice by you among that group, then your cast of exactly that card with nothing changed.
 * std-rs (CR 607.2a, 608.2g, 118.9): also free and of any card, "you may cast a card exiled with ~ without paying its mana cost" (Krang & Shredder): the choice is of a
 * nonland card (a land card can't be cast, CR 305.9), and the cast is without paying its mana cost; nothing else changed.
 */
function castFromLinkedExile(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || (b.free !== undefined && b.free !== true) || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || (b.play !== undefined && !(b.play === true && b.free === true)) || b.anyManaType !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  // edh-next-73 (CR 607.2a, 608.2g, 305.1, 118.9; Evercoat Ursine): "you may play one of them without paying its mana cost": a card of any kind (a land card is played, CR 305.1) among the linked
  // group, played free; "them" is the cards exiled with the object (the trigger's "if there are cards exiled with it"). Only that shape (the group alone, no quality, no owner)
  if (b.play === true) {
    if (f === null || f.zone !== 'any' || f.is?.ref !== 'linked' || f.is.link !== 'exiled' || Object.keys(f).some((k) => !['zone', 'is'].includes(k)) || !unreadExceptRest(list, i + 2, a.as)) return null;
    const text = 'you may play one of them without paying its mana cost';
    return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
  }
  // std-rx27 (CR 614.1a): the rider "If that spell would be put into a graveyard, put it on the bottom of its owner's library instead" (Kylox's Voltstrider), of a
  // permission for the cards anyone owns only
  if (b.graveyardInstead !== undefined && (f?.owner !== undefined || b.free === true)) return null;
  if (f === null || f.zone !== 'any' || f.is?.ref !== 'linked' || f.is.link !== 'exiled' || f.notTypes?.length !== 1 || f.notTypes[0] !== 'Land') return null;
  if (Object.keys(f).some((k) => !['zone', 'is', 'notTypes', 'anyOf', 'owner'].includes(k)) || (f.owner !== undefined && f.owner !== 'you')) return null;
  if (!unreadExceptRest(list, i + 2, a.as)) return null;
  if (b.free === true) {
    // std-rs: free, of any card you may cast ("a card": no description, no owner)
    if (f.owner !== undefined) return null;
    // p2-exile-play-1 (CR 607.2a, 118.9): free, of a spell of a description, "you may cast an instant spell from among cards exiled with ~ without paying its mana cost"
    if (f.anyOf !== undefined) {
      if (f.anyOf.length !== 1) return null;
      const one = `you may cast ${K.np({ ...f.anyOf[0]!, stackKind: 'spell' }, st, { det: 'a' })} from among cards exiled with ${alt('~', 'it')} without paying its mana cost`;
      return { clauses: [acting('you', one, one, { closesScope: true })], consumed: 2 };
    }
    const free = 'you may cast a card exiled with ~ without paying its mana cost';
    return { clauses: [acting('you', free, free, { closesScope: true })], consumed: 2 };
  }
  if (f.anyOf?.length !== 1) return null;
  const spell = K.np({ ...f.anyOf[0]!, stackKind: 'spell' }, st, { det: 'a' });
  // std-rx27 (family self-it): "cards exiled with it", the object itself
  const text = f.owner === 'you' ? `you may cast ${spell} from among cards you own exiled with ~`
    : `you may cast ${spell} from among cards exiled with ${alt('~', 'it')}${b.graveyardInstead === undefined ? '' : graveyardInsteadText(b.graveyardInstead)}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * std-exile-play-2-3 (CR 608.2d, 406.1, 404.1): "Exile up to one noncreature, nonland card from that player's graveyard." (Hama, the Bloodbender): your choice of at
 * most one card of the description in one player's graveyard as it resolves (no target), then the exile of exactly the chosen card. Only that shape; a later step
 * may name the exiled card ("the exiled card").
 */
function exileUpToOneFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1
    || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (b.guard !== undefined || b.until !== undefined || !isBound(b.what, a.as) || JSON.stringify(b.to) !== '{"zone":"exile"}') return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || f.zone !== 'graveyard' || f.isCard !== true || typeof f.owner !== 'object' || f.anyOf?.length !== 1 || Object.keys(f).some((k) => !['zone', 'isCard', 'owner', 'anyOf'].includes(k))) return null;
  // the chosen card, once exiled, is what a later instruction names ("the exiled card"): the choice's binding, now in exile
  bind(st, a.as, { nouns: ['card'], plural: false, zone: 'exile' });
  if (b.as !== undefined) bind(st, b.as, { nouns: ['card'], plural: false, zone: 'exile' });
  const np = K.np({ ...f.anyOf[0]!, zone: 'graveyard', owner: f.owner }, st, { det: 'none', plural: false, count: 'up to one' });
  return { clauses: [plain(`exile ${np}`)], consumed: 2 };
}

/**
 * std-exile-play-2-2 (CR 608.2g, 601.2, 118.9, 305.9, 122.1): "you may cast a spell from among cards you own in exile with dream counters on them without paying its
 * mana cost" (Goliath Daydreamer): you choose up to one nonland card you own in exile that has a counter of that kind (a land card is never cast, CR 305.9) and cast
 * it during the resolution without paying its mana cost. Only that shape: the one optional choice by you, then your free cast of exactly that card.
 */
function castFromOwnedExileWithCounters(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || b.maxManaValue !== undefined || b.exactManaValue !== undefined || b.graveyardInstead !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  // edh-next-123 (CR 122.1, 406.1; Tasha, the Witch Queen): or the cards in exile whoever owns them ("from among cards in exile with page counters on them"): no `owner`
  if (f === null || f.zone !== 'exile' || (f.owner !== 'you' && f.owner !== undefined) || f.notTypes?.length !== 1 || f.notTypes[0] !== 'Land' || Object.keys(f).some((k) => !['zone', 'owner', 'notTypes', 'counters'].includes(k))) return null;
  const c = f.counters as Record<string, unknown> | undefined;
  if (c === undefined || typeof c['kind'] !== 'string' || Object.keys(c).length !== 1) return null;
  if (!unreadExceptRest(list, i + 2, a.as)) return null;
  const text = `you may cast a spell from among cards ${f.owner === 'you' ? 'you own ' : ''}in exile with ${c['kind']} counters on them without paying its mana cost`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * std-exile-play-2-4 (CR 105.2, 608.2c-d, 701.20a, 406.1; Sanar, Innovative First-Year): "For each of those colors, you may exile a card of that color from among the
 * revealed cards." right after "reveal cards from the top of your library until you reveal X nonland cards, where X is the number of colors among permanents you
 * control": for each color (white, blue, black, red, green, in that order) among the permanents you control, your optional choice of one revealed card of that color,
 * then the exile of every card chosen. The order of the colors limits nothing (each choice is optional and a card exiled is no longer among the revealed cards
 * still in the library). Only exactly that shape after exactly that reveal; the exiled cards are "the exiled cards" afterwards.
 */
const WUBRG = ['W', 'U', 'B', 'R', 'G'] as const;
function exileOneOfEachColorFromRevealed(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const r = list[i - 1];
  if (r?.op !== 'revealUntil' || typeof r.revealed !== 'string' || r.guard !== undefined || JSON.stringify(r.who) !== '{"ref":"you"}') return null;
  if (JSON.stringify(r.count) !== JSON.stringify({ q: 'distinct', what: 'colors', among: { ref: 'each', filter: { controller: 'you' } } }) || JSON.stringify(r.filter) !== '{"notTypes":["Land"]}') return null;
  const names: string[] = [];
  for (let k = 0; k < 5; k++) {
    const c = list[i + k];
    const color = WUBRG[k]!;
    if (c?.op !== 'chooseObjects' || c.as === undefined || c.who.ref !== 'you' || c.min !== 0 || c.max !== 1 || c.random === true || c.groupLimit !== undefined || c.perPlayer !== undefined) return null;
    const want = { ref: 'each', filter: { is: { ref: 'bound', name: r.revealed }, zone: 'library', colors: [color] } };
    const guard = { cond: 'exists', of: { ref: 'each', filter: { controller: 'you', colors: [color] } } };
    if (JSON.stringify(c.from) !== JSON.stringify(want) || JSON.stringify(c.guard) !== JSON.stringify(guard)) return null;
    names.push(c.as);
  }
  const m = list[i + 5];
  if (m?.op !== 'move' || m.guard !== undefined || m.until !== undefined || JSON.stringify(m.to) !== '{"zone":"exile"}') return null;
  if (JSON.stringify(m.what) !== JSON.stringify({ ref: 'union', of: names.map((n) => ({ ref: 'bound', name: n })) })) return null;
  if (list.slice(i + 6).some((x) => names.some((n) => JSON.stringify(x).includes(`"name":"${n}"`)))) return null;
  // (family exiled-card-of-this-ability: what the choices exiled is "the exiled cards" afterwards; a name of the binding, no alternative group)
  if (m.as !== undefined) bind(st, m.as, { nouns: ['card'], plural: true, zone: 'exile', thisWay: 'exiled this way', alts: ['the exiled cards'] });
  return { clauses: [plain('for each of those colors, you may exile a card of that color from among the revealed cards')], consumed: 6 };
}

/**
 * std-rx27 (CR 608.2g, 601.2, 118.9, 305.9, 101.4, 614.1a): "you may cast a spell from each opponent's graveyard without paying its mana cost. If a spell cast this way
 * would be put into a graveyard, exile it instead." (Jetsam): for each opponent in turn, you choose up to one nonland card in that player's graveyard and cast it
 * during the resolution without paying its mana cost, then optionally the rider of its cast (zz-cloud/std-rx27.json). Only that shape.
 */
function castFromEachOpponentGraveyard(list: EffectStep[], i: number): Folded | null {
  const s = list[i];
  if (s?.op !== 'forEach' || s.guard !== undefined || s.as === undefined || JSON.stringify(s.over) !== '{"ref":"each","who":"opponent"}' || s.do.length !== 2) return null;
  const [a, b] = s.do;
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || b.maxManaValue !== undefined || b.exactManaValue !== undefined || !isBound(b.what, a.as)) return null;
  const want = { ref: 'each', filter: { notTypes: ['Land'], zone: 'graveyard', owner: { ref: 'bound', name: s.as }, isCard: true } };
  if (JSON.stringify(a.from) !== JSON.stringify(want)) return null;
  const gi = b.graveyardInstead;
  if (gi !== undefined && JSON.stringify(gi) !== '{"to":{"zone":"exile"}}') return null;
  if (!unreadExceptRest(list, i + 1, a.as) || !unreadExceptRest(list, i + 1, s.as)) return null;
  const text = "you may cast a spell from each opponent's graveyard without paying its mana cost";
  // the rider is a sentence of its own after the cast, which may itself follow another instruction ("Each opponent mills three cards, then you may cast ...")
  const rider = gi !== undefined ? [plain('if a spell cast this way would be put into a graveyard, exile it instead', { standalone: true })] : [];
  return { clauses: [acting('you', text, text, { closesScope: true }), ...rider], consumed: 1 };
}

/**
 * std-rw7 (CR 608.2g, 601.2, 118.9, 305.9): "you may cast a spell with mana value 4 or less from your hand without paying its mana cost" (the Expertise cycle),
 * "you may cast an artifact, instant, or sorcery spell from your graveyard" (Bilbo, Thief in the Night): you choose up to one nonland card of ONE description
 * in your hand or your graveyard (a land is never cast, CR 305.9) and cast it during the resolution (CR 608.2g), from your hand without paying its mana cost
 * (CR 118.9), from your graveyard paying its costs; then optionally the sentence of its `graveyardInstead` (render/steps-zones.ts#graveyardInsteadText, CR 614.1a).
 * Only that shape: one optional choice by you among the cards of that zone of yours, then your cast of exactly that card with nothing else changed.
 */
function castFromOwnZone(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.who.ref !== 'you' || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || b.maxManaValue !== undefined || b.exactManaValue !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  // edh-b-8 (CR 202.3, 404.1; Diviner of Mist): "you may cast an instant or sorcery spell from your graveyard with mana value 4 or less without paying its mana cost": a limit on the mana
  // value of the card chosen from the graveyard (a number, "or less"), said after the zone
  // edhd36 (CR 202.3, 608.2h; Counterpoint): the limit is the mana value of the spell the same ability countered, "with mana value less than or equal to that spell's mana value" (one target of the ability)
  const mvThat = f?.manaValue !== undefined && f.manaValue.op === '<=' && typeof f.manaValue.value === 'object' && f.manaValue.value.q === 'stat' && f.manaValue.value.stat === 'manaValue' && f.manaValue.value.of.ref === 'target' && f.zone === 'graveyard' && f.owner === 'you' && b.free === true && list[0]?.op === 'counter' ? "that spell's" : null;
  const mvLimit = f?.manaValue !== undefined && f.manaValue.op === '<=' && typeof f.manaValue.value === 'number' && f.zone === 'graveyard' ? f.manaValue.value : mvThat !== null ? mvThat : null;
  // edh-d-16 (CR 202.3, 404.1, 118.9; Spectral Arcanist): a free cast from a graveyard of any player, with a counted limit on the mana value: "you may cast an instant or sorcery spell with mana value
  // less than or equal to the number of Spirits you control from a graveyard without paying its mana cost" (no owner in the filter; the limit is said before the zone)
  const anyGrave = f !== null && f.owner === undefined && f.zone === 'graveyard' && b.free === true && f.manaValue?.op === '<=' && typeof f.manaValue.value === 'object';
  if (f === null || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined && !(mvLimit !== null && k === 'manaValue')).sort().join() !== (anyGrave ? 'anyOf,isCard,manaValue,notTypes,zone' : 'anyOf,isCard,notTypes,owner,zone')) return null;
  if (f.manaValue !== undefined && mvLimit === null && !anyGrave) return null;
  // edh-b-8 (CR 404.1, 608.2g; Sorcerous Squall): the graveyard of the player an earlier instruction of the ability named, "from that player's graveyard" (only a free cast from a graveyard)
  const theirs = typeof f.owner === 'object' && f.owner !== null && 'ref' in f.owner && f.zone === 'graveyard' && b.free === true;
  if ((f.owner !== 'you' && !theirs && !anyGrave) || f.isCard !== true || f.notTypes?.length !== 1 || f.notTypes[0] !== 'Land' || f.anyOf?.length !== 1) return null;
  // from your hand only free, from your graveyard paid or (edh-cast-14, template eff.edhc14.cast.fromGraveyard.free; Sword of Once and Future) free: the wordings of zz-cloud/std-rw7.json and zz-cloud/edh-cast-14.json
  // edh-next-114 (CR 608.2g, 118.9, 400.1; Kaya the Inexorable's emblem, template eff.edhn114.cast.fromHandGraveyardOrExile.free): a free cast from your hand, your graveyard or among the cards you own in exile
  const threeZones = Array.isArray(f.zone) && f.zone.join() === 'hand,graveyard,exile' && b.free === true && b.graveyardInstead === undefined;
  if (!(f.zone === 'hand' && b.free === true) && f.zone !== 'graveyard' && !threeZones) return null;
  const kind = f.anyOf[0]!;
  if (kind.zone !== undefined || kind.stackKind !== undefined || kind.owner !== undefined || kind.controller !== undefined) return null;
  if (!unreadExceptRest(list, i + 2, a.as)) return null;
  const spell = K.np({ ...kind, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' });
  if (threeZones) {
    const own3 = `you may cast ${spell} from your hand, from your graveyard, or from among cards you own in exile without paying its mana cost`;
    return { clauses: [acting('you', own3, own3, { closesScope: true })], consumed: 2 };
  }
  if (anyGrave) {
    const qty = K.qty(f.manaValue!.value, st);
    const own = `you may cast ${spell} with mana value less than or equal to ${qty} from a graveyard without paying its mana cost`;
    const text = `${own}${b.graveyardInstead !== undefined ? graveyardInsteadText(b.graveyardInstead) : ''}`;
    return { clauses: [acting('you', text, text, { closesScope: true, ...(b.graveyardInstead !== undefined ? { standalone: true } : {}) })], consumed: 2 };
  }
  const whose = theirs ? alt("that player's", K.player(f.owner as never, st, 'possessive').text) : 'your';
  const text = `you may cast ${spell} from ${whose} ${f.zone}${mvLimit !== null ? (mvThat !== null ? ` with mana value less than or equal to ${mvThat} mana value` : ` with mana value ${mvLimit} or less`) : ''}${b.free === true ? ' without paying its mana cost' : ''}${b.graveyardInstead !== undefined ? graveyardInsteadText(b.graveyardInstead) : ''}`;
  // (edh-b-8, Sorcerous Squall: after another player's mill the cast joins with ", then" and the rider is a sentence of its own, as in castFromEachOpponentGraveyard)
  if (theirs && b.graveyardInstead !== undefined) {
    const own = `you may cast ${spell} from ${whose} ${f.zone}${mvLimit !== null ? ` with mana value ${mvLimit} or less` : ''} without paying its mana cost`;
    return { clauses: [acting('you', own, own, { closesScope: true }), plain(graveyardInsteadText(b.graveyardInstead).replace(/^\. /, ''), { standalone: true })], consumed: 2 };
  }
  return { clauses: [acting('you', text, text, { closesScope: true, ...(b.graveyardInstead !== undefined ? { standalone: true } : {}) })], consumed: 2 };
}

/**
 * r3-dig (CR 608.2d, 406.1, 400.7): "exile a card at random from your graveyard" (Tersa Lightshatter): one card of your graveyard chosen at random (no player decides),
 * then exiled. The chosen card is named afterwards ("You may play that card this turn": the card in exile, the binding re-based by the move, CR 400.7j), so the
 * choice is bound as a card in exile. Only that exact shape: one choice by you of exactly one card, at random, among the cards in your graveyard, then the move of
 * exactly that card into exile.
 */
function exileRandomFromGraveyard(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (a.from.ref !== 'each') return null;
  // std-cardcopy-4 (CR 608.2d): also a described card, "exile a permanent card from your graveyard at random" (Sin, Spira's Punishment), as Oracle orders it
  const f = a.from.filter;
  // edh-d-16 (CR 202.3, 608.2d; Storm of Memories): also with a limit on the mana value, "an instant or sorcery card with mana value 3 or less from your graveyard at random"
  const mvAtMost = f.manaValue?.op === '<=' && typeof f.manaValue.value === 'number' ? f.manaValue.value : undefined;
  const { manaValue: _mv, ...fNoMv } = f;
  const base = mvAtMost !== undefined ? fNoMv : f;
  const kind = f.anyOf?.length === 1 && JSON.stringify({ ...base, anyOf: undefined }) === JSON.stringify({ anyOf: undefined, zone: 'graveyard', owner: 'you', isCard: true }) ? f.anyOf[0]! : undefined;
  if (kind === undefined && JSON.stringify(f) !== JSON.stringify({ zone: 'graveyard', owner: 'you', isCard: true })) return null;
  if (mvAtMost !== undefined && kind === undefined) return null;
  // (edh-zones-12: the exile of an ability whose other abilities read "cards exiled with ~" carries the link, CR 607.2a; what it records is no wording)
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || (m.link !== undefined && m.link !== 'exiled') || m.remember !== undefined || !isBound(m.what, a.as)) return null;
  if (JSON.stringify(m.to) !== JSON.stringify({ zone: 'exile' })) return null;
  // (std-cardcopy-4: the card exiled is also "the exiled card" later, family exiled-card-participle: a reading of the binding)
  bind(st, a.as, { nouns: ['card'], plural: false, zone: 'exile', alts: ['the exiled card'] }); // (edh-d-20: also for a card of no description, Advanced Reconstruction)
  // edh-zones-12 (family exile-described-at-random): the described card is also "exile an instant or sorcery card at random from your graveyard" (Arcane Bombardment)
  const described = kind === undefined ? undefined : withArticle(`${K.np(kind, st, { det: 'none' })} card`);
  // edh-zones-22 (Wondrous Crucible): a description of no card type of its own, "a nonland card", is said with the card noun (the plain noun would be "nonland permanent")
  const asCard = kind === undefined || kind.types !== undefined || kind.subtypes !== undefined || kind.allTypes !== undefined || kind.anyOf !== undefined ? undefined : K.np({ ...kind, isCard: true, zone: 'graveyard' }, cloneState(st), { det: 'a', noZone: true });
  const text = described === undefined ? alt('exile a card at random from your graveyard', 'exile a card from your graveyard at random') /* edh-d-20 (Advanced Reconstruction) */
    : mvAtMost !== undefined ? `exile ${described} with mana value ${mvAtMost} or less from your graveyard at random`
    : alt(`exile ${described} from your graveyard at random`, `exile ${described} at random from your graveyard`, ...(asCard === undefined ? [] : [`exile ${asCard} at random from your graveyard`, `exile ${asCard} from your graveyard at random`]));
  return { clauses: [acting('you', text, text)], consumed: 2 };
}

/**
 * CLOUD std-misc (CR 607.2a, 608.2d, 110.2; Omenpath Journey): "choose a card at random exiled with ~ and put it onto the battlefield tapped": one card of those a
 * linked ability exiled, chosen at random (no player decides), then put onto the battlefield under your control. Only that exact shape: one choice by you of exactly
 * one card, at random, among the linked exiled cards, then the move of exactly that card onto the battlefield, nothing reading the choice after it.
 */
function chooseRandomLinkedThenBattlefield(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const m = list[i + 1];
  if (a?.op !== 'chooseObjects' || a.as === undefined || a.random !== true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (a.from.ref !== 'linked') return null;
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined || !isBound(m.what, a.as) || m.to.zone !== 'battlefield') return null;
  if (!unreadExceptRest(list, i + 2, a.as)) return null;
  const text = `choose a card at random exiled with ${K.obj({ ref: 'self' }, st, 'object').text} and put it ${destPhrase(m.to, st, false, true)}`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * r3-cost (CR 608.2g, 601.2, 118.9, 305.9, 202.3): "You may cast any number of spells [with mana value X or less] from among them without paying their mana
 * costs." (Kotis, the Fangkeeper; Villainous Wealth): after cards were exiled, you choose any number of the nonland ones among them (a land is never cast,
 * CR 305.9), with the mana value the text says if it says one, and cast each during the resolution without paying its mana cost. Only that shape: one choice
 * by you of any number among a group exiled earlier, described as nonland with at most a mana value limit, then the free cast by you of exactly the chosen cards.
 */
/** edh-cast-2: "the nonland cards exiled this way" / "the instant cards exiled this way" for `{is: <a plural bound group>, notTypes:['Land'] | types:[T], zone:'exile'}`, else null. */
function exiledThisWayOfType(f: ObjectFilter, st: RenderState): { text: string; plural: boolean } | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  if (f.is?.ref !== 'bound' || f.zone !== 'exile') return null;
  const group = K.obj(f.is, st, 'object');
  if (!group.plural || group.text === AMBIGUOUS) return null;
  if (keys === 'is,notTypes,zone' && f.notTypes?.length === 1 && f.notTypes[0] === 'Land') return { text: 'the nonland cards exiled this way', plural: true };
  if (keys === 'is,types,zone' && f.types?.length === 1) return { text: `the ${f.types[0]!.toLowerCase()} cards exiled this way`, plural: true };
  return null;
}

/**
 * edh-top-8 (CR 608.2c, 406.1; Plargg and Nassari): "the other cards exiled this way" for `{is: <a plural bound group>, not: {is: <a choice>}, zone:'exile'}` (parser/holes/object.ts#rest, the anaphor
 * "rest-exiled": lower/mentions.ts#restOf), the cards of an earlier exile's group that a choice among it did not pick, else null.
 */
function otherExiledThisWay(f: ObjectFilter, st: RenderState): { text: string; plural: boolean } | null {
  const keys = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join();
  if (keys !== 'is,not,zone' || f.is?.ref !== 'bound' || f.zone !== 'exile' || f.not?.is?.ref !== 'bound') return null;
  const group = K.obj(f.is, st, 'object');
  if (!group.plural || group.text === AMBIGUOUS) return null;
  return { text: 'the other cards exiled this way', plural: true };
}

function castAnyFromExiledFree(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  // edh-next-121 (CR 107.3, 608.2h; Wand of Wonder): or "up to X", the X a die-roll table defines (the variable X, parser/lower/die-roll.ts#defineXRows)
  const varX = a?.op === 'chooseObjects' && typeof a.max === 'object' && a.max !== null && JSON.stringify(a.max) === '{"q":"var","name":"X"}';
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || (a.max !== 'any' && !(typeof a.max === 'number' && a.max >= 2) && !varX) || a.groupLimit !== undefined || a.perPlayer !== undefined) return null; // std-rj: also "up to two"
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || !isBound(b.what, a.as)) return null;
  if (a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const { is, zone, notTypes, types, manaValue, ...rest } = a.from.filter;
  // std-rx29 (CR 304.1, 307.1; Kylox, Visionary Inventor): "any number of instant and/or sorcery spells from among the exiled cards": only those two card types
  const spells = types === undefined && notTypes?.length === 1 && notTypes[0] === 'Land' ? 'spells'
    : notTypes === undefined && types?.length === 2 && types[0] === 'Instant' && types[1] === 'Sorcery' ? 'instant and/or sorcery spells' : null;
  // edh-d-96 (CR 608.2g, 304.1, 307.1; Epic Experiment): of any number, the two card types are also said bare, "you may cast instant and sorcery spells with mana value X or less from among them ..."
  const bareTypes = spells === 'instant and/or sorcery spells' && a.max === 'any';
  // edh-cast-2 (CR 608.2c, 400.7; Etali, Primal Conqueror): "from among the nonland cards exiled this way": the earlier exile's group of one description
  // (parser/holes/edhc2.ts writes `{ref:'each', filter:{is: <the group>, notTypes:['Land']}}`, or one card type)
  const typed = is?.ref === 'each' && 'filter' in is ? (exiledThisWayOfType(is.filter, st) ?? otherExiledThisWay(is.filter, st)) : null; // edh-top-8: the other cards exiled this way
  // edh-d-101 (CR 607.2a; Forger's Foundry): or the cards exiled with the source by a linked ability ("from among cards exiled with ~", `{ref:'linked', link:'exiled'}`)
  const linkedGroup = is?.ref === 'linked' && is.link === 'exiled' ? { text: 'cards exiled with ~', plural: true } : null;
  if ((is?.ref !== 'bound' && typed === null && linkedGroup === null) || zone !== 'exile' || Object.values(rest).some((v) => v !== undefined) || spells === null) return null;
  if (manaValue !== undefined && manaValue.op !== '<=') return null;
  // edh-next-121 (CR 400.7h, 608.2c; Kefka, Dancing Mad): or "Then each player who owns a spell you cast this way ...", a loop over the spells the cast kept in the choice (`dropUncast`)
  const castThisWay = b.dropUncast === true && list.slice(i + 2).every((x) => !JSON.stringify(x).includes(`"name":"${a.as}"`) || (x.op === 'forEach' && x.over.ref === 'bound' && x.over.name === a.as && !JSON.stringify(x.do).includes(`"name":"${a.as}"`)));
  if (!unreadExceptRest(list, i + 2, a.as) && !castThisWay) return null; // edh-next-99: and "Put the rest into your hand." (Glorious Purpose) reads the choice too
  const them = typed ?? linkedGroup ?? K.obj(is!, st, 'object');
  if (!them.plural || them.text === AMBIGUOUS) return null;
  const mv = manaValue === undefined ? '' : ` with mana value ${K.qty(manaValue.value, st)} or less`;
  // edh-next-121 (family cards-exiled-this-way-bare; Wand of Wonder): the instant and/or sorcery spells too, "from among cards exiled this way"
  const among = spells === 'spells' && them.text !== 'them' ? alt(them.text, 'those nonland cards', 'cards exiled this way') : alt(them.text, 'cards exiled this way');
  const counted = `${a.max === 'any' ? 'any number of' : varX ? `up to ${K.qty(a.max as Quantity, st)}` : `up to ${numWord(a.max as number)}`} ${spells}`;
  const text = `you may cast ${bareTypes ? alt(counted, 'instant and sorcery spells') : counted}${mv} from among ${among} without paying their mana costs`; // pc-exile-play-2 (family spells-from-among-nonland-cards); edh-next-108 (family cards-exiled-this-way-bare)
  st.info.set(`r:${a.as}`, { ...(st.info.get(`r:${a.as}`) ?? { nouns: ['card'], plural: true }), castChosen: true }); // edh-d-96: the chosen cards were cast (render/refs.ts, "all cards exiled this way that weren't cast")
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/**
 * r3-cost (CR 401.2, 608.2h, 608.2g, 118.9, 202.3; Kotis, the Fangkeeper): "Exile the top X cards of their library, where X is the amount of damage dealt. You may
 * cast any number of spells with mana value X or less from among them without paying their mana costs.": the move of a computed number of a player's top
 * cards into exile, then the choice and the free cast of castAnyFromExiledFree among exactly those cards with the SAME number as the mana value limit (one X
 * named in both sentences). Only that shape.
 */
function exileTopXThenCastAnyFree(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (m?.op !== 'move' || m.as === undefined || m.guard !== undefined || m.what.ref !== 'topCards' || m.to.zone !== 'exile' || Object.keys(m.to).length !== 1) return null;
  if (Object.keys(m).some((k) => !['op', 'as', 'what', 'to'].includes(k))) return null;
  const n = m.what.count;
  if (typeof n !== 'object' || n.q === 'X' || n.q === 'var') return null;
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.from.ref !== 'each' || !('filter' in a.from)) return null;
  const mv = a.from.filter.manaValue;
  const is = a.from.filter.is;
  if (mv === undefined || JSON.stringify(mv.value) !== JSON.stringify(n) || is?.ref !== 'bound' || is.name !== m.as) return null;
  const owner = K.player(m.what.player, st, 'possessive').text;
  const x = K.qty(n, st);
  const head = `exile the top x cards of ${owner} library, where x is ${x}`;
  bind(st, m.as, { nouns: ['card'], plural: true, zone: 'exile' });
  const rest = castAnyFromExiledFree(list, i + 1, st);
  if (rest === null) return null;
  const text = `${head}. you may cast any number of spells with mana value x or less from among them without paying their mana costs`;
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 3 };
}

/**
 * FAST5 T63 (CR 601.2, 608.2g, 118.9, 107.3b): "You may cast a noncreature spell from your hand without paying its mana cost." (Yue, the Moon Spirit): you choose up
 * to one noncreature, nonland card in your hand (a land is never a spell, CR 305.9, and a creature card is excluded), then cast it during the resolution without
 * paying its mana cost. Only that exact shape: one optional choice by you among the cards of your hand, then the free cast by you of exactly that card.
 */
function chooseThenCastFree(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1) return null;
  if (b.guard !== undefined || b.as !== undefined || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'isCard,notTypes,owner,zone' || f.zone !== 'hand' || f.owner !== 'you' || f.isCard !== true) return null;
  const not = [...(f.notTypes ?? [])].sort().join();
  if (not !== 'Creature,Land') return null;
  const text = 'you may cast a noncreature spell from your hand without paying its mana cost';
  return { clauses: [acting('you', text, text, { closesScope: true })], consumed: 2 };
}

/** edh-next-144: is the step at `k` "If you don't, ..." on the instruction named `name` (an `if` that it was not done, with no `else` or guard), the last step that reads that name? */
function nextIsDidNot(list: EffectStep[], k: number, name: string): boolean {
  const c = list[k];
  return c?.op === 'if' && c.guard === undefined && c.else === undefined && c.cond.cond === 'did' && c.cond.step === name && c.cond.not === true
    && Object.keys(c.cond).length === 3 && !list.slice(k + 1).some((x) => JSON.stringify(x).includes(JSON.stringify(name)));
}

/**
 * r4-cost (CR 601.2, 608.2g, 118.9, 202.3; Buster Sword): "you may cast a spell from your hand with mana value less than or equal to that damage without paying its
 * mana cost": you choose up to one nonland card of the description in your hand (a land is never cast, CR 305.9) whose mana value is at most the amount, then cast
 * it during the resolution without paying its mana cost. Only that shape: one optional choice by you among the cards of your hand of ONE description, with an
 * "at most" mana value, then the free cast by you of exactly that card.
 */
function castFromHandFreeMv(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'cast' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.groupLimit !== undefined) return null;
  // edh-next-144 (CR 608.2c; In Search of Greatness): with an exact mana value, the cast may be named (`as`) for an "If you don't, ..." right after it (the cast did not happen)
  const named = typeof b.as === 'string' && a.from.ref === 'each' && 'filter' in a.from && a.from.filter.manaValue?.op === '==' && nextIsDidNot(list, i + 2, b.as);
  if (b.guard !== undefined || (b.as !== undefined && !named) || b.who.ref !== 'you' || b.free !== true || b.optional !== undefined || b.costChange !== undefined || b.transformed !== undefined
    || b.copyIn !== undefined || b.play !== undefined || b.anyManaType !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join() !== 'anyOf,isCard,manaValue,notTypes,owner,zone') return null;
  if (f.zone !== 'hand' || f.owner !== 'you' || f.isCard !== true || f.notTypes?.length !== 1 || f.notTypes[0] !== 'Land' || f.anyOf?.length !== 1 || (f.manaValue?.op !== '<=' && f.manaValue?.op !== '==')) return null;
  const kind = f.anyOf[0]!;
  if (kind.zone !== undefined || kind.stackKind !== undefined || kind.manaValue !== undefined || (kind.notTypes ?? []).includes('Land')) return null;
  if (!unread(list, i + 2, a.as)) return null;
  const spell = K.np({ ...kind, zone: 'stack', stackKind: 'spell' }, st, { det: 'a' });
  // "that damage": the amount of the damage event that triggered the ability (the only words the parser reads as that amount here, zz-cloud/r4-cost.json)
  const v = f.manaValue.value;
  const amount = typeof v === 'object' && v !== null && 'q' in v && v.q === 'eventAmount' ? 'that damage' : K.qty(v, st);
  // edh-next-144 (CR 202.3; In Search of Greatness, eff.edhn144.cast.fromHand.free.mvEqual): an exact mana value, "with mana value equal to 1 plus the greatest mana value among ..."
  if (f.manaValue.op === '==') {
    const exact = `you may cast ${spell} from your hand with mana value equal to ${amount} without paying its mana cost`;
    if (named) {
      const c = list[i + 2] as Extract<EffectStep, { op: 'if' }>;
      const rest = `${exact}. if you don't, ${K.steps(c.then, st)}`;
      return { clauses: [acting('you', rest, rest, { closesScope: true })], consumed: 3 };
    }
    return { clauses: [acting('you', exact, exact, { closesScope: true })], consumed: 2 };
  }
  const text = `you may cast ${spell} from your hand with mana value less than or equal to ${amount} without paying its mana cost`;
  // pc-exile-play-1 (family cast-hand-free-mv-or-less): a number says "with mana value 8 or less", after "from your hand" or before it
  const short = typeof v === 'number';
  // (a computed number may be said as X: "..., where X is the number of attacking creatures")
  const read = short ? alt(text, `you may cast ${spell} from your hand with mana value ${amount} or less without paying its mana cost`, `you may cast ${spell} with mana value ${amount} or less from your hand without paying its mana cost`)
    : alt(text, `you may cast ${spell} with mana value x or less from your hand without paying its mana cost, where x is ${amount}`);
  return { clauses: [acting('you', read, read, { closesScope: true })], consumed: 2 };
}

/**
 * FAST5X E25 (CR 701.58a, 701.58e, 701.20e, 608.2c, 401.4): "Look at the top five cards of your library, cloak two of them, and put the rest on the bottom of
 * your library in a random order": you look at a fixed number of top cards, choose exactly N of them, cloak those cards (one at a time) and put the cards you
 * did not choose on the bottom of your library. Only that exact shape: the look by you, then one choice by you of a fixed number among exactly those cards,
 * then the cloak of exactly the chosen cards, then the move of exactly the rest.
 */
function lookCloakRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const l = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  const c = list[i + 3];
  if (l?.op !== 'look' || a?.op !== 'chooseObjects' || b?.op !== 'action' || c?.op !== 'move') return null;
  if ([l, a, b, c].some((x) => x.guard !== undefined)) return null;
  if (l.who.ref !== 'you' || l.at.ref !== 'topCards' || l.at.player.ref !== 'you' || l.at.zone !== undefined || typeof l.at.count !== 'number' || l.at.count < 2 || l.as === undefined) return null;
  if (a.who.ref !== 'you' || a.random === true || typeof a.min !== 'number' || a.min < 1 || a.max !== a.min || a.min >= l.at.count || a.as === undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null || !isBound(pool.group, l.as)) return null;
  if (b.action !== 'cloak' || b.who.ref !== 'you' || b.n !== undefined || b.arg !== undefined || b.as !== undefined || b.subject === undefined || !isBound(b.subject as ObjRef, a.as)) return null;
  if (c.what.ref !== 'each' || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined) return null;
  const rest = restOfGroup(c.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== l.as) return null;
  if (c.to.zone !== 'library' || c.to.position !== 'bottom' || c.to.owner !== undefined) return null;
  if (!unread(list, i + 4, l.as, a.as)) return null;
  const text = `look at the top ${numWord(l.at.count)} cards of your library, cloak ${numWord(a.min)} of them, and put the rest ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 4 };
}

/**
 * Cloud std-woe (CR 701.20e, 608.2c-d, 401.4): "Look at the top four cards of your library, then put up to two of them back on top of your library in any order and the
 * rest into your graveyard" (Rowan's Grim Search): you look at a fixed number of top cards, choose at most N of them (perhaps none), put those back on top in an order
 * you choose and the cards you did not choose into your graveyard. Only that exact shape: the look by you, then one choice by you of up to a fixed number among exactly
 * those cards, then the move of exactly the chosen cards on top of your library in any order, then the move of exactly the rest into your graveyard.
 */
function lookPutBackUpToRest(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const l = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  const c = list[i + 3];
  if (l?.op !== 'look' || a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move') return null;
  if ([l, a, b, c].some((x) => x.guard !== undefined)) return null;
  if (l.who.ref !== 'you' || l.at.ref !== 'topCards' || l.at.player.ref !== 'you' || l.at.zone !== undefined || typeof l.at.count !== 'number' || l.at.count < 2 || l.as === undefined) return null;
  if (a.who.ref !== 'you' || a.random === true || a.min !== 0 || typeof a.max !== 'number' || a.max < 1 || a.max >= l.at.count || a.as === undefined || a.groupLimit !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null || !isBound(pool.group, l.as)) return null;
  if (!isBound(b.what, a.as) || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'library', position: 'top', order: 'chosen' })) return null;
  if (c.what.ref !== 'each' || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined) return null;
  const rest = restOfGroup(c.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== l.as || JSON.stringify(c.to) !== JSON.stringify({ zone: 'graveyard' })) return null;
  if (!unread(list, i + 4, l.as, a.as)) return null;
  const text = `look at the top ${numWord(l.at.count)} cards of your library, then put up to ${numWord(a.max)} of them back ${destPhrase(b.to, st, true, true)} and the rest ${destPhrase(c.to, st, true, true)}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 4 };
}

/**
 * edh-zones-2 (CR 701.20e, 401.4, 608.2c-d; Thassa's Oracle): "Put up to one of them on top of your library and the rest on the bottom of your library in a random
 * order": after a look at (or a reveal of) top cards, you choose at most N of exactly those cards, put the chosen cards on top of your library (in an order you choose)
 * and the cards you did not choose on the bottom in a random order. Only that exact shape (the look itself is its own step before).
 */
function putUpToTopRestBottom(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'move' || [a, b, c].some((x) => x.guard !== undefined)) return null;
  if (a.who.ref !== 'you' || a.random === true || a.min !== 0 || typeof a.max !== 'number' || a.max < 1 || a.as === undefined || a.groupLimit !== undefined) return null;
  const pool = groupPool(a.from);
  if (pool === null || pool.desc !== null || pool.group.ref !== 'bound') return null;
  if (!isBound(b.what, a.as) || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined) return null;
  if (JSON.stringify(b.to) !== JSON.stringify({ zone: 'library', position: 'top', order: 'chosen' })) return null;
  if (c.what.ref !== 'each' || c.as !== undefined || c.until !== undefined || c.link !== undefined || c.remember !== undefined) return null;
  const rest = restOfGroup(c.what.filter);
  if (rest === null || rest.chosen !== a.as || rest.group !== pool.group.name || JSON.stringify(c.to) !== JSON.stringify({ zone: 'library', position: 'bottom', order: 'random' })) return null;
  if (!unread(list, i + 3, pool.group.name, a.as)) return null;
  const text = `put up to ${numWord(a.max)} of them on top of your library and the rest on the bottom of your library in a random order`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 3 };
}

/**
 * edh-zones-2 (CR 701.17a, 608.2c-d, 400.7j; Ripples of Undeath): "put a card from among those cards into your hand" for the cards an earlier mill put into a graveyard
 * (the step may sit apart from the mill, behind a payment): you choose exactly one of exactly those cards (they are in a public zone, the binding follows them) and put it
 * into your hand. Only that exact shape: the group alone, no description.
 */
function putCardFromGroupToHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || [a, b].some((x) => x.guard !== undefined) || a.who.ref !== 'you' || a.random === true || a.min !== 1 || a.max !== 1 || a.as === undefined) return null;
  if (a.groupLimit !== undefined || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort().join(',') !== 'is,zone' || f.zone !== 'any' || f.is?.ref !== 'bound') return null;
  if (!isBound(b.what, a.as) || b.as !== undefined || b.until !== undefined || b.link !== undefined || b.remember !== undefined || JSON.stringify(b.to) !== JSON.stringify({ zone: 'hand' })) return null;
  if (!unread(list, i + 2, a.as)) return null;
  if (!st.info.has(`${MILLED_KEY}${f.is.name}`)) return null; // the cards of a mill (render/steps-cards.ts#mill) and nothing else
  const text = `put a card from among ${alt('those cards', 'them', 'the milled cards')} into your hand`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/**
 * edh-zones-2 (CR 701.20e, 401.4, 406.1, 608.2c-d; Expressive Iteration): "Put one of them into your hand, put one of them on the bottom of your library, and exile one of
 * them." after a look at the top cards: you choose one of exactly those cards for your hand, one of the others for the bottom of your library, and one of the rest to exile.
 * Only that exact shape (three choices by you, each of exactly one card of the looked-at group and not the card put on the bottom, three moves).
 */
function handBottomExileOfGroup(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const [c1, m1, c2, m2, c3, m3] = list.slice(i, i + 6);
  if (c1?.op !== 'chooseObjects' || m1?.op !== 'move' || c2?.op !== 'chooseObjects' || m2?.op !== 'move' || c3?.op !== 'chooseObjects' || m3?.op !== 'move') return null;
  const all = [c1, m1, c2, m2, c3, m3];
  if (all.some((x) => x.guard !== undefined)) return null;
  for (const c of [c1, c2, c3]) {
    if (c.who.ref !== 'you' || c.random === true || c.min !== 1 || c.max !== 1 || c.as === undefined || c.groupLimit !== undefined) return null;
  }
  const g1 = groupPool(c1.from);
  const g2 = groupPool(c2.from);
  if (g1 === null || g2 === null || g1.desc !== null || g2.desc !== null || g1.group.ref !== 'bound' || JSON.stringify(g1.group) !== JSON.stringify(g2.group)) return null;
  const rest = restOfGroup(c3.from.ref === 'each' ? c3.from.filter : ({} as never));
  if (rest === null || rest.group !== g1.group.name || rest.chosen !== c2.as) return null;
  for (const [m, c] of [[m1, c1], [m2, c2], [m3, c3]] as const) {
    if (!isBound(m.what, c.as) || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  }
  if (m1.as !== undefined || m2.as !== undefined) return null;
  if (JSON.stringify(m1.to) !== JSON.stringify({ zone: 'hand' }) || JSON.stringify(m2.to) !== JSON.stringify({ zone: 'library', position: 'bottom' }) || JSON.stringify(m3.to) !== JSON.stringify({ zone: 'exile' })) return null;
  if (!unread(list, i + 6, c1.as, c2.as, g1.group.name)) return null;
  // what is exiled is "the exiled card" for a later instruction (render/steps-zones.ts#bindMoved's alternative)
  if (m3.as === undefined) bind(st, c3.as!, { nouns: ['card'], plural: false, zone: 'exile', alts: ['the exiled card'] });
  else return null;
  const text = 'put one of them into your hand, put one of them on the bottom of your library, and exile one of them';
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 6 };
}

/** FAST5X E25 (CR 701.58a): "Cloak a card from your hand": you choose one card of your hand and cloak it (the choice is yours only, CR 402.3). */
function cloakFromHand(list: EffectStep[], i: number): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'action' || a.guard !== undefined || b.guard !== undefined || a.as === undefined || a.random === true) return null;
  if (a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.from.ref !== 'each') return null;
  const f = a.from.filter;
  if (f.zone !== 'hand' || f.owner !== 'you' || Object.keys(f).some((k) => k !== 'zone' && k !== 'owner')) return null;
  if (b.action !== 'cloak' || b.who.ref !== 'you' || b.n !== undefined || b.arg !== undefined || b.as !== undefined || b.subject === undefined || !isBound(b.subject as ObjRef, a.as)) return null;
  if (!unread(list, i + 2, a.as)) return null;
  return { clauses: [acting('you', 'cloak a card from your hand', 'you cloak a card from your hand')], consumed: 2 };
}

/**
 * FAST5X E25 (CR 406.3, 701.58a, 701.58e): "Exile any number of face-up creatures you control with disguise in a face-down pile, shuffle that pile, then cloak
 * them": you choose any number of the described permanents, exile exactly those face down, then cloak exactly those exiled cards in a random order. Only that
 * exact shape.
 */
function exilePileCloak(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  const c = list[i + 2];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || c?.op !== 'action' || [a, b, c].some((x) => x.guard !== undefined)) return null;
  if (a.who.ref !== 'you' || a.random === true || a.min !== 0 || a.max !== 'any' || a.as === undefined || a.from.ref !== 'each') return null;
  if (!isBound(b.what, a.as) || b.as === undefined || JSON.stringify(b.to) !== JSON.stringify({ zone: 'exile', faceDown: true }) || b.until !== undefined || b.link !== undefined || b.remember !== undefined) return null;
  if (c.action !== 'cloak' || c.arg !== 'shuffle' || c.who.ref !== 'you' || c.n !== undefined || c.as !== undefined || c.subject === undefined || !isBound(c.subject as ObjRef, b.as)) return null;
  if (!unread(list, i + 3, a.as, b.as)) return null;
  const what = K.np(a.from.filter, st, { det: 'none', plural: true, count: 'any number of' });
  return { clauses: [acting('you', `exile ${what} in a face-down pile, shuffle that pile, then cloak them`, `you exile ${what} in a face-down pile, shuffle that pile, then cloak them`)], consumed: 3 };
}

/**
 * FAST5X E25 (CR 701.62a-b, 608.2c): "Whenever you manifest dread, put a card you put into your graveyard this way into your hand": the card the manifest dread
 * put into the graveyard is the event's subject (effects/handlers/face-ops.ts). Only under exactly that trigger.
 */
function dreadBinnedToHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  if (m?.op !== 'move' || m.guard !== undefined || m.as !== undefined || m.until !== undefined || m.link !== undefined || m.remember !== undefined) return null;
  if (JSON.stringify(m.what) !== '{"ref":"event","role":"subject"}' || JSON.stringify(m.to) !== '{"zone":"hand"}') return null;
  const tr = st.trigger ?? [];
  if (tr.length !== 1 || JSON.stringify(tr[0]) !== JSON.stringify({ ev: 'action', verb: 'manifestDread', actor: 'you' })) return null;
  return { clauses: [acting('you', 'put a card you put into your graveyard this way into your hand', 'you put a card you put into your graveyard this way into your hand')], consumed: 1 };
}

/** The computed quantities (`definedX`) a step uses, as canonical JSON, each once, in the order they occur. */
function definedQuantities(step: EffectStep): string[] {
  const out: string[] = [];
  const walk = (v: unknown): void => {
    if (typeof v !== 'object' || v === null) return;
    if (Array.isArray(v)) { v.forEach(walk); return; }
    if (typeof (v as { q?: unknown }).q === 'string' && definedX(v)) {
      const k = JSON.stringify(v);
      if (!out.includes(k)) out.push(k);
      return;
    }
    Object.values(v).forEach(walk);
  };
  walk(step);
  return out;
}

/** `step` with every occurrence of the quantity `q` (canonical JSON) replaced by `{q: 'X'}`. */
export function withX(step: EffectStep, q: string): EffectStep {
  const walk = (v: unknown): unknown => {
    if (typeof v !== 'object' || v === null) return v;
    if (Array.isArray(v)) return v.map(walk);
    if (JSON.stringify(v) === q) return { q: 'X' };
    return Object.fromEntries(Object.entries(v).map(([k, x]) => [k, walk(x)]));
  };
  return walk(step) as EffectStep;
}

let inSharedWhereX = false;

/**
 * std-rx29 (CR 701.21a, 608.2h, 107.3; Kylox, Visionary Inventor): "sacrifice any number of other creatures, then exile the top X cards of your library, where X is
 * their total power": the choice and the sacrifice of any number of permanents (Cloud C7's pair, chooseThenSacrificeAny) and the instructions after it, which use
 * one computed number of what was sacrificed (read as it last existed), said with one X defined after all of them. The plain reading stays the first one.
 */
function sacrificeAnyThenWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (inSharedWhereX || list.length - i < 3 || a?.op !== 'chooseObjects' || b?.op !== 'sacrifice' || a.as === undefined || !isBound(b.what, a.as)) return null;
  if (definedQuantities(a).length > 0 || definedQuantities(b).length > 0) return null;
  // the instructions up to the last one that uses the number (the sentence that defines X ends there)
  let last = -1;
  for (let k = i + 2; k < list.length; k++) if (definedQuantities(list[k]!).length > 0) last = k;
  if (last < 0) return null;
  const rest = list.slice(i, last + 1);
  const used = [...new Set(rest.slice(2).flatMap((s) => definedQuantities(s)))];
  if (used.length !== 1 || !used[0]!.includes(JSON.stringify({ ref: 'bound', name: a.as }))) return null;
  const q = used[0]!;
  inSharedWhereX = true;
  try {
    const where = cloneState(st);
    // the group is named as the choice alone binds it (the folds of both readings bind nothing for it), before anything the later instructions name
    const sacrificed = cloneState(st);
    K.steps([a], sacrificed);
    const steps = K.steps(rest.map((s) => withX(s, q)), where);
    const plainText = K.steps(rest, st);
    const whereText = `${steps}, where X is ${K.qty(JSON.parse(q), sacrificed)}`;
    return { clauses: [plain(alt(plainText, whereText), { standalone: true })], consumed: rest.length };
  } finally {
    inSharedWhereX = false;
  }
}

/**
 * cloud std-spm (CR 107.3, 608.2h): a whole list of two or more instructions that use the same computed number (the first one and another) is also said with one X defined after them: "draw
 * X cards, then you may put a permanent card with mana value X or less from your hand onto the battlefield, where X is the sacrificed creature's mana value" (Venom,
 * Lethal Protector), "draw X cards, then mill X cards, where X is that creature's power". The number is read as each instruction runs, the same as without the X
 * (CR 608.2h). The plain reading stays the first one; only the list from its first step to its last, and only when no other fold reads it.
 */
function sharedWhereX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  // std-rx29 (Spry and Mighty): ... also the instructions after a first one that does not use it ("Choose exactly two creatures you control. You draw X cards and
  // the chosen creatures get +X/+X ..., where X is the difference between the chosen creatures' powers"): the list from the first instruction that uses it
  if (inSharedWhereX || list.length - i < 2 || list.slice(0, i).some((s) => definedQuantities(s).length > 0)) return null;
  const rest = list.slice(i);
  // the first instruction and at least one more use it (a choice's follower, "put it onto the battlefield", may use none)
  const firstUses = definedQuantities(rest[0]!);
  const shared = firstUses.filter((q) => rest.slice(1).some((s) => definedQuantities(s).includes(q)));
  if (shared.length !== 1) return null;
  const q = shared[0]!;
  inSharedWhereX = true;
  try {
    const where = cloneState(st);
    const whereText = `${K.steps(rest.map((s) => withX(s, q)), where)}, where X is ${K.qty(JSON.parse(q), where)}`;
    const plainText = K.steps(rest, st);
    return { clauses: [plain(alt(plainText, whereText), { standalone: true })], consumed: rest.length };
  } finally {
    inSharedWhereX = false;
  }
}

/**
 * std-lci (CR 701.20a, 701.20e, 610.3, 608.2d): "Look at target opponent's hand. You may exile a nonland card from it until ~ leaves the battlefield." (Deep-Cavern
 * Bat; "Exile a nonland card from it until ...", The River Warlock): a choice of one card out of a hand an earlier step of the ability revealed or looked at, by
 * you, then that card moved to exile (with or without a duration). The choice and the move are one instruction in the text; "You choose a nonland card from it.
 * Exile that card ..." (FAST5 T46) stays two clauses.
 */
function exileFromSeenHand(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || a.who.ref !== 'you') return null;
  if (b.guard !== undefined || b.to.zone !== 'exile' || b.to.faceDown === true || b.link !== undefined || b.as !== undefined || Object.keys(b.to).length !== 1) return null;
  if (handChoice(a, st) === null) return null;
  const optional = a.min === 0;
  const [folded, apart, ownerSays] = withVariants<{ imp: string; sub: string } | null>(st, [
    (v) => {
      const inHand = handChoice(a, v)!;
      const until = b.until !== undefined ? ` ${K.dur(b.until, v)}` : '';
      bind(v, a.as, { nouns: ['card'], plural: false, optional });
      const text = `exile ${inHand} from it${until}`;
      return optional ? { imp: `you may ${text}`, sub: `you may ${text}` } : { imp: text, sub: `you ${text}` };
    },
    // the two instructions written apart, as without this fold: "You choose a nonland card from it. Exile that card." (FAST5 T46; a "may" choice ends its sentence)
    (v) => {
      const ca = K.clause(a, v);
      const cb = K.clause(b, v);
      const sep = optional ? '. ' : alt('. ', ' and ', ', then ', ', ', '. then ');
      return { imp: `${within(ca, 'you')}${sep}${within(cb, 'you')}`, sub: `${fragment(ca)}${sep}${fragment(cb)}` };
    },
    // edh-d-33 (CR 406.1, 608.2c; Ghastlord of Fugue; family owner-exiles-chosen-card): "You choose a card from it. That player exiles that card.": the exile said with the hand's owner as its
    // subject (a card in a hand is exiled the same whoever exiles it); only the owner a target player or the player of the trigger's event, no duration
    (v) => {
      const owner = st.info.get(`b:${(a.from as { filter: ObjectFilter }).filter.is!.ref === 'bound' ? ((a.from as { filter: ObjectFilter }).filter.is as { name: string }).name : ''}`)?.handOwner;
      if (optional || b.until !== undefined || owner === undefined || !(/^\{"ref":"target","id":"t\d+"\}$/.test(owner) || owner === '{"ref":"event","role":"recipient"}')) return null;
      const ca = K.clause(a, v);
      const who = K.player(JSON.parse(owner) as never, cloneState(v), 'subject').text;
      const what = K.obj(b.what, cloneState(v), 'object').text;
      K.clause(b, v); // (binds what the move bound, as the plain reading does)
      return { imp: `${within(ca, 'you')}. ${who} exiles ${what}`, sub: `${fragment(ca)}. ${who} exiles ${what}` };
    },
  ]);
  return { clauses: [acting('you', alt(folded!.imp, apart!.imp, ...(ownerSays ? [ownerSays.imp] : [])), alt(folded!.sub, apart!.sub, ...(ownerSays ? [ownerSays.sub] : [])), optional ? { standalone: true } : {})], consumed: 2 };
}

/**
 * std-rx30 (CR 701.20a, 610.3; the parser's eff.stdrx30.exile.handCardOrObj): "You may exile a nonland card from their hand or the chosen creature until ~ leaves the
 * battlefield." (Cloak and Dagger, Entwined): one object chosen among the cards of a revealed hand and a target, then exiled. Only that shape.
 */
function exileFromHandOrTarget(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || !isBound(b.what, a.as) || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1) return null;
  if (b.guard !== undefined || b.to.zone !== 'exile' || b.to.faceDown === true || b.link !== undefined || b.as !== undefined || Object.keys(b.to).length !== 1) return null;
  const from = a.from;
  if (from.ref !== 'union' || from.of.length !== 2) return null;
  const [h, o] = from.of as [ObjRef, ObjRef];
  if (o.ref !== 'each' || Object.keys(o.filter).length !== 1 || o.filter.is?.ref !== 'target') return null;
  const inHand = handChoice({ ...a, from: h }, st);
  if (inHand === null) return null;
  const obj = K.obj(o.filter.is, st, 'object').text;
  const until = b.until !== undefined ? ` ${K.dur(b.until, st)}` : '';
  bind(st, a.as, { nouns: ['card'], plural: false });
  const text = `exile ${inHand} from ${alt('their hand', "that player's hand")} or ${obj}${until}`;
  return { clauses: [acting('you', text, `you ${text}`)], consumed: 2 };
}

/** CLOUD std-tmt: is `f` the cards a linked exile instruction exiled (CR 607.2a), in any zone, with nothing else but the extra keys `keys` (the check of `extra`)? */
function linkedExiled(f: ObjectFilter, keys: string[], extra: (f: ObjectFilter) => boolean): boolean {
  const set = Object.keys(f).filter((k) => (f as Record<string, unknown>)[k] !== undefined).sort();
  return f.is?.ref === 'linked' && f.is.link === 'exiled' && f.zone === 'any' && set.join() === ['is', 'zone', ...keys].sort().join() && extra(f);
}

/**
 * CLOUD std-tmt (CR 607.2a, 608.2d, 110.2, 400.3): "Return a creature card exiled with this land to the battlefield under your control. Return each other card exiled
 * with this land to its owner's hand." (Northampton Farm): you choose one card of the described kind among the cards the linked exile instruction exiled and put it
 * onto the battlefield under your control; the other cards it exiled go to their owners' hands. Only that shape: one choice by you of exactly one card, the move of
 * exactly that card, and optionally the move of exactly the rest of the linked cards to their owners' hands (no later step reads the choice).
 */
function linkedReturnOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || (a.min !== 1 && a.min !== 0) || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.until !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  // edh-d-77 (CR 607.2a, 608.2d, 400.3, 603.5; Ethereal Forager): "you may return an instant or sorcery card exiled with ~ to its owner's hand": your optional choice of one card of the
  // description among the linked cards, to its owner's hand (no later step reads it)
  if (a.min === 0) {
    if (f === null || !linkedExiled(f, ['isCard', 'anyOf'], (x) => x.isCard === true && x.anyOf?.length === 1) || b.to.zone !== 'hand' || Object.keys(b.to).length !== 1 || !unread(list, i + 2, a.as)) return null;
    return { clauses: [plain(`you may return ${withArticle(`${K.np(f.anyOf![0]!, st, { det: 'none' })} card`)} exiled with ~ to its owner's hand`)], consumed: 2 };
  }
  // r3-refs (CR 607.2a, 608.2d, 400.3): "Put a card exiled with this Saga into its owner's hand." (any one of the linked cards, chosen by you, to its owner's hand)
  if (f !== null && linkedExiled(f, ['isCard'], (x) => x.isCard === true) && b.to.zone === 'hand' && Object.keys(b.to).length === 1 && unread(list, i + 2, a.as)) {
    const it = alt('~', 'it');
    return { clauses: [plain(alt(`put a card exiled with ${it} into its owner's hand`, `return a card exiled with ${it} to its owner's hand`))], consumed: 2 };
  }
  // edh-next-34 (CR 607.2a, 108.3, 400.3; family linked-put-one-owned-hand; Endless Horizons): a card of the linked exile that you OWN goes to your hand (the owner is you)
  if (f !== null && linkedExiled(f, ['isCard', 'owner'], (x) => x.isCard === true && x.owner === 'you') && b.to.zone === 'hand' && Object.keys(b.to).length === 1 && unread(list, i + 2, a.as)) {
    const it = alt('~', 'it');
    // edh-next-62 (Gustha's Scepter; family linked-return-one-owned-hand): and "return a card you own exiled with ~ to your hand"
    return { clauses: [plain(alt(`put a card you own exiled with ${it} into your hand`, `return a card you own exiled with ${it} to your hand`))], consumed: 2 };
  }
  // edh-c-93 (CR 607.2a, 110.2a; family linked-return-one-battlefield-bare; Purgatory): "return a card exiled with ~ to the battlefield" (any one of the linked cards, chosen by you, put onto the battlefield under your control, the words no "under your control")
  if (f !== null && linkedExiled(f, ['isCard'], (x) => x.isCard === true) && b.to.zone === 'battlefield' && typeof b.to.controller === 'object' && b.to.controller.ref === 'you' && Object.keys(b.to).length === 2 && unread(list, i + 2, a.as)) {
    const it = alt('~', 'it');
    return { clauses: [plain(`return a card exiled with ${it} to the battlefield`)], consumed: 2 };
  }
  if (f === null || !linkedExiled(f, ['isCard', 'anyOf'], (x) => x.isCard === true && x.anyOf?.length === 1)) return null;
  const d = b.to;
  // std-cardcopy-2 (CR 607.2a, 122.6, 614.1c): "put a creature card exiled with it onto the battlefield under your control with two additional +1/+1 counters on it"
  // (Sothera, the Supervoid): the chosen card enters with that many counters of one kind besides any it would enter with
  const added = d.zone === 'battlefield' && d.counters?.length === 1 && typeof d.counters[0]!.count === 'number' && d.counters[0]!.count >= 1 ? d.counters[0]! : undefined;
  if (d.zone !== 'battlefield' || typeof d.controller !== 'object' || d.controller.ref !== 'you' || Object.keys(d).some((k) => k !== 'zone' && k !== 'controller' && !(k === 'counters' && added !== undefined))) return null;
  const c = added !== undefined ? undefined : list[i + 2];
  const rest = c?.op === 'move' && c.guard === undefined && c.as === undefined && c.until === undefined && c.what.ref === 'each' && 'filter' in c.what
    && linkedExiled(c.what.filter, ['not'], (x) => x.not !== undefined && isBound(x.not.is as ObjRef, a.as) && Object.keys(x.not).length === 1)
    && c.to.zone === 'hand' && Object.keys(c.to).length === 1;
  const consumed = rest ? 3 : 2;
  // edh-next-105 (CR 607.2a, 110.2, 608.2c; Emperor of Bones): "put a creature card exiled with ~ onto the battlefield under your control with a finality counter on it. It gains haste.
  // Sacrifice it at the beginning of the next end step.": a later sentence goes on about the card put onto the battlefield (the name is read again by those steps): it is said "it"
  // / "that creature" for the later steps, as a token a sentence made is. Only the counter wording of this fold (`added`), where the parser reads the card's pronoun
  const readLater = !unread(list, i + consumed, a.as);
  // edh-d-77 (CR 607.2a, 110.2, 608.2c; Yggdrasil, Rebirth Engine): also without counters: "put a creature card exiled with ~ onto the battlefield under your control. It gains haste until end of turn."
  if (readLater && rest) return null;
  const it = alt('~', 'it');
  const noun = K.np(f.anyOf![0]!, st, { det: 'none' });
  if (readLater) bind(st, a.as, { nouns: [noun, 'card'], plural: false });
  const card = withArticle(`${noun} card`);
  const n = added === undefined ? 0 : (added.count as number);
  // edh-zones-7 (CR 607.2a, 110.2; family linked-put-onto-battlefield): the chosen card is also "put onto the battlefield under your control" (Nautiloid Ship), as with counters
  const one = added === undefined ? alt(`return ${card} exiled with ${it} to the battlefield under your control`, `put ${card} exiled with ${it} onto the battlefield under your control`)
    : `put ${card} exiled with ${it} onto the battlefield under your control with ${n === 1 ? 'an' : numWord(n)} ${alt('additional ', '')}${added.kind} counter${n === 1 ? '' : 's'} on it`; // edh-next-56 (Chaos Shrine's Black Crystal): "with a finality counter on it" says the same (family linked-put-one-counter-words)
  const clauses = [plain(one)];
  if (rest) clauses.push(plain(`return each other card exiled with ${it} to its owner's hand`, { breakBefore: true }));
  return { clauses, consumed };
}

/**
 * r3-copy (CR 607.2a, 608.2d, 707.2, 707.9b): "Create a token that's a copy of a card exiled with this Saga, except ..." (The Cloning of Shredder): you choose one card
 * among the cards the linked exile instruction exiled and create a token copy of it. Only that shape: one choice by you of exactly one linked card, then one token
 * copy of exactly that card for you (no count or flags; a binding of the token copy is allowed), and no later step reads the choice.
 */
function linkedCopyOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'copy' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.result !== 'token' || b.who.ref !== 'you' || b.count !== undefined || b.tapped !== undefined || b.attacking !== undefined
    || b.noManaCost !== undefined || b.newTargets !== undefined || !isBound(b.what, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || !linkedExiled(f, ['isCard'], (x) => x.isCard === true)) return null;
  if (!unread(list, i + 2, a.as)) return null;
  // edh-zones-12 (CR 707.2, 111.1; Mimic Vat): the token copy is a new object a later sentence names ("It gains haste. Exile it at the beginning of the next end step."), as copy does
  if (b.as !== undefined) bind(st, b.as, { nouns: ['token'], plural: false });
  const general = (mods: Modification[]): string => K.staticEffect({ s: 'continuous', affects: { ref: 'subject' }, mods }, st);
  const exc = b.except && b.except.length > 0 ? `, except ${copyExceptText(b.except, general)}` : '';
  return { clauses: [plain(`create a token that's a copy of a card exiled with ~${exc}`)], consumed: 2 };
}

/**
 * trek-6 (CR 607.2a, 608.2d; assimilate, Star Trek reminder text): "Assimilate a creature card exiled with ~." (Borg Cube): you choose one card of the described kind
 * among the cards the linked exile instruction exiled and assimilate it. Only that shape: one choice by you of exactly one linked card, then the assimilate action
 * by you on exactly that card (it may carry a name: "If you can't" reads whether it put a card onto the battlefield), and no later step reads the choice.
 */
function linkedAssimilateOne(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'chooseObjects' || b?.op !== 'action' || b.action !== 'assimilate' || a.as === undefined || a.random === true || a.guard !== undefined || a.who.ref !== 'you' || a.min !== 1 || a.max !== 1 || a.groupLimit !== undefined) return null;
  if (b.guard !== undefined || b.who.ref !== 'you' || b.n !== undefined || b.arg !== undefined || b.choices !== undefined || b.subject === undefined || !isBound(b.subject as ObjRef, a.as)) return null;
  const f = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  if (f === null || !linkedExiled(f, ['isCard', 'anyOf'], (x) => x.isCard === true && x.anyOf?.length === 1)) return null;
  if (!unread(list, i + 2, a.as)) return null;
  const card = withArticle(`${K.np(f.anyOf![0]!, st, { det: 'none' })} card`);
  return { clauses: [plain(`assimilate ${card} exiled with ${alt('~', 'it')}`)], consumed: 2 };
}

/**
 * CMD5 (family token-and-token; Standard merge wave 4: also r3-fx's eff.r3fx.token.two.kinds, whose own one-clause fold `twoTokenKinds` printed only the
 * joined form and is gone): "create a Clue token and a Food token", "create a Treasure token and a 2/2 blue Bird creature token with flying" (CR 111.1,
 * 111.2, 608.2c): two plain creations of tokens by you in a row also share one verb. The steps keep their own clauses (so every joiner reading stays); the second
 * one may drop its "create". Nothing bound, no condition, and the second clause must start with the verb.
 */
function tokenAndToken(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'createToken' || b?.op !== 'createToken') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || a.who.ref !== 'you' || b.who.ref !== 'you') return null;
  const first = K.clause(a, st);
  const second = K.clause(b, st);
  if (!second.imp.startsWith('create ') || second.standalone === true || first.standalone === true) return null;
  const rest = second.imp.slice('create '.length);
  const [imp, sub] = [second.imp, second.sub].map((x) => alt(x, rest)) as [string, string]; // one reviewed group (family token-and-token)
  return { clauses: [first, { ...second, imp, sub }], consumed: 2 };
}

/**
 * r4-fxz (CR 107.3, 608.2h): "~ gets +X/+0 until end of turn, where X is the amount of mana spent to cast that spell. If X is 4 or more, draw a card." The X the
 * instruction defines with "where X is" is the X of the next sentence's condition (parser/lower/quantities.ts carries it): an `if` whose condition compares that
 * one computed number (the only one the instruction uses) is also said with "X". Only a plain `if` (no else) right after the instruction.
 */
function whereXThenIfX(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a === undefined || b?.op !== 'if' || b.guard !== undefined || (b.else?.length ?? 0) > 0 || b.cond.cond !== 'compare' || typeof b.cond.right !== 'number') return null;
  const qs = definedQuantities(a);
  const left = JSON.stringify(b.cond.left);
  if (qs.length !== 1 || qs[0] !== left || definedQuantities(b).some((q) => q !== left)) return null;
  const first = K.clause(a, st);
  const plainSecond = K.clause(b, cloneState(st));
  const second = K.clause({ ...b, cond: { ...b.cond, left: { q: 'X' } } } as EffectStep, st);
  const [imp, sub] = (['imp', 'sub'] as const).map((k) => alt(plainSecond[k], second[k])) as [string, string]; // one reviewed group (family where-x-then-if-x)
  return { clauses: [first, { ...second, imp, sub }], consumed: 2 };
}

/**
 * Standard round I (CR 701.17a, 608.2c, 400.7j, 400.3, 110.2; Avatar Destiny): "Return this card to its owner's hand and up to one creature card milled this way to
 * the battlefield under your control." after a mill step of the same ability: the source itself goes to its owner's hand, and you choose at most one of the cards
 * that mill put into a graveyard (they are found in the public zone they moved to) and put it onto the battlefield under your control. Only that shape: the source
 * to the hand, one optional choice by you of at most one card of a description among the milled cards, the move of exactly that card, and no later step that reads the choice.
 */
function returnSelfAndMilled(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const m = list[i];
  const a = list[i + 1];
  const b = list[i + 2];
  if (m?.op !== 'move' || a?.op !== 'chooseObjects' || b?.op !== 'move' || a.as === undefined) return null;
  if (m.what.ref !== 'self' || m.to.zone !== 'hand' || Object.keys(m.to).length !== 1 || m.guard !== undefined || m.as !== undefined || m.until !== undefined) return null;
  if (a.who.ref !== 'you' || a.min !== 0 || a.max !== 1 || a.random === true || a.guard !== undefined || a.groupLimit !== undefined || a.perPlayer !== undefined) return null;
  if (b.guard !== undefined || b.as !== undefined || b.until !== undefined || !isBound(b.what, a.as)) return null;
  const d = b.to;
  if (d.zone !== 'battlefield' || typeof d.controller !== 'object' || d.controller.ref !== 'you' || Object.keys(d).length !== 2) return null;
  const from = a.from.ref === 'each' && 'filter' in a.from ? a.from.filter : null;
  // CR 701.17c: a milled card is found in the public zone it moved to (`zone: 'any'` beside the binding of the mill step)
  if (from === null || Object.keys(from).length !== 3 || from.zone !== 'any' || from.is === undefined || from.is.ref !== 'bound' || from.anyOf?.length !== 1) return null;
  if (st.info.get(`r:${from.is.name}`)?.thisWay !== 'milled this way') return null;
  if (!unread(list, i + 3, a.as)) return null;
  const upTo = K.np({ ...from.anyOf[0]!, zone: 'graveyard' as const }, st, { det: 'none', plural: false, count: 'up to one', noZone: true });
  const self = K.obj(m.what, st, 'object').text;
  return { clauses: [plain(`return ${self} to its owner's hand and ${upTo} milled this way to the battlefield under your control`)], consumed: 3 };
}

/**
 * std-rw6 (CR 702.171b, 301.7b, 205.1b, 608.2c; Alacrian Armory): "Until end of turn, that permanent becomes saddled if it's a Mount and becomes an artifact
 * creature if it's a Vehicle": two conditional instructions about one object, the first making it saddled (which lasts until end of turn) and the second adding
 * the card types artifact and creature until end of turn, said as one sentence with the duration first (family saddled-or-creature-by-type). The two plain
 * sentences stay a reading.
 */
function saddledOrCreatureByType(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'if' || b?.op !== 'if' || a.cond.cond !== 'matches' || b.cond.cond !== 'matches') return null;
  if (a.guard !== undefined || b.guard !== undefined || a.as !== undefined || b.as !== undefined || (a.else?.length ?? 0) > 0 || (b.else?.length ?? 0) > 0) return null;
  const o = JSON.stringify(a.cond.object);
  if (JSON.stringify(b.cond.object) !== o || a.then.length !== 1 || b.then.length !== 1) return null;
  const saddle = a.then[0]!;
  const lasting = b.then[0]!;
  if (saddle.op !== 'designateObject' || saddle.designation !== 'saddled' || JSON.stringify(saddle.what) !== o || saddle.guard !== undefined || saddle.as !== undefined) return null;
  if (lasting.op !== 'effect' || JSON.stringify(lasting.duration) !== JSON.stringify({ d: 'endOfTurn' }) || lasting.effects.length !== 1 || lasting.guard !== undefined) return null;
  const e = lasting.effects[0]!;
  if (e.s !== 'continuous' || JSON.stringify(e.affects) !== o || JSON.stringify(e.mods) !== JSON.stringify([{ layer: 4, types: { add: ['Artifact', 'Creature'] } }])) return null;
  if (Object.keys(e).some((k) => !['s', 'affects', 'mods'].includes(k))) return null;
  const apart = cloneState(st);
  const plainText = `${K.steps([a], apart)}. ${K.steps([b], apart)}`; // one step at a time: the pair again would come back here
  const subject = K.obj(a.cond.object, st, 'subject').text;
  const kind = (f: ObjectFilter): string => withArticle(K.np(f, st, { det: 'none' }));
  const compact = `until end of turn, ${subject} becomes saddled if it's ${kind(a.cond.filter)} and becomes an artifact creature if it's ${kind(b.cond.filter)}`;
  return { clauses: [plain(alt(plainText, compact), { standalone: true })], consumed: 2 };
}

/**
 * edh-perms-10 (CR 614.1c, 608.2c; parser riders rid.edhpm10.*): a move with `countersIf` among the steps a fold reads is folded without it, and the sentence that gives the counters
 * ends the fold's last clause ("You may put a creature card from among them onto the battlefield. If that card has mana value 3 or less, it enters with three additional +1/+1
 * counters on it."). Only when that move is the last step the fold consumed: a fold that reads on past it (the rest on the bottom) is not told where the sentence goes.
 */
export function foldAt(list: EffectStep[], i: number, st: RenderState): Folded | null {
  let j = -1;
  for (let k = i; k < Math.min(list.length, i + 6); k++) if (list[k]!.op === 'move' && (list[k] as Extract<EffectStep, { op: 'move' }>).to.countersIf !== undefined) { j = k; break; }
  if (j < 0) return foldAtPlain(list, i, st);
  const m = list[j] as Extract<EffectStep, { op: 'move' }>;
  const { countersIf, ...to } = m.to;
  const r = foldAtPlain(list.map((x, k) => (k === j ? ({ ...m, to } as EffectStep) : x)), i, st);
  if (r === null || j >= i + r.consumed) return r; // (a fold that stops before the move leaves it to the step that renders it alone, render/steps-zones.ts#move)
  if (j !== i + r.consumed - 1 || r.clauses.length === 0) return null;
  const side = countersIfSentence(countersIf!, infoOfRef(m.what, st).plural, { say: (c) => K.cond(c, st), creature: infoOfRef(m.what, st).nouns.includes('creature'), np: (f) => K.np(f, st, { det: 'a' }), qty: (q) => K.qty(q as Parameters<typeof K.qty>[0], st) }); // edh-c-6
  const c = r.clauses[r.clauses.length - 1]!;
  return { ...r, clauses: [...r.clauses.slice(0, -1), { ...c, imp: `${c.imp}. ${side}`, sub: `${c.sub}. ${side}`, standalone: true }] };
}

/**
 * edh-d-90 (CR 106.4, 500.5, 608.2c; Colossal Plow; parser/lower/riders.ts, MANA_RIDER_SKIPS): "add {W}{W}{W} and you gain 3 life. Until end of turn, you don't lose this mana as steps and phases
 * end.": your mana kept until end of turn (the rider patched the sentence's one `addMana`), then, as the last instruction, a gain of life of yours: the two joined by "and", the rider sentence after both.
 */
function keptManaThenLife(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const a = list[i];
  const b = list[i + 1];
  if (a?.op !== 'addMana' || b?.op !== 'gainLife' || i + 2 !== list.length || a.keep !== 'endOfTurn' || a.who.ref !== 'you' || b.who.ref !== 'you' || a.restriction !== undefined || a.rider !== undefined || a.guard !== undefined || b.guard !== undefined) return null;
  const { keep: _keep, ...bare } = a;
  const ca = K.clause(bare as EffectStep, st);
  const cb = K.clause(b, st);
  if (ca.standalone === true || cb.standalone === true) return null;
  const tail = ". until end of turn, you don't lose this mana as steps and phases end";
  return { clauses: [acting('you', `${ca.imp} and ${cb.sub}${tail}`, `${ca.sub} and ${cb.pred ?? cb.sub}${tail}`, { standalone: true })], consumed: 2 };
}

function foldAtPlain(list: EffectStep[], i: number, st: RenderState): Folded | null {
  const edhD99 = foldEdhD99(list, i, st); // edh-d-99: shapes only its own templates build (first: it consumes a search and two moves the folds below would take apart)
  if (edhD99 !== null) return edhD99;
  const edhN143 = foldEdhN143(list, i, st); // edh-next-143: shapes only its own templates build (first: it consumes four steps the folds below would take apart)
  if (edhN143 !== null) return edhN143;
  const edhD101 = foldEdhD101(list, i, st); // edh-d-101: shapes only its own templates build
  if (edhD101 !== null) return edhD101;
  const edhN123 = foldEdhN123(list, i, st); // edh-next-123: shapes only its own templates build (first: it consumes four steps the two-step folds below would take apart)
  if (edhN123 !== null) return edhN123;
  const edhN138 = foldEdhN138(list, i, st); // edh-next-138: shapes only its own templates build ("You may reveal it if ... Create ... if you revealed it this way.")
  if (edhN138 !== null) return edhN138;
  const edhN136 = foldEdhN136(list, i, st); // edh-next-136: "Exile that many cards from the top of your library. You may play them this turn." (a counted exile, then the impulse permission)
  if (edhN136 !== null) return edhN136;
  const edhN137 = foldEdhN137(list, i, st); // edh-next-137: shapes only its own templates build (a reveal of each opponent's hand read back by the next two steps)
  if (edhN137 !== null) return edhN137;
  const edhD75 = foldEdhD75(list, i, st); // edh-d-75: shapes only its own templates build
  if (edhD75 !== null) return edhD75;
  const edhD88 = foldEdhD88(list, i, st); // edh-d-88: shapes only its own templates build
  if (edhD88 !== null) return edhD88;
  const edhD46 = foldEdhD46(list, i, st); // edh-d-46: shapes only its own templates build (first: it consumes five steps the folds below would take apart)
  if (edhD46 !== null) return edhD46;
  const edhD94 = foldEdhD94(list, i, st); // edh-d-94: shapes only its own templates build (Oversimplify: an exile and a forEach of players)
  if (edhD94 !== null) return edhD94;
  const edhN89 = foldEdhN89(list, i, st); // edh-next-89: "Then if ~ has N or more X counters on it, remove them and transform ~"
  if (edhN89 !== null) return edhN89;
  const edhn27 = foldEdhNext27(list, i, st); // edh-next-27: shapes only its own templates build (first: it consumes four steps the two-step folds below would take apart)
  if (edhn27 !== null) return edhn27;
  const edhn40 = foldEdhN40(list, i, st); // edh-next-40: shapes only its own templates build
  if (edhn40 !== null) return edhn40;
  const edhd61 = foldEdhD61(list, i, st); // edh-d-61: shapes only its own templates build
  if (edhd61 !== null) return edhd61;
  const edhn46 = foldEdhN46(list, i, st); // edh-next-46: shapes only its own readings build
  if (edhn46 !== null) return edhn46;
  const edhn96 = foldEdhN96(list, i, st); // edh-next-96: the move of all cards another player's reveal revealed, into their graveyard
  if (edhn96 !== null) return edhn96;
  const edhd87 = foldEdhD87(list, i, st); // edh-d-87: shapes only its own templates build (Sphinx Ambassador)
  if (edhd87 !== null) return edhd87;
  const edhd90 = keptManaThenLife(list, i, st); // edh-d-90: "add {W}{W}{W} and you gain 3 life. Until end of turn, you don't lose this mana ..."
  if (edhd90 !== null) return edhd90;
  const pcCombat4 = foldPcCombat4(list, i, st); // pc-combat-4: shapes only its own template builds
  if (pcCombat4 !== null) return pcCombat4;
  const returned = returnSelfAndMilled(list, i, st); // Standard round I
  if (returned !== null) return returned;
  const linked = linkedReturnOne(list, i, st); // CLOUD std-tmt
  if (linked !== null) return linked;
  const copied = linkedCopyOne(list, i, st); // r3-copy
  if (copied !== null) return copied;
  const assimilated = linkedAssimilateOne(list, i, st); // trek-6
  if (assimilated !== null) return assimilated;
  const picks = alternatingPicks(list, i, st) ?? eachPlayerHalves(list, i) ?? forEachPlayerDestroyUpToOne(list, i, st) ?? eachRevealsOtherLoses(list, i, st) ?? skipsNextTurns(list, i, st) ?? searchOutsideOpponentChooses(list, i, st); // std-rx30: before the folds of one choice and its move
  if (picks !== null) return picks;
  const rx31 = foldStdRx31(list, i, st); // std-rx31: shapes only its own templates build
  if (rx31 !== null) return rx31;
  const combat1 = foldStdCombat1(list, i, st); // std-combat-1: shapes only its own templates build
  if (combat1 !== null) return combat1;
  const edhMisc2 = foldEdhMisc2(list, i, st); // edh-misc-2: shapes only its own templates build
  if (edhMisc2 !== null) return edhMisc2;
  const pcCombat1 = foldPcCombat1(list, i, st); // pc-combat-1: shapes only its own template and lowering build
  if (pcCombat1 !== null) return pcCombat1;
  const costs2 = foldStdCosts2(list, i, st); // std-costs-2: shapes only its own templates build
  if (costs2 !== null) return costs2;
  const edhN90 = foldEdhN90(list, i, st); // edh-next-90: shapes only its own templates build
  if (edhN90 !== null) return edhN90;
  const lib2 = foldStdLibrary2(list, i, st); // std-library-2: shapes only its own templates and lowering build
  if (lib2 !== null) return lib2;
  const copy6 = foldStdCopy6(list, i, st); // std-copy-6: shapes only its own templates build
  if (copy6 !== null) return copy6;
  const edhMk12 = foldEdhMk12(list, i, st); // edh-mana-keywords-12: shapes only its own template builds
  if (edhMk12 !== null) return edhMk12;
  const edhD54 = foldEdhD54(list, i, st); // edh-d-54: shapes only its own templates build
  if (edhD54 !== null) return edhD54;
  const edhD73 = foldEdhD73(list, i, st); // edh-d-73: shapes only its own templates build
  if (edhD73 !== null) return edhD73;
  const edhD95 = foldEdhD95(list, i, st); // edh-d-95: shapes only its own templates build
  if (edhD95 !== null) return edhD95;
  const edhMk11 = foldEdhMk11(list, i, st); // edh-mana-keywords-11: shapes only its own template builds
  if (edhMk11 !== null) return edhMk11;
  const edhCast1 = foldEdhCast1(list, i, st); // edh-cast-1: shapes only its own templates build
  if (edhCast1 !== null) return edhCast1;
  const edhCast5 = foldEdhCast5(list, i, st); // edh-cast-5: shapes only its own templates build
  if (edhCast5 !== null) return edhCast5;
  const edhCast7 = foldEdhCast7(list, i, st); // edh-cast-7: shapes only its own templates build
  if (edhCast7 !== null) return edhCast7;
  const edhCb1 = foldEdhCb1(list, i, st); // edh-combat-1: shapes only its own templates build
  if (edhCb1 !== null) return edhCb1;
  const edhV14 = foldEdhV14(list, i, st); // edh-c-14: shapes only its own templates build
  if (edhV14 !== null) return edhV14;
  const edhV32 = foldEdhV32(list, i, st); // edh-c-32: shapes only its own templates build
  if (edhV32 !== null) return edhV32;
  const edhV51 = foldEdhV51(list, i, st); // edh-c-51: shapes only its own templates build
  if (edhV51 !== null) return edhV51;
  const edhV24 = foldEdhV24(list, i, st); // edh-c-24: shapes only its own templates build
  if (edhV24 !== null) return edhV24;
  const edhZones3 = foldEdhZones3(list, i, st); // edh-zones-3: shapes only its own templates build
  if (edhZones3 !== null) return edhZones3;
  const edhB5 = foldEdhB5(list, i, st); // edh-b-5: shapes only its own templates build
  if (edhB5 !== null) return edhB5;
  const edhB12 = foldEdhB12(list, i, st); // edh-b-12: shapes only its own templates build
  if (edhB12 !== null) return edhB12;
  const edhN3 = foldEdhN3(list, i); // edh-next-3: shapes only its own templates build
  if (edhN3 !== null) return edhN3;
  const edhD80 = foldEdhD80(list, i, st); // edh-d-80: three steps (untap, goad, a lasting effect on the same object) the two-step fold below would take apart
  if (edhD80 !== null) return edhD80;
  const edhN19 = foldEdhN19(list, i, st); // edh-next-19: shapes only its own templates build
  if (edhN19 !== null) return edhN19;
  const edhD64 = foldEdhD64(list, i, st); // edh-d-64: shapes only its own templates build
  if (edhD64 !== null) return edhD64;
  const edhN10 = foldEdhN10(list, i, st); // edh-next-10: shapes only its own templates build
  if (edhN10 !== null) return edhN10;
  const edhN63 = foldEdhN63(list, i, st); // edh-next-63: shapes only its own templates build
  if (edhN63 !== null) return edhN63;
  const edhN7 = foldEdhN7(list, i); // edh-next-7: shapes only its own templates build
  if (edhN7 !== null) return edhN7;
  const edhV10 = foldEdhV10(list, i, st); // edh-c-10: shapes only its own templates build
  if (edhV10 !== null) return edhV10;
  const edhV26 = foldEdhV26(list, i); // edh-c-26: shapes only its own templates build
  if (edhV26 !== null) return edhV26;
  const edhV80 = foldEdhV80(list, i, st); // edh-c-80: shapes only its own templates build
  if (edhV80 !== null) return edhV80;
  const edhV97 = foldEdhV97(list, i, st); // edh-c-97: shapes only its own templates build
  if (edhV97 !== null) return edhV97;
  const edhP5 = foldEdhP5(list, i, st); // edh-players-5: shapes only its own templates build
  if (edhP5 !== null) return edhP5;
  const edhP6 = foldEdhP6(list, i, st); // edh-players-6: shapes only its own templates build
  if (edhP6 !== null) return edhP6;
  const edhP7 = foldEdhP7(list, i, st); // edh-players-7: shapes only its own templates build
  if (edhP7 !== null) return edhP7;
  const edhP9 = foldEdhP9(list, i, st); // edh-players-9: shapes only its own templates build
  if (edhP9 !== null) return edhP9;
  const p2refs1 = foldP2Refs1(list, i, st); // p2-refs-1: shapes only its own templates build
  if (p2refs1 !== null) return p2refs1;
  const control1 = foldStdControl1(list, i, st); // std-control-1: shapes only its own templates build
  if (control1 !== null) return control1;
  const damage2 = foldP2Damage2(list, i, st); // p2-damage-2: shapes only its own templates build
  if (damage2 !== null) return damage2;
  const damage3 = foldP2Damage3(list, i, st); // p2-damage-3: shapes only its own templates build
  if (damage3 !== null) return damage3;
  const combat5 = foldStdCombat5(list, i, st); // std-combat-5: shapes only its own templates build
  if (combat5 !== null) return combat5;
  const p2rd1 = foldP2ReplaceDamage1(list, i, st); // p2-replace-damage-1: shapes only its own templates build
  if (p2rd1 !== null) return p2rd1;
  const p2dig1 = foldP2Dig1(list, i, st); // p2-dig-1: shapes only its own templates build
  if (p2dig1 !== null) return p2dig1;
  const p2rd3 = foldP2ReplaceDamage3(list, i, st); // p2-replace-damage-3: shapes only its own templates build
  if (p2rd3 !== null) return p2rd3;
  const edhV60 = foldEdhV60(list, i, st); // edh-c-60: shapes only its own templates build
  if (edhV60 !== null) return edhV60;
  const edhCb5 = foldEdhCb5(list, i, st); // edh-combat-5: shapes only its own template builds
  if (edhCb5 !== null) return edhCb5;
  const cf1 = foldP2CombatFlow1(list, i, st); // p2-combat-flow-1: shapes only its own templates build
  if (cf1 !== null) return cf1;
  const p2ga1 = foldP2GroupActions1(list, i, st); // p2-group-actions-1: shapes only its own templates build
  if (p2ga1 !== null) return p2ga1;
  const p2ga2 = foldP2GroupActions2(list, i, st); // p2-group-actions-2: shapes only its own templates build
  if (p2ga2 !== null) return p2ga2;
  const edhn1 = foldEdhNext1(list, i, st); // edh-next-1: shapes only its own templates build
  if (edhn1 !== null) return edhn1;
  const edhN142 = foldEdhN142(list, i, st); // edh-next-142: shapes only its own templates build
  if (edhN142 !== null) return edhN142;
  const edhv105 = foldEdhV105(list, i, st); // edh-c-105: shapes only its own templates build
  if (edhv105 !== null) return edhv105;
  const p2rd4 = foldP2ReplaceDamage4(list, i, st); // p2-replace-damage-4: shapes only its own templates build
  if (p2rd4 !== null) return p2rd4;
  const trek3 = foldTrek3(list, i, st); // trek-3: shapes only its own templates build
  if (trek3 !== null) return trek3;
  const edhC104 = foldEdhC104(list, i, st); // edh-c-104: shapes only its own templates build
  if (edhC104 !== null) return edhC104;
  const trek8 = foldTrek8(list, i, st); // trek-8: shapes only its own templates build
  if (trek8 !== null) return trek8;
  const trek20 = foldTrek20(list, i, st); // trek-20: the shape only its own template builds
  if (trek20 !== null) return trek20;
  const trek9 = foldTrek9(list, i, st); // trek-9: shapes only its own templates build
  if (trek9 !== null) return trek9;
  const edhPm4 = foldEdhPm4(list, i, st); // edh-perms-4: shapes only its own templates build
  if (edhPm4 !== null) return edhPm4;
  const edhN59 = foldEdhN59(list, i, st); // edh-next-59: shapes only its own templates build
  if (edhN59 !== null) return edhN59;
  const pcZones2 = foldPcZones2(list, i, st); // pc-zones-2: shapes only its own templates build
  if (pcZones2 !== null) return pcZones2;
  const edhT6 = foldEdhT6(list, i, st); // edh-top-6: shapes only its own templates build
  if (edhT6 !== null) return edhT6;
  const edhV102 = foldEdhV102(list, i, st); // edh-c-102: shapes only its own templates build
  if (edhV102 !== null) return edhV102;
  const edhN16 = foldEdhN16(list, i, st); // edh-next-16: shapes only its own templates build
  if (edhN16 !== null) return edhN16;
  const edhD89 = foldEdhD89(list, i, st); // edh-d-89: shapes only its own templates build
  if (edhD89 !== null) return edhD89;
  const edhN8 = foldEdhN8(list, i, st); // edh-next-8: shapes only its own templates build
  if (edhN8 !== null) return edhN8;
  const edhB14 = foldEdhB14(list, i, st); // edh-b-14: shapes only its own templates build
  if (edhB14 !== null) return edhB14;
  const edhV18 = foldEdhV18(list, i, st); // edh-c-18: shapes only its own templates build
  if (edhV18 !== null) return edhV18;
  const edhN21 = foldEdhN21(list, i, st); // edh-next-21: shapes only its own templates build
  if (edhN21 !== null) return edhN21;
  const edhT8 = foldEdhT8(list, i, st); // edh-top-8: shapes only its own templates build
  if (edhT8 !== null) return edhT8;
  const edhT9 = foldEdhT9(list, i, st); // edh-top-9: shapes only its own readings build
  if (edhT9 !== null) return edhT9;
  const edhT16 = foldEdhT16(list, i, st); // edh-top-16: shapes only its own readings build
  if (edhT16 !== null) return edhT16;
  const pcp1 = foldPcPlayers1(list, i, st); // pc-players-1: shapes only its own templates build
  if (pcp1 !== null) return pcp1;
  const pcTokens1 = foldPcTokens1(list, i, st); // pc-tokens-1: shapes only its own templates build
  if (pcTokens1 !== null) return pcTokens1;
  const pcZones1 = foldPcZones1(list, i, st); // pc-zones-1: shapes only its own templates build
  if (pcZones1 !== null) return pcZones1;
  const edhZones11 = foldEdhZones11(list, i, st); // edh-zones-11: shapes only its own templates build
  if (edhZones11 !== null) return edhZones11;
  const edhZones4 = foldEdhZones4(list, i, st); // edh-zones-4: shapes only its own templates build
  if (edhZones4 !== null) return edhZones4;
  const edhMisc4 = foldEdhMisc4(list, i, st); // edh-misc-4: shapes only its own templates build
  if (edhMisc4 !== null) return edhMisc4;
  const edhMisc5 = foldEdhMisc5(list, i, st); // edh-misc-5: shapes only its own templates build
  if (edhMisc5 !== null) return edhMisc5;
  const edhCb7 = foldEdhCb7(list, i, st); // edh-combat-7: shapes only its own templates build
  if (edhCb7 !== null) return edhCb7;
  const edhZones8 = foldEdhZones8(list, i, st); // edh-zones-8: shapes only its own templates build
  if (edhZones8 !== null) return edhZones8;
  const edhZones9 = foldEdhZones9(list, i, st); // edh-zones-9: shapes only its own templates build
  if (edhZones9 !== null) return edhZones9;
  const edhD7 = foldEdhD7(list, i, st); // edh-d-7: shapes only its own templates build
  if (edhD7 !== null) return edhD7;
  const edhD15 = foldEdhD15(list, i, st); // edh-d-15: shapes only its own templates build
  if (edhD15 !== null) return edhD15;
  const edhD25 = foldEdhD25(list, i, st); // edh-d-25: shapes only its own templates build
  if (edhD25 !== null) return edhD25;
  const edhD29 = foldEdhD29(list, i, st); // edh-d-29: shapes only its own templates build
  if (edhD29 !== null) return edhD29;
  const edhD32 = foldEdhD32(list, i, st); // edh-d-32: shapes only its own templates build
  if (edhD32 !== null) return edhD32;
  const edhD43 = foldEdhD43(list, i, st); // edh-d-43: shapes only its own templates build
  if (edhD43 !== null) return edhD43;
  const edhD35 = foldEdhD35(list, i, st); // edh-d-35: shapes only its own templates build
  if (edhD35 !== null) return edhD35;
  const edhD19 = foldEdhD19(list, i, st); // edh-d-19: shapes only its own templates build
  if (edhD19 !== null) return edhD19;
  const edhD27 = foldEdhD27(list, i, st); // edh-d-27: shapes only its own templates build
  if (edhD27 !== null) return edhD27;
  const edhD36 = foldEdhD36(list, i, st); // edh-d-36: shapes only its own templates build
  if (edhD36 !== null) return edhD36;
  const edhN66 = foldEdhN66(list, i, st); // edh-next-66: shapes only its own templates build
  if (edhN66 !== null) return edhN66;
  const edhV92 = foldEdhV92(list, i, st); // edh-c-92: shapes only its own templates build
  if (edhV92 !== null) return edhV92;
  const edhP8 = foldEdhP8(list, i, st); // edh-players-8: shapes only its own templates build
  if (edhP8 !== null) return edhP8;
  const edhP11 = foldEdhP11(list, i, st); // edh-players-11: shapes only its own templates build
  if (edhP11 !== null) return edhP11;
  const edhV29 = foldEdhV29(list, i, st); // edh-c-29: shapes only its own templates build
  if (edhV29 !== null) return edhV29;
  const edhZones10 = foldEdhZones10(list, i, st); // edh-zones-10: shapes only its own templates build
  if (edhZones10 !== null) return edhZones10;
  const edhPm12 = foldEdhPm12(list, i, st); // edh-perms-12: shapes only its own templates build
  if (edhPm12 !== null) return edhPm12;
  const edhD1 = foldEdhD1(list, i, st); // edh-d-1: shapes only its own templates build
  if (edhD1 !== null) return edhD1;
  const edhD28 = foldEdhD28(list, i, st); // edh-d-28: shapes only its own templates build
  if (edhD28 !== null) return edhD28;
  const edhZones12 = foldEdhZones12(list, i, st); // edh-zones-12: shapes only its own templates build
  if (edhZones12 !== null) return edhZones12;
  const edhMk8 = foldEdhMk8(list, i, st); // edh-mana-keywords-8: shapes only its own templates build
  if (edhMk8 !== null) return edhMk8;
  const edhP13 = foldEdhP13(list, i, st); // edh-players-13: shapes only its own templates build
  if (edhP13 !== null) return edhP13;
  const edhV25 = foldEdhV25(list, i, st); // edh-c-25: two or more plain tokens and the grant that follows them (both sentence forms stay readings)
  if (edhV25 !== null) return edhV25;
  const edhP17 = foldEdhP17(list, i, st); // edh-players-17: shapes only its own templates build
  if (edhP17 !== null) return edhP17;
  const edhP15 = foldEdhP15(list, i, st); // edh-players-15: shapes only its own templates build
  if (edhP15 !== null) return edhP15;
  const edhZones13 = foldEdhZones13(list, i, st); // edh-zones-13: shapes only its own templates build
  if (edhZones13 !== null) return edhZones13;
  const edhD33 = foldEdhD33(list, i, st); // edh-d-33: shapes only its own templates build
  if (edhD33 !== null) return edhD33;
  const edhV27 = foldEdhV27(list, i, st); // edh-c-27: shapes only its own templates build
  if (edhV27 !== null) return edhV27;
  const edhPm15 = foldEdhPm15(list, i, st); // edh-perms-15: shapes only its own templates build
  if (edhPm15 !== null) return edhPm15;
  const edhC6 = foldEdhC6(list, i, st); // edh-c-6: shapes only its own templates build
  if (edhC6 !== null) return edhC6;
  const edhV20 = foldEdhV20(list, i, st); // edh-c-20: shapes only its own templates build
  if (edhV20 !== null) return edhV20;
  const edhPm16 = foldEdhPm16(list, i, st); // edh-perms-16: shapes only its own templates build
  if (edhPm16 !== null) return edhPm16;
  const edhPm17 = foldEdhPm17(list, i, st); // edh-perms-17: shapes only its own templates build
  if (edhPm17 !== null) return edhPm17;
  const edhD47 = foldEdhD47(list, i, st); // edh-d-47: shapes only its own templates build
  if (edhD47 !== null) return edhD47;
  const edhZones16 = foldEdhZones16(list, i, st); // edh-zones-16: shapes only its own templates build
  if (edhZones16 !== null) return edhZones16;
  const edhZones18 = foldEdhZones18(list, i, st); // edh-zones-18: shapes only its own templates build
  if (edhZones18 !== null) return edhZones18;
  const trek17 = foldTrek17(list, i, st); // trek-17: shapes only its own templates build
  if (trek17 !== null) return trek17;
  const edhZones22 = foldEdhZones22(list, i, st); // edh-zones-22: shapes only its own templates build
  if (edhZones22 !== null) return edhZones22;
  const edhV19 = foldEdhV19(list, i, st); // edh-c-19: shapes only its own templates build
  if (edhV19 !== null) return edhV19;
  const edhZones24 = foldEdhZones24(list, i, st); // edh-zones-24: shapes only its own templates build
  if (edhZones24 !== null) return edhZones24;
  const edhD20 = foldEdhD20(list, i, st); // edh-d-20: shapes only its own templates build
  if (edhD20 !== null) return edhD20;
  const edhP20 = foldEdhP20(list, i, st); // edh-players-20: shapes only its own templates build
  if (edhP20 !== null) return edhP20;
  const edhC8 = foldEdhC8(list, i, st); // edh-c-8: shapes only its own templates build
  if (edhC8 !== null) return edhC8;
  const edhC76 = foldEdhC76(list, i, st); // edh-c-76: shapes only its own templates build
  if (edhC76 !== null) return edhC76;
  const edhD62 = foldEdhD62(list, i, st); // edh-d-62: shapes only its own templates build
  if (edhD62 !== null) return edhD62;
  const edhC83 = foldEdhC83(list, i, st); // edh-c-83: shapes only its own templates build
  if (edhC83 !== null) return edhC83;
  const edhV30 = foldEdhV30(list, i, st); // edh-c-30: shapes only its own templates build
  if (edhV30 !== null) return edhV30;
  const edhZones25 = exileOneOfThemFromGraveyard(list, i, st); // edh-zones-25: shapes only its own templates build
  if (edhZones25 !== null) return edhZones25;
  const edhPm21 = chooseOneCopyToken(list, i, st); // edh-perms-21: shapes only its own template builds
  if (edhPm21 !== null) return edhPm21;
  const edhZones27 = foldEdhZones27(list, i, st); // edh-zones-27: shapes only its own templates build
  if (edhZones27 !== null) return edhZones27;
  const edhN95 = foldEdhN95(list, i, st); // edh-next-95: shapes only its own templates build
  if (edhN95 !== null) return edhN95;
  const edhD58 = foldEdhD58(list, i, st); // edh-d-58: shapes only its own templates build
  if (edhD58 !== null) return edhD58;
  const edhP21 = foldEdhP21(list, i, st); // edh-players-21: shapes only its own templates build
  if (edhP21 !== null) return edhP21;
  const edhB13 = foldEdhB13(list, i, st); // edh-b-13: shapes only its own templates build
  if (edhB13 !== null) return edhB13;
  const edhV4 = foldEdhV4(list, i, st); // edh-c-4: shapes only its own templates build
  if (edhV4 !== null) return edhV4;
  const edhV59 = foldEdhV59(list, i, st); // edh-c-59: shapes only its own templates build
  if (edhV59 !== null) return edhV59;
  const edhV74 = foldEdhV74(list, i, st); // edh-c-74: shapes only its own templates build
  if (edhV74 !== null) return edhV74;
  const edhV65 = foldEdhV65(list, i, st); // edh-c-65: shapes only its own templates build
  if (edhV65 !== null) return edhV65;
  const edhV96 = foldEdhV96(list, i, st); // edh-c-96: shapes only its own templates build
  if (edhV96 !== null) return edhV96;
  const edhV56 = foldEdhV56(list, i, st); // edh-c-56: shapes only its own templates build
  if (edhV56 !== null) return edhV56;
  const edhD74 = foldEdhD74(list, i, st); // edh-d-74: shapes only its own templates build
  if (edhD74 !== null) return edhD74;
  const edhV71 = foldEdhV71(list, i); // edh-c-71: shapes only its own templates build
  if (edhV71 !== null) return edhV71;
  const edhC108 = foldEdhC108(list, i, st); // edh-c-108: shapes only its own templates build
  if (edhC108 !== null) return edhC108;
  const edhN98 = foldEdhN98(list, i, st); // edh-next-98: shapes only its own templates build
  if (edhN98 !== null) return edhN98;
  const edhV46 = foldEdhV46(list, i, st); // edh-c-46: shapes only its own templates build
  if (edhV46 !== null) return edhV46;
  const edhCast15 = foldEdhCast15(list, i, st); // edh-cast-15: shapes only its own templates build
  if (edhCast15 !== null) return edhCast15;
  const edhB11 = foldEdhB11(list, i, st); // edh-b-11: shapes only its own templates build
  if (edhB11 !== null) return edhB11;
  const edhC11 = foldEdhC11(list, i, st); // edh-c-11: shapes only its own readings build
  if (edhC11 !== null) return edhC11;
  const edhC73 = foldEdhC73(list, i, st); // edh-c-73: shapes only its own templates build
  if (edhC73 !== null) return edhC73;
  const edhC12 = foldEdhC12(list, i, st); // edh-c-12: shapes only its own templates build
  if (edhC12 !== null) return edhC12;
  const edhC75 = foldEdhC75(list, i, st); // edh-c-75: shapes only its own templates build
  if (edhC75 !== null) return edhC75;
  const edhB9 = foldEdhB9(list, i, st); // edh-b-9: shapes only its own templates build
  if (edhB9 !== null) return edhB9;
  const edhC66 = foldEdhC66(list, i, st); // edh-c-66: shapes only its own templates build
  if (edhC66 !== null) return edhC66;
  const edhD2 = foldEdhD2(list, i, st); // edh-d-2: shapes only its own templates build
  if (edhD2 !== null) return edhD2;
  const edhD26 = foldEdhD26(list, i, st); // edh-d-26: shapes only its own templates build
  if (edhD26 !== null) return edhD26;
  const edhD9 = foldEdhD9(list, i, st); // edh-d-9: shapes only its own templates build
  if (edhD9 !== null) return edhD9;
  const edhD39 = foldEdhD39(list, i, st); // edh-d-39: shapes only its own templates build
  if (edhD39 !== null) return edhD39;
  const edhN126 = foldEdhN126(list, i, st); // edh-next-126: shapes only its own templates build
  if (edhN126 !== null) return edhN126;
  const edhN144 = foldEdhN144(list, i, st); // edh-next-144: shapes only its own templates build
  if (edhN144 !== null) return edhN144;
  const edhN140 = foldEdhN140(list, i, st); // edh-next-140: shapes only its own templates build
  if (edhN140 !== null) return edhN140;
  const edhD23 = foldEdhD23(list, i, st); // edh-d-23: shapes only its own templates build
  if (edhD23 !== null) return edhD23;
  const edhD37 = foldEdhD37(list, i, st); // edh-d-37: shapes only its own templates build
  if (edhD37 !== null) return edhD37;
  const edhD52 = foldEdhD52(list, i, st); // edh-d-52: shapes only its own templates build
  if (edhD52 !== null) return edhD52;
  const edhC50 = foldEdhC50(list, i, st); // edh-c-50: shapes only its own templates build
  if (edhC50 !== null) return edhC50;
  const edhV22 = foldEdhV22(list, i, st); // edh-c-22: shapes only its own templates build
  if (edhV22 !== null) return edhV22;
  const edhV95 = foldEdhV95(list, i, st); // edh-c-95: shapes only its own templates build
  if (edhV95 !== null) return edhV95;
  const edhD53 = foldEdhD53(list, i, st); // edh-d-53: shapes only its own templates build
  if (edhD53 !== null) return edhD53;
  const edhD67 = foldEdhD67(list, i, st); // edh-d-67: shapes only its own templates build
  if (edhD67 !== null) return edhD67;
  const edhD5 = foldEdhD5(list, i, st); // edh-d-5: shapes only its own templates build
  if (edhD5 !== null) return edhD5;
  const edhD17 = foldEdhD17(list, i, st); // edh-d-17: shapes only its own templates build
  if (edhD17 !== null) return edhD17;
  const edhD51 = foldEdhD51(list, i, st); // edh-d-51: shapes only its own templates build
  if (edhD51 !== null) return edhD51;
  const edhN80 = foldEdhN80(list, i, st); // edh-next-80: shapes only its own templates build
  if (edhN80 !== null) return edhN80;
  const edhD49 = foldEdhD49(list, i, st); // edh-d-49: shapes only its own templates build
  if (edhD49 !== null) return edhD49;
  const edhD63 = foldEdhD63(list, i, st); // edh-d-63: shapes only its own templates build
  if (edhD63 !== null) return edhD63;
  const edhN79 = foldEdhN79(list, i, st); // edh-next-79: a delayed return of a group and the grant to it, one sentence
  if (edhN79 !== null) return edhN79;
  const edhN97 = foldEdhN97(list, i, st); // edh-next-97: shapes only its own readings build
  if (edhN97 !== null) return edhN97;
  const edhN110 = foldEdhN110(list, i, st); // edh-next-110: shapes only its own templates build
  if (edhN110 !== null) return edhN110;
  const edhN125 = foldEdhN125(list, i, st); // edh-next-125: shapes only its own templates build
  if (edhN125 !== null) return edhN125;
  const edhN122 = foldEdhN122(list, i, st); // edh-next-122: shapes only its own templates build
  if (edhN122 !== null) return edhN122;
  const edhN120 = foldEdhN120(list, i, st); // edh-next-120: shapes only its own templates build
  if (edhN120 !== null) return edhN120;
  const edhN121 = foldEdhN121(list, i, st); // edh-next-121: shapes only its own templates build
  if (edhN121 !== null) return edhN121;
  const edhN131 = foldEdhN131(list, i, st); // edh-next-131: shapes only its own templates build
  if (edhN131 !== null) return edhN131;
  const edhN134 = foldEdhN134(list, i, st); // edh-next-134: shapes only its own templates build (and, as an alt, the older wording of the same JSON)
  if (edhN134 !== null) return edhN134;
  const edhN145 = foldEdhN145(list, i, st); // edh-next-145: shapes only its own templates build
  if (edhN145 !== null) return edhN145;
  const edhN128 = foldEdhN128(list, i, st); // edh-next-128: shapes only its own readings build
  if (edhN128 !== null) return edhN128;
  const edhN127 = foldEdhN127(list, i, st); // edh-next-127: shapes only its own templates build
  if (edhN127 !== null) return edhN127;
  const edhD93 = foldEdhD93(list, i, st); // edh-d-93: shapes only its own templates build
  if (edhD93 !== null) return edhD93;
  const edhN129 = foldEdhN129(list, i, st); // edh-next-129: shapes only its own templates build
  if (edhN129 !== null) return edhN129;
  const edhN135 = foldEdhN135(list, i, st); // edh-next-135: shapes only its own templates build
  if (edhN135 !== null) return edhN135;
  const edhN139 = foldEdhN139(list, i, st); // edh-next-139: shapes only its own templates build
  if (edhN139 !== null) return edhN139;
  const edhN132 = foldEdhN132(list, i, st); // edh-next-132: shapes only its own templates build
  if (edhN132 !== null) return edhN132;
  const edhD97 = foldEdhD97(list, i, st); // edh-d-97: shapes only its own templates build
  if (edhD97 !== null) return edhD97;
  const edhD96 = foldEdhD96(list, i, st); // edh-d-96: shapes only its own templates build
  if (edhD96 !== null) return edhD96;
  const edhD92 = foldEdhD92(list, i, st); // edh-d-92: shapes only its own templates build
  if (edhD92 !== null) return edhD92;
  const edhD85 = foldEdhD85(list, i, st); // edh-d-85: shapes only its own templates build
  if (edhD85 !== null) return edhD85;
  const edhD91 = foldEdhD91(list, i, st); // edh-d-91: shapes only its own templates build
  if (edhD91 !== null) return edhD91;
  const edhN146 = foldEdhN146(list, i, st); // edh-next-146: shapes only its own templates build
  if (edhN146 !== null) return edhN146;
  const edhD100 = foldEdhD100(list, i, st); // edh-d-100: shapes only its own templates build
  if (edhD100 !== null) return edhD100;
  return handBottomExileOfGroup(list, i, st) /* edh-zones-2 */ ?? putUpToTopRestBottom(list, i, st) /* edh-zones-2 */ ?? shuffleThenExileTop(list, i, st) /* edh-zones-2 */ ?? putCardFromGroupToHand(list, i, st) /* edh-zones-2 */ ?? chooseThenCastFree(list, i) ?? castFromHandFreeMv(list, i, st) /* r4-cost */ ?? castFromGroupFree(list, i, st) ?? castFromLinkedExile(list, i, st) /* std-re */ ?? exileUpToOneFromGraveyard(list, i, st) /* std-exile-play-2-3 */ ?? castFromOwnedExileWithCounters(list, i) /* std-exile-play-2-2 */ ?? exileOneOfEachColorFromRevealed(list, i, st) /* std-exile-play-2-4 */ ?? castFromEachOpponentGraveyard(list, i) /* std-rx27 */ ?? castFromOwnZone(list, i, st) /* std-rw7 */ ?? exileTopXThenCastAnyFree(list, i, st) ?? castAnyFromExiledFree(list, i, st) /* r3-cost */ ?? revealCardsFromHand(list, i, st) ?? lookCloakRest(list, i, st) ?? cloakFromHand(list, i) ?? exilePileCloak(list, i, st)
    ?? dreadBinnedToHand(list, i, st) ?? putOfThemAndRest(list, i, st) ?? eachCardTypeFromGroup(list, i, st) /* std-library-3 */ ?? restOfExiledToHand(list, i, st) /* std-library-3 */ ?? putAnyFromGroupAndRest(list, i, st) ?? putThatAndRest(list, i, st) ?? exileRandomFromGraveyard(list, i, st) ?? returnRandomFromGraveyard(list, i, st) /* p2-coinflip-1 */ ?? revealRandomFromHand(list, i, st) /* p2-coinflip-1 */ ?? lookAtRandomInHand(list, i, st) /* edh-mana-keywords-10 */ ?? putUpToTotalFromGroupAndRest(list, i, st) ?? putOfThem(list, i, st) /* r4-repl */ ?? putAnyFromGroup(list, i, st) /* r4-fxz, r4-repl */ ?? revealTopAndPut(list, i, st) /* r4-dig */ ?? playerLooksThenExilesFaceDown(list, i, st) /* r4-dig */ ?? putEitherFromGroup(list, i, st) ?? revealThreeAndOrFromGroup(list, i, st) /* edh-b-1 */ ?? revealTwoAndOrFromGroup(list, i, st) /* edh-c-76 */ ?? putEitherFromHand(list, i, st) /* r4-fxz */ ?? putAllFromGroupAndRest(list, i, st) /* r4-fxz */ ?? putAllRevealedSplit(list, i, st) /* std-rx1 */ ?? chooseUpToFromGroup(list, i, st) /* r4-dig */ ?? chooseUpToFromGroupThenReveal(list, i, st) /* r5-dig */ ?? otherChoosesThenChosenAndRest(list, i, st) /* r5-dig */ ?? forEachOwnerMayPlay(list, i, st) /* r5-dig */ ?? playerRevealsUntilToGraveyard(list, i, st) /* r5-dig */ ?? revealOneFromHand(list, i, st) /* r4-dig */ ?? putAnyOfHitsAndRestOfRevealed(list, i, st) /* r4-dig */ ?? chooseFromGroup(list, i, st)
    ?? chooseRandomFromGroup(list, i, st) ?? chooseRandomLinkedThenBattlefield(list, i, st) ?? sourceOfChoiceShield(list, i, st) ?? textChange(list, i, st) ?? textChangeFixed(list, i, st) /* edh-misc-6 */ ?? tapThenCounters(list, i, st) ?? tapThenFreeze(list, i, st) ?? gainControlThenUntap(list, i, st) /* r4-trig */ ?? chooseThenUntap(list, i, st)
    ?? putBottomThenDrawPlus(list, i) ?? wheel(list, i) ?? eachPlayerShufflesZones(list, i, st) /* std-rn */ ?? exileFromHandOrTarget(list, i, st) /* std-rx30 */ ?? exileFromSeenHand(list, i, st) ?? foldR4RefsEarly(list, i, st) /* r4-refs */ ?? chosenRevealedExiled(list, i, st) /* std-exile-play-1-2 */ ?? chooseThenMove(list, i, st) ?? faceDownPilesFold(list, i, st) /* r5-dig */ ?? ownerTopElseBottom(list, i, st) ?? targetsChoiceAndOther(list, i, st) /* std-rx30 */ ?? pilesEpilogue(list, i, st) ?? ownerShufflesSelfThenDraws(list, i, st)
    ?? shuffleInto(list, i, st) ?? shuffleOwners(list, i, st) ?? choiceGrant(list, i, st) ?? choiceCardTypeProtection(list, i, st) ?? searchThenHandOrGraveyard(list, i, st) ?? onePutOtherGraveyard(list, i, st) ?? searchThenMove(list, i, st)
    ?? playerGainsThenSearches(list, i, st) ?? shuffleThenTopInstead(list, i, st) ?? shuffleThenTop(list, i, st) ?? lookThenPutBack(list, i, st) ?? choiceThenEffect(list, i, st)
    ?? choicePump(list, i, st) ?? choiceToken(list, i) ?? ownerTopOrBottom(list, i, st) ?? ownerSecondOrBottom(list, i, st) /* r3-refs */ ?? exileSacrificeReturn(list, i, st) ?? drainWhereX(list, i, st) ?? damageGainWhereX(list, i, st)
    ?? drawLoseWhereX(list, i, st) ?? letLifeDrawWhereX(list, i, st) ?? eachOpponentDrawsThenYou(list, i) ?? chooseThenDiscard(list, i, st) ?? sacrificeAnyThenDraw(list, i, st) ?? sacrificeAnyList(list, i, st) /* r4-fxz */ ?? drawTwoToTheX(list, i, st)
    ?? youAndPlayerDraw(list, i, st) ?? youAndPlayerEachDraw(list, i, st) ?? youAndPlayerEachCreate(list, i, st) /* std-rx18 */ ?? millThenPutFromAmong(list, i, st) ?? millThenPutAll(list, i, st) ?? fivePuts(list, i, st) ?? threePuts(list, i, st) ?? twoPuts(list, i, st)
    ?? pumpThenSelfDamage(list, i, st) ?? chooseThenTapAny(list, i, st) ?? gainsThenNoUntap(list, i, st) ?? chooseThenRemoveFromEach(list, i, st) ?? lookPutBackUpToRest(list, i, st) ?? chooseThenTurnFaceUp(list, i, st)
    ?? chooseOneThenSuspect(list, i, st) ?? chooseOneThenCounter(list, i, st) ?? chooseOneThenCopyToken(list, i, st) /* std-rj */ ?? twoExtraCombats(list, i) ?? chooseThenRemoveAnyCounter(list, i, st) ?? countersAndLifeWhereX(list, i, st) /* r4-fxb */ ?? foldStdDsk(list, i, st) ?? chooseThenDestroy(list, i, st) ?? chooseThenAttach(list, i, st) ?? chooseThenUnattachFrom(list, i, st) ?? millThenPutEachMilled(list, i, st)
    ?? sacrificeAnyThenWhereX(list, i, st) /* std-rx29 */ ?? chooseThenSacrificeAny(list, i, st) /* Cloud C7 */ ?? tokenAndToken(list, i, st) /* CMD5 */ ?? flashThenGrantEveryCast(list, i, st) /* edh-d-50 */ ?? chooseThenCounters(list, i, st) /* r3-refs */ ?? chooseAnyThenRemoveCounter(list, i, st) /* std-rx14 */ ?? flickerObjAndUpToOne(list, i, st) /* std-rx14 */ ?? foldR4Refs(list, i, st) /* r4-refs */ ?? whereXThenIfX(list, i, st) /* r4-fxz */ ?? foldR5Refs(list, i, st) /* r5-refs */ ?? foldR5Fxz(list, i, st) /* r5-fxz */ ?? foldStdRs(list, i, st) /* std-rs */ ?? sharedWhereX(list, i, st) ?? saddledOrCreatureByType(list, i, st) /* std-rw6 */ ?? foldStdCombat2(list, i, st) /* std-combat-2 */ ?? foldStdExile3(list, i, st) /* std-exile-play-1-3 */ ?? foldPcEp3(list, i, st) /* pc-exile-play-3 */ ?? foldTrek13(list, i, st) /* trek-13 */ ?? foldPcEp4(list, i, st) /* pc-exile-play-4 */ ?? foldEdhPm8(list, i, st) /* edh-perms-8 */ ?? foldEdhT5(list, i, st) /* edh-top-5 */; // the folds of every slice; cloud std-spm's sharedWhereX last, after every specific fold
}

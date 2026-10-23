/**
 * The keyword abilities of CR 702 (names and rule numbers, effective 2026-09-25, from rules/cr/KEYWORDS.md). The keyword-line compiler
 * (cards/keywords.ts) uses it to tell "a keyword the engine does not automate yet" from ordinary rules text, so a card's
 * `automation.unsupported` names the rule that still has to be implemented. Rule numbers are stable; new keywords are appended
 * when the rules pack is updated.
 */
const LIST =
  '2 Deathtouch;3 Defender;4 Double Strike;5 Enchant;6 Equip;7 First Strike;8 Flash;9 Flying;10 Haste;11 Hexproof;' +
  '12 Indestructible;13 Intimidate;14 Landwalk;15 Lifelink;16 Protection;17 Reach;18 Shroud;19 Trample;' +
  '20 Vigilance;21 Ward;22 Banding;23 Rampage;24 Cumulative Upkeep;25 Flanking;26 Phasing;27 Buyback;28 Shadow;' +
  '29 Cycling;30 Echo;31 Horsemanship;32 Fading;33 Kicker;34 Flashback;35 Madness;36 Fear;37 Morph;38 Amplify;' +
  '39 Provoke;40 Storm;41 Affinity;42 Entwine;43 Modular;44 Sunburst;45 Bushido;46 Soulshift;47 Splice;48 Offering;' +
  '49 Ninjutsu;50 Epic;51 Convoke;52 Dredge;53 Transmute;54 Bloodthirst;55 Haunt;56 Replicate;57 Forecast;58 Graft;' +
  '59 Recover;60 Ripple;61 Split Second;62 Suspend;63 Vanishing;64 Absorb;65 Aura Swap;66 Delve;67 Fortify;' +
  '68 Frenzy;69 Gravestorm;70 Poisonous;71 Transfigure;72 Champion;73 Changeling;74 Evoke;75 Hideaway;76 Prowl;' +
  '77 Reinforce;78 Conspire;79 Persist;80 Wither;81 Retrace;82 Devour;83 Exalted;84 Unearth;85 Cascade;' +
  '86 Annihilator;87 Level Up;88 Rebound;89 Umbra Armor;90 Infect;91 Battle Cry;92 Living Weapon;93 Undying;' +
  '94 Miracle;95 Soulbond;96 Overload;97 Scavenge;98 Unleash;99 Cipher;100 Evolve;101 Extort;102 Fuse;103 Bestow;' +
  '104 Tribute;105 Dethrone;106 Hidden Agenda;107 Outlast;108 Prowess;109 Dash;110 Exploit;111 Menace;112 Renown;' +
  '113 Awaken;114 Devoid;115 Ingest;116 Myriad;117 Surge;118 Skulk;119 Emerge;120 Escalate;121 Melee;122 Crew;' +
  '123 Fabricate;124 Partner;125 Undaunted;126 Improvise;127 Aftermath;128 Embalm;129 Eternalize;130 Afflict;' +
  '131 Ascend;132 Assist;133 Jump-Start;134 Mentor;135 Afterlife;136 Riot;137 Spectacle;138 Escape;139 Companion;' +
  '140 Mutate;141 Encore;142 Boast;143 Foretell;144 Demonstrate;145 Daybound and Nightbound;146 Disturb;' +
  '147 Decayed;148 Cleave;149 Training;150 Compleated;151 Reconfigure;152 Blitz;153 Casualty;154 Enlist;' +
  '155 Read Ahead;156 Ravenous;157 Squad;158 Space Sculptor;159 Visit;160 Prototype;161 Living Metal;' +
  '162 More Than Meets the Eye;163 For Mirrodin!;164 Toxic;165 Backup;166 Bargain;167 Craft;168 Disguise;' +
  '169 Solved;170 Plot;171 Saddle;172 Spree;173 Freerunning;174 Gift;175 Offspring;176 Impending;177 Exhaust;' +
  '178 Max Speed;179 Start Your Engines!;180 Harmonize;181 Mobilize;182 Job Select;183 Tiered;184 Station;185 Warp;' +
  '186 ∞ (Infinity);187 Mayhem;188 Web-slinging;189 Firebending;190 Sneak;191 Increment;192 Paradigm;193 Power-up;' +
  '194 Teamwork;195 Storied;' +
  '';

/** Lower-case keyword name -> CR 702 rule number ("702.9"). */
export const KEYWORD_RULES: ReadonlyMap<string, string> = new Map(
  LIST.split(';').filter(Boolean).map((row) => {
    const i = row.indexOf(' ');
    return [row.slice(i + 1).toLowerCase(), `702.${row.slice(0, i)}`] as [string, string];
  }),
);

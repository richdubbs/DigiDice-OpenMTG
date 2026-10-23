/**
 * Subtype classes (CR 205.3g-205.3q), data only. Layer 4 needs them for three rules: a subtype set by an effect replaces the subtypes of its own class
 * (CR 305.7, 205.3d), an object that loses a card type loses the subtypes that only that type has (CR 205.3d), and changeling means every creature type
 * (CR 702.73a). Generated from rules/cr/2-parts-of-a-card/205-type-line.md (effective 2026-09-25); a subtype in no list is kept as it is.
 *
 * THE ONE LIST (WP30). Every rules module that needs a subtype class reads it here: the layers (statics/mods.ts), the filters (rules/filter.ts: creature and land
 * types of an object), the evaluators (rules/creature-types.ts, `ALL_CREATURE_TYPES`). Apostrophes are straight, as in the Oracle data ("Urza's", "C'tan").
 * test/m5/statics/wp30-subtypes.test.ts checks every class against the lexicon that scripts/gen-lexicon.ts generates from the Comprehensive Rules, so a new
 * edition that adds a type makes that test fail until this file is updated (planeswalker and planar types are not needed by any rule here and are not listed).
 */
import type { CardType } from '../types/card';

/** r4-cost (CR 110.4): the permanent types, the card types a permanent can have (`distinct permanentTypes`: effects/eval.ts, statics/match.ts). */
export const PERMANENT_TYPES: readonly string[] = ['Artifact', 'Battle', 'Creature', 'Enchantment', 'Land', 'Planeswalker'];
export const BASIC_LAND_TYPES: readonly string[] = ['Plains', 'Island', 'Swamp', 'Mountain', 'Forest'];
export const LAND_TYPES: readonly string[] = ["Cave", "Desert", "Forest", "Gate", "Island", "Lair", "Locus", "Mine", "Mountain", "Plains", "Planet", "Power-Plant", "Sphere", "Swamp", "Tower", "Town", "Urza's"];
export const ARTIFACT_TYPES: readonly string[] = [
  "Attraction", "Blood", "Bobblehead", "Book", "Clue", "Contraption", "Equipment", "Food", "Fortification", "Gold", "Heartwood", "Incubator", "Infinity",
  "Junk", "Lander", "Map", "Mutagen", "Powerstone", "Spacecraft", "Stone", "Treasure", "Vehicle", "Vibranium",
];
export const ENCHANTMENT_TYPES: readonly string[] = ["Aura", "Background", "Cartouche", "Case", "Class", "Curse", "Plan", "Role", "Room", "Rune", "Saga", "Shard", "Shrine"];
export const SPELL_TYPES: readonly string[] = ["Adventure", "Arcane", "Lesson", "Omen", "Trap"];
/** CR 205.3m: creature types (shared by creatures and kindreds). "Time Lord" is the one two-word type. */
export const CREATURE_TYPES: readonly string[] = [
  "Advisor", "Aetherborn", "Alien", "Ally", "Angel", "Antelope", "Ape", "Archer", "Archon", "Armadillo", "Army", "Artificer", "Assassin",
  "Assembly-Worker", "Astartes", "Atog", "Aurochs", "Avatar", "Azra", "Badger", "Balloon", "Barbarian", "Bard", "Basilisk", "Bat", "Bear",
  "Beast", "Beaver", "Beeble", "Beholder", "Berserker", "Bird", "Bison", "Blinkmoth", "Boar", "Bringer", "Brushwagg", "Camarid", "Camel",
  "Capybara", "Caribou", "Carrier", "Cat", "Centaur", "Child", "Chimera", "Citizen", "Cleric", "Clown", "Cockatrice", "Construct", "Coward",
  "Coyote", "Crab", "Crocodile", "C'tan", "Custodes", "Cyberman", "Cyclops", "Dalek", "Dauthi", "Demigod", "Demon", "Deserter", "Detective",
  "Devil", "Dinosaur", "Djinn", "Doctor", "Dog", "Dragon", "Drake", "Dreadnought", "Drix", "Drone", "Druid", "Dryad", "Dwarf", "Echidna",
  "Efreet", "Egg", "Elder", "Eldrazi", "Elemental", "Elephant", "Elf", "Elk", "Employee", "Eternal", "Eye", "Faerie", "Ferret", "Fish",
  "Flagbearer", "Fox", "Fractal", "Frog", "Fungus", "Gamer", "Gamma", "Gargoyle", "Germ", "Giant", "Giraffe", "Gith", "Glimmer", "Gnoll",
  "Gnome", "Goat", "Goblin", "God", "Golem", "Gorgon", "Graveborn", "Gremlin", "Griffin", "Guest", "Hag", "Halfling", "Hamster", "Harpy",
  "Hedgehog", "Hellion", "Hero", "Hippo", "Hippogriff", "Homarid", "Homunculus", "Horror", "Horse", "Human", "Hydra", "Hyena", "Illusion",
  "Imp", "Incarnation", "Inhuman", "Inkling", "Inquisitor", "Insect", "Jackal", "Jellyfish", "Juggernaut", "Kangaroo", "Kavu", "Kirin",
  "Kithkin", "Knight", "Kobold", "Kor", "Kraken", "Kree", "Llama", "Lamia", "Lammasu", "Leech", "Lemur", "Leviathan", "Lhurgoyf", "Licid",
  "Lizard", "Lobster", "Manticore", "Masticore", "Mercenary", "Merfolk", "Metathran", "Minion", "Minotaur", "Mite", "Mole", "Monger",
  "Mongoose", "Monk", "Monkey", "Moogle", "Moonfolk", "Mount", "Mouse", "Mutant", "Myr", "Mystic", "Nautilus", "Necron", "Nephilim",
  "Nightmare", "Nightstalker", "Ninja", "Noble", "Noggle", "Nomad", "Nymph", "Octopus", "Ogre", "Ooze", "Orb", "Orc", "Orgg", "Otter",
  "Ouphe", "Ox", "Oyster", "Pangolin", "Peasant", "Pegasus", "Pentavite", "Performer", "Pest", "Phelddagrif", "Phoenix", "Phyrexian",
  "Pilot", "Pincher", "Pirate", "Plant", "Platypus", "Porcupine", "Possum", "Praetor", "Primarch", "Prism", "Processor", "Qu", "Rabbit",
  "Raccoon", "Ranger", "Rat", "Rebel", "Reflection", "Rhino", "Rigger", "Robot", "Rogue", "Sable", "Salamander", "Samurai", "Sand",
  "Saproling", "Satyr", "Scarecrow", "Scientist", "Scion", "Scorpion", "Scout", "Sculpture", "Seal", "Serf", "Serpent", "Servo", "Shade",
  "Shaman", "Shapeshifter", "Shark", "Sheep", "Shi'ar", "Siren", "Skeleton", "Skrull", "Skunk", "Slith", "Sliver", "Sloth", "Slug", "Snail",
  "Snake", "Soldier", "Soltari", "Sorcerer", "Spawn", "Specter", "Spellshaper", "Sphinx", "Spider", "Spike", "Spirit", "Splinter", "Sponge",
  "Spy", "Squid", "Squirrel", "Starfish", "Surrakar", "Survivor", "Symbiote", "Synth", "Tentacle", "Tetravite", "Thalakos", "Thopter",
  "Thrull", "Tiefling", "Toy", "Treefolk", "Trilobite", "Triskelavite", "Troll", "Turtle", "Tyranid", "Unicorn", "Utrom", "Vampire",
  "Varmint", "Vedalken", "Villain", "Volver", "Wall", "Walrus", "Warlock", "Warrior", "Weasel", "Weird", "Werewolf", "Whale", "Wizard",
  "Wolf", "Wolverine", "Wombat", "Worm", "Wraith", "Wurm", "Yeti", "Zombie", "Zubera", "Time Lord",
];

/** CR 205.3q: the one battle type. */
export const BATTLE_TYPES: readonly string[] = ['Siege'];
/** CR 205.3p: the one dungeon type. */
export const DUNGEON_TYPES: readonly string[] = ['Undercity'];

export type SubtypeClass = 'land' | 'artifact' | 'enchantment' | 'spell' | 'creature' | 'battle' | 'dungeon';

const CLASS_OF = new Map<string, SubtypeClass>();
for (const t of CREATURE_TYPES) CLASS_OF.set(t, 'creature');
for (const t of SPELL_TYPES) CLASS_OF.set(t, 'spell');
for (const t of ENCHANTMENT_TYPES) CLASS_OF.set(t, 'enchantment');
for (const t of ARTIFACT_TYPES) CLASS_OF.set(t, 'artifact');
for (const t of LAND_TYPES) CLASS_OF.set(t, 'land');
for (const t of BATTLE_TYPES) CLASS_OF.set(t, 'battle');
for (const t of DUNGEON_TYPES) CLASS_OF.set(t, 'dungeon');

/** The class of a subtype, or undefined when it is in no list this build knows (a planeswalker type, a planar type, a future type). */
export const subtypeClass = (t: string): SubtypeClass | undefined => CLASS_OF.get(t);

/** The card types whose possession lets an object have a subtype of this class (CR 205.3d). */
export const TYPES_FOR_CLASS: Readonly<Record<SubtypeClass, readonly CardType[]>> = {
  land: ['Land'],
  artifact: ['Artifact'],
  enchantment: ['Enchantment'],
  spell: ['Instant', 'Sorcery'],
  creature: ['Creature', 'Kindred'],
  battle: ['Battle'],
  dungeon: ['Dungeon'],
};

/** Does an object with these card types keep a subtype of this class? Unknown classes are always kept. */
export const hasTypeFor = (cls: SubtypeClass | undefined, types: readonly string[]): boolean => cls === undefined || TYPES_FOR_CLASS[cls].some((t) => types.includes(t));

/** CR 205.3m: is this subtype one of the creature types? */
export const isCreatureType = (t: string): boolean => CLASS_OF.get(t) === 'creature';

/**
 * Does this subtype belong to a class OTHER than creature types (a land, artifact, enchantment, spell, battle or dungeon type)? A subtype in no list is not: a
 * creature type printed on a card but newer than this list still counts as one (rules/filter.ts#creatureTypesOf).
 */
export const isNonCreatureSubtype = (t: string): boolean => { const c = CLASS_OF.get(t); return c !== undefined && c !== 'creature'; };

/** CR 205.3i: is this subtype a land type? */
export const isLandType = (t: string): boolean => CLASS_OF.get(t) === 'land';

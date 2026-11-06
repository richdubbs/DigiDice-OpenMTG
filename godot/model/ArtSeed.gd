class_name ArtSeed
extends RefCounted
## The seed and the scene choice of the card frame's procedural art: a port of the browser's packages/client/src/cards/artSeed.ts
## (FNV-1a hash, mulberry32 generator, type and land-colour readers), `planArt` from CardArt.tsx, and `paletteOf` / `glowAt`
## from artScenes.tsx. The same card name, colours and types give the same numbers in both front ends (tests/model/
## test_art_seed.gd checks them against values exported from the TypeScript). The shapes themselves are drawn by
## shaders/procedural_art.gdshader from these numbers.
##
## Integer maths: JavaScript works in 32-bit words here (Math.imul, >>>). GDScript ints are 64-bit, so every step is masked to
## 32 bits and `imul` multiplies in 16-bit halves (no 64-bit overflow).

const MASK: int = 0xFFFFFFFF

## Flavor ids as the shader numbers them.
const FLAVOR_IDS: Dictionary = {"W": 0, "U": 1, "B": 2, "R": 3, "G": 4, "steel": 5, "crystal": 6, "terra": 7}
## Art types as the shader numbers them (artSeed.ts ArtType).
const TYPE_IDS: Dictionary = {
	"creature": 0, "instant": 1, "sorcery": 2, "enchantment": 3, "artifact": 4, "planeswalker": 5, "battle": 6, "land": 7,
}

const _TYPE_WORDS: Array = [
	["planeswalker", "Planeswalker"],
	["battle", "Battle"],
	["creature", "Creature"],
	["land", "Land"],
	["artifact", "Artifact"],
	["enchantment", "Enchantment"],
	["instant", "Instant"],
	["sorcery", "Sorcery"],
]
const _BASIC_COLOR: Array = [["Plains", "W"], ["Island", "U"], ["Swamp", "B"], ["Mountain", "R"], ["Forest", "G"]]
const _ORDER: Array[String] = ["W", "U", "B", "R", "G"]
## The golden light of a card of several colours: hsl(45 95% 66%).
const GOLD: Color = Color(0.983, 0.8215, 0.337)

static var _regex_cache: Dictionary = {}


## Math.imul: the low 32 bits of a * b, as an unsigned 32-bit value.
static func imul(a: int, b: int) -> int:
	a &= MASK
	b &= MASK
	var al: int = a & 0xFFFF
	var ah: int = (a >> 16) & 0xFFFF
	var bl: int = b & 0xFFFF
	var bh: int = (b >> 16) & 0xFFFF
	return (al * bl + (((ah * bl + al * bh) & 0xFFFF) << 16)) & MASK


## FNV-1a, 32 bit, over the UTF-16 code units of `s` (JavaScript's charCodeAt), as artSeed.ts `hashString` and config.ts `hash`.
static func hash_string(s: String) -> int:
	var h: int = 0x811c9dc5
	var units := s.to_utf16_buffer() # little-endian code units, no byte order mark
	var i: int = 0
	while i + 1 < units.size():
		var unit: int = units[i] | (units[i + 1] << 8)
		h = imul(h ^ unit, 0x01000193)
		i += 2
	return h & MASK


## mulberry32: a small seeded generator returning [0, 1) (artSeed.ts `rngOf`).
class Rng:
	extends RefCounted
	var a: int

	func _init(start: int) -> void:
		a = start & ArtSeed.MASK

	func next() -> float:
		a = (a + 0x6d2b79f5) & ArtSeed.MASK
		var t: int = a
		t = ArtSeed.imul(t ^ (t >> 15), t | 1)
		t = t ^ ((t + ArtSeed.imul(t ^ (t >> 7), t | 61)) & ArtSeed.MASK)
		return float((t ^ (t >> 14)) & ArtSeed.MASK) / 4294967296.0

	## artShapes.ts `between`.
	func between(lo: float, hi: float) -> float:
		return lo + next() * (hi - lo)


static func rng_of(start: int) -> Rng:
	return Rng.new(start)


static func _word(word: String) -> RegEx:
	if not _regex_cache.has(word):
		var re := RegEx.new()
		re.compile("\\b" + word + "\\b")
		_regex_cache[word] = re
	return _regex_cache[word]


## Every art type named in a type line, in the order planeswalker, battle, creature, land, artifact, enchantment, instant, sorcery.
static func art_types_of(type_line: String) -> Array[String]:
	var out: Array[String] = []
	for pair: Array in _TYPE_WORDS:
		if _word(String(pair[1])).search(type_line) != null:
			out.append(String(pair[0]))
	return out


## The one type a card's emblem shows (artSeed.ts `emblemTypeOf`).
static func emblem_type_of(type_line: String) -> String:
	if _word("Emblem").search(type_line) != null:
		return "enchantment"
	var types := art_types_of(type_line)
	return types[0] if not types.is_empty() else "enchantment"


## The colours a land is drawn in: its basic land types and the mana its rules text mentions (artSeed.ts `landColorsOf`).
static func land_colors_of(type_line: String, oracle_text: String) -> Array[String]:
	var found: Dictionary = {}
	for pair: Array in _BASIC_COLOR:
		if _word(String(pair[0])).search(type_line) != null:
			found[String(pair[1])] = true
	if not _regex_cache.has("__mana"):
		var re := RegEx.new()
		re.compile("\\{([WUBRG])(?:/[WUBRGP])?\\}")
		_regex_cache["__mana"] = re
	var mana: RegEx = _regex_cache["__mana"]
	for m: RegExMatch in mana.search_all(oracle_text):
		found[m.get_string(1)] = true
	var out: Array[String] = []
	for c: String in _ORDER:
		if found.has(c):
			out.append(c)
	return out


## What to draw for a card (CardArt.tsx `planArt`): {"flavors": Array[String], "land": bool, "primary": String, "gear": bool}.
static func plan_art(colors: Array[String], type_line: String, oracle_text: String) -> Dictionary:
	var types := art_types_of(type_line)
	var land := types.has("land")
	var flavors: Array[String] = []
	if land:
		var lc: Array[String] = []
		if not colors.is_empty():
			lc.assign(colors)
		else:
			lc = land_colors_of(type_line, oracle_text)
		if lc.is_empty():
			flavors.append("terra")
		else:
			flavors.assign(lc)
	elif not colors.is_empty():
		flavors.assign(colors)
	else:
		flavors.append("steel" if types.has("artifact") else "crystal")
	if flavors.size() > 3:
		var picked: Array[String] = [flavors[0], flavors[int(flavors.size() / 2.0)], flavors[flavors.size() - 1]]
		flavors = picked
	var primary := emblem_type_of(type_line)
	return {
		"flavors": flavors,
		"land": land,
		"primary": primary,
		"gear": types.has("artifact") and primary != "artifact" and not flavors.has("steel"),
	}


## CSS hsl() as a Color (h in degrees, s and l in percent).
static func hsl(h: float, s: float, l: float) -> Color:
	var hh: float = fposmod(h, 360.0) / 360.0
	var ss: float = s / 100.0
	var ll: float = l / 100.0
	var q: float = ll * (1.0 + ss) if ll < 0.5 else ll + ss - ll * ss
	var p: float = 2.0 * ll - q
	return Color(_hue(p, q, hh + 1.0 / 3.0), _hue(p, q, hh), _hue(p, q, hh - 1.0 / 3.0))


static func _hue(p: float, q: float, t: float) -> float:
	var tt: float = fposmod(t, 1.0)
	if tt < 1.0 / 6.0:
		return p + (q - p) * 6.0 * tt
	if tt < 0.5:
		return q
	if tt < 2.0 / 3.0:
		return p + (q - p) * (2.0 / 3.0 - tt) * 6.0
	return p


## The palette of a flavor, hue-shifted by `dh` degrees (artScenes.tsx `paletteOf`): sky top/middle/bottom, glow, light, mid,
## dark, deep. The accent colours of the SVG scenes are not needed by the shader.
static func palette_of(f: String, dh: float) -> Dictionary:
	match f:
		"R":
			return _pal(hsl(352 + dh, 62, 13), hsl(8 + dh, 78, 34), hsl(34 + dh, 95, 56), hsl(48, 100, 78), hsl(42 + dh, 100, 64), hsl(10 + dh, 80, 42), hsl(350 + dh, 62, 16), hsl(350 + dh, 55, 8))
		"U":
			return _pal(hsl(232 + dh, 65, 11), hsl(214 + dh, 72, 27), hsl(190 + dh, 70, 46), hsl(188, 90, 86), hsl(186 + dh, 85, 74), hsl(208 + dh, 70, 36), hsl(226 + dh, 70, 16), hsl(232 + dh, 70, 8))
		"G":
			return _pal(hsl(160 + dh, 45, 9), hsl(138 + dh, 42, 22), hsl(92 + dh, 52, 42), hsl(72, 95, 80), hsl(84 + dh, 70, 62), hsl(128 + dh, 42, 30), hsl(150 + dh, 50, 11), hsl(160 + dh, 55, 6))
		"B":
			return _pal(hsl(268 + dh, 45, 5), hsl(276 + dh, 38, 15), hsl(292 + dh, 32, 30), hsl(280, 60, 88), hsl(288 + dh, 50, 66), hsl(280 + dh, 34, 26), hsl(268 + dh, 42, 9), hsl(262 + dh, 50, 4))
		"W":
			return _pal(hsl(208 + dh, 58, 64), hsl(40 + dh, 78, 80), hsl(46 + dh, 95, 91), hsl(48, 100, 97), hsl(48 + dh, 100, 94), hsl(40 + dh, 55, 66), hsl(34 + dh, 40, 46), hsl(30 + dh, 35, 30))
		"steel":
			return _pal(hsl(215, 14, 12), hsl(28 + dh, 22, 20), hsl(34 + dh, 30, 30), hsl(44, 95, 76), hsl(42 + dh, 50, 76), hsl(30 + dh, 28, 40), hsl(26 + dh, 26, 22), hsl(24 + dh, 24, 12))
		"crystal":
			return _pal(hsl(250 + dh, 30, 20), hsl(218 + dh, 40, 44), hsl(192 + dh, 55, 72), hsl(190, 100, 96), hsl(188 + dh, 80, 92), hsl(218 + dh, 42, 52), hsl(244 + dh, 34, 26), hsl(250 + dh, 36, 14))
		_:
			return _pal(hsl(218, 30, 28), hsl(28 + dh, 42, 50), hsl(40 + dh, 62, 72), hsl(46, 100, 86), hsl(44 + dh, 70, 76), hsl(28 + dh, 36, 38), hsl(22 + dh, 34, 20), hsl(20 + dh, 34, 11))


static func _pal(s0: Color, s1: Color, s2: Color, glow: Color, light: Color, mid: Color, dark: Color, deep: Color) -> Dictionary:
	return {"sky0": s0, "sky1": s1, "sky2": s2, "glow": glow, "light": light, "mid": mid, "dark": dark, "deep": deep}


## Where the scene's light sits, in the 100 x 70 box (artScenes.tsx `glowAt`): Vector3(x, y, radius).
static func glow_at(flavor: String, land: bool, rng: Rng) -> Vector3:
	var x: float = rng.between(32, 68)
	if flavor == "steel":
		return Vector3(80, 30, 34)
	if land:
		return Vector3(x, rng.between(28, 36), 34)
	if flavor == "R":
		return Vector3(x, rng.between(44, 52), 40)
	if flavor == "B":
		return Vector3(rng.between(56, 76), 19, 28)
	if flavor == "G":
		return Vector3(rng.between(58, 90), 6, 38)
	if flavor == "W":
		return Vector3(x, 31, 38)
	return Vector3(x, rng.between(24, 34), 32)


## Everything the art shader needs for a card, drawn from the same generator calls as CardArt.tsx `build`:
## {"count", "flavors": Array[int], "land", "primary", "type_id", "gear", "palettes": Array[Dictionary], "seams": Array[Vector2]
## (x at the top and at the bottom of the box, 0..100), "glows": Array[Vector3], "seeds": Array[float] (one per scene, for the
## shader's noise), "gold": bool}.
static func art_params(seed_name: String, colors: Array[String], type_line: String, oracle_text: String) -> Dictionary:
	var plan := plan_art(colors, type_line, oracle_text)
	var flavors: Array[String] = []
	flavors.assign(plan["flavors"])
	var land: bool = plan["land"]
	var h: int = hash_string(seed_name)
	var rng := rng_of(h)
	var n: int = flavors.size()
	var multi: bool = n > 1
	var palettes: Array[Dictionary] = []
	for f: String in flavors:
		palettes.append(palette_of(f, rng.between(-9, 9)))
	var seams: Array[Vector2] = []
	var glows: Array[Vector3] = []
	var seeds: Array[float] = []
	if not multi:
		var r := rng_of(h ^ 0x9e3779b9)
		glows.append(glow_at(flavors[0], land, r))
		seeds.append(r.next())
	else:
		for i: int in range(n - 1):
			var top: float = (100.0 * (i + 1)) / n + rng.between(-4, 4) + 6.0
			seams.append(Vector2(top, top - rng.between(10, 16)))
		for i: int in range(n):
			var r := rng_of(h ^ imul(i + 1, 0x85ebca6b))
			glows.append(glow_at(flavors[i], land, r))
			seeds.append(r.next())
	var ids: Array[int] = []
	for f: String in flavors:
		ids.append(int(FLAVOR_IDS.get(f, 7)))
	return {
		"count": n,
		"flavors": ids,
		"land": land,
		"primary": plan["primary"],
		"type_id": int(TYPE_IDS.get(plan["primary"], 3)),
		"gear": plan["gear"],
		"palettes": palettes,
		"seams": seams,
		"glows": glows,
		"seeds": seeds,
		"gold": multi,
	}

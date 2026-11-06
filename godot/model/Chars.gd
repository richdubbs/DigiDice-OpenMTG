class_name Chars
extends RefCounted
## What the table shows of an object's characteristics (name, mana cost, colours, types, rules text, power and toughness).
##
## The browser asks the engine for them (`getChars` over the view, CR 613 layers: board/model.ts `charsOf`). Godot has no
## engine, and the layers are not recomputed here. So:
##
##   1. The view's characteristics summary is used as is. Since view schema 2 the TypeScript source's views carry it as a top-level map
##      `view.chars[objectId]` (core/view-chars.ts `ViewChars`), one entry per object the viewer may see (a hidden object has none):
##        {name, manaCost: ManaSymbol[] | null, manaValue, colors, supertypes, types, subtypes, controller,
##         power?: number | null, toughness?: number | null (null for an unevaluated "*"; absent when it has none),
##         loyalty?: String, defense?: String, keywords: [lower-case canonical names, "first strike"],
##         abilities: [{key, text, manual?: true}], summoningSick?: bool (battlefield only)}
##      When `view.chars` has no entry for the object, a summary on the object itself (`view.objects[id].chars`) is read the same
##      way: the plan goldens (tests/fixtures/plans/*.json) carry it there, made by the board's `charsOf` (power and
##      toughness as text, no abilities, no controller). The goldens are not regenerated, so both places stay readable.
##   2. Otherwise (a schema-1 view) the shown face of the definition (`View.shown_face`) is read, with power and toughness adjusted
##      by +1/+1 and -1/-1 counters only. Such a result has `approximate: true`: anthems, auras, equipment, "becomes" effects and
##      copy effects are NOT applied, so the board may show a printed value the engine does not use.
##
## Every result has the same keys: name, mana_cost (text such as "{2}{G}"), mana_value, colors (Array[String] of W/U/B/R/G),
## supertypes, types, subtypes (Array[String]), type_line, text (the abilities' readings, one per line; the keyword names when
## there are none), printed_text (the shown face's printed text, which seeds the procedural art as the browser's CardArt does),
## abilities (Array[Dictionary] {key, text, manual}), power, toughness ("3"; "*" for an unevaluated star; "" when absent), loyalty, defense
## (Strings, "" when absent), keywords (Array[String], lower-case canonical names), keyword_names (the same, capitalised for
## display: "First strike"), controller (after layer 2, CR 613.1b; the object's own field when the summary does not say),
## summoning_sick and sick_known (bools: whether the engine said the permanent is summoning sick, CR 302.6, and whether it said
## anything), approximate (bool). A hidden object gives {}.


static func of(view: Dictionary, obj: Dictionary) -> Dictionary:
	if obj.is_empty() or View.is_hidden(obj):
		return {}
	var summary := summary_of(view, obj)
	if not summary.is_empty():
		return _from_summary(summary, View.def_of(view, obj), obj)
	var def := View.def_of(view, obj)
	if def.is_empty():
		return {}
	return _from_def(def, obj)


static func of_id(view: Dictionary, id: String) -> Dictionary:
	return of(view, View.object(view, id))


## The raw summary of an object: `view.chars[id]` (view schema 2) first, then `obj.chars` (the plan goldens); {} when neither.
static func summary_of(view: Dictionary, obj: Dictionary) -> Dictionary:
	var id := Val.text(obj, "id")
	if id != "":
		var top := Val.dict(view, "chars")
		if top.has(id):
			var entry := Val.as_dict(top[id])
			if not entry.is_empty():
				return entry
	return Val.dict(obj, "chars")


## Who controls the object after layer 2 (CR 613.1b): the summary's `controller`, else the object's own field.
static func controller_of(view: Dictionary, obj: Dictionary) -> String:
	if obj.is_empty():
		return ""
	if not View.is_hidden(obj):
		var c := Val.text(summary_of(view, obj), "controller")
		if c != "":
			return c
	return Val.text(obj, "controller")


static func _from_summary(c: Dictionary, def: Dictionary, obj: Dictionary) -> Dictionary:
	var supertypes := Val.texts(c, "supertypes")
	var types := Val.texts(c, "types")
	var subtypes := Val.texts(c, "subtypes")
	var keywords := _lower(Val.texts(c, "keywords"))
	var abilities: Array[Dictionary] = []
	var lines: Array[String] = []
	for a: Variant in Val.list(c, "abilities"):
		var d := Val.as_dict(a)
		var line := Val.text(d, "text")
		abilities.append({"key": Val.text(d, "key"), "text": line, "manual": Val.flag(d, "manual")})
		if line != "":
			lines.append(line)
	var text := ""
	if c.has("abilities"):
		text = "\n".join(lines)
	else:
		# A summary without abilities (the plan goldens): the text it carries, else the shown face's printed text.
		text = Val.text(c, "text", Val.text(_face(def, obj), "oracleText"))
	if text == "" and not keywords.is_empty():
		text = ", ".join(keyword_names(keywords))
	var cost: Variant = c.get("manaCost")
	var mana_val: Variant = c.get("manaValue")
	return {
		"name": Val.text(c, "name"),
		"mana_cost": mana_text(cost),
		"mana_value": Val.as_int(mana_val) if (mana_val is int or mana_val is float) else mana_value(cost),
		"colors": Val.texts(c, "colors"),
		"supertypes": supertypes,
		"types": types,
		"subtypes": subtypes,
		"type_line": type_line(supertypes, types, subtypes),
		"text": text,
		"printed_text": Val.text(_face(def, obj), "oracleText"),
		"abilities": abilities,
		"power": stat_text(c, "power"),
		"toughness": stat_text(c, "toughness"),
		"loyalty": Val.text(c, "loyalty"),
		"defense": Val.text(c, "defense"),
		"keywords": keywords,
		"keyword_names": keyword_names(keywords),
		"controller": Val.text(c, "controller", Val.text(obj, "controller")),
		"summoning_sick": Val.flag(c, "summoningSick"),
		"sick_known": c.get("summoningSick") is bool,
		"approximate": false,
	}


## Power or toughness of a summary as shown: a number as its integer ("3", "-1"), null as "*" (a characteristic-defining ability
## not evaluated), absent as "". Text (the plan goldens carry "2") is kept as it is.
static func stat_text(c: Dictionary, key: String) -> String:
	if not c.has(key):
		return ""
	var v: Variant = c[key]
	if v == null:
		return "*"
	if v is int or v is float:
		return str(Val.as_int(v))
	return Val.as_text(v)


## Keyword names capitalised for display ("first strike" -> "First strike"; only the first letter changes).
static func keyword_names(keywords: Array[String]) -> Array[String]:
	var out: Array[String] = []
	for k: String in keywords:
		out.append(k.substr(0, 1).to_upper() + k.substr(1) if k != "" else k)
	return out


static func _lower(list: Array[String]) -> Array[String]:
	var out: Array[String] = []
	for k: String in list:
		out.append(k.to_lower())
	return out


static func _face(def: Dictionary, obj: Dictionary) -> Dictionary:
	var faces := Val.list(def, "faces")
	if faces.is_empty():
		return {}
	return Val.as_dict(faces[clampi(View.shown_face(def, obj), 0, faces.size() - 1)])


static func _from_def(def: Dictionary, obj: Dictionary) -> Dictionary:
	var face := _face(def, obj)
	var power := Val.text(face, "power")
	var toughness := Val.text(face, "toughness")
	# Counters (CR 122.1a): the only modification read here.
	var counters := Val.dict(obj, "counters")
	var delta: int = Val.num(counters, "+1/+1") - Val.num(counters, "-1/-1")
	if delta != 0 and power.is_valid_int() and toughness.is_valid_int():
		power = str(power.to_int() + delta)
		toughness = str(toughness.to_int() + delta)
	var name := Val.text(face, "name", Val.text(def, "name"))
	if View.is_face_down_profile(obj):
		name = ""
	var keywords := _lower(Val.texts(face, "keywords"))
	var empty_abilities: Array[Dictionary] = []
	return {
		"name": name,
		"mana_cost": mana_text(face.get("manaCost")),
		"mana_value": mana_value(face.get("manaCost")),
		"colors": Val.texts(face, "colors"),
		"supertypes": Val.texts(face, "supertypes"),
		"types": Val.texts(face, "types"),
		"subtypes": Val.texts(face, "subtypes"),
		"type_line": Val.text(face, "typeLine"),
		"text": Val.text(face, "oracleText"),
		"printed_text": Val.text(face, "oracleText"),
		"abilities": empty_abilities,
		"power": power,
		"toughness": toughness,
		"loyalty": Val.text(face, "loyalty"),
		"defense": Val.text(face, "defense"),
		"keywords": keywords,
		"keyword_names": keyword_names(keywords),
		"controller": Val.text(obj, "controller"),
		"summoning_sick": false,
		"sick_known": false,
		"approximate": true,
	}


## "Legendary Creature — Elf Druid" from the parts.
static func type_line(supertypes: Array[String], types: Array[String], subtypes: Array[String]) -> String:
	var left := " ".join(supertypes + types)
	if subtypes.is_empty():
		return left
	return "%s — %s" % [left, " ".join(subtypes)]


## A mana cost (ManaSymbol[] from types/mana.ts, or null) as text, "{2}{W/U}{X}" (port of `formatManaCost`).
static func mana_text(cost: Variant) -> String:
	if not (cost is Array):
		return ""
	var out := ""
	for s: Variant in cost:
		out += _symbol_text(Val.as_dict(s))
	return out


static func _symbol_text(s: Dictionary) -> String:
	var cs := Val.texts(s, "colors")
	match Val.text(s, "kind"):
		"generic":
			return "{%d}" % Val.num(s, "amount")
		"colored":
			return "{%s}" % Val.text(s, "color")
		"colorless":
			return "{C}"
		"hybrid":
			return "{%s/%s}" % [cs[0] if cs.size() > 0 else "?", cs[1] if cs.size() > 1 else "?"]
		"monoHybrid":
			return "{%d/%s}" % [Val.num(s, "generic"), Val.text(s, "color")]
		"colorlessHybrid":
			return "{C/%s}" % Val.text(s, "color")
		"phyrexian":
			return "{%s/P}" % Val.text(s, "color")
		"hybridPhyrexian":
			return "{%s/%s/P}" % [cs[0] if cs.size() > 0 else "?", cs[1] if cs.size() > 1 else "?"]
		"variable":
			return "{%s}" % Val.text(s, "name", "X")
		"snow":
			return "{S}"
		_:
			return ""


## The mana value of a printed cost (CR 202.3): generic amounts, one per coloured, hybrid, Phyrexian or snow symbol, the larger
## half of a monohybrid symbol, X as zero.
static func mana_value(cost: Variant) -> int:
	if not (cost is Array):
		return 0
	var n: int = 0
	for s: Variant in cost:
		var sym := Val.as_dict(s)
		match Val.text(sym, "kind"):
			"generic":
				n += Val.num(sym, "amount")
			"monoHybrid":
				n += maxi(1, Val.num(sym, "generic"))
			"variable":
				pass
			_:
				n += 1
	return n


static func has_type(chars: Dictionary, type_name: String) -> bool:
	return Val.texts(chars, "types").has(type_name)

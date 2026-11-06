class_name SoundCues
extends RefCounted
## What a change sounds like on the table: a port of the TypeScript source's packages/client/src/board/fx/sounds.ts (the sound of each moment,
## the events the animator never shows, and the short summary of a change shown without animation). Pure, like Plan.gd.
##
## - The animator (fx/Animator.gd) plays most sounds itself, at the visual beats of its choreography: the helpers here only name them
##   (`hit_sound`, `arrival_sound`, `exit_cue` ...).
## - `event_cues`: what happened without a visual of its own (taps, untaps, shuffles, coin flips, a lock-on by the opponent ...), for
##   every change, animated or not. At most a few cues, each sound once.
## - `unanimated_cues`: a change shown at once (animations off, reduced motion, a catch-up) still sounds, condensed: its most
##   important moments, a few at most, a beat apart, then its event cues.
##
## A cue is a Dictionary {id, gain?, delay?} (delay in seconds from now). Sound ids are the TypeScript source's audio/catalog.ts ids, which
## the server's GET /api/sounds/manifest lists. Panning is not computed here: Sound.gd plays each cue through an AudioStreamPlayer2D
## at the event's position on the table (sounds.ts `panFor` is not needed).
##
## Every id comes from events already redacted for the viewer, so a sound never tells more than the screen may show (CR 400.2).

## Seconds into a sound of its main accent (catalog.ts `accent`): the animator lines the accent up with its own beat at any speed.
## The manifest carries no accents, so they are kept here (as catalog.ts has them).
const ACCENTS: Dictionary = {
	"cast.fire": 0.44, "cast.lightning": 0.44, "cast.arcane": 0.44, "cast.shadow": 0.44, "cast.nature": 0.44, "cast.radiant": 0.44,
	"cast.force": 0.44, "spell.bolt": 0.3, "combat.swing": 0.28, "card.destroy": 0.32, "card.sacrifice": 0.62, "card.exile": 0.5,
	"card.bounce": 0.295, "card.toGraveyard": 0.34, "card.toLibrary": 0.34, "card.flip": 0.18,
}

## How long after `game.start` the first turn's banner stays quiet (ms).
const GAME_START_QUIET_MS: float = 3000.0
## At most this many event cues per change.
const EVENT_CUE_CAP: int = 6
## At most this many taps per change (a board of taps is one gesture).
const TAP_CAP: int = 3
## Steps whose start is never ticked: nobody gets priority in the untap step (CR 502.4), normally not in the cleanup step (CR 514.3).
const SILENT_STEPS: Array[String] = ["untap", "cleanup"]
## A change shown at once makes at most this many sounds of its own moments, this far apart ...
const CONDENSED_CAP: int = 4
const CONDENSED_GAP_S: float = 0.08
## ... and at most this many sounds in all, with its event cues.
const UNANIMATED_CAP: int = 6

const MANA_SOUNDS: Dictionary = {"W": "mana.W", "U": "mana.U", "B": "mana.B", "R": "mana.R", "G": "mana.G", "C": "mana.C"}


## A blow's sound by its damage: 1-2 light, 3-5 medium, 6+ heavy on a card; a player's disc has its own (CR 120.3a).
static func hit_sound(amount: int, on_player: bool) -> String:
	if on_player:
		return "hit.player"
	if amount >= 6:
		return "hit.heavy"
	return "hit.medium" if amount >= 3 else "hit.light"


## Louder for more damage: 0.6 at 0, full at 6 or more.
static func damage_gain(amount: int) -> float:
	return 0.6 + 0.4 * minf(1.0, maxf(0.0, float(amount)) / 6.0)


## Lines a sound's accent (seconds into the sound) up with its animation's beat (seconds at normal speed) when the animation runs at
## `k` times its normal length: {offset, delay} in seconds (start that far into the sound, or that much later).
static func align_accent(accent: float, beat: float, k: float) -> Dictionary:
	var target := beat * k
	if target < accent:
		return {"offset": roundf((accent - target) * 1000.0) / 1000.0, "delay": 0.0}
	return {"offset": 0.0, "delay": target - accent}


static func cast_sound(style: String) -> String:
	return "cast.%s" % style


static func impact_sound(style: String) -> String:
	return "impact.%s" % style


## The mana orb's sound by the mana's type (colourless for anything else).
static func mana_sound(type: String) -> String:
	return String(MANA_SOUNDS.get(type, "mana.C"))


## The sound of a card leaving (a Move of the plan). `finished_spell`: a resolved spell's card going to its pile, softer.
static func exit_cue(m: Dictionary, finished_spell: bool = false) -> Dictionary:
	var kind := Val.text(m, "kind")
	# A token outside the battlefield ceases to exist (CR 111.7, 704.5d): it vanishes, quietly.
	if Val.flag(m, "token") and kind != "die" and kind != "sacrifice" and kind != "exile":
		return {"id": "card.exile", "gain": 0.4}
	var soft: float = 0.6 if finished_spell else 0.0
	match kind:
		"die":
			return {"id": "card.destroy"}
		"sacrifice":
			return {"id": "card.sacrifice"}
		"exile":
			return {"id": "card.exile", "gain": soft} if soft > 0.0 else {"id": "card.exile"}
		"bounce", "toHand":
			return {"id": "card.bounce"}
		"toLibrary":
			return {"id": "card.toLibrary", "gain": soft} if soft > 0.0 else {"id": "card.toLibrary"}
		"toGraveyard":
			return {"id": "card.toGraveyard", "gain": soft} if soft > 0.0 else {"id": "card.toGraveyard"}
		_:
			return {"id": "card.exile", "gain": 0.4}


static func _is_land(view: Dictionary, id: String) -> bool:
	var o := View.object(view, id)
	if o.is_empty() or View.is_hidden(o):
		return false
	var chars := Chars.of(view, o)
	if not chars.is_empty():
		return Chars.has_type(chars, "Land")
	return false


## A permanent's power on `view` (0 when it has none or it cannot be told).
static func power_of(view: Dictionary, id: String) -> int:
	var o := View.object(view, id)
	if o.is_empty() or View.is_hidden(o):
		return 0
	var p := Val.text(Chars.of(view, o), "power")
	return p.to_int() if p.is_valid_int() else 0


## The lands played in this change (CR 305.1), by their new ids.
static func lands_played(events: Array) -> Dictionary:
	var out: Dictionary = {}
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		if Val.text(e, "type") == "landPlayed":
			out[Val.text(e, "objectId")] = true
	return out


## A permanent landing on the table: a land locks in, a big creature (power 4 or more) shakes the table, a token compiles out of light.
static func enter_sound(to: Dictionary, id: String, lands: Dictionary) -> String:
	if Val.text(View.object(to, id), "kind") == "token":
		return "card.token"
	if lands.has(id) or _is_land(to, id):
		return "card.land"
	return "card.enterHeavy" if power_of(to, id) >= 4 else "card.enter"


## The sound of a card arriving where the animator flies it, or "" for none.
static func arrival_sound(m: Dictionary, to: Dictionary, lands: Dictionary) -> String:
	var new_id: Variant = m.get("newId")
	if not (new_id is String):
		return ""
	var dest := Val.text(m, "to")
	if dest == "stack":
		return cast_sound(Plan.spell_style([to], new_id))
	if dest == "hand":
		return "card.draw" if Val.text(m, "from") == "library" else "card.bounce"
	if dest == "battlefield":
		return enter_sound(to, new_id, lands)
	return ""


## The banner's sound for a new turn, or "" when the game's start just played.
static func banner_sound(turn: Dictionary, viewer: String, started_ms_ago: float) -> String:
	if Val.num(turn, "number") <= 1 and started_ms_ago < GAME_START_QUIET_MS:
		return ""
	return "turn.mine" if Val.text(turn, "player") == viewer else "turn.theirs"


## A counter change is good for its permanent: +1/+1, loyalty, charge added, or a -1/-1 removed.
static func counter_good(counter: String, delta: int) -> bool:
	return not counter.begins_with("-") if delta > 0 else counter.begins_with("-")


## Who controls the object after layer 2 (Chars.controller_of), in the view after the change, else the one before it.
static func _controller_of(from: Dictionary, to: Dictionary, id: String) -> String:
	var o := Plan.known_object(to, id)
	if not o.is_empty():
		return Chars.controller_of(to, o)
	return Chars.controller_of(from, Plan.known_object(from, id))


## The sounds of what the animator never shows, in order, each sound once (taps up to three), at most EVENT_CUE_CAP (sounds.ts
## `eventCues`). `plan` may be {} (it is made when needed).
static func event_cues(events: Array, from: Dictionary, to: Dictionary, viewer: String, plan: Dictionary = {}) -> Array:
	var out: Array = []
	var once: Dictionary = {}
	var attackers: Dictionary = {}
	var mana_sources: Dictionary = {}
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		if Val.text(e, "type") == "attackersDeclared":
			for a: Variant in Val.list(e, "attackers"):
				attackers[Val.text(Val.as_dict(a), "attacker")] = true
		elif Val.text(e, "type") == "manaAdded" and Val.text(e, "sourceId") != "":
			mana_sources[Val.text(e, "sourceId")] = true
	var taps: int = 0
	var untaps: int = 0
	var untap_mine := false
	var step := ""
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		match Val.text(e, "type"):
			"tapped":
				var oid := Val.text(e, "objectId")
				if not attackers.has(oid) and not mana_sources.has(oid) and taps < TAP_CAP:
					taps += 1
					out.append({"id": "card.tap"})
			"untapped":
				untaps += 1
				if viewer != "" and _controller_of(from, to, Val.text(e, "objectId")) == viewer:
					untap_mine = true
			"shuffled":
				_add_once(out, once, "game.shuffle")
			"mulligan":
				_add_once(out, once, "game.mulligan")
			"coinFlipped":
				_add_once(out, once, "game.coin")
			"dieRolled":
				_add_once(out, once, "game.dice")
			"dayNight":
				_add_once(out, once, "world.day" if Val.text(e, "to") == "day" else "world.night")
			"designationChanged":
				# CR 724 (the monarch), 725 (the initiative); day and night (CR 731) also come as dayNight: one sound.
				var what := Val.text(e, "what")
				if what == "monarch" or what == "initiative":
					_add_once(out, once, "world.crown")
				else:
					_add_once(out, once, "world.day" if what == "day" else "world.night")
			"controlChanged":
				_add_once(out, once, "card.control")
			"attached":
				# Attached to something (`to` null is an unattach).
				if not (e.has("to") and e["to"] == null):
					_add_once(out, once, "card.attach")
			"phasedOut":
				_add_once(out, once, "card.phase")
			"spellCopied":
				_add_once(out, once, "spell.copied")
			"turnedFaceDown", "flipped", "melded", "mutated":
				_add_once(out, once, "card.flip")
			"actionPerformed":
				var verb := Val.text(e, "verb")
				if verb == "search":
					_add_once(out, once, "card.search")
				elif verb == "reveal" or verb == "scry" or verb == "surveil":
					_add_once(out, once, "card.reveal")
			"becameTarget":
				var target := Val.text(e, "objectId")
				if viewer != "" and Val.text(e, "byController") != viewer and (target == viewer or _controller_of(from, to, target) == viewer):
					_add_once(out, once, "card.targeted")
			"damagePrevented":
				_add_once(out, once, "damage.prevented")
			"zoneChanged":
				# Milled (CR 701.17): the library and the graveyard are piles, nothing flies between them.
				if Val.text(e, "from") == "library" and Val.text(e, "to") == "graveyard":
					_add_once(out, once, "card.toGraveyard", 0.7)
			"stepBegan":
				step = Val.text(e, "step")
			_:
				pass
	# Untapping is one sweep for the whole board (CR 502.3), softer for the other player's.
	if untaps > 0:
		_add_once(out, once, "card.untap", -1.0 if (untap_mine or viewer == "") else 0.6)
	if step != "" and not SILENT_STEPS.has(step) and out.is_empty():
		var p := plan if not plan.is_empty() else Plan.plan_batch(events, from, to)
		if Plan.is_empty(p):
			_add_once(out, once, "turn.step")
	# A mulligan's hand goes back and is shuffled (CR 103.5): the shuffle follows the mulligan's own "again", not over it.
	var m := _index_of(out, "game.mulligan")
	var sh := _index_of(out, "game.shuffle")
	if m >= 0 and sh >= 0 and sh < m:
		var shuffle: Variant = out[sh]
		out.remove_at(sh)
		out.insert(m, shuffle)
	return _spaced(out.slice(0, EVENT_CUE_CAP), 0.0)


static func _add_once(out: Array, once: Dictionary, id: String, gain: float = -1.0) -> void:
	if once.has(id):
		return
	once[id] = true
	out.append({"id": id} if gain < 0.0 else {"id": id, "gain": gain})


static func _index_of(cues: Array, id: String) -> int:
	for i: int in range(cues.size()):
		if Val.text(Val.as_dict(cues[i]), "id") == id:
			return i
	return -1


## Delays for cues played one after another: taps 30 ms apart, a shuffle 0.7 s after a mulligan, anything else 70 ms. The lock-on
## warning waits at least 0.12 s, so the spell's own cast does not cover it.
static func _spaced(cues: Array, start: float) -> Array:
	var t := start
	var out: Array = []
	for i: int in range(cues.size()):
		var c: Dictionary = Val.as_dict(cues[i]).duplicate()
		var id := Val.text(c, "id")
		if i > 0:
			var prev := Val.text(Val.as_dict(cues[i - 1]), "id")
			if id == "card.tap" and prev == "card.tap":
				t += 0.03
			elif id == "game.shuffle" and prev == "game.mulligan":
				t += 0.7
			else:
				t += 0.07
		if id == "card.targeted":
			t = maxf(t, start + 0.12)
		if t > 0.0:
			c["delay"] = roundf(t * 1000.0) / 1000.0
		out.append(c)
	return out


## The heaviest blow of the change, {hit, style} (style "physical" for combat), or {} when none.
static func _heaviest_hit(plan: Dictionary) -> Dictionary:
	var best: Dictionary = {}
	for sv: Variant in Val.list(plan, "a"):
		var s := Val.as_dict(sv)
		var kind := Val.text(s, "kind")
		if kind != "resolve" and kind != "combat" and kind != "damage":
			continue
		var style := "physical" if kind == "combat" else Val.text(s, "style")
		for hv: Variant in Val.list(s, "hits"):
			var h := Val.as_dict(hv)
			if best.is_empty() or Val.num(h, "amount") > Val.num(Val.dict(best, "hit"), "amount"):
				best = {"hit": h, "style": style}
	return best


## The most important moments of a change as the animator would have sounded them, at most CONDENSED_CAP, CONDENSED_GAP_S apart in
## the order they would have happened (sounds.ts `condensedCues`).
static func condensed_cues(plan: Dictionary, events: Array, to: Dictionary, viewer: String, started_ms_ago: float = INF) -> Array:
	var list: Array = [] # [{cue, rank, beat, i}]
	var b := Val.dict(plan, "b")
	if b.get("gameOver") != null:
		_candidate(list, {"id": "game.finalBlow"}, 0, 12)
	elif b.get("turn") != null:
		var id := banner_sound(Val.dict(b, "turn"), viewer, started_ms_ago)
		if id != "":
			_candidate(list, {"id": id}, 1, 11)
	for mv: Variant in Val.list(b, "moves"):
		var m := Val.as_dict(mv)
		var kind := Val.text(m, "kind")
		if kind == "die" or kind == "sacrifice" or (kind == "exile" and Val.text(m, "from") == "battlefield"):
			_candidate(list, exit_cue(m), 2, 6)
	var heavy := _heaviest_hit(plan)
	if not heavy.is_empty():
		var hit := Val.dict(heavy, "hit")
		var on_player := not View.player(to, Val.text(hit, "target")).is_empty()
		var gain := damage_gain(Val.num(hit, "amount"))
		var style := Val.text(heavy, "style")
		var id2 := hit_sound(Val.num(hit, "amount"), on_player) if (style == "physical" or on_player) else impact_sound(style)
		_candidate(list, {"id": id2, "gain": gain}, 3, 3)
	for sv: Variant in Val.list(plan, "a"):
		var s := Val.as_dict(sv)
		var kind := Val.text(s, "kind")
		if kind == "resolve" or kind == "combat" or kind == "damage" or kind == "life":
			for lv: Variant in Val.list(s, "life"):
				var l := Val.as_dict(lv)
				if Val.num(l, "delta") > 0:
					_candidate(list, {"id": "life.gain"}, 4, 4)
				elif Val.num(l, "delta") < 0 and not Val.flag(l, "byDamage"):
					_candidate(list, {"id": "life.loss"}, 4, 4)
		if kind == "countered":
			_candidate(list, {"id": "spell.countered"}, 4, 2)
	for sv: Variant in Val.list(plan, "a"):
		var s := Val.as_dict(sv)
		if Val.text(s, "kind") == "cast":
			_candidate(list, {"id": cast_sound(Val.text(s, "style"))}, 5, 0)
			break
	var lands := lands_played(events)
	for mv: Variant in Val.list(b, "moves"):
		var m := Val.as_dict(mv)
		var new_id: Variant = m.get("newId")
		if not (new_id is String):
			continue
		var dest := Val.text(m, "to")
		if dest == "stack":
			_candidate(list, {"id": cast_sound(Plan.spell_style([to], new_id))}, 5, 0)
		elif dest == "hand" and Val.text(m, "from") == "library":
			var mine := Val.text(m, "owner") == viewer or viewer == ""
			_candidate(list, {"id": "card.draw"} if mine else {"id": "card.draw", "gain": 0.6}, 6, 8)
		elif dest == "battlefield":
			_candidate(list, {"id": enter_sound(to, new_id, lands)}, 6, 7)
	if not Val.list(b, "tokens").is_empty():
		_candidate(list, {"id": "card.token"}, 6, 7)
	if not Val.list(b, "attackers").is_empty():
		_candidate(list, {"id": "combat.attack"}, 5, 9)
	if not Val.list(b, "blocks").is_empty():
		_candidate(list, {"id": "combat.block"}, 5, 9)
	for sv: Variant in Val.list(plan, "a"):
		var s := Val.as_dict(sv)
		var kind := Val.text(s, "kind")
		if kind == "ability":
			_candidate(list, {"id": "ability.triggered" if Val.flag(s, "triggered") else "ability.activated"}, 7, 1)
		if kind == "resolve" and Val.flag(s, "spell") and not _becomes_permanent(b, Val.text(s, "stackId")):
			_candidate(list, {"id": "spell.resolve"}, 7, 2)
		if kind == "resolve" or kind == "counters":
			for cv: Variant in Val.list(s, "counters"):
				var c := Val.as_dict(cv)
				_candidate(list, {"id": "counter.up" if counter_good(Val.text(c, "counter"), Val.num(c, "delta")) else "counter.down"}, 8, 5)
	for ev: Variant in events:
		var t := Val.text(Val.as_dict(ev), "type")
		if t == "transformed" or t == "turnedFaceUp":
			_candidate(list, {"id": "card.flip"}, 8, 10)
			break
	var kept := list.duplicate()
	kept.sort_custom(func(x: Dictionary, y: Dictionary) -> bool:
		return _before(x, y, "rank")
	)
	kept = kept.slice(0, CONDENSED_CAP)
	kept.sort_custom(func(x: Dictionary, y: Dictionary) -> bool:
		return _before(x, y, "beat")
	)
	var out: Array = []
	for i: int in range(kept.size()):
		var cue: Dictionary = Val.dict(kept[i], "cue").duplicate()
		if i > 0:
			cue["delay"] = roundf(i * CONDENSED_GAP_S * 1000.0) / 1000.0
		out.append(cue)
	return out


## Order of two candidates by `key` (rank or beat), then by the order they were added.
static func _before(x: Dictionary, y: Dictionary, key: String) -> bool:
	if int(x[key]) != int(y[key]):
		return int(x[key]) < int(y[key])
	return int(x["i"]) < int(y["i"])


static func _candidate(list: Array, cue: Dictionary, rank: int, beat: int) -> void:
	for c: Variant in list:
		if Val.text(Val.dict(Val.as_dict(c), "cue"), "id") == Val.text(cue, "id"):
			return
	list.append({"cue": cue, "rank": rank, "beat": beat, "i": list.size()})


static func _becomes_permanent(b: Dictionary, stack_id: String) -> bool:
	for mv: Variant in Val.list(b, "moves"):
		var m := Val.as_dict(mv)
		if Val.text(m, "oldId") == stack_id and Val.text(m, "to") == "battlefield":
			return true
	return false


## Everything a change shown without animation sounds like: its condensed moments, then its event cues, each sound once, at most
## UNANIMATED_CAP (sounds.ts `unanimatedCues`).
static func unanimated_cues(events: Array, from: Dictionary, to: Dictionary, started_ms_ago: float = INF) -> Array:
	var plan := Plan.plan_batch(events, from, to)
	var viewer := View.viewer(to)
	var main := condensed_cues(plan, events, to, viewer, started_ms_ago)
	var ids: Dictionary = {}
	for c: Variant in main:
		ids[Val.text(Val.as_dict(c), "id")] = true
	var start := main.size() * CONDENSED_GAP_S
	var out: Array = main.duplicate()
	for c: Variant in event_cues(events, from, to, viewer, plan):
		var cue: Dictionary = Val.as_dict(c).duplicate()
		if ids.has(Val.text(cue, "id")):
			continue
		cue["delay"] = roundf((start + Val.real(cue, "delay")) * 1000.0) / 1000.0
		out.append(cue)
	return out.slice(0, UNANIMATED_CAP)

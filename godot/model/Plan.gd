class_name Plan
extends RefCounted
## What a change looks like on the table: one batch of engine events turned into an animation plan. A faithful port of the
## TypeScript source's packages/client/src/board/fx/plan.ts (`planBatch`, `classifyMove`, `spellStyle`, `totalDamage`, `planIsEmpty`), with
## the same step kinds and field names, so the same change gives the same plan JSON in both front ends (tests/model/test_plan.gd
## checks it against golden plans exported from the TypeScript source, tests/fixtures/plans/). Also the stack pace curve
## (packages/play/src/stackPace.ts) and `stackDepths` (packages/client/src/board/fx/stackPace.ts).
##
## The animator plays part A on the board as it was (casts that came and went, resolutions with their spell effects, combat swings,
## life changes), then the board shows the new view, then part B (cards leaving, cards arriving, the turn banner).
##
## Every id comes from events already redacted for the viewer (the server's LocalConnection.events()) and from the viewer's own
## views, so a plan never knows more than the screen may show (CR 400.2).
##
## A plan is a Dictionary:
##   {a: [StepA], b: {moves: [Move], tokens: [id], turn: {number, player} | null, attackers: [id],
##                    blocks: [{blocker, attacker}], gameOver: {winner} | null, lost: [player], left: [{player, removed, revealed}]}}
## StepA, by `kind`:
##   cast      {kind, stackId, origin (id or null), controller, style}
##   ability   {kind, stackId, source (id or null), triggered, transient, style}
##   resolve   {kind, stackId, spell, source (id or null), style, hits: [Hit], life: [LifeChange], counters: [CounterChange], targets: [id]}
##   combat    {kind, hits, life}
##   damage    {kind, hits, style, life}
##   life      {kind, life}
##   countered {kind, stackId}
##   counters  {kind, counters}
## Hit {source, target, amount}; LifeChange {player, delta, byDamage}; CounterChange {target, counter, delta}.
## Move {oldId, newId (or null), from (or null), to, owner, controller, kind, token, shownInA}; kind is one of MOVE_KINDS.
##
## Deviation (GDScript has no weak maps): the TypeScript memoises the last plan per events array; here `plan_batch` plans again on
## every call. The Table plans each change once and hands the same Dictionary to the animator.
##
## The spell look reads an object's colours after the layers through Chars.gd: the view's summary `view.chars[id]` (view schema 2),
## else `view.objects[id].chars` (how the goldens carry it), else the shown face of its definition; for an object that left, the
## last known characteristics of `view.lki[id].chars`.

const SPELL_STYLES: Array[String] = ["fire", "lightning", "arcane", "shadow", "nature", "radiant", "force"]
const MOVE_KINDS: Array[String] = ["die", "sacrifice", "exile", "bounce", "toLibrary", "toGraveyard", "toBattlefield", "toStack", "toHand", "other"]

const LIGHTNING_PATTERN: String = "(?i)lightning|bolt|shock|electr|storm|thunder|spark|zap|arc\\b"
const FIRE_PATTERN: String = "(?i)fire|flame|burn|blaze|inferno|pyro|ember|scorch|magma|lava|incinerat|immolat|heat|char\\b"

## Events that end a stretch of effects: what follows them is not part of the resolution before them.
const BOUNDARIES: Array[String] = [
	"resolved", "spellCast", "abilityActivated", "abilityTriggered", "countered", "abilityCountered", "turnBegan", "stepBegan",
	"attackersDeclared", "blockersDeclared",
]

## Stack acceleration (packages/play/src/stackPace.ts): more objects than this on the stack and resolutions speed up.
const STACK_PACE_THRESHOLD: int = 5
## The fastest pace: a quarter of the normal time (reached at 10 objects).
const STACK_PACE_FLOOR: float = 0.25

static var _lightning: RegEx = null
static var _fire: RegEx = null

# The state of one planning run (makePlan's locals in the TypeScript; GDScript lambdas copy captured locals, so they live here).
var _from: Dictionary = {}
var _to: Dictionary = {}
var _views: Array = []
var _a: Array = []
var _b: Dictionary = {}
var _group: Variant = null
var _life_only: Variant = null
var _counters: Variant = null


# ---- the public functions -----------------------------------------------------------------------------------------------------

## What the board shows for one change (`events`, the change's events, from view `from` to view `to`).
static func plan_batch(events: Array, from: Dictionary, to: Dictionary) -> Dictionary:
	var p := Plan.new()
	return p._make(events, from, to)


## Total damage of hits landing together, for the screen shake.
static func total_damage(hits: Array) -> int:
	var n: int = 0
	for h: Variant in hits:
		n += Val.num(Val.as_dict(h), "amount")
	return n


## True when the plan has anything to show (a change with only priority passes animates nothing).
static func is_empty(plan: Dictionary) -> bool:
	var b := Val.dict(plan, "b")
	return (
		Val.list(plan, "a").is_empty() and Val.list(b, "moves").is_empty() and Val.list(b, "tokens").is_empty()
		and b.get("turn") == null and Val.list(b, "attackers").is_empty() and Val.list(b, "blocks").is_empty()
		and b.get("gameOver") == null and Val.list(b, "lost").is_empty() and Val.list(b, "left").is_empty()
	)


## The time factor for a stack of `size` objects (stackPace.ts): 1 up to the threshold, then (5/n)^2, never below the floor.
static func stack_pace(size: int) -> float:
	if not (size > STACK_PACE_THRESHOLD):
		return 1.0
	var r: float = float(STACK_PACE_THRESHOLD) / float(size)
	return maxf(STACK_PACE_FLOOR, r * r)


## How many objects are on the stack as each step of part A begins (stackPace.ts `stackDepths`): one more for each cast or ability
## (counted in its own step), one fewer after each resolution or counter; a resolution counts itself.
static func stack_depths(steps: Array, start: int) -> Array[int]:
	var out: Array[int] = []
	var n: int = start
	for s: Variant in steps:
		var kind := Val.text(Val.as_dict(s), "kind")
		if kind == "cast" or kind == "ability":
			n += 1
		out.append(n)
		if kind == "resolve" or kind == "countered":
			n = maxi(0, n - 1)
	return out


## The object as the view knows it now or last knew it (CR 608.2h); {} when unknown (or `id` is empty).
static func known_object(view: Dictionary, id: String) -> Dictionary:
	if id == "":
		return {}
	var objects := Val.dict(view, "objects")
	if objects.has(id):
		return Val.as_dict(objects[id])
	return Val.dict(Val.dict(Val.dict(view, "lki"), id), "object")


## The spell look of a source: lightning or fire by name, else by colour (red fire, blue arcane, black shadow, green nature, white
## radiant; blue and red together lightning; none force).
static func spell_style(views: Array, id: String) -> String:
	for v: Variant in views:
		var view := Val.as_dict(v)
		var o := known_object(view, id)
		if o.is_empty() or View.is_hidden(o):
			continue
		var defs := Val.dict(view, "defs")
		var def_id := Val.text(o, "defId")
		var def := Val.dict(defs, def_id)
		var name := "%s %s" % [Val.text(def, "name"), Val.text(Val.dict(o, "stack"), "sourceName")]
		if _lightning_re().search(name) != null:
			return "lightning"
		if _fire_re().search(name) != null:
			return "fire"
		var colors := _colors_of(view, o, def, defs.has(def_id))
		if colors.has("U") and colors.has("R"):
			return "lightning"
		var first: String = colors[0] if not colors.is_empty() else ""
		match first:
			"R":
				return "fire"
			"U":
				return "arcane"
			"B":
				return "shadow"
			"G":
				return "nature"
			"W":
				return "radiant"
			_:
				return "force"
	return "force"


## A zone change as a move of the plan (plan.ts `classifyMove`).
static func classify_move(e: Dictionary, from: Dictionary) -> Dictionary:
	var token := Val.text(known_object(from, Val.text(e, "oldId")), "kind") == "token"
	var zfrom: Variant = e.get("from")
	var zto := Val.text(e, "to")
	var kind := "other"
	if zto == "exile":
		kind = "exile"
	elif zfrom == "battlefield" and zto == "graveyard":
		kind = "sacrifice" if Val.text(e, "cause") == "sacrifice" else "die"
	elif zfrom == "battlefield" and zto == "hand":
		kind = "bounce"
	elif zto == "library":
		kind = "toLibrary"
	elif zto == "graveyard":
		kind = "toGraveyard"
	elif zto == "battlefield":
		kind = "toBattlefield"
	elif zto == "stack":
		kind = "toStack"
	elif zto == "hand":
		kind = "toHand"
	return {
		"oldId": Val.text(e, "oldId"), "newId": _id_or_null(e.get("newId")), "from": zfrom if zfrom is String else null, "to": zto,
		"owner": Val.text(e, "owner"), "controller": Val.text(e, "controller"), "kind": kind, "token": token, "shownInA": false,
	}


# ---- helpers ------------------------------------------------------------------------------------------------------------------

static func _lightning_re() -> RegEx:
	if _lightning == null:
		_lightning = RegEx.create_from_string(LIGHTNING_PATTERN)
	return _lightning


static func _fire_re() -> RegEx:
	if _fire == null:
		_fire = RegEx.create_from_string(FIRE_PATTERN)
	return _fire


## plan.ts: `(view.objects[o.id] ? charsOf(view, o)?.colors : view.lki[o.id]?.chars?.colors) ?? def?.faces[0]?.colors ?? []`.
static func _colors_of(view: Dictionary, o: Dictionary, def: Dictionary, has_def: bool) -> Array[String]:
	var oid := Val.text(o, "id")
	var found := false
	var colors: Array[String] = []
	var objects := Val.dict(view, "objects")
	if objects.has(oid):
		# charsOf is null for a hidden object or one whose definition the view lacks.
		var obj := Val.as_dict(objects[oid])
		if has_def and not View.is_hidden(obj):
			var chars := Chars.of(view, obj)
			if not chars.is_empty():
				colors = Val.texts(chars, "colors")
				found = true
	else:
		var lki_chars := Val.dict(Val.dict(Val.dict(view, "lki"), oid), "chars")
		if lki_chars.get("colors") is Array:
			colors = Val.texts(lki_chars, "colors")
			found = true
	if not found:
		var faces := Val.list(def, "faces")
		if not faces.is_empty():
			colors = Val.texts(Val.as_dict(faces[0]), "colors")
	return colors


static func _id_or_null(v: Variant) -> Variant:
	return v if v is String else null


## The card backs of `owner`'s hand in `view` that `other` does not have (plan.ts placeUnseen `backs`).
static func _backs(view: Dictionary, other: Dictionary, owner: String) -> Array[String]:
	var out: Array[String] = []
	var objects := Val.dict(view, "objects")
	var other_objects := Val.dict(other, "objects")
	for id: String in Val.texts(Val.dict(Val.dict(view, "zones"), "hand"), owner):
		if objects.has(id) and View.is_hidden(Val.as_dict(objects[id])) and not other_objects.has(id):
			out.append(id)
	return out


## NETFIX2 (CR 400.2): another player's hidden hand card is named by no id the view shows, so each such draw is given one of the card
## backs that are new in that hand after the change, and each such move out of the hand one of the backs gone from it before
## (plan.ts `placeUnseen`). Returns the same array when nothing changed.
static func _place_unseen(events: Array, from: Dictionary, to: Dictionary) -> Array:
	var viewer: Variant = to.get("viewer")
	var to_objects := Val.dict(to, "objects")
	var from_objects := Val.dict(from, "objects")
	var arriving: Dictionary = {}
	var leaving: Dictionary = {}
	var changed := false
	var out: Array = []
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		var t := Val.text(e, "type")
		if t == "drew" and not Val.flag(e, "commandZone") and e.get("player") != viewer and not to_objects.has(Val.text(e, "objectId")):
			var owner := Val.text(e, "player")
			if not arriving.has(owner):
				arriving[owner] = _backs(to, from, owner)
			var pool: Array[String] = arriving[owner]
			if not pool.is_empty():
				var copy := e.duplicate()
				copy["objectId"] = pool.pop_back()
				changed = true
				out.append(copy)
				continue
		if t == "zoneChanged" and e.get("from") == "hand" and e.get("owner") != viewer and not from_objects.has(Val.text(e, "oldId")):
			var owner2 := Val.text(e, "owner")
			if not leaving.has(owner2):
				leaving[owner2] = _backs(from, to, owner2)
			var pool2: Array[String] = leaving[owner2]
			if not pool2.is_empty():
				var copy2 := e.duplicate()
				copy2["oldId"] = pool2.pop_back()
				changed = true
				out.append(copy2)
				continue
		out.append(ev)
	return out if changed else events


# ---- one planning run (plan.ts makePlan) ---------------------------------------------------------------------------------------

func _close() -> void:
	_group = null
	_life_only = null
	_counters = null


func _group_kind() -> String:
	if _group == null:
		return ""
	var g: Dictionary = _group
	return Val.text(g, "kind")


func _is_resolving(id: String) -> bool:
	if _group_kind() != "resolve":
		return false
	var g: Dictionary = _group
	return Val.text(g, "stackId") == id


func _open_resolve(id: String) -> void:
	_close()
	var o := known_object(_from, id)
	if o.is_empty():
		o = known_object(_to, id)
	var spell := Val.text(o, "kind") != "ability"
	var st := Val.dict(o, "stack")
	var source: Variant = null
	if not spell:
		source = _id_or_null(st.get("sourceId"))
	var style_id: String = id
	if not spell and source != null:
		style_id = source
	# What it targets (CR 115.1, 608.2b), as the viewer saw it on the stack: its effect visibly reaches them even when it deals no damage.
	var targets: Array = []
	for group: Variant in Val.list(st, "targets"):
		# `.flat()`: a list of target lists, one level deep (a bare target stays as it is).
		var members: Array = group if group is Array else [group]
		for t: Variant in members:
			var tid: Variant = Val.as_dict(t).get("id")
			if not targets.has(tid):
				targets.append(tid)
	var step: Dictionary = {
		"kind": "resolve", "stackId": id, "spell": spell, "source": source, "style": spell_style(_views, style_id),
		"hits": [], "life": [], "counters": [], "targets": targets,
	}
	_a.append(step)
	_group = step


## A damage event (plan.ts `case 'damageDealt'`): combat damage joins the combat step, damage inside a resolution its resolve step,
## other damage a damage step of its own; a life loss paired with it (reported just before it) joins the same step.
func _damage(e: Dictionary, i: int, paired_damage: Dictionary, pending_loss: Array) -> void:
	var amount := Val.num(e, "amount")
	var hit: Dictionary = {"source": Val.text(e, "source"), "target": Val.text(e, "target"), "amount": amount}
	if amount <= 0:
		return
	var loss: Variant = null
	if paired_damage.has(i):
		for k: int in range(pending_loss.size()):
			var l: Dictionary = pending_loss[k]
			if l.get("player") == e.get("target") and -Val.num(l, "delta") == amount:
				loss = l
				pending_loss.remove_at(k)
				break
	if Val.flag(e, "combat"):
		if _group_kind() != "combat":
			_close()
			_group = {"kind": "combat", "hits": [], "life": []}
			_a.append(_group)
	elif _group_kind() != "resolve":
		if _group_kind() != "damage":
			_close()
			_group = {"kind": "damage", "hits": [], "style": spell_style(_views, Val.text(e, "source")), "life": []}
			_a.append(_group)
	var g: Dictionary = _group
	Val.list(g, "hits").append(hit)
	if loss != null:
		Val.list(g, "life").append(loss)


## A life change not paired with a damage event (plan.ts `case 'lifeChanged'`): into the open step (by damage when one of its hits
## struck that player), else into a life step of its own.
func _life(e: Dictionary) -> void:
	var by_damage := false
	if _group != null:
		var g: Dictionary = _group
		for h: Variant in Val.list(g, "hits"):
			if Val.as_dict(h).get("target") == e.get("player"):
				by_damage = true
				break
	var change: Dictionary = {"player": Val.text(e, "player"), "delta": Val.num(e, "delta"), "byDamage": by_damage}
	if _group != null:
		var g2: Dictionary = _group
		Val.list(g2, "life").append(change)
	else:
		if _life_only == null:
			_life_only = {"kind": "life", "life": []}
			_a.append(_life_only)
		var lo: Dictionary = _life_only
		Val.list(lo, "life").append(change)


func _make(batch: Array, from: Dictionary, to: Dictionary) -> Dictionary:
	_from = from
	_to = to
	_views = [from, to]
	var events := _place_unseen(batch, from, to)
	_a = []
	_b = {"moves": [], "tokens": [], "turn": null, "attackers": [], "blocks": [], "gameOver": null, "lost": [], "left": []}
	_close()
	var on_stack_after: Dictionary = {}
	for id: String in Val.texts(Val.dict(to, "zones"), "stack"):
		on_stack_after[id] = true
	var on_stack_before: Dictionary = {}
	for id: String in Val.texts(Val.dict(from, "zones"), "stack"):
		on_stack_before[id] = true
	var countered: Dictionary = {}
	var n := events.size()
	# Damage to a player reports the life it costs before the damage itself (CR 120.3a): pair each such loss with the damage just after
	# it, so the hit alone shows it.
	var loss_by_damage: Dictionary = {}
	var paired_damage: Dictionary = {}
	for i: int in range(n):
		var e := Val.as_dict(events[i])
		if Val.text(e, "type") != "lifeChanged" or Val.num(e, "delta") >= 0:
			continue
		for j: int in range(i + 1, mini(n, i + 8)):
			var x := Val.as_dict(events[j])
			var xt := Val.text(x, "type")
			if xt == "lifeChanged" and x.get("player") == e.get("player"):
				break
			if xt == "damageDealt" and not paired_damage.has(j) and x.get("target") == e.get("player") and Val.num(x, "amount") == -Val.num(e, "delta"):
				paired_damage[j] = true
				loss_by_damage[i] = true
				break
	# A resolution's effects come first and its `resolved` event last (CR 608.2c, then 608.2n): every event after the previous boundary
	# and up to a `resolved` belongs to that resolution.
	var resolving: Array = []
	resolving.resize(n)
	var closing: Variant = null
	for i: int in range(n - 1, -1, -1):
		var e := Val.as_dict(events[i])
		var t := Val.text(e, "type")
		if t == "resolved":
			closing = Val.text(e, "objectId")
		elif BOUNDARIES.has(t) or (t == "damageDealt" and Val.flag(e, "combat")):
			closing = null
		resolving[i] = closing
	## Life lost to damage, reported before the damage (paired above): it joins the step of the hit that caused it.
	var pending_loss: Array = []

	for i: int in range(n):
		var e := Val.as_dict(events[i])
		var t := Val.text(e, "type")
		var within: Variant = resolving[i]
		if within != null and t != "resolved" and not _is_resolving(within):
			_open_resolve(within)
		match t:
			"zoneChanged":
				Val.list(_b, "moves").append(classify_move(e, from))
			"spellCast":
				_close()
				var oid := Val.text(e, "objectId")
				# On the stack after this change: it arrives there in part B. Gone again already: show it flying there now.
				if not on_stack_after.has(oid) and not on_stack_before.has(oid):
					var origin: Variant = null
					for xv: Variant in events:
						var x := Val.as_dict(xv)
						if Val.text(x, "type") == "zoneChanged" and x.get("newId") == oid and Val.text(x, "to") == "stack":
							origin = _id_or_null(x.get("oldId"))
							break
					_a.append({"kind": "cast", "stackId": oid, "origin": origin, "controller": Val.text(e, "player"), "style": spell_style(_views, oid)})
			"abilityActivated", "abilityTriggered":
				_close()
				var sid := Val.text(e, "objectId")
				var source: Variant = _id_or_null(e.get("sourceId"))
				_a.append({
					"kind": "ability", "stackId": sid, "source": source, "triggered": t == "abilityTriggered",
					"transient": not on_stack_after.has(sid) and not on_stack_before.has(sid),
					"style": spell_style(_views, source if source != null else sid),
				})
			"resolved":
				# Its step opened at its first effect; one with no effects opens here. It stays open: an effect reported after it still
				# belongs to it.
				if not _is_resolving(Val.text(e, "objectId")):
					_open_resolve(Val.text(e, "objectId"))
			"countered", "abilityCountered":
				_close()
				countered[Val.text(e, "objectId")] = true
				_a.append({"kind": "countered", "stackId": Val.text(e, "objectId")})
			"damageDealt":
				_damage(e, i, paired_damage, pending_loss)
			"lifeChanged":
				# Paired with the damage right after it, it never makes a step of its own: the hit shows it.
				if loss_by_damage.has(i):
					pending_loss.append({"player": Val.text(e, "player"), "delta": Val.num(e, "delta"), "byDamage": true})
				else:
					_life(e)
			"countersChanged":
				var cc: Dictionary = {"target": Val.text(e, "target"), "counter": Val.text(e, "counter"), "delta": Val.num(e, "delta")}
				if _group_kind() == "resolve":
					var g4: Dictionary = _group
					Val.list(g4, "counters").append(cc)
				else:
					if _counters == null:
						_counters = {"kind": "counters", "counters": []}
						_a.append(_counters)
					var cs: Dictionary = _counters
					Val.list(cs, "counters").append(cc)
			"drew":
				# A commander drawn and put into the command zone instead (CR 903.9b) already moved with its own zoneChanged event.
				# A draw moves the top card silently (no zoneChanged event, CR 121.1): it arrives in the hand from the library.
				if not Val.flag(e, "commandZone"):
					Val.list(_b, "moves").append({
						"oldId": "", "newId": Val.text(e, "objectId"), "from": "library", "to": "hand", "owner": Val.text(e, "player"),
						"controller": Val.text(e, "player"), "kind": "toHand", "token": false, "shownInA": false,
					})
			"tokenCreated":
				Val.list(_b, "tokens").append(Val.text(e, "objectId"))
			"turnBegan":
				_close()
				_b["turn"] = {"number": Val.num(e, "turn"), "player": Val.text(e, "activePlayer")}
			"stepBegan":
				_close()
			"attackersDeclared":
				_close()
				for x: Variant in Val.list(e, "attackers"):
					Val.list(_b, "attackers").append(Val.text(Val.as_dict(x), "attacker"))
			"blockersDeclared":
				_close()
				for x: Variant in Val.list(e, "blocks"):
					Val.list(_b, "blocks").append(Val.as_dict(x).duplicate(true))
			"playerLost":
				Val.list(_b, "lost").append(Val.text(e, "player"))
			"gameOver":
				_b["gameOver"] = {"winner": _id_or_null(e.get("winner"))}
			"playerLeft":
				var revealed: Array = []
				for r: Variant in Val.list(e, "revealed"):
					revealed.append(Val.as_dict(r).duplicate(true))
				Val.list(_b, "left").append({"player": Val.text(e, "player"), "removed": Val.list(e, "removed").duplicate(), "revealed": revealed})
			_:
				pass
	for m: Variant in _b["moves"]:
		var move: Dictionary = m
		if countered.has(Val.text(move, "oldId")):
			move["shownInA"] = true
	return {"a": _a, "b": _b}

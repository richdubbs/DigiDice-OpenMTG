extends RefCounted
## Pure helpers for the combat prompts, a port of packages/client/src/prompts/combat.ts: default attack targets (CR 508.1b; none with
## several possible defenders in a multiplayer game), attack and block requirements (CR 508.1d, 509.1c), block toggling (CR 509.1a),
## damage assignment (CR 510.1c-d, 702.19b) and division (CR 601.2d).
##
## Attacks are held as a Dictionary attacker id -> defender id, where "" means "declared, but needs a target" (multiplayer only).
## Blocks are an Array of {blocker, attacker}.

const J := preload("res://prompts/lib/json_read.gd")
const Names := preload("res://prompts/lib/names.gd")


## Is this a multiplayer game (CR 800.1: `options.multiplayer`)?
static func is_multiplayer(v: Dictionary) -> bool:
	return J.has(J.dict(v, "options"), "multiplayer")


## The candidate entry of a declareAttackers or declareBlockers decision, or {}.
static func candidate(dec: Dictionary, id: String) -> Dictionary:
	for c: Dictionary in J.dicts(dec, "candidates"):
		if J.str_of(c, "id") == id:
			return c
	return {}


static func candidate_ids(dec: Dictionary) -> Array:
	var out: Array = []
	for c: Dictionary in J.dicts(dec, "candidates"):
		out.append(J.str_of(c, "id"))
	return out


## What an attacker attacks unless the player picks something else: the first player it may attack, else the first planeswalker or battle.
static func default_defender(v: Dictionary, defenders: Array) -> String:
	for d: Variant in defenders:
		if Names.is_player(v, str(d)):
			return str(d)
	return str(defenders[0]) if defenders.size() > 0 else ""


## The target an attacker gets without asking in a multiplayer game: its only possible defender, else none ("").
static func only_target(defenders: Array) -> String:
	return str(defenders[0]) if defenders.size() == 1 else ""


## The attacks the prompt starts with: creatures that must attack (CR 508.1d) are declared; when the engine enforces the requirements
## (`mustObey`), its obeying declaration is pre-selected. Multiplayer: declared without a target unless they have only one (D15).
static func initial_attacks(v: Dictionary, dec: Dictionary, multi: bool) -> Dictionary:
	var out := {}
	for c: Dictionary in J.dicts(dec, "candidates"):
		var defenders := J.arr(c, "defenders")
		if J.bool_of(c, "mustAttack") and defenders.size() > 0:
			out[J.str_of(c, "id")] = only_target(defenders) if multi else default_defender(v, defenders)
	if J.has(dec, "mustObey"):
		for x: Dictionary in J.dicts(dec, "obeying"):
			var a := J.str_of(x, "attacker")
			var df := J.str_of(x, "defender")
			var c2 := candidate(dec, a)
			if c2.is_empty() or not J.arr(c2, "defenders").has(df):
				continue
			if multi:
				if not out.has(a):
					out[a] = only_target(J.arr(c2, "defenders"))
			else:
				out[a] = df
	return out


## Click on a creature: declare it as an attacker, or take it back.
static func toggle_attacker(v: Dictionary, attacks: Dictionary, dec: Dictionary, id: String, multi: bool) -> Dictionary:
	var out := attacks.duplicate()
	if out.has(id):
		out.erase(id)
		return out
	var defenders := J.arr(candidate(dec, id), "defenders")
	if defenders.is_empty():
		return out
	out[id] = only_target(defenders) if multi else default_defender(v, defenders)
	return out


## "Attack with all": every creature that can attack is declared; those already declared keep their target.
static func arm_all(v: Dictionary, attacks: Dictionary, dec: Dictionary, multi: bool) -> Dictionary:
	var out := attacks.duplicate()
	for c: Dictionary in J.dicts(dec, "candidates"):
		var id := J.str_of(c, "id")
		var defenders := J.arr(c, "defenders")
		if not out.has(id) and defenders.size() > 0:
			out[id] = only_target(defenders) if multi else default_defender(v, defenders)
	return out


## The attackers still without a target, in the decision's order.
static func untargeted(attacks: Dictionary, dec: Dictionary) -> Array:
	var out: Array = []
	for id: Variant in candidate_ids(dec):
		if attacks.has(id) and str(attacks[id]) == "":
			out.append(id)
	return out


## What the attackers without a target can be aimed at: their possible defenders, once each.
static func aimable(attacks: Dictionary, dec: Dictionary) -> Array:
	var out: Array = []
	for c: Dictionary in J.dicts(dec, "candidates"):
		var id := J.str_of(c, "id")
		if attacks.has(id) and str(attacks[id]) == "":
			for d: Variant in J.arr(c, "defenders"):
				if not out.has(str(d)):
					out.append(str(d))
	return out


## Click on a player, a planeswalker or a battle: every attacker without a target that may attack it now attacks it.
static func aim_at(attacks: Dictionary, dec: Dictionary, target: String) -> Dictionary:
	var out := attacks.duplicate()
	for c: Dictionary in J.dicts(dec, "candidates"):
		var id := J.str_of(c, "id")
		if out.has(id) and str(out[id]) == "" and J.arr(c, "defenders").has(target):
			out[id] = target
	return out


## "All at Bianca": every creature that can attack that player attacks them.
static func all_at(attacks: Dictionary, dec: Dictionary, target: String) -> Dictionary:
	var out := attacks.duplicate()
	for c: Dictionary in J.dicts(dec, "candidates"):
		if J.arr(c, "defenders").has(target):
			out[J.str_of(c, "id")] = target
	return out


## The opponents some candidate can attack, in the view's (turn) order.
static func all_at_players(v: Dictionary, dec: Dictionary) -> Array:
	var out: Array = []
	for p: Dictionary in Names.players(v):
		var pid := J.str_of(p, "id")
		for c: Dictionary in J.dicts(dec, "candidates"):
			if J.arr(c, "defenders").has(pid):
				out.append(pid)
				break
	return out


## The declaration as the engine wants it: [{attacker, defender}] in the decision's order, attackers with a target only.
static func attack_list(attacks: Dictionary, dec: Dictionary) -> Array:
	var out: Array = []
	for id: Variant in candidate_ids(dec):
		if attacks.has(id) and str(attacks[id]) != "":
			out.append({"attacker": str(id), "defender": str(attacks[id])})
	return out


## Whether a declaration obeys one requirement (CR 508.1d, 509.1c), as the engine reads it (rules/requirements.ts).
static func requirement_obeyed(r: Dictionary, attacks: Array, blocks: Array) -> bool:
	var creature := J.str_of(r, "creature")
	var limited := J.has(r, "among")
	var among := J.strings(r, "among")
	match J.str_of(r, "kind"):
		"attack":
			for a: Dictionary in attacks:
				if J.str_of(a, "attacker") == creature and (not limited or among.has(J.str_of(a, "defender"))):
					return true
		"block":
			for b: Dictionary in blocks:
				if J.str_of(b, "blocker") == creature and (not limited or among.has(J.str_of(b, "attacker"))):
					return true
		"beBlocked":
			for b: Dictionary in blocks:
				if J.str_of(b, "attacker") == creature and (not limited or among.has(J.str_of(b, "blocker"))):
					return true
	return false


## The requirement hint (CR 508.1d, 509.1c): {"text": the lines to show, "warning": "" or why the engine will refuse the declaration}.
static func requirement_hint(dec: Dictionary, attacks: Array, blocks: Array) -> Dictionary:
	var reqs := J.dicts(dec, "requirements")
	var unchecked := J.dicts(dec, "unchecked")
	if reqs.is_empty() and unchecked.is_empty():
		return {"text": "", "warning": ""}
	var rule := "CR 508.1d" if J.str_of(dec, "kind") == "declareAttackers" else "CR 509.1c"
	var lines: Array = []
	var obeyed := 0
	for r: Dictionary in reqs:
		if requirement_obeyed(r, attacks, blocks):
			obeyed += 1
	var enforced := J.has(dec, "mustObey")
	var must := J.int_of(dec, "mustObey")
	if not reqs.is_empty():
		if enforced:
			lines.append("Requirements (%s): obey %d of %d, the most that can be obeyed without breaking a restriction. Obeyed now: %d." % [rule, must, reqs.size(), obeyed])
		else:
			lines.append("Requirements (%s): the engine can't tell how many can be obeyed here, so it does not enforce them; obey as many as you can." % rule)
		for r: Dictionary in reqs:
			var ok := requirement_obeyed(r, attacks, blocks)
			lines.append("%s %s (%s, %s)" % ["[x]" if ok else "[ ]", J.str_of(r, "text"), J.str_of(r, "sourceName"), "obeyed" if ok else "not obeyed"])
	if not unchecked.is_empty():
		lines.append("Not checked by the engine (check these yourself):")
		for u: Dictionary in unchecked:
			lines.append("- %s: %s" % [J.str_of(u, "sourceName"), J.str_of(u, "text")])
	var warning := ""
	if enforced and obeyed < must:
		warning = "This declaration obeys %d of the %d requirements it must obey: the engine will refuse it (%s)." % [obeyed, must, rule]
	return {"text": "\n".join(J.packed(lines)), "warning": warning}


## M6-11 (CR 509.1c): the blocks the prompt starts with: the engine's obeying declaration when it enforces the requirements, else none.
static func initial_blocks(dec: Dictionary) -> Array:
	var out: Array = []
	if not J.has(dec, "mustObey"):
		return out
	for b: Dictionary in J.dicts(dec, "obeying"):
		var blocker := J.str_of(b, "blocker")
		var attacker := J.str_of(b, "attacker")
		if J.arr(candidate(dec, blocker), "attackers").has(attacker):
			out.append({"blocker": blocker, "attacker": attacker})
	return out


## Add or remove `blocker` blocking `attacker`; a creature that can block only one attacker moves its block instead (CR 509.1a).
static func toggle_block(blocks: Array, dec: Dictionary, blocker: String, attacker: String) -> Array:
	for i: int in blocks.size():
		var b: Dictionary = blocks[i]
		if J.str_of(b, "blocker") == blocker and J.str_of(b, "attacker") == attacker:
			var without := blocks.duplicate()
			without.remove_at(i)
			return without
	var c := candidate(dec, blocker)
	var most := J.int_of(c, "maxBlocks", 1)
	var mine := 0
	var first := -1
	for i: int in blocks.size():
		var b: Dictionary = blocks[i]
		if J.str_of(b, "blocker") == blocker:
			mine += 1
			if first < 0:
				first = i
	var out := blocks.duplicate()
	if mine >= most and first >= 0:
		out.remove_at(first)
	out.append({"blocker": blocker, "attacker": attacker})
	return out


## Every attacker the defending player could block: the decision's candidates' attackers first, then the rest of combat.
static func attackers_of(v: Dictionary, dec: Dictionary) -> Array:
	var out: Array = []
	for c: Dictionary in J.dicts(dec, "candidates"):
		for a: Variant in J.arr(c, "attackers"):
			if not out.has(str(a)):
				out.append(str(a))
	for a: Dictionary in J.dicts(J.dict(v, "combat"), "attackers"):
		var id := J.str_of(a, "id")
		if id != "" and not out.has(id):
			out.append(id)
	return out


static func blocks_on(blocks: Array, attacker: String) -> int:
	var n := 0
	for b: Dictionary in blocks:
		if J.str_of(b, "attacker") == attacker:
			n += 1
	return n


## The fewest blockers an attacker needing several can be blocked by (menace: 2, CR 702.111b; "three or more", FAST5 T57).
static func blocker_floor(dec: Dictionary, attacker: String) -> int:
	for x: Dictionary in J.dicts(dec, "minBlockers"):
		if J.str_of(x, "attacker") == attacker:
			return J.int_of(x, "min", 2)
	return 2


## MX5, CR 509.1b: "can't be blocked by more than N creatures", or -1.
static func blocker_cap(dec: Dictionary, attacker: String) -> int:
	for x: Dictionary in J.dicts(dec, "maxBlockers"):
		if J.str_of(x, "attacker") == attacker:
			return J.int_of(x, "max", -1)
	return -1


## Attackers with menace (or similar) blocked by too few creatures: the engine will reject this declaration (CR 702.111b, 509.1b).
static func under_blocked(dec: Dictionary, blocks: Array) -> Array:
	var out: Array = []
	for a: Variant in J.arr(dec, "needsMultiple"):
		var n := blocks_on(blocks, str(a))
		if n > 0 and n < blocker_floor(dec, str(a)):
			out.append(str(a))
	return out


## Damage: auto allocation in the player's order. Each creature in `order` gets lethal damage while any is left; the rest goes to what
## the creature attacks with trample (CR 702.19b), else to the first creature. Returns recipient id -> int.
static func allocate_in_order(dec: Dictionary, order: Array) -> Dictionary:
	var recipients := J.dicts(dec, "recipients")
	var out := {}
	for r: Dictionary in recipients:
		out[J.str_of(r, "id")] = 0
	# A stable sort by the rank in `order` (sort_custom is not stable): [rank, index] pairs.
	var keyed: Array = []
	for i: int in recipients.size():
		var rid := J.str_of(recipients[i], "id")
		var rank := order.find(rid)
		keyed.append([order.size() if rank < 0 else rank, i])
	keyed.sort_custom(func(a: Array, b: Array) -> bool: return a[0] < b[0] or (a[0] == b[0] and a[1] < b[1]))
	var ranked: Array = []
	for k: Array in keyed:
		ranked.append(recipients[J.to_int(k[1])])
	var left := J.int_of(dec, "amount")
	for r: Dictionary in ranked:
		if J.bool_of(r, "trampleTarget"):
			continue
		var n := mini(left, J.int_of(r, "lethal"))
		out[J.str_of(r, "id")] = n
		left -= n
	if left > 0 and not ranked.is_empty():
		var sink := {}
		if J.bool_of(dec, "canTrample"):
			for r: Dictionary in ranked:
				if J.bool_of(r, "trampleTarget"):
					sink = r
					break
		if sink.is_empty():
			for r: Dictionary in ranked:
				if not J.bool_of(r, "trampleTarget"):
					sink = r
					break
		if sink.is_empty():
			sink = ranked[0]
		var sid := J.str_of(sink, "id")
		out[sid] = J.to_int(out.get(sid, 0)) + left
	return out


## Why an assignment is not acceptable yet ("" when it is): the total must match (CR 510.1) and trample needs lethal damage first (CR 702.19b).
static func assignment_problem(dec: Dictionary, amounts: Dictionary) -> String:
	var total := 0
	for r: Dictionary in J.dicts(dec, "recipients"):
		var n := J.to_int(amounts.get(J.str_of(r, "id"), 0))
		if n < 0:
			return "Use whole numbers of 0 or more."
		total += n
	var amount := J.int_of(dec, "amount")
	if total != amount:
		return "%d damage left to assign." % (amount - total) if total < amount else "%d damage too many." % (total - amount)
	for t: Dictionary in J.dicts(dec, "recipients"):
		if not J.bool_of(t, "trampleTarget") or J.to_int(amounts.get(J.str_of(t, "id"), 0)) <= 0:
			continue
		for r: Dictionary in J.dicts(dec, "recipients"):
			if not J.bool_of(r, "trampleTarget") and J.to_int(amounts.get(J.str_of(r, "id"), 0)) < J.int_of(r, "lethal"):
				return "With trample, every blocker needs lethal damage before any goes to what the creature attacks (CR 702.19b)."
	return ""


## CR 601.2d: each target gets at least 1; the rest goes to the first target.
static func default_division(total: int, targets: int) -> Array:
	var out: Array = []
	for _i: int in targets:
		out.append(1)
	if targets > 0:
		out[0] = maxi(1, total - (targets - 1))
	return out


## Why a division can't be confirmed yet (CR 601.2d), or "".
static func division_problem(total: int, amounts: Array) -> String:
	var sum := 0
	for a: Variant in amounts:
		var n := J.to_int(a)
		if n < 1:
			return "Each target needs at least 1 (CR 601.2d)."
		sum += n
	if sum > total:
		return "%d too many: divide exactly %d (CR 601.2d)." % [sum - total, total]
	if sum < total:
		return "%d left to divide (CR 601.2d)." % (total - sum)
	return ""

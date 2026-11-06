extends RefCounted
## The engine's cheapest legal answers to a decision, a port of packages/client/src/game/computer.ts#fallbacks.
##
## Every fallback action for `d`, most cautious first: pass priority (CR 117.3d); cancel (CR 733.1) when the decision is cancellable;
## choose nothing where nothing may be chosen ("up to one target", CR 115.1, 601.2c), else the first legal choices; keep the hand;
## resolve a manual text with no adjustments. The computer tries them in order until the engine accepts one. The actions are the
## engine's `Action` shapes: {type:'pass', player}, {type:'cancel', player}, {type:'answer', player, decisionId, answer}.
## Like the browser, there is none for `chooseDivision` and `chooseName` (an empty list after a possible cancel).

const J := preload("res://prompts/lib/json_read.gd")


## The first fallback action, or {} when there is none.
static func fallback(d: Dictionary) -> Dictionary:
	var all := fallbacks(d)
	return all[0] if not all.is_empty() else {}


## The first fallback that answers the decision (an `answer` action's DecisionAnswer), or {} when there is none.
static func first_answer(d: Dictionary) -> Dictionary:
	for a: Dictionary in fallbacks(d):
		if J.str_of(a, "type") == "answer":
			return J.dict(a, "answer")
	return {}


static func fallbacks(d: Dictionary) -> Array:
	var player := J.str_of(d, "player")
	var kind := J.str_of(d, "kind")
	if kind == "priority":
		return [{"type": "pass", "player": player}]
	var out: Array = []
	var id := J.str_of(d, "id")
	if J.bool_of(d, "cancellable"):
		out.append({"type": "cancel", "player": player})
	var lo := J.int_of(d, "min")
	match kind:
		"declareBlockers":
			var obeys := J.has(d, "mustObey") and J.has(d, "obeying")
			_answer(out, player, id, {"kind": "declareBlockers", "blocks": _pairs(J.dicts(d, "obeying"), "blocker", "attacker") if obeys else []})
			if obeys:
				_answer(out, player, id, {"kind": "declareBlockers", "blocks": []})
		"declareAttackers":
			_answer(out, player, id, {"kind": "declareAttackers", "attacks": []})
		"chooseTargets":
			var all: Array = []
			for o: Variant in J.arr(d, "objects"):
				all.append({"kind": "object", "id": str(o)})
			for p: Variant in J.arr(d, "players"):
				all.append({"kind": "player", "id": str(p)})
			if lo == 0:
				_answer(out, player, id, {"kind": "chooseTargets", "targets": []})
			elif all.size() >= lo:
				_answer(out, player, id, {"kind": "chooseTargets", "targets": all.slice(0, lo)})
				_answer(out, player, id, {"kind": "chooseTargets", "targets": all.slice(all.size() - lo)})
		"chooseObjects":
			var options := J.strings(d, "options")
			if lo == 0:
				_answer(out, player, id, {"kind": "chooseObjects", "ids": []})
			elif options.size() >= lo:
				_answer(out, player, id, {"kind": "chooseObjects", "ids": options.slice(0, lo)})
		"chooseOption":
			var usable: Array = []
			for o: Dictionary in J.dicts(d, "options"):
				if not J.has(o, "disabled"):
					usable.append(J.str_of(o, "id"))
			if lo == 0:
				_answer(out, player, id, {"kind": "chooseOption", "ids": []})
			elif usable.size() >= lo:
				_answer(out, player, id, {"kind": "chooseOption", "ids": usable.slice(0, lo)})
			elif J.bool_of(d, "allowRepeat") and usable.size() > 0:
				var same: Array = []
				for _i: int in lo:
					same.append(usable[0])
				_answer(out, player, id, {"kind": "chooseOption", "ids": same})
		"chooseNumber":
			_answer(out, player, id, {"kind": "chooseNumber", "n": lo})
		"chooseColor":
			var colors := J.strings(d, "options")
			if not colors.is_empty():
				_answer(out, player, id, {"kind": "chooseColor", "color": colors[0]})
		"yesNo":
			_answer(out, player, id, {"kind": "yesNo", "yes": false})
			_answer(out, player, id, {"kind": "yesNo", "yes": true})
		"order":
			var ids: Array = []
			for item: Dictionary in J.dicts(d, "items"):
				ids.append(J.str_of(item, "id"))
			_answer(out, player, id, {"kind": "order", "ids": ids})
		"chooseReplacement":
			for o: Dictionary in J.dicts(d, "options"):
				_answer(out, player, id, {"kind": "chooseReplacement", "id": J.str_of(o, "id")})
		"manualResolve":
			_answer(out, player, id, {"kind": "manualResolve", "ops": []})
		"payCost":
			_answer(out, player, id, {"kind": "payCost", "auto": true})
		"mulligan":
			_answer(out, player, id, {"kind": "mulligan", "keep": true})
		"playFirst":
			_answer(out, player, id, {"kind": "playFirst", "player": player})
		"commanderZone":
			_answer(out, player, id, {"kind": "commanderZone", "command": true})
			_answer(out, player, id, {"kind": "commanderZone", "command": false})
	return out


static func _answer(out: Array, player: String, decision_id: String, answer: Dictionary) -> void:
	out.append({"type": "answer", "player": player, "decisionId": decision_id, "answer": answer})


## [{a, b}] pairs copied with String values (the engine's obeying declaration as an answer).
static func _pairs(list: Array, a: String, b: String) -> Array:
	var out: Array = []
	for x: Dictionary in list:
		out.append({a: J.str_of(x, a), b: J.str_of(x, b)})
	return out

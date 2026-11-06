extends "res://prompts/PromptBase.gd"
## declareAttackers (CR 508.1): click creatures to attack with, here or on the board. A creature that may attack several players,
## planeswalkers or battles gets a defender picker (CR 508.1b). Creatures that must attack (`mustAttack`, CR 508.1d) start declared, and
## when the engine enforces the requirements (`mustObey`) its obeying declaration is pre-selected; the requirement hint says which
## requirements the declaration obeys and what the engine does not check (`unchecked`).
## Two-player game: an attacker attacks the first player it may attack unless changed. Multiplayer game (`view.options.multiplayer`):
## no default target, each attacker with several possible defenders needs one picked (or a click on a player / planeswalker / battle
## on the board aims every attacker still without one), and OK stays disabled until every attacker has a target.
## Answer: {kind:'declareAttackers', attacks: [{attacker, defender}]}.

const Combat := preload("res://prompts/lib/combat.gd")

## attacker id -> defender id ("" = declared, needs a target).
var attacks: Dictionary = {}
var _multi: bool = false
var _ids: Array = []
var _labels: Dictionary = {}
var _targets_box: VBoxContainer = null
var _hint: Label = null
var _all_button: Button = null
var _clear_button: Button = null


func _build() -> void:
	_multi = Combat.is_multiplayer(view)
	_ids = Combat.candidate_ids(decision)
	_labels = Names.distinct_labels(view, _ids)
	attacks = Combat.initial_attacks(view, decision, _multi)
	add_chips(body, _ids, toggle_attacker, _labels)
	_targets_box = VBoxContainer.new()
	_targets_box.name = "Targets"
	body.add_child(_targets_box)
	if _multi:
		var everyone := Combat.all_at_players(view, decision)
		if everyone.size() > 1:
			var row := HFlowContainer.new()
			row.name = "AllAt"
			for p: Variant in everyone:
				var pid := str(p)
				var b := Button.new()
				b.name = ("AllAt_" + pid).validate_node_name()
				b.text = "All at %s" % Names.player_name(view, pid)
				b.pressed.connect(_on_all_at.bind(pid))
				row.add_child(b)
			body.add_child(row)
	_hint = make_label("", &"PromptDetail")
	_hint.visible = false
	body.add_child(_hint)
	_all_button = add_action("Attack with all", "AttackWithAll", _on_attack_with_all)
	_clear_button = add_action("Clear", "Clear", _on_clear)


func toggle_attacker(id: String) -> void:
	if not _ids.has(id):
		return
	attacks = Combat.toggle_attacker(view, attacks, decision, id, _multi)
	_refresh()


func _on_card_clicked(id: String) -> void:
	if _ids.has(id):
		toggle_attacker(id)
	elif _multi and Combat.aimable(attacks, decision).has(id):
		attacks = Combat.aim_at(attacks, decision, id)
		_refresh()


func _on_attack_with_all() -> void:
	attacks = Combat.arm_all(view, attacks, decision, _multi)
	_refresh()


func _on_all_at(pid: String) -> void:
	attacks = Combat.all_at(attacks, decision, pid)
	_refresh()


func _on_clear() -> void:
	attacks = {}
	_refresh()


## Pick the defender of one attacker (the OptionButton of its row).
func set_defender(attacker: String, defender: String) -> void:
	if not attacks.has(attacker):
		return
	if defender == "" or J.arr(Combat.candidate(decision, attacker), "defenders").has(defender):
		attacks[attacker] = defender
	_refresh()


func _target_name(id: String) -> String:
	return Names.player_name(view, id) if Names.is_player(view, id) else Names.object_name(view, id)


func _refresh() -> void:
	var list := Combat.attack_list(attacks, decision)
	var waiting := Combat.untargeted(attacks, decision)
	var marks := {}
	for c: Dictionary in J.dicts(decision, "candidates"):
		var id := J.str_of(c, "id")
		var mark := ""
		if attacks.has(id):
			var t := str(attacks[id])
			mark = "needs a target" if t == "" else "attacking %s" % _target_name(t)
			if J.bool_of(c, "taxed"):
				mark += ", costs extra (CR 508.1h)"
		elif J.bool_of(c, "mustAttack"):
			mark = "must attack"
		if mark != "":
			marks[id] = mark
		update_chip(id, attacks.has(id), mark)
	_rebuild_targets()
	var hint := Combat.requirement_hint(decision, list, [])
	_hint.text = str(hint["text"])
	_hint.visible = _hint.text != ""
	var problems: Array = []
	if str(hint["warning"]) != "":
		problems.append(hint["warning"])
	if list.size() == 1:
		var alone := Combat.candidate(decision, J.str_of(list[0], "attacker"))
		if J.bool_of(alone, "onlyWithOthers"):
			problems.append("%s can't attack alone (CR 506.5)." % str(_labels.get(J.str_of(alone, "id"), "")))
	set_problem("\n".join(J.packed(problems)))
	if not waiting.is_empty():
		set_detail("Now pick whom %s: a player, a planeswalker or a battle (CR 508.1b, 802.2)." % (
			"%s attacks" % str(_labels.get(waiting[0], waiting[0])) if waiting.size() == 1 else "these %d attackers attack" % waiting.size()))
		set_ok(false, "Pick a target for %s" % Names.plural(waiting.size(), "attacker"))
	else:
		set_detail("Click creatures to attack with (CR 508.1a).")
		set_ok(true, "No attacks" if list.is_empty() else "Attack with %d" % list.size())
	_all_button.disabled = attacks.size() == _ids.size()
	_clear_button.disabled = attacks.is_empty()
	var selectable := _ids.duplicate()
	if _multi:
		selectable.append_array(Combat.aimable(attacks, decision))
	publish_selection(selectable, attacks.keys(), marks)


## One defender picker per declared attacker that may attack more than one player, planeswalker or battle.
func _rebuild_targets() -> void:
	clear_children(_targets_box)
	for id: Variant in _ids:
		var aid := str(id)
		if not attacks.has(aid):
			continue
		var defenders := J.strings(Combat.candidate(decision, aid), "defenders")
		if defenders.size() <= 1:
			continue
		var row := HBoxContainer.new()
		row.add_child(make_cell_label("%s attacks" % str(_labels.get(aid, aid))))
		var pick := OptionButton.new()
		pick.name = ("Defender_" + aid).validate_node_name()
		pick.fit_to_longest_item = false
		pick.clip_text = true
		fit_cell(pick)
		var current := str(attacks[aid])
		if _multi:
			pick.add_item("Pick a target...")
			pick.set_item_metadata(0, "")
		for d: Variant in defenders:
			pick.add_item(_target_name(str(d)))
			pick.set_item_metadata(pick.item_count - 1, str(d))
		for i: int in pick.item_count:
			if str(pick.get_item_metadata(i)) == current:
				pick.select(i)
		pick.item_selected.connect(_on_defender_picked.bind(aid, pick))
		row.add_child(pick)
		_targets_box.add_child(row)


func _on_defender_picked(index: int, aid: String, pick: OptionButton) -> void:
	set_defender.call_deferred(aid, str(pick.get_item_metadata(index)))


func _on_ok() -> void:
	if Combat.untargeted(attacks, decision).is_empty():
		send_answer({"kind": "declareAttackers", "attacks": Combat.attack_list(attacks, decision)})

extends "res://prompts/PromptBase.gd"
## declareBlockers (CR 509.1): click a creature to block with, then the attacker it blocks, or the attacker first and then a creature that
## can block it (here or on the board). A creature that can
## block only one attacker moves its block instead of adding one (`maxBlocks`, CR 509.1a). When the engine enforces the requirements
## (`mustObey`) its obeying declaration is pre-selected; creatures a requirement asks something of are marked ("must block", "must be
## blocked"), and the requirement hint says how many are obeyed. Attackers that need two or more blockers (menace, CR 702.111b; "three or
## more", `minBlockers`) or can't be blocked by more than N (`maxBlockers`) say so, and a declaration that breaks it is warned about.
## Esc first drops the picked blocker or attacker. The engine rejects an illegal declaration with its explanation.
## Answer: {kind:'declareBlockers', blocks: [{blocker, attacker}]}.

const Combat := preload("res://prompts/lib/combat.gd")

var blocks: Array = []
## The blocker picked, waiting for the attacker it blocks ("" = none).
var picked: String = ""
## The attacker picked first, waiting for a creature to block it ("" = none).
var picked_attacker: String = ""
var _blockers: Array = []
var _attackers: Array = []
var _names: Dictionary = {}
var _list_box: VBoxContainer = null
var _hint: Label = null
var _clear_button: Button = null


func _build() -> void:
	blocks = Combat.initial_blocks(decision)
	_blockers = Combat.candidate_ids(decision)
	_attackers = Combat.attackers_of(view, decision)
	_names = Names.distinct_labels(view, _blockers)
	_names.merge(Names.distinct_labels(view, _attackers), true)
	body.add_child(make_label("Your blockers", &"PromptDetail"))
	add_chips(body, _blockers, click, _names)
	body.add_child(make_label("Attackers", &"PromptDetail"))
	var attacker_labels := {}
	for a: Variant in _attackers:
		var aid := str(a)
		var text := str(_names.get(aid, aid))
		if J.arr(decision, "needsMultiple").has(aid):
			text += " (needs %d or more blockers)" % Combat.blocker_floor(decision, aid)
		var cap := Combat.blocker_cap(decision, aid)
		if cap == 1:
			text += " (at most one blocker)"
		elif cap > 1:
			text += " (at most %d blockers)" % cap
		attacker_labels[aid] = text
	add_chips(body, _attackers, click, attacker_labels)
	_list_box = VBoxContainer.new()
	_list_box.name = "Blocks"
	body.add_child(_list_box)
	_hint = make_label("", &"PromptDetail")
	_hint.visible = false
	body.add_child(_hint)
	_clear_button = add_action("Clear", "Clear", _on_clear)


func _name(id: String) -> String:
	return str(_names.get(id, Names.object_name(view, id)))


## The attackers the picked blocker can block.
func _can_block() -> Array:
	if picked == "":
		return []
	return J.strings(Combat.candidate(decision, picked), "attackers")


## The blockers that can block `attacker`.
func _blockers_of(attacker: String) -> Array:
	var out: Array = []
	for c: Dictionary in J.dicts(decision, "candidates"):
		if J.arr(c, "attackers").has(attacker):
			out.append(J.str_of(c, "id"))
	return out


## Either order pairs a blocker with an attacker. A click on a blocker picks it (again: drops it), or, with an attacker picked first that
## it can block, declares that block; a click on an attacker the picked blocker can block declares the block, otherwise picks the
## attacker (again: drops it).
func click(id: String) -> void:
	if _blockers.has(id):
		if picked_attacker != "" and _blockers_of(picked_attacker).has(id):
			blocks = Combat.toggle_block(blocks, decision, id, picked_attacker)
			picked_attacker = ""
		else:
			picked = "" if picked == id else id
			picked_attacker = ""
	elif _can_block().has(id):
		var max_blocks := J.int_of(Combat.candidate(decision, picked), "maxBlocks", 1)
		blocks = Combat.toggle_block(blocks, decision, picked, id)
		if max_blocks <= 1:
			picked = ""
	elif picked == "" and _attackers.has(id) and not _blockers_of(id).is_empty():
		picked_attacker = "" if picked_attacker == id else id
	_refresh()


func _on_card_clicked(id: String) -> void:
	click(id)


func _on_escape() -> bool:
	if picked == "" and picked_attacker == "":
		return false
	picked = ""
	picked_attacker = ""
	_refresh()
	return true


func _on_clear() -> void:
	blocks = []
	picked = ""
	picked_attacker = ""
	_refresh()


func remove_block(index: int) -> void:
	if index >= 0 and index < blocks.size():
		blocks.remove_at(index)
	_refresh()


func _refresh() -> void:
	var marks := {}
	for b: Variant in _blockers:
		var bid := str(b)
		var blocking: Array = []
		for x: Dictionary in blocks:
			if J.str_of(x, "blocker") == bid:
				blocking.append(_name(J.str_of(x, "attacker")))
		if not blocking.is_empty():
			marks[bid] = "blocking %s" % ", ".join(J.packed(blocking))
	for a: Variant in _attackers:
		var n := Combat.blocks_on(blocks, str(a))
		if n > 0:
			marks[str(a)] = Names.plural(n, "blocker")
	for r: Dictionary in J.dicts(decision, "requirements"):
		var creature := J.str_of(r, "creature")
		if marks.has(creature) or Combat.requirement_obeyed(r, [], blocks):
			continue
		if J.str_of(r, "kind") == "block":
			marks[creature] = "must block"
		elif J.str_of(r, "kind") == "beBlocked":
			marks[creature] = "must be blocked"
	# What a click can do now: with a blocker picked, the attackers it can block; otherwise every attacker some creature can block.
	var can := _can_block()
	if picked == "":
		for a: Variant in _attackers:
			if not _blockers_of(str(a)).is_empty():
				can.append(str(a))
	for b: Variant in _blockers:
		update_chip(str(b), picked == str(b), str(marks.get(str(b), "")))
	for a: Variant in _attackers:
		update_chip(str(a), picked_attacker == str(a), str(marks.get(str(a), "")), not can.has(str(a)))
	if picked != "":
		set_detail("Now click the attacker %s blocks." % _name(picked))
	elif picked_attacker != "":
		set_detail("Now click a creature to block %s with." % _name(picked_attacker))
	else:
		set_detail("Click a creature to block with, then the attacker it blocks (or the attacker first).")
	clear_children(_list_box)
	for i: int in blocks.size():
		var x: Dictionary = blocks[i]
		var row := HBoxContainer.new()
		var text: String = "%s blocks %s" % [_name(J.str_of(x, "blocker")), _name(J.str_of(x, "attacker"))]
		row.add_child(fit_cell(make_label(text)))
		var remove := Button.new()
		remove.name = "Remove_%d" % i
		remove.text = "Remove"
		remove.tooltip_text = "Remove: %s" % text
		remove.pressed.connect(remove_block.bind(i), CONNECT_DEFERRED)
		row.add_child(remove)
		_list_box.add_child(row)
	var hint := Combat.requirement_hint(decision, [], blocks)
	_hint.text = str(hint["text"])
	_hint.visible = _hint.text != ""
	var problems: Array = []
	var under := Combat.under_blocked(decision, blocks)
	if not under.is_empty():
		var under_names: Array = []
		for a: Variant in under:
			under_names.append(_name(str(a)))
		problems.append("%s can't be blocked except by two or more creatures (CR 702.111b)." % ", ".join(J.packed(under_names)))
	for x: Dictionary in J.dicts(decision, "maxBlockers"):
		var aid := J.str_of(x, "attacker")
		if Combat.blocks_on(blocks, aid) > J.int_of(x, "max", 1):
			problems.append("%s can't be blocked by more than %s (CR 509.1b)." % [_name(aid), Names.plural(J.int_of(x, "max", 1), "creature")])
	if str(hint["warning"]) != "":
		problems.append(hint["warning"])
	set_problem("\n".join(J.packed(problems)))
	set_ok(true, "No blocks" if blocks.is_empty() else "Confirm blocks")
	_clear_button.disabled = blocks.is_empty()
	var selected: Array = []
	if picked != "":
		selected.append(picked)
	if picked_attacker != "":
		selected.append(picked_attacker)
	for x: Dictionary in blocks:
		if not selected.has(J.str_of(x, "blocker")):
			selected.append(J.str_of(x, "blocker"))
	var selectable := _blockers.duplicate()
	selectable.append_array(can)
	publish_selection(selectable, selected, marks)


func _on_ok() -> void:
	send_answer({"kind": "declareBlockers", "blocks": blocks.duplicate(true)})

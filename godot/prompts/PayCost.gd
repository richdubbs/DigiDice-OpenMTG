extends "res://prompts/PromptBase.gd"
## payCost (CR 601.2g-h, 602.2b). Auto pay is the default (the engine's solver keeps flexible sources untapped); "Pay by hand" lists the
## mana abilities the decision offers (`manaSources`, CR 605.3a): click sources here or on the board, pick a color where a source can
## make several (it starts with a color the cost still needs), and tick Phyrexian symbols to pay with 2 life each (CR 107.4f, 119.4).
## The mana pool is shown; mana already in it is spent as well (CR 601.2h). Space never auto pays a cost with Phyrexian symbols.
## A cost the engine says has only one way to pay (`onlyWay`) is paid at once, like the browser's prompt bar (`auto_answer`).
##
## Contract deviation: while this decision is pending the engine accepts only an answer or a cancel (core/apply.ts; legalActions is empty
## outside priority), so manual payment can't tap sources with client.act; it sends the `activations` the engine runs itself.
## Answer: {kind:'payCost', auto:true} or {kind:'payCost', auto:false, activations:[{objectId, abilityKey, color?}], lifeForPhyrexian?}.

const Pay := preload("res://prompts/lib/pay.gd")

var manual: bool = false
## Picked sources: [{objectId, abilityKey, color?}].
var picked: Array = []
## Indices of Phyrexian symbols paid with life.
var life: Array = []
var _sources: Array = []
var _manual_box: VBoxContainer = null
var _chosen_label: Label = null
var _source_buttons: Dictionary = {}
var _color_pickers: Dictionary = {}
var _auto_button: Button = null
var _manual_button: Button = null


func _build() -> void:
	_sources = J.dicts(decision, "manaSources")
	manual = not J.bool_of(decision, "autoPayable")
	var me := J.str_of(decision, "player")
	var for_player := J.str_of(decision, "forPlayer")
	var text := "Cost: %s" % J.str_of(decision, "costText")
	if for_player != "" and for_player != me:
		text += " (for %s)" % Names.player_name(view, for_player)
	var pool := _pool_types()
	if not pool.is_empty():
		var symbols := ""
		for t: Variant in pool:
			symbols += "{%s}" % str(t)
		text += ". Mana in your pool: %s." % symbols
	else:
		text += ". Your mana pool is empty."
	if not J.bool_of(decision, "autoPayable"):
		text += "\nNo automatic payment was found: choose sources by hand%s." % (" or cancel" if is_cancellable() else "")
	set_detail(text)
	if J.bool_of(decision, "autoPayable"):
		_auto_button = add_action("Auto pay", "AutoPay", _on_auto)
	_manual_button = add_action("Pay by hand", "PayByHand", _on_pay_by_hand)
	_build_manual()
	if auto_answer and J.bool_of(decision, "autoPayable") and J.bool_of(decision, "onlyWay"):
		send_answer_deferred({"kind": "payCost", "auto": true})


func _pool_types() -> Array:
	var p := Names.find_player(view, J.str_of(decision, "player"))
	var out: Array = []
	for u: Dictionary in J.dicts(p, "manaPool"):
		out.append(J.str_of(u, "type"))
	return out


func _build_manual() -> void:
	_manual_box = VBoxContainer.new()
	_manual_box.name = "Manual"
	body.add_child(_manual_box)
	if _sources.is_empty():
		_manual_box.add_child(make_label("No mana abilities can be activated.", &"PromptDetail"))
	var labels: Array = []
	for s: Dictionary in _sources:
		labels.append(J.str_of(s, "label"))
	labels = Names.number_duplicates(labels)
	for i: int in _sources.size():
		var s: Dictionary = _sources[i]
		var key := Pay.source_key(s)
		var row := HBoxContainer.new()
		var b := Button.new()
		b.name = ("Source_%d" % i)
		b.toggle_mode = true
		b.text = str(labels[i])
		b.pressed.connect(toggle_source.bind(i))
		row.add_child(b)
		_source_buttons[key] = b
		var produces := J.strings(s, "produces")
		if produces.size() > 1:
			var pick := OptionButton.new()
			pick.name = "Color_%d" % i
			for c: Variant in produces:
				pick.add_item(Names.mana_name(str(c)))
				pick.set_item_metadata(pick.item_count - 1, str(c))
			pick.item_selected.connect(_on_color_picked.bind(key, pick))
			row.add_child(pick)
			_color_pickers[key] = pick
		_manual_box.add_child(row)
	var phyrexian := Pay.phyrexian_indices(J.str_of(decision, "costText"))
	var symbols := Pay.cost_symbols(J.str_of(decision, "costText"))
	for idx: Variant in phyrexian:
		var i := J.to_int(idx)
		var check := CheckBox.new()
		check.name = "Life_%d" % i
		check.text = "Pay %s (symbol %d) with 2 life" % [str(symbols[i]), i + 1]
		check.toggled.connect(_on_life_toggled.bind(i))
		_manual_box.add_child(check)
	_chosen_label = make_label("", &"PromptDetail")
	_manual_box.add_child(_chosen_label)


func _colors_chosen() -> Array:
	var out: Array = []
	for p: Dictionary in picked:
		if J.has(p, "color"):
			out.append(J.str_of(p, "color"))
			continue
		for s: Dictionary in _sources:
			if Pay.source_key(s) == Pay.source_key(p):
				var produces := J.strings(s, "produces")
				if not produces.is_empty():
					out.append(produces[0])
	return out


## The colors the cost still needs (without the symbols paid with life), after the pool and the picked sources.
func _needed() -> Array:
	var symbols := Pay.cost_symbols(J.str_of(decision, "costText"))
	var rest := ""
	for i: int in symbols.size():
		if not life.has(i):
			rest += str(symbols[i])
	return Pay.needed_colors(rest, _colors_chosen(), _pool_types())


## Pick (or put back) the i-th mana source.
func toggle_source(i: int) -> void:
	if i < 0 or i >= _sources.size():
		return
	picked = Pay.toggle_picked(picked, _sources[i], _needed())
	_refresh()


func _on_card_clicked(id: String) -> void:
	if not manual:
		return
	for p: Dictionary in picked:
		if J.str_of(p, "objectId") == id:
			var kept: Array = []
			for q: Dictionary in picked:
				if J.str_of(q, "objectId") != id:
					kept.append(q)
			picked = kept
			_refresh()
			return
	for i: int in _sources.size():
		if J.str_of(_sources[i], "objectId") == id:
			toggle_source(i)
			return


func _on_color_picked(index: int, key: String, pick: OptionButton) -> void:
	var color := str(pick.get_item_metadata(index))
	for p: Dictionary in picked:
		if Pay.source_key(p) == key:
			p["color"] = color
	_refresh()


func _on_life_toggled(on: bool, i: int) -> void:
	if on and not life.has(i):
		life.append(i)
	elif not on:
		life.erase(i)
	_refresh()


func _on_pay_by_hand() -> void:
	manual = true
	_refresh()


func _on_auto() -> void:
	if J.bool_of(decision, "autoPayable"):
		send_answer({"kind": "payCost", "auto": true})


func _refresh() -> void:
	_manual_box.visible = manual
	if _manual_button != null:
		_manual_button.visible = not manual
	for key: Variant in _source_buttons:
		var b: Button = _source_buttons[key]
		var on := false
		var color := ""
		for p: Dictionary in picked:
			if Pay.source_key(p) == str(key):
				on = true
				color = J.str_of(p, "color")
		b.set_pressed_no_signal(on)
		var pick: OptionButton = _color_pickers.get(key)
		if pick != null:
			pick.visible = on
			for i: int in pick.item_count:
				if str(pick.get_item_metadata(i)) == color:
					pick.select(i)
	var chosen_text := ""
	for c: Variant in _colors_chosen():
		chosen_text += "{%s}" % str(c)
	_chosen_label.text = "Chosen: %s%s for %s." % [
		chosen_text if chosen_text != "" else "nothing", " and %d life" % (2 * life.size()) if not life.is_empty() else "", J.str_of(decision, "costText")]
	var phyrexian := not Pay.phyrexian_indices(J.str_of(decision, "costText")).is_empty()
	if manual:
		set_problem("")
		set_ok(true, "Pay with chosen sources")
	else:
		set_problem("Auto pay may pay Phyrexian symbols with 2 life each instead of mana (CR 107.4f, 119.4). To decide yourself, choose Pay by hand." if phyrexian else "")
		# OK (Space) is Auto pay, except with Phyrexian symbols: Auto pay may spend life there, which the player should choose with a click.
		set_ok(J.bool_of(decision, "autoPayable") and not phyrexian, "Auto pay")
		ok_button.visible = not phyrexian
	if _auto_button != null:
		_auto_button.visible = manual or phyrexian
	var selectable: Array = []
	if manual:
		for s: Dictionary in _sources:
			if not selectable.has(J.str_of(s, "objectId")):
				selectable.append(J.str_of(s, "objectId"))
	var selected: Array = []
	for p: Dictionary in picked:
		selected.append(J.str_of(p, "objectId"))
	publish_selection(selectable, selected)


func _on_ok() -> void:
	if manual:
		send_answer(Pay.manual_answer(picked, life))
	elif J.bool_of(decision, "autoPayable"):
		send_answer({"kind": "payCost", "auto": true})

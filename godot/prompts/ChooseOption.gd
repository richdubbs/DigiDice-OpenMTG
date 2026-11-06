extends "res://prompts/PromptBase.gd"
## chooseOption (CR 700.2 modes and other choices; M12-4b the multiplayer choices among players, CR 310.12a, 508.5a, 601.7a, 800.4g;
## votes, CR 701.38). One button per option: an option with `disabled` can't be chosen and says why; with `allowRepeat` an option may be
## chosen more than once ("x2", and a "-" button takes one back). Options that are players are also clickable on the board. OK is
## enabled when the number chosen is within min..max.
## Answer: {kind:'chooseOption', ids: string[]} (an id repeated as often as it was chosen, in the options' order).

var counts: Dictionary = {}
var _options: Array = []
var _lo: int = 0
var _hi: int = 0
var _repeat: bool = false
var _source: String = ""
var _labels: Dictionary = {}
var _less_buttons: Dictionary = {}
var _player_options: Array = []
## The stage's copies of the card by option id (a mode choice on the stage).
var _mode_cards: Dictionary = {}
var _mode_texts: Dictionary = {}

const PLAYER_HINTS := {
	"siegeProtector": "A Siege's controller chooses its protector among their opponents: that player defends it, and the other players may attack it (CR 310.9a, 310.12a).",
	"defendingPlayer": "The text says \"defending player\" and there are several: choose which defending player it means (CR 508.5a, 802.2a).",
	"opponentChooses": "The spell asks an opponent to make a choice: you decide which of your opponents makes it (CR 601.7a).",
	"anOpponent": "The text says \"an opponent\": choose which of your opponents it means (CR 601.7a).",
	"anotherOpponent": "An opponent who had to make a choice left the game: you choose another opponent to make it (CR 800.4g).",
	"players": "Choose a player: click their life on the table or a name below.",
}


func _build() -> void:
	_options = J.dicts(decision, "options")
	_lo = J.int_of(decision, "min")
	_hi = J.int_of(decision, "max")
	_repeat = J.bool_of(decision, "allowRepeat")
	_source = mode_source(J.str_of(decision, "prompt"))
	var all_players := not _options.is_empty()
	for o: Dictionary in _options:
		if not Names.is_player(view, J.str_of(o, "id")):
			all_players = false
	var list := VBoxContainer.new()
	list.name = "Options"
	for o: Dictionary in _options:
		var oid := J.str_of(o, "id")
		var label := player_label(oid) if all_players else Names.with_self_name(J.str_of(o, "label", oid), _source)
		_labels[oid] = label
		var row := HBoxContainer.new()
		var b := Button.new()
		b.name = ("Option_" + oid).validate_node_name()
		b.toggle_mode = true
		b.text = label
		b.disabled = J.has(o, "disabled")
		b.tooltip_text = J.str_of(o, "disabled")
		b.pressed.connect(change.bind(oid, 1))
		row.add_child(b)
		chip_buttons[oid] = b
		if _repeat:
			var less := Button.new()
			less.name = ("Less_" + oid).validate_node_name()
			less.text = "-"
			less.tooltip_text = "One less: %s" % label
			less.pressed.connect(change.bind(oid, -1))
			row.add_child(less)
			_less_buttons[oid] = less
		if J.has(o, "disabled"):
			row.add_child(make_label("Not possible: %s" % J.str_of(o, "disabled"), &"PromptWarning"))
		else:
			if all_players:
				_player_options.append(oid)
		list.add_child(row)
	body.add_child(list)
	var hint := ""
	if all_players and J.has(J.dict(view, "options"), "multiplayer"):
		hint = str(PLAYER_HINTS.get(player_choice_kind(), ""))
	var text := Names.count_text(_lo, _hi) + (" (an option may be chosen more than once)." if _repeat else ".")
	set_detail(text if hint == "" else "%s\n%s" % [hint, text])
	if not all_players:
		_open_mode_stage()


## A mode choice on the stage, as in Arena: the card once for each mode, each with that one mode written under it (and the mode's
## additional cost, CR 700.2h), and the card's own mana cost under the title. Clicking a card chooses (or un-chooses) its mode; a mode
## that can't be chosen is dimmed with why.
func _open_mode_stage() -> void:
	var card_id := mode_object(_source)
	if card_id == "":
		return
	var st := open_stage("Choose %s: %s" % ["a mode" if _hi == 1 else "modes", _source if _source != "" else Names.object_name(view, card_id)])
	if st == null:
		return
	var o := Names.object_of(view, card_id)
	var face := _face_of(o)
	var cost := Chars.mana_text(face.get("manaCost"))
	if cost != "":
		st.set_cost(cost)
	var lines := mode_lines(card_id, _options.size())
	var ids: Array = []
	for opt: Dictionary in _options:
		ids.append(J.str_of(opt, "id"))
	var cards := st.row(view, ids, card_id)
	for i: int in cards.size():
		var c := cards[i]
		var opt: Dictionary = _options[i]
		var oid := J.str_of(opt, "id")
		c.id = oid
		var extra := mode_cost(str(lines[i]) if i < lines.size() else "")
		_mode_texts[oid] = c.add_mode_text(str(_labels.get(oid, oid)), extra)
		if J.has(opt, "disabled"):
			c.set_unchoosable("Not possible: %s" % J.str_of(opt, "disabled"))
		else:
			c.make_clickable()
			c.pressed.connect(func(_id: String) -> void:
				if not _busy:
					Sound.cue("ui.select" if _repeat or J.to_int(counts.get(oid, 0)) == 0 else "ui.tick")
					change(oid, 1))
		_mode_cards[oid] = c


func _face_of(o: Dictionary) -> Dictionary:
	var d := Names.def_of(view, o)
	var faces := J.dicts(d, "faces")
	var st := J.dict(o, "stack")
	var i := J.int_of(st, "face") if J.has(st, "face") else J.int_of(o, "face")
	if i >= 0 and i < faces.size():
		return faces[i]
	return faces[0] if not faces.is_empty() else {}


## The object a mode choice is for, by the name in the engine's prompt: the spell or ability on the stack first (CR 601.2a: the card
## is already on the stack while its modes are chosen), else any visible object with that name; "" when none.
func mode_object(card_name: String) -> String:
	if card_name == "":
		return ""
	var stack := J.strings(J.dict(view, "zones"), "stack")
	for i: int in range(stack.size() - 1, -1, -1):
		if _named(str(stack[i]), card_name):
			return str(stack[i])
	for id: Variant in J.dict(view, "objects"):
		if _named(str(id), card_name):
			return str(id)
	return ""


func _named(id: String, card_name: String) -> bool:
	var o := Names.object_of(view, id)
	if o.is_empty() or J.str_of(o, "defId") == Names.HIDDEN_DEF:
		return false
	var d := Names.def_of(view, o)
	if d.is_empty():
		return false
	if J.str_of(d, "name") == card_name or J.str_of(J.dict(o, "stack"), "sourceName") == card_name:
		return true
	for f: Dictionary in J.dicts(d, "faces"):
		if J.str_of(f, "name") == card_name:
			return true
	return false


## The printed line of each mode ("• Deal 2 damage ...", "+ {1} — ..."), when the card prints one per option; else [].
func mode_lines(id: String, count: int) -> Array:
	var face := _face_of(Names.object_of(view, id))
	var out: Array = []
	for l: String in J.str_of(face, "oracleText").split("\n"):
		var t := l.strip_edges()
		if t.begins_with("•") or t.begins_with("+"):
			out.append(t)
	return out if out.size() == count else []


## The additional cost printed at the start of a mode's line ("+ {1} — ...", spree; "Label {2} — ...", tiered, CR 700.2h), or "".
static func mode_cost(line: String) -> String:
	if line == "":
		return ""
	var m := RegEx.create_from_string("^[•+]?\\s*\\+?\\s*(?:[^{—]*?\\s)?((?:\\{[^}]+\\})+)\\s*[—–-]").search(line)
	return m.get_string(1) if m != null else ""


## The card a mode choice is for: the engine's prompt ends "... modes for <name>." (actions/announce.ts chooseModes), or "".
static func mode_source(prompt: String) -> String:
	var m := RegEx.create_from_string("\\bmodes? for (.+)\\.$").search(prompt)
	return m.get_string(1) if m != null else ""


## "Bianca (32 life)", "Bianca (you, 32 life)".
func player_label(pid: String) -> String:
	var p := Names.find_player(view, pid)
	var bits: Array = []
	if pid == Names.viewer(view):
		bits.append("you")
	if not p.is_empty():
		bits.append("%d life" % J.int_of(p, "life"))
	var pname := Names.player_name(view, pid)
	return pname if bits.is_empty() else "%s (%s)" % [pname, ", ".join(J.packed(bits))]


## Which multiplayer choice among players this is, told apart by the rules the engine cites (m12 design 4.5).
func player_choice_kind() -> String:
	var cites := J.strings(decision, "rules")
	var prompt := J.str_of(decision, "prompt")
	if cites.has("CR 310.12a") or cites.has("CR 704.5x"):
		return "siegeProtector"
	if cites.has("CR 508.5a"):
		return "defendingPlayer"
	if cites.has("CR 800.4g") and prompt.contains("has left the game: choose another opponent"):
		return "anotherOpponent"
	if cites.has("CR 601.7a"):
		return "opponentChooses" if prompt.contains("makes this choice") else "anOpponent"
	return "players"


func _total() -> int:
	var t := 0
	for k: Variant in counts:
		t += J.to_int(counts[k])
	return t


## Choose `oid` once more (+1) or once less (-1), as the browser's option list does.
func change(oid: String, delta: int) -> void:
	var opt := {}
	for o: Dictionary in _options:
		if J.str_of(o, "id") == oid:
			opt = o
	if opt.is_empty() or (delta > 0 and J.has(opt, "disabled")):
		_refresh()
		return
	var now := J.to_int(counts.get(oid, 0))
	if delta > 0 and not _repeat:
		if now > 0:
			counts[oid] = 0
			_refresh()
			return
		if _hi == 1:
			counts = {oid: 1}
			_refresh()
			return
	if delta > 0 and _total() >= _hi:
		_refresh()
		return
	counts[oid] = maxi(0, now + delta)
	_refresh()


func _on_card_clicked(id: String) -> void:
	change(id, 1)


## The answer's ids: each option as often as it was chosen, in the options' order.
func chosen_ids() -> Array:
	var out: Array = []
	for o: Dictionary in _options:
		var oid := J.str_of(o, "id")
		for _i: int in J.to_int(counts.get(oid, 0)):
			out.append(oid)
	return out


func _refresh() -> void:
	var marks := {}
	var selected: Array = []
	for o: Dictionary in _options:
		var oid := J.str_of(o, "id")
		var n := J.to_int(counts.get(oid, 0))
		var b: Button = chip_buttons.get(oid)
		if b != null:
			b.set_pressed_no_signal(n > 0)
			b.text = str(_labels.get(oid, oid)) + (" x%d" % n if _repeat and n > 0 else "")
		var less: Button = _less_buttons.get(oid)
		if less != null:
			less.visible = n > 0
		if n > 0:
			selected.append(oid)
			marks[oid] = "chosen x%d" % n if n > 1 else "chosen"
	var total := _total()
	set_ok(total >= _lo and total <= _hi)
	if stage != null:
		stage.set_subtitle("%s (%d chosen)." % [Names.count_text(_lo, _hi), total])
		for oid: Variant in _mode_cards:
			var n := J.to_int(counts.get(oid, 0))
			var c: PromptStage.StageCard = _mode_cards[oid]
			c.set_selected(n > 0, "Chosen")
			c.set_mode_text(str(_labels.get(oid, oid)) + (" x%d" % n if _repeat and n > 0 else ""), n > 0)
	if not _player_options.is_empty():
		publish_selection(_player_options, selected, marks)


func _on_ok() -> void:
	send_answer({"kind": "chooseOption", "ids": chosen_ids()})

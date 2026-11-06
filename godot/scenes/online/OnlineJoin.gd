extends OnlineSetup
## Join an online game (the browser's online/JoinScreen.tsx): this player's name and deck, and one box for the host's address and
## the join code, in any order (OnlineUi.read_invite). The local server connects to the host over UDP, sends the deck by names (the
## host resolves and checks it with its own card data) and the game opens with the first view. Errors say what to check. In a game
## of 3 or 4 players the code is the one of this player's own seat, and the player waits in the lobby until every seat is taken.

var _form: PanelContainer = null
var _lobby: PanelContainer = null
var _name: LineEdit = null
var _deck: OptionButton = null
var _box: LineEdit = null
var _found: Label = null
var _problems: VBoxContainer = null
var _blocked: Label = null
var _join: Button = null
var _cancel: Button = null
var _busy: bool = false


func _ready() -> void:
	build_page("Join an online game")
	_form = _build_form()
	page.add_child(_form)
	_lobby = Hud.panel(16)
	_lobby.visible = false
	page.add_child(_lobby)
	refresh()


func _build_form() -> PanelContainer:
	var panel := Hud.panel(16)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	panel.add_child(col)
	var grid := GridContainer.new()
	grid.columns = 2
	grid.add_theme_constant_override("h_separation", 14)
	grid.add_theme_constant_override("v_separation", 10)
	col.add_child(grid)
	_name = LineEdit.new()
	_name.text = Settings.player_names[0]
	_name.max_length = 40
	_name.text_changed.connect(func(_t: String) -> void: refresh())
	_field(grid, "Your name", _name)
	_deck = OptionButton.new()
	_deck.item_selected.connect(func(_i: int) -> void: refresh())
	_field(grid, "Deck", _deck)
	_box = LineEdit.new()
	_box.placeholder_text = "203.0.113.7:%d XXXX-XXXX-XXXX-XXXX" % Online.DEFAULT_PORT
	_box.text_changed.connect(func(_t: String) -> void: refresh())
	_field(grid, "Host address and join code", _box)
	_found = Hud.text("", 13)
	col.add_child(_found)
	_problems = VBoxContainer.new()
	col.add_child(_problems)
	col.add_child(Hud.text("Ask the host for their public IP address, the port and the join code (in a game of 3 or 4 players, the code of your own seat), and paste or type them all into the box above, in any order. You need nothing forwarded on your own router to join. The host's server checks your deck for the host's format with the host's card data.", 13))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.alignment = BoxContainer.ALIGNMENT_END
	_blocked = Hud.text("", 13)
	_blocked.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_blocked.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(_blocked)
	_cancel = Hud.button("Cancel")
	_cancel.pressed.connect(leave_game)
	row.add_child(_cancel)
	_join = Hud.primary("Join game", 18)
	_join.custom_minimum_size = Vector2(220, 48)
	_join.pressed.connect(_on_join)
	row.add_child(_join)
	col.add_child(row)
	return panel


func _field(grid: GridContainer, label: String, control: Control) -> void:
	var l := Hud.text(label, 14, Hud.TEXT)
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	grid.add_child(l)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	control.custom_minimum_size = Vector2(420, 0)
	grid.add_child(control)


## The host's format is not known here: a deck with a commander is judged as a Commander deck (the host's server checks it for its
## format and says why when it refuses it).
func _unplayable(d: Dictionary) -> String:
	if d.is_empty():
		return ""
	var deck := Val.dict(d, "deck")
	return Config.unplayable_reason(deck, "commander" if Config.commander_count(deck) > 0 else Config.DEFAULT_FORMAT)


func _on_join() -> void:
	var d := deck_of(_deck)
	var invite := OnlineUi.read_invite(_box.text)
	if d.is_empty() or Val.text(invite, "code") == "" or _busy:
		return
	_busy = true
	clear_error()
	started_here = true
	refresh()
	var address := Val.text(invite, "address").strip_edges()
	var r := await Online.reply(Online.join(address, Val.text(invite, "code"), _name.text.strip_edges(), OnlineUi.online_deck(Val.dict(d, "deck"))))
	_busy = false
	if not bool(r.get("ok", false)):
		started_here = false
		show_error(Val.dict(r, "error"), OnlineUi.address_port(address))
	refresh()


func refresh() -> void:
	if _form == null:
		return
	var s := Online.status
	refresh_open_panel(func() -> void: Nav.go("hostOnline"))
	var lobby := connected and started_here and Val.text(s, "role") == "guest" and Val.text(s, "phase") == "waiting" and OnlineUi.is_table(s)
	var joining := not lobby and (_busy or (started_here and Val.text(s, "role") == "guest" and Val.text(s, "phase") == "joining"))
	_form.visible = not other_game() and not lobby
	_lobby.visible = lobby
	if lobby:
		_refresh_lobby()
		return
	fill_decks(_deck)
	var d := deck_of(_deck)
	var invite := OnlineUi.read_invite(_box.text)
	_found.text = "Address: %s · Join code: %s" % [
		Val.text(invite, "address") if Val.text(invite, "address") != "" else "not found yet",
		Val.text(invite, "code") if Val.text(invite, "code") != "" else "not found yet"]
	var unplayable := _unplayable(d)
	for c: Node in _problems.get_children():
		c.queue_free()
	if unplayable != "":
		_problems.add_child(Hud.text(unplayable, 14, NeonTheme.colors()[1]))
	if not d.is_empty():
		for n: String in Config.deck_notes(Val.dict(d, "deck")):
			_problems.add_child(Hud.text("• %s" % n, 13))
	var blocked := ""
	if d.is_empty():
		blocked = "Choose a deck."
	elif unplayable != "":
		blocked = "This deck cannot be played yet (see above)."
	elif _name.text.strip_edges() == "":
		blocked = "Enter your name."
	else:
		blocked = OnlineUi.invite_problem(_box.text, invite)
		if blocked == "" and not connected:
			blocked = "Connecting to the local OpenMTG server…"
	for c: Control in [_name, _deck, _box]:
		c.set("editable" if c is LineEdit else "disabled", not joining if c is LineEdit else joining)
	_blocked.text = ("Connecting to %s…" % Val.text(invite, "address")) if joining else blocked
	_join.visible = not joining
	_join.disabled = blocked != ""
	_cancel.visible = joining
	_cancel.disabled = leaving


func _refresh_lobby() -> void:
	for c: Node in _lobby.get_children():
		c.queue_free()
	var s := Online.status
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	_lobby.add_child(col)
	col.add_child(Hud.title("You have seat %d" % int(Val.num(s, "seat")) if s.has("seat") else "You have a seat", 20))
	col.add_child(OnlineUi.lobby_seats(s))
	col.add_child(Hud.text(OnlineUi.waiting_text(s), 15, Hud.TEXT))
	var leave := Hud.button("Leaving…" if leaving else "Leave the table")
	leave.disabled = leaving
	leave.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	leave.pressed.connect(leave_game)
	col.add_child(leave)

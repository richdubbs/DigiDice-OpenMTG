extends OnlineSetup
## Host an online game (the browser's online/HostScreen.tsx): this player's name, deck and the format, the UDP port and how many
## players; then the local server opens the port, checks the deck for the format with its card data, and makes a join code (one
## per guest seat in a game of 3 or 4). The screen shows the code and the port to give the other players, how to make the port
## reachable, and opens the game when every seat is taken. Leaving the screen while waiting stops hosting.
##
## While waiting, a calm net.waiting ping sounds at once and every WAITING_PING_S; Copy code sounds ui.success.

const WAITING_PING_S: float = 3.5

var _form: PanelContainer = null
var _waiting: PanelContainer = null
var _players: OptionButton = null
var _name: LineEdit = null
var _deck: OptionButton = null
var _format: OptionButton = null
var _port: SpinBox = null
var _problems: VBoxContainer = null
var _note: Label = null
var _blocked: Label = null
var _host: Button = null
var _help: Control = null
var _help_button: Button = null
var _busy: bool = false
var _copied: int = -1
var _ping: float = 0.0
var _format_ids: Array[String] = []
var _last_port: int = Online.DEFAULT_PORT


func _ready() -> void:
	build_page("Host an online game")
	_form = _build_form()
	page.add_child(_form)
	_waiting = Hud.panel(16)
	_waiting.visible = false
	page.add_child(_waiting)
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
	_players = OptionButton.new()
	for t: String in ["2: you and one other player", "3: you and two others", "4: you and three others"]:
		_players.add_item(t)
	_players.item_selected.connect(func(_i: int) -> void: refresh())
	_field(grid, "Players", _players)
	_name = LineEdit.new()
	_name.text = Settings.player_names[0]
	_name.max_length = 40
	_name.text_changed.connect(func(_t: String) -> void: refresh())
	_field(grid, "Your name", _name)
	_deck = OptionButton.new()
	_deck.item_selected.connect(_on_deck)
	_field(grid, "Deck", _deck)
	_format = OptionButton.new()
	for f: Dictionary in Config.formats():
		_format.add_item(String(f["label"]))
		_format_ids.append(String(f["id"]))
	_format.select(maxi(0, _format_ids.find(Config.DEFAULT_FORMAT)))
	_format.item_selected.connect(func(_i: int) -> void: refresh())
	_field(grid, "Format", _format)
	_port = SpinBox.new()
	_port.min_value = 1
	_port.max_value = 65535
	_port.step = 1
	_port.value = Online.DEFAULT_PORT
	_port.value_changed.connect(func(_v: float) -> void: refresh())
	_field(grid, "UDP port", _port)
	_problems = VBoxContainer.new()
	col.add_child(_problems)
	_note = Hud.text("", 13)
	col.add_child(_note)
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	row.alignment = BoxContainer.ALIGNMENT_END
	_blocked = Hud.text("", 13)
	_blocked.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	_blocked.horizontal_alignment = HORIZONTAL_ALIGNMENT_RIGHT
	row.add_child(_blocked)
	_host = Hud.primary("Host game", 18)
	_host.custom_minimum_size = Vector2(220, 48)
	_host.pressed.connect(_on_host)
	row.add_child(_host)
	col.add_child(row)
	_help_button = Hud.button("How the other player reaches you (port forwarding)")
	_help_button.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	_help_button.pressed.connect(func() -> void:
		_help.visible = not _help.visible)
	col.add_child(_help_button)
	_help = VBoxContainer.new()
	_help.visible = false
	col.add_child(_help)
	return panel


func _field(grid: GridContainer, label: String, control: Control) -> void:
	var l := Hud.text(label, 14, Hud.TEXT)
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	grid.add_child(l)
	control.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	control.custom_minimum_size = Vector2(380, 0)
	grid.add_child(control)


func _seats() -> int:
	return _players.selected + 2


func _on_deck(_i: int) -> void:
	var d := deck_of(_deck)
	var f := Config.offered_format(Val.text(d, "format"))
	if f != "" and _format_ids.has(f):
		_format.select(_format_ids.find(f))
	refresh()


func _selected_format() -> String:
	return _format_ids[maxi(0, _format.selected)] if not _format_ids.is_empty() else Config.DEFAULT_FORMAT


## Why Host game is off, or "".
func _blocked_reason(unplayable: String, too_many: String) -> String:
	var d := deck_of(_deck)
	if d.is_empty():
		return "Choose a deck."
	if unplayable != "":
		return "This deck cannot be played yet (see above)."
	if too_many != "":
		return too_many
	if _name.text.strip_edges() == "":
		return "Enter your name."
	var bad := OnlineUi.port_problem(int(_port.value))
	if bad != "":
		return bad
	if not connected:
		return "Connecting to the local OpenMTG server…"
	return ""


func _on_host() -> void:
	var d := deck_of(_deck)
	if d.is_empty() or _busy:
		return
	_busy = true
	clear_error()
	started_here = true
	_last_port = int(_port.value)
	refresh()
	var r := await Online.reply(Online.host(_name.text.strip_edges(), OnlineUi.online_deck(Val.dict(d, "deck")), _selected_format(), _last_port, _seats()))
	_busy = false
	if not bool(r.get("ok", false)):
		started_here = false
		show_error(Val.dict(r, "error"), _last_port)
	refresh()


func _process(delta: float) -> void:
	var s := Online.status
	if _is_waiting() and Val.text(s, "phase") == "waiting":
		_ping -= delta
		if _ping <= 0.0:
			_ping = WAITING_PING_S
			Sound.cue("net.waiting")
	else:
		_ping = 0.0


func _is_waiting() -> bool:
	var s := Online.status
	var hosting := Val.text(s, "role") == "host" and Val.text(s, "phase") in ["starting", "waiting"]
	if connected and hosting:
		started_here = true
	return hosting and started_here


func refresh() -> void:
	if _form == null:
		return
	var waiting := _is_waiting()
	refresh_open_panel()
	_form.visible = not waiting and not other_game()
	_waiting.visible = waiting
	if waiting:
		_refresh_waiting()
		return
	fill_decks(_deck)
	var d := deck_of(_deck)
	var format := _selected_format()
	var unplayable := Config.unplayable_reason(Val.dict(d, "deck"), format) if not d.is_empty() else ""
	var too_many := Config.format_problem(format, _seats())
	for c: Node in _problems.get_children():
		c.queue_free()
	if unplayable != "":
		_problems.add_child(Hud.text(unplayable, 14, NeonTheme.colors()[1]))
	elif too_many != "":
		_problems.add_child(Hud.text(too_many, 14, NeonTheme.colors()[1]))
	if not d.is_empty():
		for n: String in Config.deck_notes(Val.dict(d, "deck")):
			_problems.add_child(Hud.text("• %s" % n, 13))
	_note.text = "Your server makes one join code for each other seat, checks every deck for the format with your card data, and runs the game: each other player's server gets only what their player may see. The game starts when every seat is taken; the seating is random." if _seats() > 2 else "Your server checks both decks for the format with your card data, and runs the game: the other player's server gets only what their player may see."
	var blocked := _blocked_reason(unplayable, too_many)
	_blocked.text = blocked
	_host.disabled = blocked != "" or _busy
	_host.text = "STARTING…" if _busy else "HOST GAME"
	_help_button.text = "How the other players reach you (port forwarding)" if _seats() > 2 else "How the other player reaches you (port forwarding)"
	for c: Node in _help.get_children():
		c.queue_free()
	_help.add_child(OnlineUi.port_help(int(_port.value), _seats()))


func _refresh_waiting() -> void:
	for c: Node in _waiting.get_children():
		c.queue_free()
	var s := Online.status
	var port := int(Val.num(s, "port", _last_port))
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 12)
	_waiting.add_child(col)
	var table := OnlineUi.is_table(s)
	col.add_child(Hud.title("Give each player the code of their own seat" if table else "Give the other player these", 20))
	if table:
		col.add_child(Hud.text("Each join code admits one player, into its seat. Send each code only to the player it is for.", 13))
		for c: Variant in Val.list(s, "codes"):
			var cd := Val.as_dict(c)
			var seat := int(Val.num(cd, "seat"))
			var who := ""
			for p: Dictionary in OnlineUi.seated_players(s):
				if int(Val.num(p, "seat")) == seat:
					who = Val.text(p, "name")
			col.add_child(_code_row("Seat %d" % seat, Val.text(cd, "code"), seat, not Val.flag(cd, "taken"),
				("Taken" + (" by %s" % who if who != "" else "")) if Val.flag(cd, "taken") else "Open"))
	else:
		col.add_child(_code_row("Join code", Val.text(s, "code", "…"), 0, Val.text(s, "code") != "", ""))
	col.add_child(_fact("Port", "%d (UDP)" % port))
	col.add_child(_fact("Address", "Your public IP address with the port, for example 203.0.113.7:%d (see below how to find it)." % port))
	if table:
		col.add_child(OnlineUi.lobby_seats(s))
	var state := "Opening the port and checking your deck…" if Val.text(s, "phase") == "starting" else (OnlineUi.waiting_text(s) if table else "Waiting for the other player to join…")
	col.add_child(Hud.text(state, 15, Hud.TEXT))
	for w: Variant in Val.list(s, "warnings"):
		col.add_child(Hud.text("• %s" % String(w), 13))
	var stop := Hud.button("Stopping…" if leaving else "Stop hosting")
	stop.disabled = leaving
	stop.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
	stop.pressed.connect(leave_game)
	col.add_child(stop)
	col.add_child(OnlineUi.port_help(port, int(Val.num(s, "seats", 2))))


func _code_row(label: String, code: String, seat: int, can_copy: bool, state: String) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var l := Hud.text(label, 15, Hud.TEXT)
	l.add_theme_font_override("font", Hud.bold_font())
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	l.custom_minimum_size = Vector2(110, 0)
	row.add_child(l)
	var c := Label.new()
	c.text = code
	c.add_theme_font_override("font", Hud.wide_font())
	c.add_theme_font_size_override("font_size", 24)
	c.add_theme_color_override("font_color", NeonTheme.colors()[0])
	row.add_child(c)
	if can_copy:
		var copy := Hud.button("Copied" if _copied == seat else ("Copy code" if seat == 0 else "Copy"))
		copy.set_meta(&"sfx", "none")
		copy.pressed.connect(func() -> void:
			DisplayServer.clipboard_set(code)
			_copied = seat
			Sound.cue("ui.success")
			refresh())
		row.add_child(copy)
	if state != "":
		row.add_child(Hud.text(state, 14))
	return row


func _fact(label: String, text: String) -> Control:
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 12)
	var l := Hud.text(label, 14, Hud.TEXT)
	l.add_theme_font_override("font", Hud.bold_font())
	l.autowrap_mode = TextServer.AUTOWRAP_OFF
	l.custom_minimum_size = Vector2(110, 0)
	row.add_child(l)
	var t := Hud.text(text, 14)
	t.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	row.add_child(t)
	return row

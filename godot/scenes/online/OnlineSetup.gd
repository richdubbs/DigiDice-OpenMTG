class_name OnlineSetup
extends Control
## What the Host and Join screens share (the browser's online/setup.tsx): the page, the link to the local server's online play
## (connected when the screen opens; Try again when it cannot be), the decks to pick from, the panel of a game the server already
## has open (Return to the game, Leave that game), and opening the game on the table once the game this screen started begins.
## Leaving the screen any other way leaves a game it started that never began (a host still waiting, a join still connecting), so
## no UDP port stays open behind the player's back.

var page: VBoxContainer = null
var decks: Array[Dictionary] = []
var decks_loaded: bool = false
## The game was started from this screen (or is one it hosts that no guest joined yet).
var started_here: bool = false
var connected: bool = false
var leaving: bool = false

var _connect_box: VBoxContainer = null
var _error_box: VBoxContainer = null
var _open_box: VBoxContainer = null
var _entered: bool = false


## The screen's page under its title, with Back.
func build_page(title: String) -> void:
	TopBar.attach(self)
	Footer.attach(self)
	var scroll := ScrollContainer.new()
	scroll.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	scroll.offset_top = TopBar.HEIGHT
	scroll.offset_bottom = -56
	scroll.horizontal_scroll_mode = ScrollContainer.SCROLL_MODE_DISABLED
	add_child(scroll)
	var margin := MarginContainer.new()
	margin.size_flags_horizontal = Control.SIZE_EXPAND_FILL
	margin.add_theme_constant_override("margin_left", 220)
	margin.add_theme_constant_override("margin_right", 220)
	margin.add_theme_constant_override("margin_top", 18)
	margin.add_theme_constant_override("margin_bottom", 24)
	scroll.add_child(margin)
	page = VBoxContainer.new()
	page.add_theme_constant_override("separation", 14)
	margin.add_child(page)
	var head := HBoxContainer.new()
	head.add_theme_constant_override("separation", 14)
	var back := Hud.button("Back")
	back.custom_minimum_size = Vector2(80, 36)
	back.pressed.connect(Nav.back)
	head.add_child(back)
	head.add_child(Hud.title(title, 28))
	page.add_child(head)
	_connect_box = VBoxContainer.new()
	page.add_child(_connect_box)
	_open_box = VBoxContainer.new()
	page.add_child(_open_box)
	_error_box = VBoxContainer.new()
	page.add_child(_error_box)
	Online.changed.connect(_on_link)
	Online.watch(true)
	_connect()
	_load_decks()


func _exit_tree() -> void:
	Online.watch(false)
	if _entered:
		return
	# A game this screen started that never began (no view yet) is left: its port closes.
	if started_here and Online.has_game() and Online.view.is_empty():
		Online.leave()


func _connect() -> void:
	for c: Node in _connect_box.get_children():
		c.queue_free()
	var problem: String = await Online.connect_link()
	if not is_inside_tree():
		return
	connected = problem == ""
	if connected:
		Sound.cue("net.connected")
	else:
		var box := OnlineUi.error_box({"message": "Online play is not available right now.", "hint": problem})
		_connect_box.add_child(box)
		var again := Hud.button("Try again")
		again.size_flags_horizontal = Control.SIZE_SHRINK_BEGIN
		again.pressed.connect(_connect)
		_connect_box.add_child(again)
	refresh()


func _load_decks() -> void:
	var all: Dictionary = await NewGameScreen.all_decks()
	if not is_inside_tree():
		return
	decks.assign(Val.list(all, "decks"))
	decks_loaded = true
	refresh()


## An OptionButton of the decks ("Choose a deck…" first; an item's id is the deck's index in `decks`).
func fill_decks(option: OptionButton) -> void:
	var keep := option.get_selected_id() if option.item_count > 0 else -1
	option.clear()
	option.add_item("Loading decks…" if not decks_loaded else "Choose a deck…", -1)
	for i: int in decks.size():
		option.add_item(String(decks[i]["name"]), i)
	var at := option.get_item_index(keep)
	option.select(at if at >= 0 else 0)


func deck_of(option: OptionButton) -> Dictionary:
	var id := option.get_selected_id()
	return decks[id] if id >= 0 and id < decks.size() else {}


## An error from a reply, shown until the next one (ui.error).
func show_error(e: Dictionary, port: int = -1) -> void:
	clear_error()
	if not e.is_empty():
		_error_box.add_child(OnlineUi.error_box(OnlineUi.explain(e, port)))


func clear_error() -> void:
	for c: Node in _error_box.get_children():
		c.queue_free()


func _on_link() -> void:
	if not is_inside_tree():
		return
	var s := Online.status
	# The game this screen started has begun: open it on the table.
	if started_here and not Online.view.is_empty() and Val.text(s, "phase") in ["playing", "over", "reconnecting", "spectating"]:
		enter_game()
		return
	refresh()


## Open the online game on the table.
func enter_game() -> void:
	if _entered or Online.view.is_empty():
		return
	_entered = true
	Sound.cue("net.joined")
	GameClient.open_online()
	Nav.go("table")


## Leave the game the server has open (a host stops hosting, a guest leaves the lobby).
func leave_game() -> void:
	leaving = true
	refresh()
	var r := await Online.reply(Online.leave())
	leaving = false
	started_here = false
	if not bool(r.get("ok", false)):
		show_error(Val.dict(r, "error"))
	refresh()


## A game the server has open that this screen did not start: return to it, or leave it.
func other_game() -> bool:
	return connected and OnlineUi.game_open(Online.status) and not started_here


func refresh_open_panel(show_code: Callable = Callable()) -> void:
	for c: Node in _open_box.get_children():
		c.queue_free()
	if not other_game():
		return
	var s := Online.status
	var panel := Hud.panel(16)
	var col := VBoxContainer.new()
	col.add_theme_constant_override("separation", 10)
	panel.add_child(col)
	col.add_child(Hud.title("A game is open", 20))
	var hosting := Val.text(s, "role") == "host" and Val.text(s, "phase") in ["starting", "waiting"]
	var what := "You are hosting a game" if Val.text(s, "role") == "host" else "You are in a game"
	var others: Array = []
	if OnlineUi.is_table(s):
		for p: Dictionary in OnlineUi.seated_players(s):
			if Val.text(p, "id") != Val.text(s, "me") and Val.text(p, "name") != "" and not Val.flag(p, "left"):
				others.append(Val.text(p, "name"))
	elif Val.text(s, "opponent") != "":
		others.append(Val.text(s, "opponent"))
	var with_whom := (" with %s" % OnlineUi.list_names(others)) if not others.is_empty() else ""
	col.add_child(Hud.text("%s%s on this OpenMTG server (%s). Return to it, or leave it to start another." % [what, with_whom, OnlineUi.phase_label(s)], 14, Hud.TEXT))
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 10)
	if not Online.view.is_empty():
		var back := Hud.button("Return to the game")
		back.set_meta(&"slab", "primary")
		back.pressed.connect(enter_game)
		row.add_child(back)
	if hosting and show_code.is_valid():
		var code := Hud.button("Show the join code")
		code.set_meta(&"slab", "primary")
		code.pressed.connect(show_code)
		row.add_child(code)
	var leave := Hud.button("Leaving…" if leaving else "Leave that game")
	leave.disabled = leaving
	leave.pressed.connect(leave_game)
	row.add_child(leave)
	col.add_child(row)
	_open_box.add_child(panel)


## Redraw the screen's own part (each screen).
func refresh() -> void:
	pass

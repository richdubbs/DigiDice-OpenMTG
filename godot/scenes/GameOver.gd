class_name GameOverScreen
extends ColorRect
## The result (packages/client/src/game/GameOver.tsx): the DigiDice mark, "<name> wins" or "The game is a draw", the engine's
## reason, who conceded (two players), the finishing order with how each player lost (three or four players), Rematch (two
## players) or "Rematch?" Yes / No then each player's deck with Same decks and Change decks (more players), New game, Home and
## Show the board, which folds the panel into a bar with "Show the result". It comes in as the browser's does: the dim fades in
## after 0.9 s and the result word lands from 2.1 times its size with its letters closing up (arena.css result-dim,
## result-word-in).

signal rematch_pressed()
signal home_pressed()
signal new_game_pressed()
signal change_decks_pressed()

@onready var _title: Label = %Title
@onready var _reason: Label = %Reason
@onready var _rematch: Button = %Rematch
@onready var _home: Button = %Home
@onready var _look: Button = %Look

var _box: VBoxContainer = null
var _extra: VBoxContainer = null
var _new_game: Button = null
var _folded: PanelContainer = null
var _folded_title: Label = null
var _headline: String = ""
## The game's replay (GameClient.recording): Watch replay, Keep replay, where it stands, and at a shared screen who shows their
## cards in it (the browser's end-screen replay panel).
var _replay: VBoxContainer = null
var _watch: Button = null
var _keep: Button = null
var _replay_status: Label = null
var _cards: VBoxContainer = null
var _card_boxes: Dictionary = {}
var _watch_waiting: bool = false
var _view: Dictionary = {}


func _ready() -> void:
	mouse_filter = Control.MOUSE_FILTER_STOP
	_box = _title.get_parent() as VBoxContainer
	var logo := Logo3D.make(56.0)
	logo.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
	_box.add_child(logo)
	_box.move_child(logo, 0)
	_title.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_reason.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_reason.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
	_reason.custom_minimum_size = Vector2(460, 0)
	_extra = VBoxContainer.new()
	_extra.add_theme_constant_override("separation", 8)
	_box.add_child(_extra)
	_box.move_child(_extra, _reason.get_index() + 1)
	_build_replay()
	_rematch.set_meta(&"slab", "primary")
	_new_game = Hud.button("New game")
	_new_game.name = "NewGame"
	_rematch.get_parent().add_child(_new_game)
	_rematch.get_parent().move_child(_new_game, _rematch.get_index() + 1)
	_look.text = "Show the board"
	_rematch.pressed.connect(func() -> void: rematch_pressed.emit())
	_home.pressed.connect(func() -> void: home_pressed.emit())
	_new_game.pressed.connect(func() -> void: new_game_pressed.emit())
	_look.pressed.connect(_fold)
	# The folded bar: the headline and "Show the result", at the top of the table.
	_folded = PanelContainer.new()
	_folded.visible = false
	_folded.set_anchors_and_offsets_preset(Control.PRESET_CENTER_TOP)
	_folded.position.y = 100.0
	var row := HBoxContainer.new()
	row.add_theme_constant_override("separation", 14)
	_folded.add_child(row)
	_folded_title = Label.new()
	_folded_title.add_theme_font_override("font", Hud.bold_font())
	_folded_title.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	row.add_child(_folded_title)
	var show := Hud.button("Show the result")
	show.pressed.connect(_unfold)
	row.add_child(show)


func _build_replay() -> void:
	_replay = VBoxContainer.new()
	_replay.name = "Replay"
	_replay.add_theme_constant_override("separation", 8)
	_replay.visible = false
	_box.add_child(_replay)
	_box.move_child(_replay, _extra.get_index() + 1)
	var row := HBoxContainer.new()
	row.alignment = BoxContainer.ALIGNMENT_CENTER
	row.add_theme_constant_override("separation", 10)
	_watch = Hud.button("Watch replay")
	_watch.name = "WatchReplay"
	_watch.pressed.connect(_on_watch)
	row.add_child(_watch)
	_keep = Hud.button("Keep replay")
	_keep.name = "KeepReplay"
	_keep.toggle_mode = true
	_keep.tooltip_text = "Keep this replay in the library: it is not removed to make room for newer ones."
	_keep.toggled.connect(func(on: bool) -> void:
		_light_keep(on)
		GameClient.recording_control({"keep": on}))
	row.add_child(_keep)
	_replay.add_child(row)
	_replay_status = Hud.text("", 13)
	_replay_status.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	_replay_status.custom_minimum_size = Vector2(460, 0)
	_replay.add_child(_replay_status)
	_cards = VBoxContainer.new()
	_cards.add_theme_constant_override("separation", 4)
	_replay.add_child(_cards)
	GameClient.recording_changed.connect(_refresh_replay)


## Keep is lit while it is on.
func _light_keep(on: bool) -> void:
	_keep.set_meta(&"slab", "primary" if on else "")
	_keep.queue_redraw()


func _refresh_replay() -> void:
	var rec := GameClient.recording
	_replay.visible = visible and not rec.is_empty() and not GameClient.is_replay
	if rec.is_empty():
		return
	var state := Val.text(rec, "state")
	var keep := Val.flag(rec, "keep")
	_keep.set_pressed_no_signal(keep)
	_light_keep(keep)
	_watch.disabled = state == "failed"
	match state:
		"recording", "saving":
			_replay_status.text = "Saving the replay…"
		"failed":
			var err := Val.text(rec, "error")
			_replay_status.text = "The replay could not be saved: %s" % err if err != "" else "The replay could not be saved."
		_:
			if not _watch_waiting:
				_replay_status.text = ""
	_replay_status.visible = _replay_status.text != ""
	_refresh_cards(rec)
	if _watch_waiting and state == "saved":
		_watch_waiting = false
		_open_replay()
	elif _watch_waiting and (state == "failed" or state == "empty"):
		_watch_waiting = false
		_on_watch()


## At a screen several people share: "<Name>: show my cards in replays" for each of them, and what that means.
func _refresh_cards(rec: Dictionary) -> void:
	var people := Val.list(rec, "people")
	_cards.visible = people.size() > 1
	if people.size() <= 1:
		return
	if _card_boxes.size() != people.size():
		for c: Node in _cards.get_children():
			c.queue_free()
		_card_boxes.clear()
		var head := Hud.kicker("Show my cards in replays")
		head.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		_cards.add_child(head)
		for p: Variant in people:
			var pid := String(p)
			var box := CheckBox.new()
			box.text = "%s: show my cards in replays" % View.player_name(_view, pid)
			box.size_flags_horizontal = Control.SIZE_SHRINK_CENTER
			box.toggled.connect(func(on: bool) -> void: GameClient.recording_control({"reveal": {"player": pid, "agreed": on}}))
			_cards.add_child(box)
			_card_boxes[pid] = box
		var note := Hud.text("My cards are my hand, my face-down cards and my decklist. Until everyone here ticks this, the replay shows only what the table saw.", 12)
		note.horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
		note.custom_minimum_size = Vector2(460, 0)
		_cards.add_child(note)
	var agreed := Val.list(rec, "agreed")
	for pid: Variant in _card_boxes:
		(_card_boxes[pid] as CheckBox).set_pressed_no_signal(agreed.has(pid))


## Watch replay: at once when it is saved, after the save while it is being saved.
func _on_watch() -> void:
	var rec := GameClient.recording
	match Val.text(rec, "state"):
		"saved":
			_open_replay()
		"empty":
			_replay_error("This game has no replay to watch.")
		"failed":
			var err := Val.text(rec, "error")
			_replay_error("The replay could not be saved: %s" % err if err != "" else "The replay could not be saved.")
		_:
			_watch_waiting = true
			_replay_status.text = "Saving the replay…"
			_replay_status.visible = true


func _replay_error(text: String) -> void:
	_replay_status.text = text
	_replay_status.visible = true
	Sound.cue("ui.error")


## The replay opens on the table; leaving it comes back to this end screen.
func _open_replay() -> void:
	_watch.disabled = true
	GameClient.return_table = GameClient.table_id
	Nav.open("table", {"replay": Val.text(GameClient.recording, "id")})


## Show the result of a finished game; `can_rematch`: the same game can be started again.
func show_result(view: Dictionary, r: Dictionary, can_rematch: bool) -> void:
	_view = view
	var winner := Val.text(r, "winner")
	_headline = "The game is a draw" if winner == "" else "%s wins" % View.player_name(view, winner)
	_title.text = _headline
	_reason.text = Val.text(r, "reason")
	var multiplayer := not Val.dict(Val.dict(view, "options"), "multiplayer").is_empty()
	for c: Node in _extra.get_children():
		c.queue_free()
	if not multiplayer:
		var conceded: Array[String] = []
		for p: Variant in Val.list(view, "players"):
			var pd := Val.as_dict(p)
			if Val.flag(pd, "conceded"):
				conceded.append(View.player_name(view, Val.text(pd, "id")))
		if not conceded.is_empty():
			_extra.add_child(_centered(Hud.text("%s conceded (CR 104.3a)." % " and ".join(conceded), 14)))
	else:
		_extra.add_child(_places(view, r))
	_rematch.visible = can_rematch and not multiplayer
	if multiplayer and can_rematch:
		_extra.add_child(_rematch_question(view))
	visible = true
	_folded.visible = false
	_refresh_replay()
	_play_entrance()


func _centered(c: Control) -> Control:
	if c is Label:
		(c as Label).horizontal_alignment = HORIZONTAL_ALIGNMENT_CENTER
	return c


## The finishing order (GameOver.tsx finishingOrder): the winner first, then the others by when they left, latest first; each
## with how they lost and the turn they left on.
func _places(view: Dictionary, r: Dictionary) -> Control:
	var winner := Val.text(r, "winner")
	var players: Array = Val.list(view, "players")
	var n := players.size()
	var ranked: Array = []
	for i: int in n:
		var p := Val.as_dict(players[i])
		var left := Val.dict(p, "left")
		var rank := 0 if Val.text(p, "id") == winner else (1 if left.is_empty() else 1 + (n - int(Val.num(left, "order")) + 1))
		ranked.append({"p": p, "rank": rank, "turn_order": i})
	ranked.sort_custom(func(a: Dictionary, b: Dictionary) -> bool:
		return int(a["rank"]) < int(b["rank"]) or (int(a["rank"]) == int(b["rank"]) and int(a["turn_order"]) < int(b["turn_order"])))
	var grid := GridContainer.new()
	grid.columns = 3
	grid.add_theme_constant_override("h_separation", 16)
	for row: Dictionary in ranked:
		var p: Dictionary = row["p"]
		var place := 1
		for other: Dictionary in ranked:
			if int(other["rank"]) < int(row["rank"]):
				place += 1
		var left := Val.dict(p, "left")
		var reason := Val.text(left, "reason", Val.text(p, "lostReason") if Val.flag(p, "hasLost") else "")
		var how := "Winner" if Val.text(p, "id") == winner else ""
		if how == "":
			if reason != "":
				var cause := _loss_cause(reason, Val.texts(left, "rules"))
				how = cause if cause.to_lower() == reason.to_lower() else "%s: %s" % [cause, reason]
				if not left.is_empty():
					how += " (turn %d)" % int(Val.num(left, "turn"))
			else:
				how = "Draw (CR 104.4a)" if winner == "" else "Lost"
		var place_label := Hud.title(_ordinal(place), 16)
		grid.add_child(place_label)
		var name_label := Label.new()
		name_label.text = View.player_name(view, Val.text(p, "id"))
		name_label.add_theme_font_override("font", Hud.bold_font())
		grid.add_child(name_label)
		grid.add_child(Hud.text(how, 13))
	var c := CenterContainer.new()
	c.add_child(grid)
	return c


static func _loss_cause(reason: String, rules: Array) -> String:
	var r := reason.to_lower()
	if r.contains("timed out") or r.contains("forfeit") or r.contains("disconnect"):
		return "Timed out"
	if rules.has("CR 104.3a") or r.contains("conced"):
		return "Conceded"
	if rules.has("CR 704.6c") or r.contains("commander"):
		return "Commander damage"
	if rules.has("CR 704.5c") or r.contains("poison"):
		return "Poison"
	if rules.has("CR 704.5b") or r.contains("empty library"):
		return "Empty library"
	if rules.has("CR 704.5a") or r.contains("life"):
		return "Life"
	if r.contains("won the game"):
		return "Another player won"
	return "Lost"


static func _ordinal(n: int) -> String:
	var suffix := "th"
	if n % 100 < 11 or n % 100 > 13:
		suffix = ["th", "st", "nd", "rd", "th", "th", "th", "th", "th", "th"][n % 10]
	return "%d%s" % [n, suffix]


## A game of three or four players asks "Rematch?" first; Yes shows each player with their deck, Same decks and Change decks.
func _rematch_question(view: Dictionary) -> Control:
	var box := VBoxContainer.new()
	box.alignment = BoxContainer.ALIGNMENT_CENTER
	var ask := HBoxContainer.new()
	ask.alignment = BoxContainer.ALIGNMENT_CENTER
	ask.add_theme_constant_override("separation", 12)
	var q := Hud.title("Rematch?", 18)
	q.size_flags_vertical = Control.SIZE_SHRINK_CENTER
	ask.add_child(q)
	var yes := Hud.primary("Yes", 16)
	yes.custom_minimum_size = Vector2(90, 40)
	var no := Hud.button("No")
	ask.add_child(yes)
	ask.add_child(no)
	box.add_child(ask)
	no.pressed.connect(func() -> void: box.queue_free())
	yes.pressed.connect(func() -> void:
		ask.queue_free()
		var setup: Dictionary = Nav.last_setup
		var seats: Array = Val.list(setup, "seats")
		if not seats.is_empty():
			var grid := GridContainer.new()
			grid.columns = 2
			grid.add_theme_constant_override("h_separation", 16)
			for seat: Variant in seats:
				var s := Val.as_dict(seat)
				var who := Label.new()
				who.text = Val.text(s, "name")
				who.add_theme_font_override("font", Hud.bold_font())
				grid.add_child(who)
				grid.add_child(Hud.text(Val.text(s, "deck_name"), 13))
			var c := CenterContainer.new()
			c.add_child(grid)
			box.add_child(c)
		var buttons := HBoxContainer.new()
		buttons.alignment = BoxContainer.ALIGNMENT_CENTER
		buttons.add_theme_constant_override("separation", 12)
		var same := Hud.primary("Same decks" if not seats.is_empty() else "Rematch", 16)
		same.custom_minimum_size = Vector2(170, 44)
		same.pressed.connect(func() -> void: rematch_pressed.emit())
		buttons.add_child(same)
		if not seats.is_empty():
			var change := Hud.button("Change decks")
			change.pressed.connect(func() -> void: change_decks_pressed.emit())
			buttons.add_child(change)
		box.add_child(buttons))
	return box


func _fold() -> void:
	visible = false
	_folded_title.text = _headline
	if _folded.get_parent() == null:
		get_parent().add_child(_folded)
	_folded.visible = true


func _unfold() -> void:
	_folded.visible = false
	visible = true
	modulate.a = 1.0


## The result screen comes in as the browser's does: the dim fades in over 0.8 s after 0.9 s (result-dim), then the result
## word lands from 2.1 times its size with its letters spread wide, overshooting a little, in 0.9 s (result-word-in).
func _play_entrance() -> void:
	var words := Hud.title(_title.text, 40)
	_title.label_settings = words.label_settings
	_title.text = words.text
	words.free()
	var own := FontVariation.new()
	own.base_font = Hud.bold_font()
	_title.label_settings.font = own
	if Settings.reduced_motion:
		own.spacing_glyph = 5
		modulate.a = 1.0
		return
	modulate.a = 0.0
	_title.modulate.a = 0.0
	_title.scale = Vector2(2.1, 2.1)
	own.spacing_glyph = 20
	var t := create_tween()
	t.tween_interval(0.9)
	t.tween_property(self, "modulate:a", 1.0, 0.8).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_IN_OUT)
	var w := create_tween()
	w.tween_interval(1.15)
	w.tween_callback(func() -> void: _title.pivot_offset = _title.size / 2.0)
	w.tween_property(_title, "modulate:a", 1.0, 0.5)
	w.parallel().tween_property(_title, "scale", Vector2(0.96, 0.96), 0.5).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	w.parallel().tween_method(func(v: float) -> void: own.spacing_glyph = roundi(v), 20.0, 5.0, 0.9).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	w.tween_property(_title, "scale", Vector2.ONE, 0.4).set_trans(Tween.TRANS_SINE).set_ease(Tween.EASE_OUT)

class_name TableScreen
extends Node2D
## The game table: Camera2D over the board, the Neon Grid backdrop, one Side per player (the
## viewer at the bottom, the others at the top), the stack, the phase bar with the stops, the prompt layer, the log (collapsed),
## the pass cover for hot-seat games, the game-over panel, and a large copy of the card under the mouse.
##
## Everything is rebuilt from GameClient.view on every `view_changed` (the view is the only truth; no node keeps game state).
##
## Pacing: with its animator (fx/Animator.gd, the Animator child) the Table sets
## GameClient.paced, so changes queue there, and plays them one at a time: part A on the view on screen, the change shown (the same
## rebuild from the view), one frame drawn, part B, then GameClient.shown(seq) (the computer waits for it). More than
## GameClient.MAX_BACKLOG waiting: the animation in progress is cut short and the latest change is shown at once. Animations off
## (Settings) or reduced motion, a change with no events (an undo, a hand-off, a stop toggle) or a catch-up: shown at once, its
## sounds condensed (fx/sounds.gd unanimated_cues). Without the animator (the node missing or its script failing to load) the
## plain path runs unchanged: every view is drawn at once and `shown` is sent right after.
##
## Board clicks: while a prompt is selecting (BoardSelection has selectable ids), a click on a selectable card or player goes to
## the prompt; otherwise a click on a card lists that card's legal actions (GameClient.legal) in a menu, and the chosen one is
## sent as it is. Playable cards glow.
##
## Deviation: three and four players share the top half in columns; the shared camera of the browser's
## board/table/useTableCamera.ts is not ported yet.

const HOME_SCENE: String = "res://scenes/Home.tscn"
const SIDE_SCENE: PackedScene = preload("res://scenes/Side.tscn")
const CARD_SCENE: PackedScene = preload("res://scenes/Card.tscn")
const BOARD_WIDTH: float = 1320.0
const TOP_AREA: Rect2 = Rect2(0, 82, 1320, 380)
const BOTTOM_AREA: Rect2 = Rect2(0, 470, 1320, 430)
const ZOOM_SCALE: float = 2.0
## The longest one change may animate before it is shown anyway (seconds at normal speed; PacedConnection's deadline).
const CHANGE_DEADLINE_S: float = 9.0

var selection := BoardSelection.new()
## player id -> SideView
var _sides: Dictionary = {}
var _menu_actions: Array[Dictionary] = []
## act request ids sent from the board's menu (their refusals are shown here)
var _requests: Dictionary = {}
var _zoom_card: CardView = null
## The zoom's other side of a two-sided card (CR 712), and what it says under the card: the artist, face down, the automation
## level, the text resolved by hand (cards/CardZoom.tsx).
var _zoom_other: CardThumb = null
var _zoom_info: VBoxContainer = null
var _shown_result: bool = false
## The animator (null when the scene has none: then nothing is paced).
var _animator: Animator = null
## A change is being played (the pump is running), and its number (a deadline cuts only the change it was set for).
var _pumping: bool = false
var _in_change: bool = false
var _change_number: int = 0
## The game's start was heard (the first turn's banner stays quiet after it, fx/sounds.gd).
var _greeted: bool = false

@onready var _sides_root: Node2D = $Board/Sides
@onready var _stack: StackView = $Board/Stack
@onready var _phase: PhaseBar = $UI/PhaseBar
@onready var _log: LogView = $UI/Log
@onready var _prompts: PromptLayer = $UI/PromptLayer
@onready var _cover: PassCover = $UI/PassCover
@onready var _over: GameOverScreen = $UI/GameOver
@onready var _menu: PopupMenu = %ActionMenu
@onready var _concede_dialog: ConfirmationDialog = %ConcedeDialog
var _bar: GameBar = null
var _leaving: bool = false
## The card under the pointer, and the stack object under it (its targets get arrows): TableArrows reads them.
## The graveyard, exile or command zone open as cards (ZoneViewer), or null.
var _zone_viewer: ZoneViewer = null
## The player at the bottom of the last layout.
var _bottom_id: String = ""
## Where dialogs over the table open (Report a bug), above everything else.
var _dialogs: Control = null
## The card (or player) the keyboard has (Tab), "" for none.
var _key_focus: String = ""
## A watched replay's panel (ReplayPanel: its status, whose view, the transport), or null.
var _replay_panel: ReplayPanel = null
var hovered_id: String = ""
var focus_stack: String = ""
var _arrows: TableArrows = null
@onready var _undo: Button = %Undo
@onready var _concede: Button = %Concede
@onready var _home: Button = %Home
@onready var _status: Label = %Status
@onready var _hint: Label = %Hint
@onready var _zoom: Control = %Zoom
@onready var _camera: Camera2D = $Camera
@onready var _fx: Node2D = $Fx
@onready var _fx_under: Node2D = $Board/FxUnder
@onready var _flash: ColorRect = %Flash


func _ready() -> void:
	GameClient.selection = selection
	_prompts.selection = selection
	selection.changed.connect(_on_selection_changed)
	GameClient.view_changed.connect(_on_view_changed)
	Settings.changed.connect(_on_setting_changed)
	GameClient.result.connect(_on_result)
	GameClient.notice.connect(_on_notice)
	GameClient.replied.connect(_on_replied)
	GameClient.disconnected.connect(_on_disconnected)
	GameClient.connected.connect(_on_connected)
	_menu.id_pressed.connect(_on_menu_id)
	_cover.accepted.connect(_on_cover_accepted)
	_over.rematch_pressed.connect(_on_rematch)
	_over.home_pressed.connect(_on_leave)
	# The game bar (GameBar.gd) replaces the old corner buttons.
	$UI/TopRight.visible = false
	# Room for the bar's two ends: the phase bar moves a little left and narrows.
	var phases := $UI/PhaseBar as Control
	phases.offset_left = -568.0
	phases.offset_right = 498.0
	_bar = GameBar.new()
	_bar.name = "GameBar"
	$UI.add_child(_bar)
	$UI.move_child(_bar, _cover.get_index())
	_bar.undo_pressed.connect(_on_undo)
	_bar.report_bug.connect(open_bug_report)
	_bar.concede.connect(_concede_for)
	_bar.leave.connect(_on_leave)
	_cover.concede_pressed.connect(func() -> void: _bar.ask_concede(_cover))
	_cover.leave_pressed.connect(func() -> void: _bar.ask_leave(_cover))
	_over.new_game_pressed.connect(func() -> void:
		GameClient.leave()
		Nav.go("newGame"))
	_over.change_decks_pressed.connect(func() -> void:
		Nav.pending_setup = Nav.last_setup.duplicate(true)
		GameClient.leave()
		Nav.go("newGame"))
	# The arena (ArenaBackdrop.tsx): the emblem and the beam on the middle line, behind the cards; light streaks on the floor.
	var arena := ArenaFx.new()
	arena.name = "Arena"
	arena.center = Vector2(BOARD_WIDTH / 2.0, (TOP_AREA.end.y + BOTTOM_AREA.position.y) / 2.0)
	arena.width = BOARD_WIDTH
	$Board.add_child(arena)
	$Board.move_child(arena, 0)
	_arrows = TableArrows.new()
	_arrows.name = "Arrows"
	_arrows.table = self
	$Board.add_child(_arrows)
	$Board.move_child(_arrows, 1)
	var floor_layer := CanvasLayer.new()
	floor_layer.layer = -9
	add_child(floor_layer)
	# A replay (opened from Replays): the server plays it; nothing is decided here, so no prompt or hand-off cover shows.
	var replay_id := Val.text(Nav.args, "replay")
	if replay_id != "":
		Nav.args = {}
		GameClient.watch(replay_id)
	# An online game: the players and their links, adjustments by hand to answer, the chat (OnlinePanel).
	if GameClient.is_online:
		var online := OnlinePanel.new()
		online.name = "OnlinePanel"
		$UI.add_child(online)
		$UI.move_child(online, _bar.get_index())
		GameClient.status_changed.connect(_on_status_changed)
	if GameClient.is_replay:
		_prompts.visible = false
		_replay_panel = ReplayPanel.new()
		_replay_panel.name = "ReplayPanel"
		_replay_panel.table = self
		_replay_panel.leave_requested.connect(_on_leave)
		$UI.add_child(_replay_panel)
		var replay_cover := _replay_panel.cover()
		$UI.add_child(replay_cover)
		$UI.move_child(replay_cover, _bar.get_index())
	floor_layer.add_child(ArenaFx.FloorStreaks.new())
	_stack.card_clicked.connect(_on_card_clicked)
	_stack.card_hovered.connect(_on_card_hovered)
	# The large copy of a card shows over a prompt's stage too.
	$UI.move_child(_zoom, _prompts.get_index())
	_zoom_card = CARD_SCENE.instantiate()
	_zoom.add_child(_zoom_card)
	_zoom_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_zoom_card.set_card_scale(ZOOM_SCALE)
	_zoom_card.position = CardView.SIZE * ZOOM_SCALE * 0.5 - _zoom_card.pivot_offset
	_zoom_other = CardThumb.new()
	_zoom_other.size = CardView.SIZE * ZOOM_SCALE
	_zoom_other.position = Vector2(CardView.SIZE.x * ZOOM_SCALE + 8.0, 0.0)
	_zoom_other.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_zoom.add_child(_zoom_other)
	_zoom_info = VBoxContainer.new()
	_zoom_info.position = Vector2(0.0, CardView.SIZE.y * ZOOM_SCALE + 6.0)
	_zoom_info.custom_minimum_size = Vector2(CardView.SIZE.x * ZOOM_SCALE * 1.6, 0)
	_zoom_info.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_zoom_info.add_theme_constant_override("separation", 4)
	_zoom.add_child(_zoom_info)
	_stack.visible = false
	_animator = get_node_or_null("Animator") as Animator
	if _animator != null:
		_animator.setup(self)
		GameClient.paced = true
		GameClient.changes_waiting.connect(_on_changes_waiting)
	Pictures.pictures_changed.connect(_redraw)
	Sound.hold_ambience()
	if not GameClient.view.is_empty():
		_on_view_changed(GameClient.seq)
	elif GameClient.table_id != "":
		GameClient.attach(GameClient.table_id)
		_status.text = "Opening the table…"
	else:
		_status.text = "No game is open."


func _exit_tree() -> void:
	# Leaving (Home, Leave, the menu) may come in the middle of an animation: nothing more is drawn on this closing table.
	_leaving = true
	# Nothing reaches this closing table any more (the next screen may already be listening: a replay and back).
	for pair: Array in [[GameClient.view_changed, _on_view_changed], [GameClient.result, _on_result], [GameClient.notice, _on_notice],
			[GameClient.replied, _on_replied], [GameClient.disconnected, _on_disconnected], [GameClient.connected, _on_connected],
			[GameClient.changes_waiting, _on_changes_waiting], [Settings.changed, _on_setting_changed], [Pictures.pictures_changed, _redraw],
			[GameClient.status_changed, _on_status_changed]]:
		var sig: Signal = pair[0]
		if sig.is_connected(pair[1]):
			sig.disconnect(pair[1])
	if GameClient.selection == selection:
		GameClient.selection = null
	if _animator != null:
		_animator.finish()
		GameClient.paced = false
		# The latest change waiting is shown at once (and `shown` sent), without drawing on this closing table.
		if GameClient.view_changed.is_connected(_on_view_changed):
			GameClient.view_changed.disconnect(_on_view_changed)
		GameClient.flush()
	Sound.release_ambience()


func _unhandled_input(event: InputEvent) -> void:
	var key := event as InputEventKey
	if key != null and key.pressed and not key.echo and key.keycode == KEY_Z and GameClient.can_undo:
		_on_undo()
		get_viewport().set_input_as_handled()
		return
	# The shared table's camera keys, while it does not follow the mouse: + and - zoom, the arrows pan, Home recentres.
	if key == null or not key.pressed or _track_spread <= 0.0 or Settings.camera_follow:
		return
	var handled := true
	match key.keycode:
		KEY_PLUS, KEY_EQUAL, KEY_KP_ADD:
			_track_zoom = minf(1.4, _track_zoom + 0.1)
		KEY_MINUS, KEY_KP_SUBTRACT:
			_track_zoom = maxf(0.4, _track_zoom - 0.1)
		KEY_LEFT:
			_track_pan += TRACK_PAN_KEY
		KEY_RIGHT:
			_track_pan -= TRACK_PAN_KEY
		KEY_HOME:
			_track_pan = 0.0
			_track_zoom = 1.0
		_:
			handled = false
	if handled:
		_track_pan = clampf(_track_pan, -_track_spread, _track_spread)
		_apply_track()
		get_viewport().set_input_as_handled()


# ---- drawing the view ----------------------------------------------------------------------------------------------------------

func _on_view_changed(at_seq: int) -> void:
	_redraw()
	# Outside a paced change the view is on screen now (the pump sends `shown` itself once part B is done).
	if not _in_change and not GameClient.view.is_empty():
		GameClient.shown(at_seq)
	if GameClient.paced and not _pumping and GameClient.backlog() > 0:
		_pump()


## Draw GameClient.view (the change on screen): the sides, the stack, the bars, the prompt, the covers.
func _redraw() -> void:
	var view := GameClient.view
	if view.is_empty() or _leaving:
		return
	if not _greeted:
		_greeted = true
		if Val.num(View.turn(view), "number") <= 1:
			Sound.cue("game.start")
	_layout_sides(view)
	_stack.show_stack(view, selection)
	_phase.show_view(view)
	_log.show_view(view)
	# A replay asks nothing: its decisions are shown read-only in its panel.
	if not GameClient.is_replay:
		_prompts.show_view(view)
	_bar.show_view(view, GameClient.can_undo, GameClient.table_kind == "hotseat", not View.result(view).is_empty())
	_status.text = GameClient.status
	if GameClient.handoff_player != "":
		_cover.show_for(View.player_name(view, GameClient.handoff_player))
	else:
		_cover.visible = false
	var r := View.result(view)
	# A replay's end is shown on the table and in its panel only.
	if not r.is_empty() and not _shown_result and not GameClient.is_replay:
		_shown_result = true
		_over.show_result(view, r, not GameClient.last_start.is_empty() and not GameClient.is_online)


# ---- pacing ----------------------------------------------------------------------------------------------------------

func _on_changes_waiting(count: int) -> void:
	# Too far behind: cut the animation in progress short; the pump then jumps to the latest change.
	if (count > GameClient.MAX_BACKLOG or GameClient.jump_waiting()) and _animator != null and _animator.playing:
		_animator.finish()
	if not _pumping:
		_pump()


## Show the waiting changes one at a time, each animated when it may be.
func _pump() -> void:
	if _pumping:
		return
	_pumping = true
	while GameClient.backlog() > 0 and is_inside_tree():
		var change := GameClient.take_change()
		if change.is_empty():
			break
		await _play_change(change)
	_pumping = false


func _play_change(change: Dictionary) -> void:
	_change_number += 1
	var number := _change_number
	var from := GameClient.view
	var to := Val.dict(change, "view")
	var events := Val.list(change, "events")
	var at_seq := Val.num(change, "seq")
	_in_change = true
	var animate := _animator != null and Settings.animates() and not _replay_condensed() and not events.is_empty() and not from.is_empty() \
			and not Val.flag(change, "skipped")
	if animate:
		_animator.pace = _replay_pace()
		var plan := Plan.plan_batch(events, from, to)
		_deadline(number, CHANGE_DEADLINE_S * maxf(1.0, Settings.speed_factor()))
		await _animator.play(plan, events, from, to, func() -> void:
			if not _leaving:
				GameClient.show_change(change))
		# Cut short before it was shown (a catch-up, the deadline): show it now, unless the table is closing.
		if _leaving:
			return
		if GameClient.seq != at_seq:
			GameClient.show_change(change)
	else:
		GameClient.show_change(change)
		if not events.is_empty() and not from.is_empty():
			Sound.play_cues(SoundCues.unanimated_cues(events, from, to, Sound.since("game.start")))
	_in_change = false
	if is_inside_tree():
		GameClient.shown(at_seq)


## A replay's speed as times faster than live (real time plays as live); 1 in a game.
func _replay_pace() -> float:
	if not GameClient.is_replay:
		return 1.0
	var s: Variant = GameClient.replay_state.get("speed", 1.0)
	return 1.0 if s == null or s is String else float(s)


## Above 4x a replay is condensed: each change is shown at once, with the condensed sounds.
func _replay_condensed() -> bool:
	return _replay_pace() > 4.0


## Report a bug: the moment now, what happened, saved as a file.
func open_bug_report() -> void:
	if _dialogs == null:
		_dialogs = Control.new()
		_dialogs.name = "Dialogs"
		_dialogs.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
		_dialogs.mouse_filter = Control.MOUSE_FILTER_IGNORE
		$UI.add_child(_dialogs)
	BugReport.open(_dialogs)


## Whether something on the table is open that Esc closes first: the game bar's menu or question, the zone viewer, a dialog.
func has_open_overlay() -> bool:
	if _bar.has_open():
		return true
	if _dialogs != null:
		for n: Node in _dialogs.get_children():
			if n is Modal and (n as CanvasItem).visible:
				return true
	for n: Node in $UI.get_children():
		if (n is ZoneViewer or n is Modal) and (n as CanvasItem).visible:
			return true
	return false


## A change that takes too long is shown anyway (a hidden window, a very long resolution): the animator is cut short.
func _deadline(number: int, seconds: float) -> void:
	get_tree().create_timer(seconds).timeout.connect(_on_deadline.bind(number))


func _on_deadline(number: int) -> void:
	if number == _change_number and _in_change and _animator != null and _animator.playing:
		_animator.finish()


# ---- what the animator reads ----------------------------------------------------------------------------------------------------

## player id -> SideView
func sides() -> Dictionary:
	return _sides


func stack_view() -> StackView:
	return _stack


## Above the table (ghosts, flights, numbers, banners) and below the cards (impacts on cards, dust: never over a card picture).
func fx_layer() -> Node2D:
	return _fx


func fx_under() -> Node2D:
	return _fx_under


func camera() -> Camera2D:
	return _camera


## The full-screen flash of a heavy blow (only its modulate alpha changes).
func flash_rect() -> ColorRect:
	return _flash


## The table's area (the board without the stack column), in canvas coordinates.
func board_rect() -> Rect2:
	return Rect2(0, TOP_AREA.position.y, BOARD_WIDTH, BOTTOM_AREA.end.y - TOP_AREA.position.y)


## The viewer's half of the table (where the viewer's drawn cards are held up to be read).
func viewer_area() -> Rect2:
	return BOTTOM_AREA


## Where the opponents' sides go with three or four players (Settings.table_layout; two players always "acrossTop"):
## - "acrossTop": side by side at the top, each a share of the width.
## - "shared": each at full size in a row wider than the screen, on a track the camera looks across: it follows the mouse
##   (Settings.camera_follow), or stays still for the keys (+ and - zoom, the arrows pan, Home recentres). Reduced motion keeps
##   it still too. The viewer's own board never moves.
## - "focused": one opponent large at the top, the others as strips beside it; it follows whose turn it is, then who attacks
##   or targets the viewer, else stays on the last one (a click on a strip focuses that opponent, or picks them as a target).
const STRIP_WIDTH: float = 300.0
const TRACK_PAN_KEY: float = 120.0

var _top_track: Node2D = null
var _track_spread: float = 0.0
var _track_pan: float = 0.0
var _track_zoom: float = 1.0
var _focused: String = ""
var _strips: VBoxContainer = null


func _layout_name(view: Dictionary) -> String:
	return Settings.table_layout if View.player_ids(view).size() > 2 else "acrossTop"


## The opponent the focused layout shows large: the active player, else one attacking or targeting the viewer, else the last.
func _focus_of(view: Dictionary, opponents: Array[String]) -> String:
	var active := Val.text(View.turn(view), "activePlayer")
	if opponents.has(active):
		return active
	var me := View.viewer(view)
	for a: Variant in Val.list(View.combat(view), "attackers"):
		var ad := Val.as_dict(a)
		if Val.text(ad, "defender") == me:
			var who := Chars.controller_of(view, View.object(view, Val.text(ad, "id")))
			if opponents.has(who):
				return who
	for s: String in View.stack(view):
		for group: Variant in Val.list(Val.dict(View.object(view, s), "stack"), "targets"):
			for t: Variant in Val.as_list(group):
				if Val.text(Val.as_dict(t), "id") == me:
					var who := Chars.controller_of(view, View.object(view, s))
					if opponents.has(who):
						return who
	return _focused if opponents.has(_focused) else opponents[0]


## One Side per player: the viewer at the bottom, the others (in turn order after the viewer) at the top as the layout says.
func _layout_sides(view: Dictionary) -> void:
	var ids := View.player_ids(view)
	if ids.is_empty():
		return
	# The viewer sits at the bottom; with no viewer (a hand-off, a replay's public or open view), whoever sat there a moment ago, so
	# the table does not turn round, else the active player (board/model.ts `seating`).
	var bottom := View.viewer(view)
	if bottom == "":
		bottom = _bottom_id if ids.has(_bottom_id) else Val.text(View.turn(view), "activePlayer")
	var first := maxi(0, ids.find(bottom))
	_bottom_id = ids[first]
	var order: Array[String] = []
	for i: int in range(ids.size()):
		order.append(ids[(first + i) % ids.size()])
	for pid: Variant in _sides.keys():
		if not order.has(String(pid)):
			var gone: SideView = _sides[pid]
			gone.queue_free()
			_sides.erase(pid)
	var others := order.size() - 1
	var layout := _layout_name(view)
	if _top_track == null:
		_top_track = Node2D.new()
		_sides_root.add_child(_top_track)
	var opponents: Array[String] = []
	for i: int in range(1, order.size()):
		opponents.append(order[i])
	if layout == "focused" and not opponents.is_empty():
		_focused = _focus_of(view, opponents)
	_track_spread = (others - 1) * BOARD_WIDTH / 2.0 if layout == "shared" else 0.0
	for i: int in range(order.size()):
		var pid := order[i]
		var side := _side_for(pid)
		var area := BOTTOM_AREA
		var parent: Node = _sides_root
		var shown := true
		if i > 0:
			match layout:
				"shared":
					parent = _top_track
					area = Rect2(BOARD_WIDTH * (i - 1) - _track_spread, TOP_AREA.position.y, BOARD_WIDTH, TOP_AREA.size.y)
				"focused":
					shown = pid == _focused
					area = Rect2(TOP_AREA.position.x, TOP_AREA.position.y, BOARD_WIDTH - STRIP_WIDTH, TOP_AREA.size.y)
				_:
					var w: float = TOP_AREA.size.x / others
					area = Rect2(TOP_AREA.position.x + w * (i - 1), TOP_AREA.position.y, w, TOP_AREA.size.y)
		if side.get_parent() != parent:
			side.reparent(parent, false)
		side.visible = shown
		side.show_side(view, pid, i > 0, area, selection, GameClient)
	_show_strips(view, opponents if layout == "focused" else ([] as Array[String]))
	if layout != "shared":
		_track_pan = 0.0
		_track_zoom = 1.0
	_apply_track()


## The focused layout's other opponents, as strips down the right of the top half: name, life, cards; a click focuses one, or
## picks them while a prompt chooses players.
func _show_strips(view: Dictionary, opponents: Array[String]) -> void:
	if _strips == null:
		_strips = VBoxContainer.new()
		_strips.add_theme_constant_override("separation", 8)
		_sides_root.add_child(_strips)
	for c: Node in _strips.get_children():
		c.queue_free()
	_strips.visible = opponents.size() > 1
	_strips.position = Vector2(BOARD_WIDTH - STRIP_WIDTH + 10.0, TOP_AREA.position.y + 6.0)
	for pid: String in opponents:
		if pid == _focused:
			continue
		var p := View.player(view, pid)
		var b := Button.new()
		b.custom_minimum_size = Vector2(STRIP_WIDTH - 20.0, 64)
		b.alignment = HORIZONTAL_ALIGNMENT_LEFT
		b.text = "%s   %d life\nHand %d · Library %d · %d permanents" % [Val.text(p, "name", pid), int(Val.num(p, "life")),
			View.hand_of(view, pid).size(), View.library_count(view, pid), View.battlefield_of(view, pid).size()]
		b.tooltip_text = "Show %s's board" % Val.text(p, "name", pid)
		if selection != null and selection.can_select(pid):
			b.modulate = Color(NeonTheme.colors()[0]).lightened(0.5)
		b.pressed.connect(func() -> void:
			if selection != null and selection.can_select(pid):
				selection.click_player(pid)
			else:
				_focused = pid
				_layout_sides(GameClient.view))
		_strips.add_child(b)


## The layout switch (here or in Settings) and the camera setting redraw the sides.
func _on_setting_changed(key: String) -> void:
	if (key == "table_layout" or key == "camera_follow") and not GameClient.view.is_empty():
		_layout_sides(GameClient.view)


## The shared table's track: panned and zoomed about the middle of the top half.
func _apply_track() -> void:
	if _top_track == null:
		return
	var pan := clampf(_track_pan, -_track_spread, _track_spread)
	_top_track.scale = Vector2.ONE * _track_zoom
	var pivot := Vector2(BOARD_WIDTH / 2.0, TOP_AREA.position.y)
	_top_track.position = pivot - pivot * _track_zoom + Vector2(pan * _track_zoom, 0.0)


func _process(delta: float) -> void:
	if _top_track == null or _track_spread <= 0.0 or not Settings.camera_follow or Settings.reduced_motion:
		return
	# The camera follows the mouse across the opponents' row.
	var w := get_viewport().get_visible_rect().size.x
	var k := clampf(get_viewport().get_mouse_position().x / maxf(1.0, w), 0.0, 1.0)
	var target := lerpf(_track_spread, -_track_spread, k)
	var before := _track_pan
	_track_pan = lerpf(_track_pan, target, minf(1.0, delta * 4.0))
	if absf(_track_pan - before) > 0.1:
		_apply_track()


func _side_for(pid: String) -> SideView:
	if _sides.has(pid):
		return _sides[pid]
	var side: SideView = SIDE_SCENE.instantiate()
	_sides_root.add_child(side)
	side.card_clicked.connect(_on_card_clicked)
	side.card_right_clicked.connect(_on_card_right_clicked)
	side.card_hovered.connect(_on_card_hovered)
	side.player_clicked.connect(_on_player_clicked)
	side.zone_requested.connect(_on_zone_requested)
	_sides[pid] = side
	return side


func _on_selection_changed() -> void:
	if _zone_viewer != null and is_instance_valid(_zone_viewer):
		_zone_viewer.refresh()
	var view := GameClient.view
	for pid: Variant in _sides.keys():
		var side: SideView = _sides[pid]
		side.refresh_glows(view, selection, GameClient)
	_stack.show_stack(view, selection)
	_hint.text = selection.hint
	_hint.visible = selection.hint != ""


# ---- clicks --------------------------------------------------------------------------------------------------------------------

# ---- the keyboard (the browser's board cards are buttons) ---------------------------------------------------------------------

## Tab and Shift+Tab move a focus through the cards on the table (yours first, then the stack, then the other players', each
## side top to bottom and left to right) and the players a prompt may choose; the large copy of the card follows it; Enter or
## Space uses it as a click would; Esc lets go. Past either end the focus lets go, and Tab goes on to the buttons.
func _input(event: InputEvent) -> void:
	var k := event as InputEventKey
	if k == null or not k.pressed or k.echo or k.ctrl_pressed or k.alt_pressed or k.meta_pressed or GameClient.is_replay:
		return
	var focus := get_viewport().gui_get_focus_owner()
	if focus is LineEdit or focus is TextEdit or has_open_overlay() or _menu.visible:
		return
	match k.keycode:
		KEY_TAB:
			if focus != null and _key_focus == "":
				return
			if focus != null:
				focus.release_focus()
			_move_key_focus(-1 if k.shift_pressed else 1)
		KEY_ENTER, KEY_KP_ENTER, KEY_SPACE:
			if _key_focus == "":
				return
			var id := _key_focus
			if _sides.has(id):
				_on_player_clicked(id)
			else:
				_on_card_clicked(id)
		KEY_ESCAPE:
			if _key_focus == "":
				return
			_set_key_focus("")
		_:
			return
	get_viewport().set_input_as_handled()


## What Tab visits, in order: card ids (face up, or ones a prompt may choose) and the players a prompt may choose.
func _keyboard_targets() -> Array[String]:
	var view := GameClient.view
	var order: Array[String] = []
	var bottom := _bottom_id
	var pids: Array[String] = [bottom]
	for pid: Variant in _sides.keys():
		if String(pid) != bottom:
			pids.append(String(pid))
	var groups: Array[Dictionary] = []
	for i: int in pids.size():
		if not _sides.has(pids[i]):
			continue
		groups.append((_sides[pids[i]] as SideView).card_nodes())
		if i == 0 and _stack.visible:
			groups.append(_stack.card_nodes())
	for cards: Dictionary in groups:
		var here: Array[CardView] = []
		for id: Variant in cards:
			var c := cards[id] as CardView
			if c == null or not is_instance_valid(c) or not c.is_visible_in_tree():
				continue
			var obj := View.object(view, String(id))
			if View.is_hidden(obj) and not selection.can_select(String(id)):
				continue
			here.append(c)
		here.sort_custom(func(a: CardView, b: CardView) -> bool:
			var ra := a.get_global_rect()
			var rb := b.get_global_rect()
			return ra.position.y < rb.position.y - 20.0 or (absf(ra.position.y - rb.position.y) <= 20.0 and ra.position.x < rb.position.x))
		for c: CardView in here:
			order.append(c.object_id)
	for pid: String in pids:
		if selection.can_select(pid):
			order.append(pid)
	return order


func _move_key_focus(step: int) -> void:
	var list := _keyboard_targets()
	var i := list.find(_key_focus)
	i = i + step if i >= 0 else (0 if step > 0 else list.size() - 1)
	_set_key_focus(list[i] if i >= 0 and i < list.size() else "")


func _key_card(id: String) -> CardView:
	if id == "":
		return null
	var stack_cards := _stack.card_nodes()
	if stack_cards.has(id):
		return stack_cards[id] as CardView
	for pid: Variant in _sides.keys():
		var cards: Dictionary = (_sides[pid] as SideView).card_nodes()
		if cards.has(id) and is_instance_valid(cards[id]):
			return cards[id] as CardView
	return null


func _set_key_focus(id: String) -> void:
	var old := _key_card(_key_focus)
	if old != null:
		old.set_key_focus(false)
		_on_card_hovered(_key_focus, false)
	_key_focus = id
	var card := _key_card(id)
	if card != null:
		card.set_key_focus(true)
		_on_card_hovered(id, true)
	if id != "":
		Sound.cue("ui.tick")


func _on_card_clicked(id: String) -> void:
	if selection.click_card(id):
		return
	if selection.is_active():
		return # a prompt is choosing: other cards do nothing
	var actions := GameClient.legal_for(id)
	if actions.is_empty():
		return
	_menu.clear()
	_menu_actions = actions
	for i: int in range(actions.size()):
		_menu.add_item(Val.text(actions[i], "label", "Action"), i)
	# From the keyboard the menu opens at the card, from the mouse where it is.
	var at := get_viewport().get_mouse_position()
	var keyed := _key_card(id) if id == _key_focus else null
	if keyed != null:
		var r := keyed.get_global_rect()
		at = r.position + Vector2(r.size.x, 0.0)
	_menu.popup(Rect2i(Vector2i(at), Vector2i.ZERO))


func _on_card_right_clicked(id: String) -> void:
	_on_card_hovered(id, true)


func _on_menu_id(index: int) -> void:
	if index < 0 or index >= _menu_actions.size():
		return
	var action := Val.dict(_menu_actions[index], "action")
	_requests[GameClient.act(action)] = true


func _on_player_clicked(id: String) -> void:
	selection.click_player(id)


## Show (or hide) the large copy of a card: the board's cards, and the cards of a prompt's stage.
func show_zoom(id: String, inside: bool) -> void:
	_on_card_hovered(id, inside)


func _on_card_hovered(id: String, inside: bool) -> void:
	if not inside:
		if hovered_id == id:
			hovered_id = ""
		if focus_stack == id:
			focus_stack = ""
		_zoom.visible = false
		return
	hovered_id = id
	focus_stack = id if _stack.card_nodes().has(id) else ""
	var obj := View.object(GameClient.view, id)
	if obj.is_empty() or View.is_hidden(obj):
		_zoom.visible = false
		return
	_zoom_card.show_object(GameClient.view, id)
	_zoom_card.rotation_degrees = 0.0
	_zoom_extras(GameClient.view, obj)
	_zoom.visible = true


func _zoom_extras(view: Dictionary, obj: Dictionary) -> void:
	for c: Node in _zoom_info.get_children():
		c.queue_free()
	var def := View.def_of(view, obj)
	var face := View.shown_face(def, obj)
	var face_down := View.is_face_down_profile(obj) or Val.flag(obj, "faceDown")
	# The other side of a two-sided card, beside it.
	_zoom_other.visible = not face_down and Pictures.is_two_sided(def)
	if _zoom_other.visible:
		var faces: Array = []
		for f: Variant in Val.list(def, "faces"):
			var fd := Val.as_dict(f)
			var summary := fd.duplicate()
			summary["manaCost"] = Chars.mana_text(fd.get("manaCost"))
			faces.append(summary)
		_zoom_other.card = {"name": Val.text(def, "name"), "layout": Val.text(def, "layout"), "faces": faces, "colors": Val.list(def, "colors")}
		_zoom_other.face = 1 - face
	var lines: Array = []
	var artist := Pictures.artist_of(_zoom_card.picture_key)
	if artist != "":
		lines.append(["Illustrated by %s" % artist, Hud.MUTED])
	if face_down:
		lines.append(["Face down: other players see only the card back.", Hud.TEXT])
	var automation := Val.dict(def, "automation")
	var level := Val.text(automation, "level")
	if level == "partial":
		lines.append(["⚠ This card may not function as written: it is only partly automated, and some of its text is resolved by hand.", Color("#ffd27a")])
	elif level != "" and not face_down:
		lines.append([String(CardThumb.AUTOMATION.get(level, ["", "", ""])[2]), Hud.TEXT])
	var by_hand: Array = Val.list(automation, "unsupported")
	if not by_hand.is_empty() and not face_down:
		lines.append(["Resolved by hand:", Hud.TEXT])
		var card_name := View.name_of(view, obj)
		for u: Variant in by_hand:
			lines.append(["• " + String(u).replace("CARDNAME", card_name).replace("~", card_name), Hud.MUTED])
	for l: Array in lines:
		var label := Hud.text(String(l[0]), 13, l[1])
		label.add_theme_color_override("font_shadow_color", Color(0, 0, 0, 0.9))
		label.add_theme_constant_override("shadow_outline_size", 4)
		_zoom_info.add_child(label)


func _on_zone_requested(player: String, zone: String) -> void:
	if _zone_viewer != null and is_instance_valid(_zone_viewer):
		_zone_viewer.queue_free()
	_zone_viewer = ZoneViewer.open(self, player, zone)


# ---- buttons and messages ------------------------------------------------------------------------------------------------------

func _on_undo() -> void:
	if GameClient.can_undo:
		_requests[GameClient.undo()] = true


func _on_concede() -> void:
	_concede_for(View.viewer(GameClient.view))


func _concede_for(player: String) -> void:
	if player != "":
		_requests[GameClient.act({"type": "concede", "player": player})] = true


func _on_cover_accepted() -> void:
	GameClient.handoff()


func _on_rematch() -> void:
	if _animator != null:
		_animator.finish()
	Sound.reset_clock()
	_greeted = false
	_over.visible = false
	_shown_result = false
	for pid: Variant in _sides.keys():
		var side: SideView = _sides[pid]
		side.queue_free()
	_sides.clear()
	GameClient.rematch()


func _on_leave() -> void:
	var was_replay := GameClient.is_replay
	GameClient.leave()
	# A replay watched from the end screen goes back to that end screen (the finished game's table waits on the server; an online
	# game stays open there until it is left).
	if was_replay and GameClient.return_table != "":
		var back := GameClient.return_table
		GameClient.return_table = ""
		if back != "online":
			GameClient.attach(back)
		elif not Online.view.is_empty():
			GameClient.open_online()
		else:
			Nav.go("home")
			return
		Nav.open("table", {})
		return
	GameClient.return_table = ""
	Nav.go("replays" if was_replay else "home")


func _on_result(r: Dictionary) -> void:
	# A replay reaching its end only shows the end on the table (the bar can go back).
	if _shown_result or GameClient.is_replay:
		return
	var view_result := View.result(GameClient.view)
	_shown_result = true
	_over.show_result(GameClient.view, view_result if not view_result.is_empty() else r, not GameClient.last_start.is_empty() and not GameClient.is_online)


func _on_status_changed() -> void:
	_status.text = GameClient.status


func _on_notice(text: String, level: String) -> void:
	if level == "error" or level == "warning":
		_prompts.show_error(text)
	else:
		_status.text = text


func _on_replied(id: int, ok: bool, error: Dictionary) -> void:
	if not _requests.has(id):
		return
	_requests.erase(id)
	if not ok:
		_prompts.show_error(Val.text(error, "message", "The game refused that."))


func _on_disconnected() -> void:
	_status.text = "The connection to the game server was lost. Reconnecting…"


func _on_connected() -> void:
	_status.text = GameClient.status


# ---- what the arrows read (TableArrows.gd) ------------------------------------------------------------------------------

## The canvas rectangle of an object's card (battlefield, hand, stack) or a player's panel; empty when it is not drawn.
func rect_of(id: String) -> Rect2:
	var stack_cards := _stack.card_nodes()
	if stack_cards.has(id) and _stack.visible:
		return (stack_cards[id] as Control).get_global_rect()
	if _sides.has(id):
		return (_sides[id] as SideView).avatar_node().get_global_rect()
	for pid: Variant in _sides.keys():
		var cards: Dictionary = (_sides[pid] as SideView).card_nodes()
		if cards.has(id) and is_instance_valid(cards[id]):
			return (cards[id] as Control).get_global_rect()
	return Rect2()


## Whether the animator is playing a change (the arrows fade meanwhile).
func animating() -> bool:
	return _animator != null and bool(_animator.get("playing"))


## The defenders picked for attackers being declared (the prompt's choices), {attacker: defender}.
var attack_targets: Dictionary:
	get:
		var p := _prompts.get("_current") as Control
		if p != null and is_instance_valid(p) and p.get("attacks") is Dictionary:
			return p.get("attacks")
		return {}

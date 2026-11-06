extends Node
## The interface sounds every screen gets without writing them, as the browser's (packages/client/src/audio/uiSounds.ts): every
## control that enters the tree is hooked once, so a new button, tick box or text field is never silent.
##
## - a button press: its `sfx` meta (a sound id, or "none" to stay silent); else ui.confirm for a primary button (theme type
##   PromptPrimary or Primary, or the meta `primary`), ui.cancel for Back, Cancel, Close, Clear, Dismiss or Skip, ui.click for
##   the rest. A tick box or toggle button: ui.toggleOn / ui.toggleOff. A drop-down: ui.select when an item is chosen.
## - a slider or number box moving: ui.tick (at most every TICK_GAP_MS); a key typed in a text field: ui.type (TYPE_GAP_MS);
##   the mouse entering a button: ui.hover (HOVER_GAP_MS).
## - nothing under a node with the `sfx_manual` meta (the table's board makes its own sounds), and nothing for a disabled control.
## A handler that plays its own sound for the same press wins: it calls `claim()` first and the generic sound is skipped.

const HOVER_GAP_MS: int = 70
const TICK_GAP_MS: int = 45
const TYPE_GAP_MS: int = 35

const CANCEL_WORDS: Array[String] = ["cancel", "back", "close", "clear", "dismiss", "skip"]

var _last: Dictionary = {} # sound id -> ticks ms
var _claimed_frame: int = -1


func _ready() -> void:
	get_tree().node_added.connect(_hook)


## A handler is making its own sound for this press: the generic one is not played this frame.
func claim() -> void:
	_claimed_frame = Engine.get_process_frames()


## The screen changed (Nav).
func navigate() -> void:
	Sound.cue("ui.navigate")


func _hook(node: Node) -> void:
	if not node is Control:
		return
	if node is BaseButton:
		var b := node as BaseButton
		if b is OptionButton:
			(b as OptionButton).item_selected.connect(func(_i: int) -> void: _play(b, "ui.select"))
		elif b.toggle_mode:
			b.toggled.connect(func(on: bool) -> void: _play(b, "ui.toggleOn" if on else "ui.toggleOff"))
		else:
			b.pressed.connect(func() -> void: _on_pressed(b))
		b.mouse_entered.connect(func() -> void: _hover(b))
	elif node is Range and (node is Slider or node is SpinBox):
		var r := node as Range
		r.value_changed.connect(func(_v: float) -> void: _limited(r, "ui.tick", TICK_GAP_MS))
	elif node is LineEdit:
		var e := node as LineEdit
		e.gui_input.connect(func(ev: InputEvent) -> void: _typed(e, ev))
	elif node is TextEdit:
		var t := node as TextEdit
		t.gui_input.connect(func(ev: InputEvent) -> void: _typed(t, ev))


func _on_pressed(b: BaseButton) -> void:
	# A handler connected to the same press may claim it; wait for the end of the frame's work to see.
	await get_tree().process_frame
	if not is_instance_valid(b) or _claimed_frame >= Engine.get_process_frames() - 1:
		return
	var id := String(b.get_meta(&"sfx", ""))
	if id == "":
		id = _sound_for(b)
	_play(b, id)


func _sound_for(b: BaseButton) -> String:
	var variation := String(b.theme_type_variation)
	if variation == "PromptPrimary" or variation == "Primary" or bool(b.get_meta(&"primary", false)):
		return "ui.confirm"
	if b is Button:
		var words := (b as Button).text.strip_edges().to_lower()
		for w: String in CANCEL_WORDS:
			if words == w or words.begins_with(w + " "):
				return "ui.cancel"
	return "ui.click"


func _hover(b: BaseButton) -> void:
	if b.disabled:
		return
	_limited(b, "ui.hover", HOVER_GAP_MS)


func _typed(c: Control, ev: InputEvent) -> void:
	var k := ev as InputEventKey
	if k == null or not k.pressed or k.echo and k.keycode != KEY_BACKSPACE:
		return
	if k.ctrl_pressed or k.alt_pressed or k.meta_pressed:
		return
	if k.unicode > 31 or k.keycode == KEY_BACKSPACE or k.keycode == KEY_DELETE:
		_limited(c, "ui.type", TYPE_GAP_MS)


func _limited(c: Control, id: String, gap_ms: int) -> void:
	var now := Time.get_ticks_msec()
	if now - int(_last.get(id, -100000)) < gap_ms:
		return
	if _play(c, id):
		_last[id] = now


func _play(c: Control, id: String) -> bool:
	if id == "none" or not is_instance_valid(c) or _silenced(c):
		return false
	Sound.cue(id)
	return true


func _silenced(c: Control) -> bool:
	if c is BaseButton and (c as BaseButton).disabled:
		return true
	var n: Node = c
	while n != null:
		if n.has_meta(&"sfx_manual"):
			return true
		n = n.get_parent()
	return false

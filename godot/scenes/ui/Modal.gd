class_name Modal
extends Control
## A modal panel over the screen (the deck screens' modal, decks.css .deck-modal): the screen dimmed behind, the panel rising
## into place (deck-pop: 10 px and 98 % to rest in 160 ms), ui.open when it appears. Escape or a click on the dimmed screen closes
## it with ui.close; `close()` closes it without a sound. Its content goes in `body`.

signal closed()

const NARROW: float = 460.0
const WIDE: float = 760.0

var body: VBoxContainer = null
var _panel: PanelContainer = null
var _t: float = 0.0
var _closing: bool = false


## A modal over `screen`, `wide` for the export and import panels. `label` is its title, shown as a heading when not "".
static func open(screen: Control, label: String, wide: bool = false) -> Modal:
	var m := Modal.new()
	m.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	m.mouse_filter = Control.MOUSE_FILTER_STOP
	screen.add_child(m)
	var dim := ColorRect.new()
	dim.color = Color(0.008, 0.02, 0.047, 0.8)
	dim.set_anchors_and_offsets_preset(Control.PRESET_FULL_RECT)
	dim.gui_input.connect(func(e: InputEvent) -> void:
		var mb := e as InputEventMouseButton
		if mb != null and mb.pressed and mb.button_index == MOUSE_BUTTON_LEFT:
			m.dismiss())
	m.add_child(dim)
	m._panel = Hud.panel(24)
	m._panel.custom_minimum_size = Vector2(minf(WIDE if wide else NARROW, screen.size.x - 40.0), 0)
	m.add_child(m._panel)
	m.body = VBoxContainer.new()
	m.body.add_theme_constant_override("separation", 12)
	m._panel.add_child(m.body)
	if label != "":
		var title := Label.new()
		title.text = label
		title.add_theme_font_override("font", Hud.bold_font())
		title.add_theme_font_size_override("font_size", 20)
		title.autowrap_mode = TextServer.AUTOWRAP_WORD_SMART
		m.body.add_child(title)
	Sound.cue("ui.open")
	return m


func _process(delta: float) -> void:
	if _panel == null:
		return
	if _t < 1.0:
		_t = 1.0 if Settings.reduced_motion else minf(1.0, _t + delta / 0.16)
	var k := 1.0 - pow(1.0 - _t, 2.0)
	# Centred, as tall as its content, rising the last 10 px into place.
	_panel.size = Vector2(_panel.custom_minimum_size.x, minf(_panel.get_combined_minimum_size().y, size.y - 40.0))
	_panel.position = ((size - _panel.size) / 2.0).floor() + Vector2(0, 10.0 * (1.0 - k))
	_panel.pivot_offset = _panel.size / 2.0
	_panel.scale = Vector2.ONE * lerpf(0.98, 1.0, k)


func _unhandled_input(event: InputEvent) -> void:
	if event.is_action_pressed("ui_cancel"):
		get_viewport().set_input_as_handled()
		dismiss()


## Closed by the player (Escape, the dimmed screen, Cancel): ui.close.
func dismiss() -> void:
	if _closing:
		return
	Sound.cue("ui.close")
	close()


func close() -> void:
	if _closing:
		return
	_closing = true
	closed.emit()
	queue_free()


## A Cancel or Close button for the modal's actions: it dismisses (ui.close), not the generic cancel sound.
func cancel_button(label: String = "Cancel") -> Button:
	var b := Button.new()
	b.text = label
	b.flat = true
	b.set_meta(&"sfx", "none")
	b.add_theme_color_override("font_color", NeonTheme.colors()[0])
	b.pressed.connect(dismiss)
	return b

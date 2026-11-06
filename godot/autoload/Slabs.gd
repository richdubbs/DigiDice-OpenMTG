extends Node
## Every button as a physical neon slab, as the browser's (packages/client/src/theme/styles.css `button`): the face sits a few
## pixels above its side; pointing at it lifts it a pixel, lights its rim and makes it glow; a press sinks it onto its side with a
## light burst from the middle of the face, so every click is felt. Disabled, it stays a slab but dimmed, with no lift or glow.
## Kinds (`slab` meta, else from the theme type): "plain"; "primary" (`.button-primary`: the neon face with dark text; the theme
## type Primary or PromptPrimary); "danger" (`.button-danger`, magenta); "none" leaves the button as it is. A button with its own
## styles (flat, or a stylebox override) is left alone unless it has the meta. Extras by meta: `slab_depth` (px, default 4),
## `slab_glint` (Home's PLAY: a glint sweeping across it every 6 s), `slab_pulse` (Home's PLAY: its glow breathes while pointed
## at), `slab_breathe` (the prompt's main button: a light over its face breathes while it can be pressed; PromptPrimary has it).
## The slab is drawn by shaders/slab.gdshader on a child behind the button's text.

const SHADER: Shader = preload("res://shaders/slab.gdshader")
const PAD: float = 44.0
const MARGIN_X: float = 14.0
const MARGIN_Y: float = 6.0

const PLAIN: Dictionary = {
	"top": Color("#2a4d82"), "mid": Color("#173260"), "bottom": Color("#0f2347"),
	"top_hover": Color("#33609f"), "mid_hover": Color("#1c3b72"), "bottom_hover": Color("#132a55"),
	"side": Color("#0a4a86"), "rim": Color(0.373, 0.804, 1.0, 0.7), "light": Color(0.745, 0.91, 1.0, 0.34), "glow_a": 0.5,
	"text": Color("#e8e8f0"),
}
const DANGER: Dictionary = {
	"top": Color("#3a0d3f"), "mid": Color("#240829"), "bottom": Color("#1a061e"),
	"top_hover": Color("#4e1155"), "mid_hover": Color("#300a36"), "bottom_hover": Color("#22072a"),
	"side": Color("#3d003f"), "rim_a": 0.7, "light": Color(1.0, 0.745, 1.0, 0.3), "glow_a": 0.6, "text": Color("#f2e8f4"),
}
const DISABLED: Dictionary = {
	"top": Color("#243756"), "mid": Color("#172640"), "bottom": Color("#111d34"), "side": Color("#0b1b31"),
	"rim": Color(0.47, 0.627, 0.804, 0.38), "light": Color(0.745, 0.863, 1.0, 0.16), "text": Color(0.84, 0.88, 0.94, 0.55),
}
const DISABLED_PRIMARY: Dictionary = {
	"top": Color("#5f8ca6"), "mid": Color("#3d6a87"), "bottom": Color("#2d546d"), "side": Color("#163b52"),
	"rim": Color(0.627, 0.804, 0.894, 0.6), "light": Color(0.863, 0.941, 1.0, 0.38), "text": Color(0.894, 0.949, 0.988, 0.82),
}


func _ready() -> void:
	get_tree().node_added.connect(_hook)


func _hook(node: Node) -> void:
	if not node is Button or node is OptionButton or node is CheckBox or node is CheckButton or node is ColorPickerButton \
			or node is MenuButton:
		return
	var b := node as Button
	var kind := String(b.get_meta(&"slab", ""))
	if kind == "":
		if b.flat or b.has_theme_stylebox_override("normal"):
			return
		var variation := String(b.theme_type_variation)
		kind = "primary" if variation == "Primary" or variation == "PromptPrimary" else "plain"
		if variation == "PromptPrimary" and not b.has_meta(&"slab_breathe"):
			b.set_meta(&"slab_breathe", true)
	if kind == "none":
		return
	if not b.has_meta(&"slab"):
		b.set_meta(&"slab", kind)
	var face := SlabFace.new()
	face.button = b
	face.kind = kind
	b.add_child.call_deferred(face, false, Node.INTERNAL_MODE_FRONT)


## The slab of one button: a child drawn behind it, following its state each frame.
class SlabFace:
	extends Control

	var button: Button = null
	var kind: String = "plain"
	var _mat: ShaderMaterial = null
	var _depth: float = 4.0
	var _lift: float = 0.0
	var _glow: float = 0.0
	var _flash: float = 0.0
	var _was_down: bool = false
	var _clock: float = 0.0
	var _state: String = ""

	func _ready() -> void:
		# The button's own script may have chosen its kind after it entered the tree (its _ready runs after node_added).
		kind = String(button.get_meta(&"slab", kind))
		if kind == "none":
			queue_free()
			return
		show_behind_parent = true
		mouse_filter = Control.MOUSE_FILTER_IGNORE
		_depth = float(button.get_meta(&"slab_depth", 4.0))
		_mat = ShaderMaterial.new()
		_mat.shader = Slabs.SHADER
		material = _mat
		for state: String in ["normal", "hover", "pressed", "hover_pressed", "disabled", "focus"]:
			var s := StyleBoxEmpty.new()
			s.content_margin_left = Slabs.MARGIN_X
			s.content_margin_right = Slabs.MARGIN_X
			var shift := -1.0 if state == "hover" else (_depth if state.contains("pressed") else 0.0)
			s.content_margin_top = Slabs.MARGIN_Y + shift
			s.content_margin_bottom = Slabs.MARGIN_Y - shift
			if state != "focus":
				button.add_theme_stylebox_override(state, s)
		button.resized.connect(_fit)
		button.button_down.connect(func() -> void: _flash = 1.0)
		_fit()
		_apply_colors(true)

	func _draw() -> void:
		# The shader paints the slab over this whole quad.
		draw_rect(Rect2(Vector2.ZERO, size), Color.WHITE)

	func _fit() -> void:
		position = -Vector2(Slabs.PAD, Slabs.PAD)
		size = button.size + Vector2(Slabs.PAD * 2.0, Slabs.PAD * 2.0 + _depth)
		_mat.set_shader_parameter("quad_size", size)
		_mat.set_shader_parameter("pad", Vector2(Slabs.PAD, Slabs.PAD))
		_mat.set_shader_parameter("face_size", button.size)
		_mat.set_shader_parameter("depth", _depth)
		_mat.set_shader_parameter("radius", minf(10.0, button.size.y * 0.3))

	func _process(delta: float) -> void:
		if button == null or not button.is_visible_in_tree():
			return
		_clock += delta
		var disabled := button.disabled
		var down := button.is_pressed() and not disabled
		var hover := button.is_hovered() and not disabled
		var state := "disabled" if disabled else ("down" if down else ("hover" if hover else "normal"))
		if state != _state:
			_state = state
			_apply_colors(false)
		# Hover lifts the face a pixel (70 ms); a press sinks it onto its side (25 ms).
		var lift_to := -_depth if down else (1.0 if hover else 0.0)
		_lift = move_toward(_lift, lift_to, delta * (_depth / 0.025 if down or _lift < 0.0 else 1.0 / 0.07))
		var glow_to := 0.0
		if not disabled:
			if down:
				glow_to = 24.0
			elif hover:
				glow_to = 18.0
				if button.get_meta(&"slab_pulse", false):
					glow_to = 22.0 + 18.0 * (0.5 - 0.5 * cos(_clock * TAU / 1.4))
		_glow = move_toward(_glow, glow_to, delta * 400.0)
		# The press light fades over 260 ms.
		if _flash > 0.0 and not down:
			_flash = maxf(0.0, _flash - delta / 0.26)
		_mat.set_shader_parameter("lift", _lift)
		_mat.set_shader_parameter("glow_size", _glow)
		_mat.set_shader_parameter("flash", _flash if not disabled else 0.0)
		if button.get_meta(&"slab_glint", false) and not disabled:
			# 6 s apart, 1.5 s after it appears; the sweep is the first 22 % of each cycle.
			var t := fposmod(_clock - 1.5, 6.0) / 6.0 if _clock >= 1.5 else 1.0
			_mat.set_shader_parameter("glint", ease_in_out(t / 0.22) if t < 0.22 else -1.0)
		if button.get_meta(&"slab_breathe", false):
			_mat.set_shader_parameter("breathe", 0.0 if disabled else 0.5 - 0.5 * cos(_clock * TAU / 2.6))

	static func ease_in_out(t: float) -> float:
		return t * t * (3.0 - 2.0 * t)

	func _apply_colors(first: bool) -> void:
		var neon := NeonTheme.colors()[0]
		var neon2 := NeonTheme.colors()[1]
		var hover := _state == "hover" or _state == "down"
		var p: Dictionary = {}
		if _state == "disabled":
			p = Slabs.DISABLED_PRIMARY if kind == "primary" else Slabs.DISABLED
			_mat.set_shader_parameter("glow", Color(0, 0, 0, 0))
		elif kind == "primary":
			p = {
				"top": (neon.lightened(0.62) if hover else neon.lightened(0.45)),
				"mid": (neon.lightened(0.15) if hover else neon),
				"bottom": (neon.darkened(0.05) if hover else neon.darkened(0.12)),
				"side": neon.darkened(0.62), "rim": neon.lightened(0.7), "light": Color(1, 1, 1, 0.55), "text": Color("#00121f"),
			}
			_mat.set_shader_parameter("glow", Color(neon, 0.85))
		else:
			var base: Dictionary = Slabs.DANGER if kind == "danger" else Slabs.PLAIN
			p = {
				"top": base["top_hover"] if hover else base["top"], "mid": base["mid_hover"] if hover else base["mid"],
				"bottom": base["bottom_hover"] if hover else base["bottom"], "side": base["side"], "light": base["light"],
				"text": base["text"],
			}
			var accent := neon2 if kind == "danger" else neon
			p["rim"] = accent if hover else (Color(neon2, float(base.get("rim_a", 0.7))) if kind == "danger" else base["rim"])
			_mat.set_shader_parameter("glow", Color(accent, float(base["glow_a"])))
		_mat.set_shader_parameter("face_top", p["top"])
		_mat.set_shader_parameter("face_mid", p["mid"])
		_mat.set_shader_parameter("face_bottom", p["bottom"])
		_mat.set_shader_parameter("side", p["side"])
		_mat.set_shader_parameter("rim", p["rim"])
		_mat.set_shader_parameter("top_light", p["light"])
		_mat.set_shader_parameter("flash_tint", neon)
		if first or not button.has_meta(&"slab_own_text"):
			var text: Color = p["text"]
			for c: String in ["font_color", "font_hover_color", "font_pressed_color", "font_focus_color", "font_hover_pressed_color"]:
				button.add_theme_color_override(c, text if _state == "disabled" else (text if kind != "plain" else Color.WHITE if hover else text))
			button.add_theme_color_override("font_disabled_color", Slabs.DISABLED_PRIMARY["text"] if kind == "primary" else Slabs.DISABLED["text"])

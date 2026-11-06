class_name Backdrop
extends CanvasLayer
## The Neon Grid floor and horizon behind every screen (shaders/neon_grid.gdshader), in the theme's two colours. A CanvasLayer
## below everything else, so it never moves with the table's camera and never takes a click.

## How fast the floor drifts toward the viewer, in cells a second.
const SCROLL_SPEED: float = 0.35

@onready var _grid: ColorRect = $Grid


## The floor's drift now, in cells (shaders/neon_grid.gdshader `scroll`), from the app's own clock: the same on every screen.
static func scroll_now() -> float:
	return Time.get_ticks_msec() / 1000.0 * SCROLL_SPEED


## The look's "Neon grid floor and horizon behind every screen" off: only the dark room stays.
var _still_at: float = -1.0


func _process(_delta: float) -> void:
	var mat := _grid.material as ShaderMaterial
	if mat == null:
		return
	mat.set_shader_parameter("strength", 0.8 if Settings.look_scene else 0.0)
	# "Moving backgrounds" off (or reduced motion): the floor stops where it is.
	if Settings.backgrounds_move():
		_still_at = -1.0
		mat.set_shader_parameter("scroll", scroll_now())
	elif _still_at < 0.0:
		_still_at = scroll_now()
		mat.set_shader_parameter("scroll", _still_at)


func _ready() -> void:
	Settings.colors_changed.connect(_on_colors_changed)
	get_viewport().size_changed.connect(_on_resized)
	_on_colors_changed(Settings.neon, Settings.neon2)
	_on_resized()


func _on_colors_changed(neon: Color, neon2: Color) -> void:
	var mat := _grid.material as ShaderMaterial
	if mat == null:
		return
	mat.set_shader_parameter("neon", neon)
	mat.set_shader_parameter("neon2", neon2)


func _on_resized() -> void:
	var mat := _grid.material as ShaderMaterial
	var area := get_viewport().get_visible_rect().size
	if mat != null and area.y > 0.0:
		mat.set_shader_parameter("aspect", area.x / area.y)

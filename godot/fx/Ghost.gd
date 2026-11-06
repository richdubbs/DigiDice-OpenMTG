class_name Ghost
extends Node2D
## A flying copy of a card: what the animator moves while the real card waits hidden. Its origin is the
## card's centre. The card is drawn once into a SubViewport (Card.tscn at RENDER_SCALE, so a ghost held up large stays sharp) and shown
## as a sprite, a flattened texture of exactly what the card shows: its own frame, or the player's or Scryfall's picture (the copy asks
## Pictures for the same picture, which is in memory already).
##
## The animator tweens only position, rotation, scale and modulate, of the ghost and of its children: `shadow` and the glows
## (`glow(key, color)`, additive sprites behind the picture) fade by their modulate alpha. `shatter()` cuts the flattened texture into
## six pieces (Polygon2D) that the animator throws apart; a Scryfall picture is never cut (the animator lets it fall whole instead).

const CARD_SCENE: PackedScene = preload("res://scenes/Card.tscn")
## The card is rendered at this scale into the viewport (a ghost may be shown up to 1.8 times a hand card).
const RENDER_SCALE: float = 2.0

## The object shown and where its picture came from (CardView.picture_kind: "player", "scryfall" or "").
var object_id: String = ""
var picture_kind: String = ""
## The on-screen size of the card at scale 1 (the card's size on the table when the ghost was made).
var base_size: Vector2 = CardView.SIZE

var _glows: Dictionary = {}
var _card: CardView = null

@onready var _shadow: Sprite2D = $Shadow
@onready var _glow_template: Sprite2D = $GlowTemplate
@onready var _picture: Sprite2D = $Picture
@onready var _viewport: SubViewport = $Viewport


func _ready() -> void:
	_viewport.size = Vector2i(roundi(CardView.SIZE.x * RENDER_SCALE), roundi(CardView.SIZE.y * RENDER_SCALE))
	_picture.texture = _viewport.get_texture()


## Show the object `id` of `view` at `card_scale` (the size it has on the table: the ghost's scale 1 is that size).
func show_object(view: Dictionary, id: String, card_scale: float) -> void:
	object_id = id
	_card = CARD_SCENE.instantiate()
	_viewport.add_child(_card)
	_card.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_card.show_object(view, id)
	_card.set_card_scale(RENDER_SCALE)
	_card.rotation = 0.0
	_card.position = CardView.SIZE * RENDER_SCALE * 0.5 - _card.pivot_offset
	picture_kind = _card.picture_kind
	base_size = CardView.SIZE * card_scale
	_picture.scale = Vector2.ONE * (card_scale / RENDER_SCALE)
	_shadow.scale = Vector2(base_size.x / 64.0 * 1.25, base_size.y / 64.0 * 1.2)
	_glow_template.scale = Vector2(base_size.x / 128.0 * 1.35, base_size.y / 160.0 * 1.35)
	_viewport.render_target_update_mode = SubViewport.UPDATE_ALWAYS


## Show a view object that is gone from the view's objects (a spell that came and went: last known information) as it was.
func show_known(view: Dictionary, obj: Dictionary, card_scale: float) -> void:
	var v := view.duplicate()
	var objects := Val.dict(view, "objects").duplicate()
	objects[Val.text(obj, "id")] = obj
	v["objects"] = objects
	show_object(v, Val.text(obj, "id"), card_scale)


## The shadow under the ghost (its modulate alpha is tweened: 0 at rest on the table, about 0.6 lifted).
func shadow() -> Sprite2D:
	return _shadow


## A glow behind the picture, made on first use: an additive sprite whose modulate alpha the animator tweens (0 = out).
func glow(key: String, color: Color) -> Sprite2D:
	if _glows.has(key) and is_instance_valid(_glows[key]):
		return _glows[key]
	var g := _glow_template.duplicate() as Sprite2D
	g.visible = true
	g.modulate = Color(color, 0.0)
	add_child(g)
	move_child(g, _shadow.get_index() + 1)
	_glows[key] = g
	return g


## Cut the picture into six pieces (a 2 x 3 grid with jittered inner corners), hide the whole picture, and return the pieces: each a
## Polygon2D around its own centre (its position), drawn with the flattened texture.
func shatter(seed_value: int) -> Array[Polygon2D]:
	var rng := RandomNumberGenerator.new()
	rng.seed = seed_value
	var tex_size := Vector2(_viewport.size)
	var cols: int = 2
	var rows: int = 3
	# Grid points in texture pixels; inner ones jittered so the cracks are not straight.
	var points: Array[PackedVector2Array] = []
	for r: int in range(rows + 1):
		var line := PackedVector2Array()
		for c: int in range(cols + 1):
			var p := Vector2(tex_size.x * c / cols, tex_size.y * r / rows)
			if c > 0 and c < cols:
				p.x += rng.randf_range(-0.12, 0.12) * tex_size.x
			if r > 0 and r < rows:
				p.y += rng.randf_range(-0.08, 0.08) * tex_size.y
			line.append(p)
		points.append(line)
	var pieces: Array[Polygon2D] = []
	var to_local_scale := _picture.scale
	for r: int in range(rows):
		for c: int in range(cols):
			var uv := PackedVector2Array([points[r][c], points[r][c + 1], points[r + 1][c + 1], points[r + 1][c]])
			var centre := (uv[0] + uv[1] + uv[2] + uv[3]) / 4.0
			var poly := PackedVector2Array()
			for q: Vector2 in uv:
				poly.append((q - centre) * to_local_scale)
			var piece := Polygon2D.new()
			piece.texture = _picture.texture
			piece.polygon = poly
			piece.uv = uv
			piece.position = (centre - tex_size * 0.5) * to_local_scale
			add_child(piece)
			pieces.append(piece)
	_picture.visible = false
	for g: Variant in _glows.values():
		if is_instance_valid(g):
			(g as Sprite2D).visible = false
	_shadow.visible = false
	return pieces

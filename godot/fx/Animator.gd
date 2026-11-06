class_name Animator
extends Node
## The board's animator: plays one change's plan (model/Plan.gd) on the live Table, as the TypeScript source's
## packages/client/src/board/fx/Animator.ts does in the browser (MTG Arena style).
##
## Part A, on the board as it was: spells cast and finished inside the change fly from the hand to the stack; resolving spells and
## abilities flare and send their effect at their targets (fire, lightning, arcane light, shadow, leaves, radiance: fx/Vfx/*.tscn);
## in combat every creature that deals damage rises off the table and swings into what it hits (CR 510.2: all at once), with a
## hit-stop, a recoil of the target and a Camera2D shake scaled by the damage (fx/Shake.gd). Permanents destroyed, sacrificed or
## exiled play their exit where they stand. Then the new view is shown (the Table's commit) and one frame is drawn. Part B: cards that
## left play their exit from where they were (destroyed cards shatter into six pieces of a flattened copy, or fade and shrink when
## three or more break at once; a Scryfall picture is never cut: it tumbles away whole; exiled ones vanish into light; returned ones
## fly to the hand; finished spells to the graveyard), cards that arrived fly in from where they came (cast to the stack, played or
## resolved onto the table with a landing, drawn from the library, the viewer's own draws held up to be read), the rest slide from
## their old places to their new ones (FLIP), life totals pop, and a banner marks a new turn.
##
## Only position, rotation, scale and modulate are tweened, of cards, ghosts (fx/Ghost.tscn), labels
## and the camera (position, rotation, zoom: its scale); glows are child sprites whose modulate alpha is tweened. Durations are
## times the player's speed (Settings.speed_factor) times the stack's pace (Plan.stack_pace), never under 0.2 of normal.
##
## Sound (fx/sounds.gd names them, Sound.gd plays them): each beat makes its sound at the place it happens; what the change did
## without a visual (taps, shuffles, a lock-on ...) sounds as the new view is shown. Nothing more sounds once a change is cut short.
##
## `finish()` cancels everything at once: running tweens are run to their end, waits end, ghosts, numbers and banners go, hidden
## cards show again, the camera is back at rest; a `play` in progress returns soon after without committing (the Table then shows the
## change itself).
##
## Deviations from Animator.ts: the browser's canvas effects (vfx.ts) are GPUParticles2D bursts and trails; the commander damage line
## has no pop (the Side shows it as text); a transient spell or ability stands on the stack as a ghost card, not drawn by the stack
## panel itself; the arena flash is a full-screen ColorRect whose modulate alpha is tweened.

const GHOST_SCENE: PackedScene = preload("res://fx/Ghost.tscn")
const VFX: Dictionary = {
	"fire": preload("res://fx/Vfx/Fire.tscn"),
	"lightning": preload("res://fx/Vfx/Lightning.tscn"),
	"arcane": preload("res://fx/Vfx/Arcane.tscn"),
	"shadow": preload("res://fx/Vfx/Shadow.tscn"),
	"nature": preload("res://fx/Vfx/Leaves.tscn"),
	"radiant": preload("res://fx/Vfx/Radiance.tscn"),
	"force": preload("res://fx/Vfx/Impact.tscn"),
	"physical": preload("res://fx/Vfx/Impact.tscn"),
	"dust": preload("res://fx/Vfx/Dust.tscn"),
}
const MANA_STYLES: Dictionary = {"W": "radiant", "U": "arcane", "B": "shadow", "R": "fire", "G": "nature", "C": "force"}

## Pixels a card must have moved to slide to its new place.
const MOVED_PX: float = 3.0
## How long a spell or ability that came and went inside one change stands on the stack: the player's own a beat, another's
## long enough to read it and see what it targets (ms, before the speed setting).
const OWN_DWELL_MS: float = 450.0
const THEIR_DWELL_MS: float = 1300.0
## A card the viewer draws is shown large on its way to the hand; the next one this much later; more than three are just dealt.
const SHOWN_DRAW_MS: float = 1500.0
const SHOWN_DRAW_GAP_MS: float = 520.0
const MAX_SHOWN_DRAWS: int = 3
## The longest part B may take before the change goes on anyway (ms, at normal speed).
const PART_B_CAP_MS: float = 2600.0

const TARGET_GLOW: Color = Color(1.0, 0.36, 0.36, 0.95)
const TRIGGER_GLOW: Color = Color(1.0, 0.84, 0.43, 0.95)
const ACTIVATE_GLOW: Color = Color(0.12, 0.72, 1.0, 0.95)
const HIT_GLOW: Color = Color(1.0, 0.35, 0.24, 0.95)
const GOOD_GLOW: Color = Color(0.51, 0.94, 0.47, 0.9)
const BAD_GLOW: Color = Color(0.94, 0.31, 0.47, 0.9)
const RIM_GLOW: Color = Color(1.0, 0.6, 0.3, 0.95)
const BANISH_GLOW: Color = Color(0.92, 0.94, 1.0, 0.95)
const CONSUME_GLOW: Color = Color(0.6, 0.25, 0.85, 0.9)


## Jobs running side by side (the browser's Promise.all): each job calls `end()` once; `done` fires when all ended or `fire()`.
class Jobs:
	extends RefCounted
	signal done()
	var left: int = 0
	var fired: bool = false

	func start() -> void:
		left += 1

	func end() -> void:
		left -= 1
		if left <= 0:
			fire()

	func fire() -> void:
		if not fired:
			fired = true
			done.emit()


## Emitted every frame (and by finish()): every wait of this animator waits on it, so when the Table closes and frees the animator,
## its waits simply never resume (a wait on a SceneTree timer would resume on a freed instance).
signal _tick()

var _table: TableScreen = null
var _gen: int = 0
var _k: float = 1.0
var _base: float = 1.0
var _tweens: Array[Tween] = []
## CanvasItem -> its modulate alpha before it was hidden.
var _hidden: Dictionary = {}
## Ghosts, numbers, banners, particles and flashes made for this change (freed by finish()). Node lists are untyped: an entry may
## have been freed with its parent (a flash on a card the new view removed), and a typed read of a freed object is an error.
var _made: Array = []
## Spells and abilities that came and went inside this change: stack id -> {ghost, center, size}.
var _transient: Dictionary = {}
## The resolving spell's ghost while it lets its effect go (it flares as the effect leaves it).
var _launcher: Ghost = null
var _staged_backs: Array = []
## Rest transforms of board nodes touched in this half of a change: node -> {position, rotation, scale} (pops and recoils of the same
## node at once all return to the same rest).
var _rest: Dictionary = {}
var _viewer: String = ""
var _from: Dictionary = {}
var _to: Dictionary = {}
var _camera_rest: Vector2 = Vector2.ZERO
var _shake_tween: Tween = null
var _glow_tex: Texture2D = null
var _add_material: CanvasItemMaterial = null
## True while a change is being played.
var playing: bool = false


## The Table this animator plays on (its sides, stack, effect layers, camera).
func setup(table: TableScreen) -> void:
	_table = table
	_camera_rest = _table.camera().position


# ---- plumbing -----------------------------------------------------------------------------------------------------------------

## Seconds for `ms` milliseconds of animation at the current pace.
func _s(ms: float) -> float:
	return maxf(0.0, ms) * _k / 1000.0


## Stack acceleration (Plan.stack_pace): the time scale for what is played next, from the player's speed and the stack's size.
func _pace(stack_size: int) -> void:
	_k = maxf(0.2, _base * Plan.stack_pace(stack_size))


func _process(_delta: float) -> void:
	_tick.emit()


func _now() -> float:
	return Time.get_ticks_msec() / 1000.0


## Wait `ms` of animation time (at the current pace); ends at once when the change is cut short.
func _sleep(ms: float) -> void:
	var gen := _gen
	var until := _now() + _s(ms)
	while _now() < until and gen == _gen:
		await _tick


## A new tween of this change (finish() runs it to its end). Sequential by default; at least one tweener must be added at once.
func _tween() -> Tween:
	var tw := create_tween()
	_tweens.append(tw)
	tw.finished.connect(func() -> void: _tweens.erase(tw))
	return tw


func _await_tween(tw: Tween) -> void:
	if tw != null and tw.is_valid() and tw.is_running():
		await tw.finished


## Wait for the jobs, but never longer than `limit_ms` (at the current pace): a slow part never holds the change.
func _wait(jobs: Jobs, limit_ms: float) -> void:
	var gen := _gen
	var until := _now() + _s(limit_ms)
	while jobs.left > 0 and not jobs.fired and _now() < until and gen == _gen:
		await _tick
	jobs.fire()


func _hide(item: Variant) -> void:
	if not is_instance_valid(item) or not (item is CanvasItem) or _hidden.has(item):
		return
	var c := item as CanvasItem
	_hidden[c] = c.modulate.a
	c.modulate.a = 0.0


func _show(item: Variant) -> void:
	if not _hidden.has(item):
		return
	if is_instance_valid(item):
		(item as CanvasItem).modulate.a = float(_hidden[item])
	_hidden.erase(item)


func _show_all() -> void:
	for item: Variant in _hidden.keys():
		if is_instance_valid(item):
			(item as CanvasItem).modulate.a = float(_hidden[item])
	_hidden.clear()


func _drop(n: Variant) -> void:
	if is_instance_valid(n) and n is Node:
		(n as Node).queue_free()
	_made.erase(n)


## The rest transform of a board node in this half of the change (taken the first time it is touched).
func _rest_of(node: CanvasItem) -> Dictionary:
	if not _rest.has(node):
		_rest[node] = {"position": node.get("position"), "rotation": node.get("rotation"), "scale": node.get("scale")}
	return _rest[node]


## A sound at a beat: `delay_ms` animation ms from now (scaled like the animation), at `at`. A sound whose accent comes after its start
## (SoundCues.ACCENTS) is lined up with the animation's beat (`beat`, seconds at normal speed; by default the accent itself).
func _sound(id: String, at: Variant = null, delay_ms: float = 0.0, gain: float = 1.0, beat: float = -1.0) -> void:
	if id == "":
		return
	var delay := _s(delay_ms)
	var offset := 0.0
	var accent := Sound.accent_of(id)
	if accent >= 0.0 and (_k != 1.0 or beat >= 0.0):
		var a := SoundCues.align_accent(accent, beat if beat >= 0.0 else accent, _k)
		offset = float(a["offset"])
		delay += float(a["delay"])
	if delay > 0.0:
		_sound_later(_gen, delay, id, at, gain, offset)
	else:
		Sound.cue(id, at, gain, 0.0, offset)


func _sound_later(gen: int, delay_s: float, id: String, at: Variant, gain: float, offset: float) -> void:
	var until := _now() + delay_s
	while _now() < until and gen == _gen:
		await _tick
	if gen == _gen:
		Sound.cue(id, at, gain, 0.0, offset)


## A soft round glow texture and an additive material (flashes on panels, which have no Glow child of their own).
func _glow_parts() -> void:
	if _glow_tex != null:
		return
	var g := Gradient.new()
	g.offsets = PackedFloat32Array([0.0, 0.55, 1.0])
	g.colors = PackedColorArray([Color(1, 1, 1, 0.9), Color(1, 1, 1, 0.35), Color(1, 1, 1, 0)])
	var t := GradientTexture2D.new()
	t.gradient = g
	t.width = 128
	t.height = 128
	t.fill = GradientTexture2D.FILL_RADIAL
	t.fill_from = Vector2(0.5, 0.5)
	t.fill_to = Vector2(1.0, 0.5)
	_glow_tex = t
	_add_material = CanvasItemMaterial.new()
	_add_material.blend_mode = CanvasItemMaterial.BLEND_MODE_ADD


## Cut everything short and clean up (the screen is skipping ahead, the table closes).
func finish() -> void:
	_gen += 1
	for tw: Tween in _tweens.duplicate():
		if tw.is_valid():
			tw.custom_step(1000.0) # to its end: its `finished` fires, so nothing waits on it forever
	_tweens.clear()
	_show_all()
	for b: Variant in _staged_backs:
		if is_instance_valid(b):
			(b as CanvasItem).modulate.a = 1.0
	_staged_backs.clear()
	for n: Variant in _made.duplicate():
		if is_instance_valid(n):
			(n as Node).queue_free()
	_made.clear()
	_rest.clear()
	_transient.clear()
	_launcher = null
	if _shake_tween != null and _shake_tween.is_valid():
		_shake_tween.kill()
	_shake_tween = null
	if _table != null:
		var cam := _table.camera()
		cam.position = _camera_rest
		cam.rotation = 0.0
		cam.zoom = Vector2.ONE
		_table.flash_rect().modulate.a = 0.0
	playing = false
	# Every wait ends now (they see the change is over and return).
	_tick.emit()


# ---- what is on the board -------------------------------------------------------------------------------------------------------

## The board as drawn now, measured once: cards {id: Entry}, stack {id: Entry}, avatars {player: Box}, piles {"player:zone": Box},
## hands {player: Box}, anchor (Box: where a spell arriving on the stack is drawn). Entry: {id, node, center, size, scale, rotation,
## zone ("battlefield", "hand", "back" for a hidden hand card, "stack" ...), scryfall, view}. Box: {center, size, node?}.
func snapshot(view: Dictionary) -> Dictionary:
	var cards: Dictionary = {}
	var stack: Dictionary = {}
	var avatars: Dictionary = {}
	var piles: Dictionary = {}
	var hands: Dictionary = {}
	var sides := _table.sides()
	for pid: Variant in sides.keys():
		var side: SideView = sides[pid]
		var nodes := side.card_nodes()
		for id: Variant in nodes.keys():
			var c: CardView = nodes[id]
			if is_instance_valid(c) and c.is_inside_tree():
				cards[String(id)] = _entry(view, String(id), c, "")
		var panel := side.avatar_node()
		avatars[String(pid)] = _box(panel.get_global_rect(), panel)
		for z: String in ["library", "graveyard", "exile"]:
			piles["%s:%s" % [pid, z]] = _box(side.pile_rect(z), null)
		hands[String(pid)] = _box(side.hand_rect(), null)
	var sv := _table.stack_view()
	var stack_nodes := sv.card_nodes()
	for id: Variant in stack_nodes.keys():
		var c: CardView = stack_nodes[id]
		if is_instance_valid(c) and c.is_inside_tree():
			stack[String(id)] = _entry(view, String(id), c, "stack")
	return {"cards": cards, "stack": stack, "avatars": avatars, "piles": piles, "hands": hands, "anchor": _box(sv.anchor_rect(), null)}


func _entry(view: Dictionary, id: String, c: CardView, zone_override: String) -> Dictionary:
	var xf := c.get_global_transform()
	var s := absf(xf.get_scale().x)
	var o := View.object(view, id)
	var zone := zone_override if zone_override != "" else Val.text(o, "zone")
	if zone == "hand" and View.is_hidden(o):
		zone = "back"
	return {
		"id": id, "node": c, "center": xf * (c.size * 0.5), "size": CardView.SIZE * s, "scale": s, "rotation": xf.get_rotation(),
		"zone": zone, "scryfall": c.picture_kind == "scryfall", "view": view,
	}


func _box(r: Rect2, node: Control) -> Dictionary:
	return {"center": r.get_center(), "size": r.size, "node": node}


## What a hit or a spell lands on: a card (on the table or the stack) or a player's panel; {} when neither is on screen.
func _target_box(snap: Dictionary, id: String) -> Dictionary:
	var c := Val.dict(Val.dict(snap, "cards"), id)
	if not c.is_empty():
		return c
	c = Val.dict(Val.dict(snap, "stack"), id)
	if not c.is_empty():
		return c
	return Val.dict(Val.dict(snap, "avatars"), id)


func _card(snap: Dictionary, id: Variant) -> Dictionary:
	if not (id is String):
		return {}
	return Val.dict(Val.dict(snap, "cards"), id)


static func _center(box: Dictionary) -> Vector2:
	var c: Variant = box.get("center")
	return c if c is Vector2 else Vector2.ZERO


static func _size(box: Dictionary) -> Vector2:
	var s: Variant = box.get("size")
	return s if s is Vector2 else CardView.SIZE


## A node that still exists and is on screen (checked before anything else: `is` on a freed object is an error).
static func _valid(node: Variant) -> bool:
	return is_instance_valid(node) and node is Node and (node as Node).is_inside_tree()


## The object as it was on the stack, from the views around this change ({} when unknown).
func _last_known(stack_id: String) -> Dictionary:
	for v: Dictionary in [_from, _to]:
		var o := Val.dict(Val.dict(Val.dict(v, "lki"), stack_id), "object")
		if o.is_empty():
			o = View.object(v, stack_id)
		if not o.is_empty():
			return {"object": o, "view": v}
	return {}


# ---- effects: ghosts, particles, glows, numbers, shake ---------------------------------------------------------------------------

func _ghost(e: Dictionary, view: Dictionary = {}) -> Ghost:
	var g: Ghost = GHOST_SCENE.instantiate()
	_table.fx_layer().add_child(g)
	_made.append(g)
	g.show_object(view if not view.is_empty() else Val.dict(e, "view"), Val.text(e, "id"), Val.real(e, "scale", 1.0))
	g.global_position = _center(e)
	g.rotation = Val.real(e, "rotation")
	return g


## A one-shot particle burst: `under` behind the cards (a blow on a card never covers its picture), else above the table.
func _burst(style: String, at: Vector2, size: float, power: float, under: bool) -> void:
	var scene: PackedScene = VFX.get(style, VFX["force"])
	var fx: VfxBurst = scene.instantiate()
	(_table.fx_under() if under else _table.fx_layer()).add_child(fx)
	_made.append(fx)
	fx.burst(at, size, power)


## A spell's effect flying from `from` to `to` (a trail of its particles), `ms` long.
func _projectile(style: String, from: Vector2, to: Vector2, ms: float) -> void:
	var scene: PackedScene = VFX.get(style, VFX["force"])
	var fx: VfxBurst = scene.instantiate()
	_table.fx_layer().add_child(fx)
	_made.append(fx)
	fx.trail(from, 60.0)
	var tw := _tween()
	tw.tween_property(fx, "global_position", to, _s(ms)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	await _await_tween(tw)
	if is_instance_valid(fx):
		fx.stop_trail()


## A glow ring that lights up behind a card, a ghost or a panel and fades (a child sprite: only its modulate alpha changes), and a
## small pop of the thing itself.
func _pulse(target: Variant, color: Color, strength: float = 1.0) -> void:
	if not _valid(target) or not (target is CanvasItem):
		return
	var node := target as CanvasItem
	var flash := _flash(node, color, 520.0, 0.35)
	# A ghost only glows: its own tweens own its scale.
	if flash == null or node is Ghost:
		return
	var base: Vector2 = _rest_of(node)["scale"]
	if node is Control:
		(node as Control).pivot_offset = (node as Control).size * 0.5
	var tw := _tween()
	tw.tween_property(node, "scale", base * (1.0 + 0.09 * strength), _s(147.0)).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(node, "scale", base, _s(273.0)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)


## A glow child behind `node` that fades in to its peak at `peak` (0..1 of `ms`) and out again, then goes.
func _flash(target: Variant, color: Color, ms: float, peak: float) -> Sprite2D:
	if not _valid(target):
		return null
	var node := target as CanvasItem
	var flash: Sprite2D = null
	if node is CardView:
		flash = (node as CardView).add_flash(color, 1.05)
	elif node is Ghost:
		var g := node as Ghost
		flash = g.glow("flash%d" % randi(), color)
	elif node is Control:
		_glow_parts()
		var c := node as Control
		flash = Sprite2D.new()
		flash.texture = _glow_tex
		flash.material = _add_material
		flash.show_behind_parent = true
		flash.position = c.size * 0.5
		flash.scale = c.size / 128.0 * 1.5
		flash.modulate = Color(color, 0.0)
		c.add_child(flash)
	if flash == null:
		return null
	_made.append(flash)
	var tw := _tween()
	tw.tween_property(flash, "modulate:a", color.a, _s(ms * peak))
	tw.tween_property(flash, "modulate:a", 0.0, _s(ms * (1.0 - peak)))
	tw.tween_callback(_drop.bind(flash))
	return flash


## A number floating up from what changed: just above a card (never over its picture), above or below a player's panel.
func _floater(box: Dictionary, text: String, tone: String, amount: int = 1, on_card: bool = false) -> void:
	var label := Label.new()
	label.text = text
	var size := roundi(26.0 + minf(20.0, amount) * 1.3) if on_card else roundi(40.0 + minf(20.0, amount) * 2.0)
	label.add_theme_font_size_override("font_size", size)
	label.add_theme_constant_override("outline_size", 6)
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	var colors := {
		"damage": Color(1.0, 0.36, 0.3), "heal": Color(0.55, 1.0, 0.65), "buff": Color(0.55, 1.0, 0.5), "debuff": Color(1.0, 0.45, 0.6),
		"info": Color(0.9, 0.95, 1.0),
	}
	label.add_theme_color_override("font_color", colors.get(tone, Color.WHITE))
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_table.fx_layer().add_child(label)
	_made.append(label)
	label.reset_size()
	label.pivot_offset = label.size * 0.5
	var c := _center(box)
	var half := _size(box).y * 0.5
	var y := c.y - half - label.size.y * 0.5 - 2.0
	if not on_card and c.y - half < 120.0:
		y = c.y + half + label.size.y * 0.5 + 8.0 # under a panel at the top edge
	var start := Vector2(c.x, y) - label.size * 0.5
	label.position = start + Vector2(0, 6)
	label.scale = Vector2(0.6, 0.6)
	label.modulate.a = 0.0
	var tw := _tween()
	tw.tween_property(label, "position", start + Vector2(0, -10), _s(180.0))
	tw.parallel().tween_property(label, "scale", Vector2(1.15, 1.15), _s(180.0))
	tw.parallel().tween_property(label, "modulate:a", 1.0, _s(180.0))
	tw.tween_property(label, "position", start + Vector2(0, -22), _s(420.0))
	tw.parallel().tween_property(label, "scale", Vector2.ONE, _s(420.0))
	tw.tween_property(label, "position", start + Vector2(0, -40), _s(400.0))
	tw.parallel().tween_property(label, "scale", Vector2(0.95, 0.95), _s(400.0))
	tw.parallel().tween_property(label, "modulate:a", 0.0, _s(400.0))
	tw.tween_callback(_drop.bind(label))


## The table jolts by the damage (Shake.shake_for): the camera's position, rotation and zoom along the decaying keyframes.
func _shake(amount: float) -> void:
	var s := Shake.shake_for(amount)
	if Val.real(s, "amplitude") <= 0.0:
		return
	var cam := _table.camera()
	if _shake_tween != null and _shake_tween.is_valid():
		_shake_tween.kill()
	cam.position = _camera_rest
	cam.rotation = 0.0
	cam.zoom = Vector2.ONE
	var frames := Shake.keyframes(s, roundi(amount * 97.0))
	var duration := _s(Val.real(s, "duration"))
	var tw := create_tween()
	_shake_tween = tw
	var prev := 0.0
	for i: int in range(1, frames.size()):
		var f: Dictionary = frames[i]
		var step := maxf(0.001, (float(f["at"]) - prev) * duration)
		prev = float(f["at"])
		var offset: Vector2 = f["offset"]
		tw.tween_property(cam, "position", _camera_rest + offset, step)
		tw.parallel().tween_property(cam, "rotation", deg_to_rad(float(f["rotation"])), step)
		tw.parallel().tween_property(cam, "zoom", Vector2.ONE * float(f["scale"]), step)
	var level := Shake.level(amount)
	if level > 0.25:
		var flash := _table.flash_rect()
		var ft := _tween()
		ft.tween_property(flash, "modulate:a", 0.25 + level * 0.55, _s((160.0 + 260.0 * level) * 0.12))
		ft.tween_property(flash, "modulate:a", 0.0, _s((160.0 + 260.0 * level) * 0.88))


func _shake_later(gen: int, ms: float, amount: float) -> void:
	await _sleep(ms)
	if gen == _gen:
		_shake(amount)


static func style_glow(style: String) -> Color:
	match style:
		"fire":
			return Color(1.0, 0.55, 0.2, 0.95)
		"lightning":
			return Color(0.67, 0.78, 1.0, 0.95)
		"arcane":
			return Color(0.35, 0.75, 1.0, 0.95)
		"shadow":
			return Color(0.75, 0.31, 1.0, 0.95)
		"nature":
			return Color(0.47, 0.9, 0.39, 0.95)
		"radiant":
			return Color(1.0, 0.88, 0.55, 0.95)
		_:
			return Color(0.86, 0.9, 0.96, 0.95)


# ---- the change -----------------------------------------------------------------------------------------------------------------

## Play one change: part A on the board as it is, then `commit` (the Table shows the new view), one frame, then part B. Returns
## when done, or soon after `finish()` (then without committing when it had not yet).
## How many times faster than live the next change plays (a replay's speed; 1 in a game). The time base divides by it, down to the
## same floor.
var pace: float = 1.0


func play(plan: Dictionary, events: Array, from: Dictionary, to: Dictionary, commit: Callable) -> void:
	playing = true
	await _play(plan, events, from, to, commit)
	playing = false


func _play(plan: Dictionary, events: Array, from: Dictionary, to: Dictionary, commit: Callable) -> void:
	_gen += 1
	var gen := _gen
	_base = maxf(0.2, Settings.speed_factor() / maxf(0.01, pace))
	_pace(View.stack(from).size())
	_viewer = View.viewer(to)
	_from = from
	_to = to
	_transient.clear()
	_staged_backs.clear()
	_rest.clear()
	_launcher = null
	# Forget what freed itself since the last change (particles, numbers).
	_made = _made.filter(func(n: Variant) -> bool: return is_instance_valid(n))
	var before := snapshot(from)
	var early: Array = []
	if not Plan.is_empty(plan):
		var steps := Val.list(plan, "a")
		var depths := Plan.stack_depths(steps, View.stack(from).size())
		for i: int in range(steps.size()):
			if gen != _gen:
				return
			_pace(depths[i])
			await _step_a(Val.as_dict(steps[i]), before, plan)
		if gen != _gen:
			return
		await _exits_in_place(plan, before, early)
	if gen != _gen:
		return
	commit.call()
	# The new view placed every card again: rest transforms are measured anew in part B.
	_rest.clear()
	for b: Variant in _staged_backs:
		if is_instance_valid(b):
			(b as CanvasItem).modulate.a = 1.0
	_staged_backs.clear()
	# What the change did without a visual of its own sounds as the new view shows it.
	Sound.play_cues(SoundCues.event_cues(events, from, to, _viewer, plan))
	# A card that played its exit in place but is still on the table (a replacement kept it there) shows again.
	for n: Variant in early:
		_show(n)
	# One frame is drawn with the new view before it is measured.
	await _tick
	if gen != _gen:
		return
	var after := snapshot(to)
	_pace(View.stack(to).size())
	await _part_b(plan, events, before, after, from, to)
	if gen != _gen:
		return
	for t: Variant in _transient.values():
		_drop(Val.as_dict(t).get("ghost"))
	_transient.clear()
	_show_all()
	_rest.clear()


# ---- part A ---------------------------------------------------------------------------------------------------------------------

func _step_a(step: Dictionary, before: Dictionary, plan: Dictionary) -> void:
	match Val.text(step, "kind"):
		"cast":
			await _cast_transient(step, before, plan)
		"ability":
			await _ability_flare(step, before, plan)
		"resolve":
			await _resolve(step, before, plan)
		"combat":
			await _combat(Val.list(step, "hits"), Val.list(step, "life"), before, true)
		"damage":
			await _effects(Val.list(step, "hits"), Val.list(step, "life"), [], Val.text(step, "style"), {}, before, false, [])
		"life":
			await _life_effects(Val.list(step, "life"), before)
		"countered":
			await _countered(Val.text(step, "stackId"), before)
		"counters":
			await _counter_effects(Val.list(step, "counters"), before)


## A spell that came and went inside this change: it flies from where it was cast to the stack and waits there for its resolution.
func _cast_transient(step: Dictionary, before: Dictionary, plan: Dictionary) -> void:
	var gen := _gen
	var style := Val.text(step, "style")
	var stack_id := Val.text(step, "stackId")
	var controller := Val.text(step, "controller")
	var from_e := _card(before, step.get("origin"))
	# Another player's hand card is one of their card backs: the spell itself is stood on the stack instead, face up.
	var origin_e: Dictionary = {} if Val.text(from_e, "zone") == "back" else from_e
	var anchor := Val.dict(before, "anchor")
	_sound(SoundCues.cast_sound(style), _center(from_e if not from_e.is_empty() else anchor))
	if origin_e.is_empty():
		if not from_e.is_empty():
			await _projectile(style, _center(from_e), _center(anchor), 460.0)
			if gen != _gen:
				return
		if _stage_on_stack(stack_id, controller, before, style):
			await _dwell(stack_id, controller, before, plan)
		return
	var g := _ghost(origin_e)
	_hide(origin_e["node"])
	var d := _center(anchor) - _center(origin_e)
	var s := clampf(_size(anchor).x / maxf(1.0, _size(origin_e).x), 0.8, 1.6)
	var start := g.position
	var r0 := g.rotation
	g.shadow().modulate.a = 0.35
	var tw := _tween()
	tw.tween_property(g, "position", start + d * 0.45 + Vector2(0, -60), _s(231.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * s * 1.15, _s(231.0))
	tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(-4.0), _s(231.0))
	tw.parallel().tween_property(g.shadow(), "modulate:a", 0.6, _s(231.0))
	tw.tween_property(g, "position", start + d, _s(189.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * s, _s(189.0))
	tw.parallel().tween_property(g, "rotation", 0.0, _s(189.0))
	await _await_tween(tw)
	if gen != _gen:
		return
	_transient[stack_id] = {"ghost": g, "center": _center(anchor), "size": _size(origin_e) * s}
	_burst(style, _center(anchor), _size(anchor).x, 0.3, false)
	await _dwell(stack_id, controller, before, plan)


## Stand a spell or ability that came and went inside this change on the stack as a ghost card (from what the views last knew of
## it), so it resolves from the stack like any other. Another player's spell from their hand takes a card back out of that hand.
func _stage_on_stack(stack_id: String, controller: String, before: Dictionary, style: String) -> bool:
	var known := _last_known(stack_id)
	if known.is_empty():
		return false
	var obj := Val.dict(known, "object")
	var anchor := Val.dict(before, "anchor")
	var card_scale := _size(anchor).x / CardView.SIZE.x
	var g: Ghost = GHOST_SCENE.instantiate()
	_table.fx_layer().add_child(g)
	_made.append(g)
	g.show_known(Val.dict(known, "view"), obj, card_scale)
	g.global_position = _center(anchor)
	g.scale = Vector2.ONE * 0.6
	var tw := _tween()
	tw.tween_property(g, "scale", Vector2.ONE, _s(220.0)).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	_transient[stack_id] = {"ghost": g, "center": _center(anchor), "size": _size(anchor)}
	if Val.text(obj, "kind") != "ability" and controller != "" and controller != _viewer:
		for e: Variant in Val.dict(before, "cards").values():
			var entry := Val.as_dict(e)
			var node: Variant = entry.get("node")
			if Val.text(entry, "zone") == "back" and _valid(node) and Val.text(View.object(_from, Val.text(entry, "id")), "owner") == controller \
					and not _staged_backs.has(node) and (node as CanvasItem).modulate.a > 0.0:
				(node as CanvasItem).modulate.a = 0.0
				_staged_backs.append(node)
				break
	_burst(style, _center(anchor), _size(anchor).x, 0.3, false)
	_pulse(g, style_glow(style))
	return true


## A spell or ability that came and went waits on the stack for a moment, what it targets glowing.
func _dwell(stack_id: String, controller: String, before: Dictionary, plan: Dictionary) -> void:
	for s: Variant in Val.list(plan, "a"):
		var step := Val.as_dict(s)
		if Val.text(step, "kind") == "resolve" and Val.text(step, "stackId") == stack_id:
			for id: Variant in Val.list(step, "targets"):
				if id is String:
					var box := _target_box(before, id)
					if _valid(box.get("node")):
						_pulse(box["node"], TARGET_GLOW, 0.6)
			break
	await _sleep(OWN_DWELL_MS if controller != "" and controller == _viewer else THEIR_DWELL_MS)


## An ability put on the stack: its source flares and pulses (a triggered one in gold).
func _ability_flare(step: Dictionary, before: Dictionary, plan: Dictionary) -> void:
	var triggered := Val.flag(step, "triggered")
	var src := _card(before, step.get("source"))
	var style := Val.text(step, "style")
	_sound("ability.triggered" if triggered else "ability.activated", _center(src) if not src.is_empty() else null)
	if not src.is_empty():
		_burst("radiant" if triggered else style, _center(src), maxf(_size(src).x, _size(src).y), 0.35, true)
		_pulse(src["node"], TRIGGER_GLOW if triggered else ACTIVATE_GLOW)
	if Val.flag(step, "transient"):
		var stack_id := Val.text(step, "stackId")
		var controller := Val.text(Val.dict(_last_known(stack_id), "object"), "controller")
		if _stage_on_stack(stack_id, controller, before, style):
			await _dwell(stack_id, controller, before, plan)
	elif not src.is_empty():
		await _sleep(180.0)


## The resolving object's place: the ghost of a spell that came and went, else its stack card ({} when neither).
func _resolving_box(stack_id: String, before: Dictionary) -> Dictionary:
	if _transient.has(stack_id):
		var t: Dictionary = _transient[stack_id]
		return {"center": t["center"], "size": t["size"], "node": t["ghost"]}
	return Val.dict(Val.dict(before, "stack"), stack_id)


func _resolve(step: Dictionary, before: Dictionary, plan: Dictionary) -> void:
	var gen := _gen
	var stack_id := Val.text(step, "stackId")
	var style := Val.text(step, "style")
	var spell := Val.flag(step, "spell")
	var becomes_permanent := false
	for m: Variant in Val.list(Val.dict(plan, "b"), "moves"):
		var mv := Val.as_dict(m)
		if Val.text(mv, "oldId") == stack_id and Val.text(mv, "to") == "battlefield":
			becomes_permanent = true
	# "Executing": an instant, sorcery or ability rising off the stack (a permanent spell is heard landing on the table instead).
	var r := _resolving_box(stack_id, before)
	if not becomes_permanent:
		_sound("spell.resolve", _center(r) if not r.is_empty() else null)
	var shown: Dictionary = {}
	if spell and not becomes_permanent:
		shown = await _present(stack_id, before, style)
		if gen != _gen:
			return
	if not shown.is_empty():
		r = shown
	elif not r.is_empty() and _valid(r.get("node")):
		_pulse(r["node"], style_glow(style), 1.2)
		await _sleep(420.0)
		if gen != _gen:
			return
	# Effects come out of the source permanent for an ability, out of the spell for a spell.
	var src := _card(before, step.get("source"))
	var origin: Dictionary = src if not src.is_empty() else r
	var hits := Val.list(step, "hits")
	var life := Val.list(step, "life")
	var counters := Val.list(step, "counters")
	var targets := Val.list(step, "targets")
	if hits.size() + life.size() + counters.size() + targets.size() == 0:
		if not r.is_empty():
			_burst(style, _center(r), _size(r).x, 0.4, false)
		await _sleep(280.0 if not shown.is_empty() else 140.0)
		return
	await _effects(hits, life, counters, style, origin, before, spell, targets)
	_launcher = null


## A spell resolving (CR 608.2): its card comes out of the stack to the right edge of the table, grows and glows in its colours. Its
## ghost stays there until part B sends it to its graveyard.
func _present(stack_id: String, before: Dictionary, style: String) -> Dictionary:
	if _transient.has(stack_id):
		return {}
	var e := Val.dict(Val.dict(before, "stack"), stack_id)
	if e.is_empty() or Val.text(View.object(_from, stack_id), "kind") == "ability":
		return {}
	var board := _table.board_rect()
	var size := _size(e)
	var w := minf(260.0, maxf(size.x * 1.3, board.size.x * 0.16))
	var s := w / maxf(1.0, size.x)
	var h := size.y * s
	var to := Vector2(board.end.x - w * 0.5 - maxf(16.0, board.size.x * 0.03), clampf(board.get_center().y, board.position.y + h * 0.5 + 12.0, board.end.y - h * 0.5 - 12.0))
	var g := _ghost(e)
	_hide(e["node"])
	var glow := style_glow(style)
	var steady := g.glow("spell", glow)
	var peak := g.glow("spellPeak", glow)
	var gen := _gen
	var tw := _tween()
	tw.tween_property(g, "position", to + Vector2(0, -18), _s(247.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * s * 1.08, _s(247.0))
	tw.parallel().tween_property(g, "rotation", deg_to_rad(-2.0), _s(247.0))
	tw.parallel().tween_property(peak, "modulate:a", 1.0, _s(247.0))
	tw.parallel().tween_property(g.shadow(), "modulate:a", 0.65, _s(247.0))
	tw.tween_property(g, "position", to, _s(133.0))
	tw.parallel().tween_property(g, "scale", Vector2.ONE * s, _s(133.0))
	tw.parallel().tween_property(g, "rotation", 0.0, _s(133.0))
	tw.parallel().tween_property(peak, "modulate:a", 0.0, _s(133.0))
	tw.parallel().tween_property(steady, "modulate:a", 0.9, _s(133.0))
	await _await_tween(tw)
	if gen != _gen:
		return {}
	_burst(style, to, w, 0.45, false)
	var box := {"center": to, "size": Vector2(w, h), "node": g}
	_transient[stack_id] = {"ghost": g, "center": to, "size": Vector2(w, h)}
	_launcher = g
	await _sleep(140.0)
	return box


## Damage, life and counters coming out of one resolution (or a source): a creature that fights rises and strikes; otherwise each hit
## is a spell effect flying from `origin` to its target. Impacts land together and shake the table once, by the total damage.
func _effects(hits: Array, life: Array, counters: Array, style: String, origin: Dictionary, before: Dictionary, spell: bool, targets: Array) -> void:
	var gen := _gen
	var jobs := Jobs.new()
	var swings: Array = []
	if is_instance_valid(_launcher) and hits.size() + targets.size() > 0:
		var flare := _launcher.glow("flare", Color(1.0, 0.98, 0.9, 0.95))
		var ft := _tween()
		ft.tween_property(flare, "modulate:a", 1.0, _s(130.0))
		ft.tween_property(flare, "modulate:a", 0.0, _s(390.0))
	var struck: Dictionary = {}
	var total: int = 0
	for i: int in range(hits.size()):
		var h := Val.as_dict(hits[i])
		struck[Val.text(h, "target")] = true
		var src := _card(before, h.get("source"))
		# A creature dealing damage because a spell made it (fight, bite): it swings like in combat.
		if spell and not src.is_empty() and Val.text(src, "zone") == "battlefield":
			swings.append(h)
			continue
		total += Val.num(h, "amount")
		var from_box: Dictionary = src if (not src.is_empty() and Val.text(src, "zone") != "stack") else (origin if not origin.is_empty() else src)
		var to_box := _target_box(before, Val.text(h, "target"))
		if to_box.is_empty():
			continue
		if from_box.is_empty():
			_impact(h, style, before, null)
			continue
		# A player's panel is struck at its rim facing the blow, so the life total in its middle stays readable.
		var disc := Val.dict(Val.dict(before, "avatars"), Val.text(h, "target"))
		var aim := _rim_point(disc, _center(from_box)) if not disc.is_empty() else _center(to_box)
		jobs.start()
		_flight(jobs, gen, i * 70.0, style, _center(from_box), aim, h, before, not disc.is_empty())
	# What it targets but does not damage (destroyed, exiled, returned, pumped, tapped, a countered spell): the effect still lands there.
	for j: int in range(targets.size()):
		var id: Variant = targets[j]
		if not (id is String) or struck.has(id) or origin.is_empty():
			continue
		var to_box := _target_box(before, id)
		if to_box.is_empty():
			continue
		jobs.start()
		_touch_flight(jobs, gen, (hits.size() + j) * 70.0, style, _center(origin), id, before)
	if not swings.is_empty():
		jobs.start()
		_combat_job(jobs, swings, before)
	await _wait(jobs, 2000.0)
	if gen != _gen:
		return
	if total > 0:
		_shake(total)
	var unexplained: Array = []
	for l: Variant in life:
		if not Val.flag(Val.as_dict(l), "byDamage"):
			unexplained.append(l)
	await _life_effects(unexplained, before)
	if gen != _gen:
		return
	await _counter_effects(counters, before)
	if jobs.left > 0 or not hits.is_empty() or not targets.is_empty():
		await _sleep(160.0)


func _flight(jobs: Jobs, gen: int, delay_ms: float, style: String, from: Vector2, aim: Vector2, h: Dictionary, before: Dictionary, on_disc: bool) -> void:
	if delay_ms > 0.0:
		await _sleep(delay_ms)
	if gen == _gen:
		_sound("spell.bolt", from)
		await _projectile(style, from, aim, 320.0)
		if gen == _gen:
			_impact(h, style, before, aim if on_disc else null)
	jobs.end()


func _touch_flight(jobs: Jobs, gen: int, delay_ms: float, style: String, from: Vector2, id: String, before: Dictionary) -> void:
	if delay_ms > 0.0:
		await _sleep(delay_ms)
	if gen == _gen:
		var to_box := _target_box(before, id)
		_sound("spell.bolt", from, 0.0, 0.8)
		await _projectile(style, from, _center(to_box), 320.0)
		if gen == _gen:
			_sound("spell.touch", _center(to_box))
			var on_card := not _card(before, id).is_empty()
			_burst(style, _center(to_box), maxf(_size(to_box).x, _size(to_box).y), 0.15, on_card)
			if _valid(to_box.get("node")):
				_pulse(to_box["node"], style_glow(style), 1.0)
	jobs.end()


func _combat_job(jobs: Jobs, swings: Array, before: Dictionary) -> void:
	await _combat(swings, [], before, false)
	jobs.end()


## A hit landing: the target recoils, light bursts behind it, the damage floats above it.
func _impact(h: Dictionary, style: String, before: Dictionary, at: Variant) -> void:
	var target := Val.text(h, "target")
	var amount := Val.num(h, "amount")
	var card := _card(before, target)
	var disc := Val.dict(Val.dict(before, "avatars"), target)
	var box: Dictionary = card if not card.is_empty() else disc
	var on_player := card.is_empty() and not disc.is_empty()
	var gain := SoundCues.damage_gain(amount)
	var where: Variant = _center(box) if not box.is_empty() else null
	if style == "physical":
		_sound(SoundCues.hit_sound(amount, on_player), where, 0.0, gain)
	else:
		_sound(SoundCues.impact_sound(style), where, 0.0, gain)
		if on_player:
			_sound("hit.player", where, 0.0, 0.75 * gain)
	if box.is_empty():
		return
	var power := Shake.level(amount)
	var spot: Vector2 = at if at is Vector2 else _center(box)
	_burst(style, spot, maxf(_size(box).x, _size(box).y), power, not card.is_empty())
	if card.is_empty():
		_burst("force", spot, maxf(_size(box).x, _size(box).y) * 0.6, power, false)
	var node: Variant = box.get("node")
	if _valid(node):
		_recoil(node, Shake.recoil_for(amount), card.is_empty(), power)
		_flash(node, HIT_GLOW, 520.0, 0.2)
	_floater(box, "-%d" % amount, "damage", amount, not card.is_empty())


## A card (or a player's panel, which also swells) knocked back by a blow and settling where it was.
func _recoil(target: Variant, amp: float, is_panel: bool, power: float) -> void:
	if not _valid(target) or not (target is CanvasItem):
		return
	var node := target as CanvasItem
	var rest := _rest_of(node)
	var base_pos: Vector2 = rest["position"]
	var base_rot: float = rest["rotation"]
	var base_scale: Vector2 = rest["scale"]
	if node is Control:
		(node as Control).pivot_offset = (node as Control).size * 0.5
	var pop := 1.1 + power * 0.12 if is_panel else 1.0
	var ms := 380.0 if is_panel else 300.0
	var tw := _tween()
	tw.tween_property(node, "position", base_pos + Vector2(amp, -amp * 0.4), _s(ms * 0.15))
	tw.parallel().tween_property(node, "rotation", base_rot + deg_to_rad(amp * 0.25), _s(ms * 0.15))
	if is_panel:
		tw.parallel().tween_property(node, "scale", base_scale * pop, _s(ms * 0.15))
	tw.tween_property(node, "position", base_pos + Vector2(-amp * 0.7, amp * 0.3), _s(ms * 0.2))
	tw.parallel().tween_property(node, "rotation", base_rot - deg_to_rad(amp * 0.18), _s(ms * 0.2))
	if is_panel:
		tw.parallel().tween_property(node, "scale", base_scale * (1.0 + (pop - 1.0) * 0.4), _s(ms * 0.2))
	tw.tween_property(node, "position", base_pos + Vector2(amp * 0.35, 0), _s(ms * 0.25))
	tw.parallel().tween_property(node, "rotation", base_rot, _s(ms * 0.25))
	if is_panel:
		tw.parallel().tween_property(node, "scale", base_scale, _s(ms * 0.25))
	tw.tween_property(node, "position", base_pos, _s(ms * 0.4)).set_ease(Tween.EASE_OUT)


## Combat damage: every creature that deals damage rises and swings into its target at once (CR 510.2); the table shakes by the total.
func _combat(hits: Array, life: Array, before: Dictionary, shake: bool) -> void:
	var gen := _gen
	var by_source: Dictionary = {}
	for hv: Variant in hits:
		var h := Val.as_dict(hv)
		var src_id := Val.text(h, "source")
		if not by_source.has(src_id):
			by_source[src_id] = []
		Val.list(by_source, src_id).append(h)
	# A lone creature rises high; in a crowded clash each rises less, one after another, so who hits whom stays readable.
	var crowd := by_source.size()
	var lift := {"up": 1.18, "hit": 1.22} if crowd >= 3 else ({"up": 1.27, "hit": 1.32} if crowd == 2 else {"up": 1.34, "hit": 1.4})
	var jobs := Jobs.new()
	var i: int = 0
	var contact_at := 0.0
	for source: Variant in by_source.keys():
		var list: Array = by_source[source]
		var src := _card(before, source)
		var main := Val.as_dict(list[0])
		for h: Variant in list:
			if Val.num(Val.as_dict(h), "amount") > Val.num(main, "amount"):
				main = Val.as_dict(h)
		var tgt := _target_box(before, Val.text(main, "target"))
		if src.is_empty() or tgt.is_empty() or not _valid(src.get("node")):
			for h: Variant in list:
				_impact(Val.as_dict(h), "physical", before, null)
			continue
		var delay := i * 70.0
		i += 1
		var dur := 560.0
		_sound("combat.swing", _center(src), delay)
		contact_at = maxf(contact_at, delay + dur * 0.5)
		jobs.start()
		_swing(jobs, gen, src, tgt, delay, dur, lift, list, Val.text(main, "target"), before)
	if shake:
		_shake_later(gen, contact_at, Plan.total_damage(hits))
	await _wait(jobs, 2200.0)
	if gen != _gen:
		return
	var unexplained: Array = []
	for l: Variant in life:
		if not Val.flag(Val.as_dict(l), "byDamage"):
			unexplained.append(l)
	await _life_effects(unexplained, before)


## One creature rising off the table and striking: wind-up, lunge, a short hit-stop at contact, and back to its place.
func _swing(jobs: Jobs, gen: int, src: Dictionary, tgt: Dictionary, delay_ms: float, dur_ms: float, lift: Dictionary, hits: Array, main_target: String, before: Dictionary) -> void:
	var g := _ghost(src)
	g.z_index = 5
	_hide(src["node"])
	var d := _center(tgt) - _center(src)
	var dist := maxf(1.0, d.length())
	var u := d / dist
	var up := float(lift["up"])
	var hit := float(lift["hit"])
	# Half a box's size along the line of the swing.
	var ext_t := (absf(u.x) * _size(tgt).x + absf(u.y) * _size(tgt).y) * 0.5 * 0.85
	var ext_s := (absf(u.x) * _size(src).x + absf(u.y) * _size(src).y) * 0.5 * hit
	# It stops where its edge meets the target's (a little overlap: contact), so both cards stay in sight.
	var reach := maxf(0.0, dist - ext_t - ext_s)
	var side := 1.0 if d.x >= 0.0 else -1.0
	var contact := _center(tgt) - u * ext_t
	var start := g.position
	var r0 := g.rotation
	if delay_ms > 0.0:
		await _sleep(delay_ms)
		if gen != _gen:
			jobs.end()
			return
	_contact_later(gen, dur_ms * 0.5, hits, main_target, contact, before)
	var tw := _tween()
	tw.tween_property(g, "position", start + u * -22.0 + Vector2(0, -28), _s(dur_ms * 0.32)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * up, _s(dur_ms * 0.32))
	tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(-side * 9.0), _s(dur_ms * 0.32))
	tw.parallel().tween_property(g.shadow(), "modulate:a", 0.75, _s(dur_ms * 0.32))
	tw.tween_property(g, "position", start + u * reach, _s(dur_ms * 0.18)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * hit, _s(dur_ms * 0.18))
	tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(side * 10.0), _s(dur_ms * 0.18))
	# The hit-stop: barely moving for a beat at contact.
	tw.tween_property(g, "position", start + u * (reach - 10.0), _s(dur_ms * 0.12))
	tw.parallel().tween_property(g, "scale", Vector2.ONE * (hit - 0.03), _s(dur_ms * 0.12))
	tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(side * 7.0), _s(dur_ms * 0.12))
	tw.tween_property(g, "position", start, _s(dur_ms * 0.38)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE, _s(dur_ms * 0.38))
	tw.parallel().tween_property(g, "rotation", r0, _s(dur_ms * 0.38))
	tw.parallel().tween_property(g.shadow(), "modulate:a", 0.35, _s(dur_ms * 0.38))
	await _await_tween(tw)
	_drop(g)
	_show(src["node"])
	jobs.end()


func _contact_later(gen: int, ms: float, hits: Array, main_target: String, contact: Vector2, before: Dictionary) -> void:
	await _sleep(ms)
	if gen != _gen:
		return
	for h: Variant in hits:
		var hit := Val.as_dict(h)
		_impact(hit, "physical", before, contact if Val.text(hit, "target") == main_target else null)


## The point of a panel's edge (a little inside it) facing `from`.
func _rim_point(box: Dictionary, from: Vector2) -> Vector2:
	var c := _center(box)
	var d := from - c
	var r := minf(_size(box).x, _size(box).y) * 0.34
	return c + d.normalized() * r if d.length() > 0.0 else c


func _life_effects(life: Array, before: Dictionary) -> void:
	if life.is_empty():
		return
	var heard: Dictionary = {}
	for lv: Variant in life:
		var l := Val.as_dict(lv)
		var delta := Val.num(l, "delta")
		var disc := Val.dict(Val.dict(before, "avatars"), Val.text(l, "player"))
		var id := "life.gain" if delta > 0 else ("life.loss" if delta < 0 else "")
		if id != "" and not heard.has(id):
			heard[id] = true
			_sound(id, _center(disc) if not disc.is_empty() else null)
		if disc.is_empty():
			continue
		if delta > 0:
			_burst("radiant", _center(disc), _size(disc).x * 0.5, 0.5, false)
			_floater(disc, "+%d" % delta, "heal", delta)
		elif delta < 0:
			_burst("shadow", _center(disc), _size(disc).x * 0.5, Shake.level(-delta) * 0.6, false)
			_floater(disc, "%d" % delta, "damage", -delta)
			_shake(maxf(1.0, roundf(-delta / 2.0)))
	await _sleep(260.0)


func _counter_effects(counters: Array, before: Dictionary) -> void:
	if counters.is_empty():
		return
	var heard: Dictionary = {}
	for cv: Variant in counters:
		var c := Val.as_dict(cv)
		var box := _target_box(before, Val.text(c, "target"))
		var delta := Val.num(c, "delta")
		var good := SoundCues.counter_good(Val.text(c, "counter"), delta)
		var id := "counter.up" if good else "counter.down"
		if not heard.has(id):
			heard[id] = true
			_sound(id, _center(box) if not box.is_empty() else null)
		if box.is_empty():
			continue
		_burst("nature" if good else "shadow", _center(box), maxf(_size(box).x, _size(box).y), 0.3, true)
		var card := _card(before, Val.text(c, "target"))
		if not card.is_empty() and _valid(card.get("node")):
			_pulse(card["node"], GOOD_GLOW if good else BAD_GLOW, 0.8)
		_floater(box, "%s%d %s" % ["+" if delta > 0 else "", delta, Val.text(c, "counter")], "buff" if good else "debuff", 1, not card.is_empty())
	await _sleep(240.0)


## A countered spell or ability (CR 701.6): it jolts on the stack and breaks apart.
func _countered(stack_id: String, before: Dictionary) -> void:
	var gen := _gen
	var e := Val.dict(Val.dict(before, "stack"), stack_id)
	if _transient.has(stack_id):
		var t: Dictionary = _transient[stack_id]
		var g: Ghost = t["ghost"]
		_sound("spell.countered", t["center"])
		var tw := _tween()
		tw.tween_property(g, "scale", Vector2.ZERO, _s(300.0)).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_IN)
		await _await_tween(tw)
		_drop(g)
		_transient.erase(stack_id)
		return
	_sound("spell.countered", _center(e) if not e.is_empty() else null)
	if e.is_empty():
		return
	_burst("force", _center(e), _size(e).x, 0.3, false)
	await _destroy_card(e, false)
	if gen != _gen:
		return


## Permanents destroyed, sacrificed or exiled in this change play their exit where they stand, on the table as it was; only then
## does the new view close the gap. Each is marked shown so part B skips it.
func _exits_in_place(plan: Dictionary, before: Dictionary, early: Array) -> void:
	var leaving: Array[Dictionary] = []
	for mv: Variant in Val.list(Val.dict(plan, "b"), "moves"):
		var m: Dictionary = mv
		var kind := Val.text(m, "kind")
		if not Val.flag(m, "shownInA") and Val.text(m, "from") == "battlefield" and (kind == "die" or kind == "sacrifice" or kind == "exile"):
			leaving.append(m)
	# Several at once break one after another (and each a little less brightly), so a crowded clash never melts into one blur.
	var crowd := leaving.size() >= 3
	var jobs := Jobs.new()
	var n: int = 0
	for m: Dictionary in leaving:
		var old := _card(before, m.get("oldId"))
		if old.is_empty() or Val.text(old, "zone") != "battlefield" or not _valid(old.get("node")):
			continue
		m["shownInA"] = true
		early.append(old["node"])
		jobs.start()
		_exit_job(jobs, _gen, m, old, n * 110.0, crowd)
		n += 1
	await _wait(jobs, 2000.0)


func _exit_job(jobs: Jobs, gen: int, m: Dictionary, old: Dictionary, delay_ms: float, crowd: bool) -> void:
	if delay_ms > 0.0:
		await _sleep(delay_ms)
	if gen == _gen:
		var kind := Val.text(m, "kind")
		var beat := 0.22 if kind == "die" and Val.flag(old, "scryfall") else -1.0
		_sound(Val.text(SoundCues.exit_cue(m), "id"), _center(old), 0.0, 0.75 if delay_ms > 0.0 else 1.0, beat)
		match kind:
			"die":
				await _destroy_card(old, crowd)
			"sacrifice":
				await _consume(old)
			_:
				await _banish(old)
	jobs.end()


# ---- exits ----------------------------------------------------------------------------------------------------------------------

## Destroyed (CR 701.8) or put into the graveyard from the battlefield. Our own frames and the player's pictures shatter into six
## pieces of a flattened copy that fly apart over flames; a Scryfall picture is never cut: it is struck, tumbles and falls away whole.
## `crowd`: one of three or more breaking at once: it fades and shrinks whole instead.
func _destroy_card(e: Dictionary, crowd: bool) -> void:
	var gen := _gen
	var size := maxf(_size(e).x, _size(e).y)
	var on_stack := Val.text(e, "zone") == "stack"
	var g := _ghost(e)
	_hide(e.get("node"))
	var start := g.position
	var r0 := g.rotation
	if Val.flag(e, "scryfall"):
		var rim := g.glow("rim", RIM_GLOW)
		_destroy_burst_later(gen, 220.0, _center(e), size, on_stack)
		var tw := _tween()
		tw.tween_property(g, "position", start + Vector2(-5, -14), _s(180.0))
		tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(-4.0), _s(180.0))
		tw.parallel().tween_property(g, "scale", Vector2.ONE * 1.24, _s(180.0))
		tw.parallel().tween_property(rim, "modulate:a", 0.85, _s(180.0))
		tw.tween_property(g, "position", start + Vector2(5, -12), _s(108.0))
		tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(5.0), _s(108.0))
		tw.parallel().tween_property(rim, "modulate:a", 1.0, _s(108.0))
		tw.tween_property(g, "position", start + Vector2(16, 50), _s(387.0)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(34.0), _s(387.0))
		tw.parallel().tween_property(g, "scale", Vector2.ONE * 0.62, _s(387.0))
		tw.parallel().tween_property(rim, "modulate:a", 0.0, _s(387.0))
		tw.tween_property(g, "position", start + Vector2(22, 90), _s(225.0))
		tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(48.0), _s(225.0))
		tw.parallel().tween_property(g, "scale", Vector2.ZERO, _s(225.0))
		await _await_tween(tw)
		_drop(g)
		return
	# 1. Struck: the card jumps up off the table, swells and shudders while a white-hot rim builds around it (a glow behind it).
	var rim2 := g.glow("rim", RIM_GLOW)
	var swell := 1.3
	var tw2 := _tween()
	tw2.tween_property(g, "position", start + Vector2(-4, -13), _s(128.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw2.parallel().tween_property(g, "scale", Vector2.ONE * (swell - 0.04), _s(128.0))
	tw2.parallel().tween_property(g, "rotation", r0 + deg_to_rad(-3.5), _s(128.0))
	tw2.parallel().tween_property(rim2, "modulate:a", 0.7 if crowd else 1.0, _s(128.0))
	tw2.tween_property(g, "position", start + Vector2(4, -16), _s(96.0))
	tw2.parallel().tween_property(g, "rotation", r0 + deg_to_rad(3.0), _s(96.0))
	tw2.tween_property(g, "position", start + Vector2(0, -16), _s(96.0))
	tw2.parallel().tween_property(g, "rotation", r0, _s(96.0))
	tw2.parallel().tween_property(g, "scale", Vector2.ONE * swell, _s(96.0))
	await _await_tween(tw2)
	if gen != _gen:
		return
	# 2. It breaks: flames and smoke where it stood, a white-hot flash, and the table jolts.
	_burst("fire", _center(e), size * 1.35, 0.4 if crowd else 0.8, not on_stack)
	_burst("force", _center(e), size, 0.5, false)
	_shake(4.0)
	var at := g.position
	if crowd:
		# In a crowd the card falls away whole, tumbling, shrinking and fading.
		var dir := -1.0 if randf() < 0.5 else 1.0
		var tw3 := _tween()
		tw3.tween_property(rim2, "modulate:a", 0.0, _s(200.0))
		tw3.parallel().tween_property(g, "position", at + Vector2(dir * size * 0.12, size * 0.2), _s(400.0)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw3.parallel().tween_property(g, "rotation", r0 + deg_to_rad(dir * 14.0), _s(400.0))
		tw3.parallel().tween_property(g, "scale", Vector2.ONE * swell * 0.9, _s(400.0))
		tw3.tween_property(g, "position", at + Vector2(dir * size * 0.35, size * 1.3), _s(650.0))
		tw3.parallel().tween_property(g, "rotation", r0 + deg_to_rad(dir * 40.0), _s(650.0))
		tw3.parallel().tween_property(g, "scale", Vector2.ONE * swell * 0.55, _s(650.0))
		tw3.parallel().tween_property(g, "modulate:a", 0.0, _s(650.0))
		tw3.tween_callback(_drop.bind(g))
		# The change goes on while it falls.
		await _sleep(560.0)
		return
	# 3. Six pieces burst apart from the point of impact, spin, and fall away.
	rim2.modulate.a = 0.0
	var pieces := g.shatter(randi() % 100000 + 1)
	var impact := Vector2(randf_range(-0.08, 0.08), randf_range(-0.12, 0.08)) * g.base_size
	# Directions are on screen (outward from the blow, then down), turned into the ghost's own frame (lifted, swollen, and turned
	# when the card was tapped).
	var xf := g.get_global_transform()
	var inv := xf.affine_inverse()
	for p: Polygon2D in pieces:
		var out := xf.basis_xform(p.position - impact)
		var u := out.normalized() if out.length() > 0.0 else Vector2(randf_range(-1.0, 1.0), -1.0).normalized()
		var dist := (0.9 + randf() * 0.9) * size
		var fall := (0.8 + randf() * 0.8) * size
		var spin := deg_to_rad((-1.0 if randf() < 0.5 else 1.0) * (160.0 + randf() * 380.0))
		var dur := 950.0 + randf() * 320.0
		var p0 := p.position
		var crack := inv.basis_xform(u * 4.0)
		var mid := inv.basis_xform(Vector2(u.x * dist * 0.6, u.y * dist * 0.6 - size * 0.3))
		var low := inv.basis_xform(Vector2(u.x * dist, u.y * dist * 0.7 + fall))
		var gone := inv.basis_xform(Vector2(u.x * dist * 1.08, u.y * dist * 0.7 + fall * 1.35))
		var tw4 := _tween()
		tw4.tween_property(p, "position", p0 + crack, _s(dur * 0.1)).set_ease(Tween.EASE_OUT)
		tw4.parallel().tween_property(p, "rotation", spin * 0.015, _s(dur * 0.1))
		tw4.tween_property(p, "position", p0 + mid, _s(dur * 0.28)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tw4.parallel().tween_property(p, "rotation", spin * 0.45, _s(dur * 0.28))
		tw4.parallel().tween_property(p, "scale", Vector2.ONE * 0.95, _s(dur * 0.28))
		tw4.tween_property(p, "position", p0 + low, _s(dur * 0.44)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw4.parallel().tween_property(p, "rotation", spin, _s(dur * 0.44))
		tw4.parallel().tween_property(p, "scale", Vector2.ONE * 0.8, _s(dur * 0.44))
		tw4.parallel().tween_property(p, "modulate:a", 0.9, _s(dur * 0.44))
		tw4.tween_property(p, "position", p0 + gone, _s(dur * 0.18))
		tw4.parallel().tween_property(p, "rotation", spin * 1.12, _s(dur * 0.18))
		tw4.parallel().tween_property(p, "scale", Vector2.ONE * 0.74, _s(dur * 0.18))
		tw4.parallel().tween_property(p, "modulate:a", 0.0, _s(dur * 0.18))
	# The ghost (with its pieces) goes once the slowest piece is down; the change goes on while they fall.
	var cleanup := _tween()
	cleanup.tween_interval(_s(1300.0))
	cleanup.tween_callback(_drop.bind(g))
	await _sleep(560.0)


func _destroy_burst_later(gen: int, ms: float, at: Vector2, size: float, on_stack: bool) -> void:
	await _sleep(ms)
	if gen == _gen:
		_burst("fire", at, size * 1.4, 0.7, not on_stack)
		_shake(4.0)


## Sacrificed (CR 701.21): not broken but consumed: it sinks into the table in a swirl of dark smoke.
func _consume(e: Dictionary) -> void:
	var g := _ghost(e)
	_hide(e.get("node"))
	_burst("shadow", _center(e), maxf(_size(e).x, _size(e).y), 0.5, true)
	var glow := g.glow("consume", CONSUME_GLOW)
	var start := g.position
	var r0 := g.rotation
	var tw := _tween()
	tw.tween_property(g, "position", start + Vector2(0, -8), _s(192.0))
	tw.parallel().tween_property(g, "scale", Vector2.ONE * 1.06, _s(192.0))
	tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(-3.0), _s(192.0))
	tw.parallel().tween_property(glow, "modulate:a", 1.0, _s(192.0))
	tw.tween_property(g, "position", start + Vector2(0, 18), _s(448.0)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * 0.35, _s(448.0))
	tw.parallel().tween_property(g, "rotation", r0 + deg_to_rad(25.0), _s(448.0))
	tw.parallel().tween_property(g, "modulate:a", 0.0, _s(448.0))
	await _await_tween(tw)
	_drop(g)


## Exiled (CR 406): the card flares white and is drawn into a point of light.
func _banish(e: Dictionary) -> void:
	var g := _ghost(e)
	_hide(e.get("node"))
	_burst("radiant", _center(e), maxf(_size(e).x, _size(e).y), 0.6, true)
	var glow := g.glow("banish", BANISH_GLOW)
	var tw := _tween()
	tw.tween_property(g, "scale", Vector2.ONE * 1.1, _s(182.0))
	tw.parallel().tween_property(glow, "modulate:a", 1.0, _s(182.0))
	tw.tween_property(g, "scale", Vector2.ZERO, _s(338.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
	await _await_tween(tw)
	_drop(g)


## A ghost flying into a pile (shrinking to its size), or vanishing where it is when there is no pile (tokens cease to exist, CR 111.7).
func _fly_to_pile(g: Ghost, pile: Dictionary, vanish: bool) -> void:
	if not is_instance_valid(g):
		return
	var base_scale := g.scale
	if pile.is_empty() or vanish:
		var tw := _tween()
		tw.tween_property(g, "scale", base_scale * 1.08, _s(108.0))
		tw.tween_property(g, "scale", Vector2.ZERO, _s(252.0)).set_ease(Tween.EASE_IN)
		await _await_tween(tw)
		_drop(g)
		return
	var start := g.position
	var d := _center(pile) - g.global_position
	var s := maxf(0.12, _size(pile).x / maxf(1.0, g.base_size.x))
	var tw2 := _tween()
	tw2.tween_property(g, "position", start + d * 0.4 + Vector2(0, -46), _s(234.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw2.parallel().tween_property(g, "scale", Vector2.ONE * (0.6 + s * 0.4), _s(234.0))
	tw2.parallel().tween_property(g, "rotation", deg_to_rad(10.0 if d.x > 0 else -10.0), _s(234.0))
	tw2.parallel().tween_property(g.shadow(), "modulate:a", 0.6, _s(234.0))
	tw2.tween_property(g, "position", start + d, _s(286.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN)
	tw2.parallel().tween_property(g, "scale", Vector2.ONE * s, _s(286.0))
	tw2.parallel().tween_property(g, "rotation", 0.0, _s(286.0))
	tw2.parallel().tween_property(g.shadow(), "modulate:a", 0.2, _s(286.0))
	await _await_tween(tw2)
	_drop(g)


# ---- part B ---------------------------------------------------------------------------------------------------------------------

func _part_b(plan: Dictionary, events: Array, before: Dictionary, after: Dictionary, from: Dictionary, to: Dictionary) -> void:
	var gen := _gen
	var b := Val.dict(plan, "b")
	var moves := Val.list(b, "moves")
	var jobs := Jobs.new()
	var arriving: Dictionary = {}
	var consumed_old: Dictionary = {}
	var cast_target: Dictionary = {}
	var lands := SoundCues.lands_played(events)
	# Arrivals: anything shown now that was not on the board before, flying in from where its card was.
	var own_draws: int = 0
	for mv: Variant in moves:
		var m := Val.as_dict(mv)
		if _is_own_draw(m, after) and _card(before, m.get("newId")).is_empty():
			own_draws += 1
	var showcase := own_draws > 0 and own_draws <= MAX_SHOWN_DRAWS
	var draw_index: int = 0
	var shown: int = 0
	for mv: Variant in moves:
		var m := Val.as_dict(mv)
		var new_id: Variant = m.get("newId")
		if not (new_id is String):
			continue
		var dest := _card(after, new_id)
		if dest.is_empty():
			dest = Val.dict(Val.dict(after, "stack"), new_id)
		if dest.is_empty() or not _card(before, new_id).is_empty():
			continue
		var origin := _origin_of(m, before)
		arriving[new_id] = true
		if not origin.is_empty():
			consumed_old[Val.text(m, "oldId")] = true
		if Val.text(m, "to") == "stack":
			cast_target = dest
		var held := showcase and not origin.is_empty() and _is_own_draw(m, after)
		var delay := 0.0
		if held:
			delay = shown * SHOWN_DRAW_GAP_MS
			shown += 1
		elif Val.text(m, "to") == "hand" and Val.text(m, "from") == "library":
			delay = draw_index * 90.0
			draw_index += 1
		# A card flying to the table is heard as it lands (0.82 of its 620 ms flight); another player's draws are softer.
		var heard := SoundCues.arrival_sound(m, to, lands)
		var landing := 508.0 if Val.text(m, "to") == "battlefield" and not origin.is_empty() else 0.0
		if heard != "":
			_sound(heard, _center(dest), delay + landing, 0.6 if Val.text(m, "to") == "hand" and Val.text(m, "owner") != _viewer else 1.0)
		jobs.start()
		if held:
			_show_draw(jobs, gen, dest, origin, shown - 1, delay)
		else:
			_arrive(jobs, gen, m, dest, origin, delay, to)
	# Mana paid for a spell: orbs from the tapped sources to what they paid for (CR 106.4, 601.2g-h).
	var orbs: int = 0
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		if Val.text(e, "type") != "manaAdded" or Val.text(e, "sourceId") == "":
			continue
		var src := _card(after, Val.text(e, "sourceId"))
		if src.is_empty():
			src = _card(before, Val.text(e, "sourceId"))
		var target: Dictionary = cast_target if not cast_target.is_empty() else Val.dict(Val.dict(after, "avatars"), Val.text(e, "player"))
		if src.is_empty() or target.is_empty() or orbs >= 12:
			continue
		var mana := Val.texts(e, "mana")
		var kind: String = mana[0] if not mana.is_empty() else "C"
		if orbs < 6:
			_sound(SoundCues.mana_sound(kind), _center(src), orbs * 45.0)
		orbs += 1
		jobs.start()
		_orb(jobs, gen, String(MANA_STYLES.get(kind, "force")), _center(src), _center(target))
	# Departures: cards that are gone, playing their exit where they were.
	var departing: Array[Dictionary] = []
	for mv: Variant in moves:
		var m: Dictionary = mv
		var new_id: Variant = m.get("newId")
		if Val.flag(m, "shownInA") or consumed_old.has(Val.text(m, "oldId")):
			continue
		if new_id is String and not _card(after, new_id).is_empty() and not arriving.has(new_id):
			continue
		departing.append(m)
	var breaking: int = 0
	for m: Dictionary in departing:
		var old := _card(before, m.get("oldId"))
		if Val.text(m, "kind") == "die" and not _transient.has(Val.text(m, "oldId")) and not old.is_empty() and not _valid(old.get("node")):
			breaking += 1
	for m: Dictionary in departing:
		var old_id := Val.text(m, "oldId")
		if _transient.has(old_id):
			var t: Dictionary = _transient[old_id]
			var c := SoundCues.exit_cue(m, true)
			_sound(Val.text(c, "id"), t["center"], 0.0, Val.real(c, "gain", 1.0))
			jobs.start()
			_fly_job(jobs, t["ghost"], _pile_box(after, Val.text(m, "owner"), Val.text(m, "to")), Val.flag(m, "token"))
			_transient.erase(old_id)
			continue
		var old := _card(before, old_id)
		if old.is_empty() or _valid(old.get("node")):
			continue
		var cue := SoundCues.exit_cue(m)
		var beat := -1.0
		if Val.text(m, "kind") == "die" and Val.flag(old, "scryfall"):
			beat = 0.22
		elif Val.text(cue, "id") == "card.exile" and Val.flag(m, "token") and Val.text(m, "kind") != "exile":
			beat = 0.36
		_sound(Val.text(cue, "id"), _center(old), 0.0, Val.real(cue, "gain", 1.0), beat)
		jobs.start()
		_depart(jobs, m, old, after, breaking >= 3)
	# Tokens created straight onto the battlefield (CR 111.1): they materialize.
	for id: Variant in Val.list(b, "tokens"):
		var dest := _card(after, id)
		if dest.is_empty() or arriving.has(id) or not _card(before, id).is_empty():
			continue
		arriving[id] = true
		_sound("card.token", _center(dest))
		jobs.start()
		_materialize(jobs, dest)
	_slides(before, after, arriving)
	_stat_changes(events, after, from, to)
	_life_pops(after, from, to)
	# A face turned or a card transformed in place (same object, CR 701.28, 702.37e).
	var flipped := false
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		var t := Val.text(e, "type")
		if t != "transformed" and t != "turnedFaceUp":
			continue
		var now := _card(after, Val.text(e, "objectId"))
		if now.is_empty() or arriving.has(Val.text(e, "objectId")):
			continue
		if not flipped:
			_sound("card.flip", _center(now))
		flipped = true
		_burst("radiant", _center(now), maxf(_size(now).x, _size(now).y), 0.4, true)
		_pulse(now["node"], Color(1, 1, 1, 0.9), 1.4)
	# Attackers charge, blockers step in. One sound for the whole declaration (CR 508.1, 509.1).
	if not Val.list(b, "attackers").is_empty():
		_sound("combat.attack")
	if not Val.list(b, "blocks").is_empty():
		_sound("combat.block")
	for id: Variant in Val.list(b, "attackers"):
		var e := _card(after, id)
		if not e.is_empty():
			_pulse(e["node"], Color(1.0, 0.47, 0.24, 0.9), 0.9)
	for bl: Variant in Val.list(b, "blocks"):
		var e := _card(after, Val.as_dict(bl).get("blocker"))
		if not e.is_empty():
			_pulse(e["node"], Color(0.47, 0.67, 1.0, 0.9), 0.9)
	# Players who left a multiplayer game that goes on: what they owned fades where it was (CR 800.4a).
	for l: Variant in Val.list(b, "left"):
		jobs.start()
		_leave_table(jobs, gen, Val.as_dict(l), before)
	var game_over: Variant = b.get("gameOver")
	if game_over != null:
		jobs.start()
		_game_over(jobs, Val.list(b, "lost"), after)
	else:
		if not Val.list(b, "lost").is_empty():
			jobs.start()
			_eliminated(jobs, Val.list(b, "lost"), after)
		var turn: Variant = b.get("turn")
		if turn is Dictionary:
			var td: Dictionary = turn
			_sound(SoundCues.banner_sound(td, _viewer, Sound.since("game.start")))
			var mine := Val.text(td, "player") == _viewer
			var who := View.player_name(to, Val.text(td, "player"))
			_banner("Your turn" if mine else "%s's turn" % who, "mine" if mine else "theirs")
	await _wait(jobs, PART_B_CAP_MS)


## A card drawn into the viewer's own hand (face up at the bottom edge).
func _is_own_draw(m: Dictionary, after: Dictionary) -> bool:
	if Val.text(m, "from") != "library" or Val.text(m, "to") != "hand" or not (m.get("newId") is String):
		return false
	var dest := _card(after, m.get("newId"))
	return Val.text(dest, "zone") == "hand" and Val.text(m, "owner") == _viewer


## Where a moving card was: its ghost, its card, its stack card, a pile, or another player's hand ({} when unknown).
func _origin_of(m: Dictionary, before: Dictionary) -> Dictionary:
	var old_id := Val.text(m, "oldId")
	if _transient.has(old_id):
		var t: Dictionary = _transient[old_id]
		_drop(t["ghost"])
		_transient.erase(old_id)
		return {"center": t["center"], "size": t["size"]}
	var old := _card(before, old_id)
	if old.is_empty():
		old = Val.dict(Val.dict(before, "stack"), old_id)
	if not old.is_empty():
		return old
	var zone := Val.text(m, "from")
	var owner_id := Val.text(m, "owner")
	if zone == "library" or zone == "graveyard" or zone == "exile":
		return Val.dict(Val.dict(before, "piles"), "%s:%s" % [owner_id, zone])
	if zone == "hand":
		return Val.dict(Val.dict(before, "hands"), owner_id)
	return {}


func _pile_box(snap: Dictionary, owner_id: String, zone: String) -> Dictionary:
	if zone == "hand":
		return Val.dict(Val.dict(snap, "hands"), owner_id)
	return Val.dict(Val.dict(snap, "piles"), "%s:%s" % [owner_id, zone])


## A card arriving at `dest`: a copy of its new picture flies there from `origin` while the real one waits hidden, then lands.
func _arrive(jobs: Jobs, gen: int, m: Dictionary, dest: Dictionary, origin: Dictionary, delay_ms: float, to: Dictionary) -> void:
	if origin.is_empty():
		if Val.text(m, "to") == "battlefield":
			await _materialize_now(dest)
		jobs.end()
		return
	var g := _ghost(dest, to)
	_hide(dest["node"])
	var s0 := clampf(_size(origin).x / maxf(1.0, _size(dest).x), 0.15, 2.0)
	var end_pos := _center(dest)
	var end_rot := Val.real(dest, "rotation")
	g.global_position = _center(origin)
	g.rotation = 0.0
	g.scale = Vector2.ONE * s0
	var start := g.position
	var d := end_pos - _center(origin)
	var to_table := Val.text(m, "to") == "battlefield"
	var to_stack := Val.text(m, "to") == "stack"
	var lift := -70.0 if to_table else (-50.0 if to_stack else -24.0)
	var dur := 620.0 if to_table else (460.0 if to_stack else 420.0)
	if delay_ms > 0.0:
		await _sleep(delay_ms)
		if gen != _gen:
			jobs.end()
			return
	if to_stack:
		_cast_trail(gen, Plan.spell_style([to], Val.text(m, "newId")), _center(origin), end_pos, dur)
	var tw := _tween()
	if to_table:
		tw.tween_property(g, "position", start + d * 0.55 + Vector2(0, lift), _s(dur * 0.55)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(g, "scale", Vector2.ONE * 1.32, _s(dur * 0.55))
		tw.parallel().tween_property(g, "rotation", deg_to_rad(6.0 if d.x > 0 else -6.0), _s(dur * 0.55))
		tw.parallel().tween_property(g.shadow(), "modulate:a", 0.7, _s(dur * 0.55))
		tw.tween_property(g, "position", start + d, _s(dur * 0.27)).set_trans(Tween.TRANS_QUAD).set_ease(Tween.EASE_IN)
		tw.parallel().tween_property(g, "scale", Vector2.ONE * 1.12, _s(dur * 0.27))
		tw.parallel().tween_property(g, "rotation", end_rot, _s(dur * 0.27))
		tw.tween_property(g, "scale", Vector2.ONE * 0.96, _s(dur * 0.08))
		tw.parallel().tween_property(g.shadow(), "modulate:a", 0.35, _s(dur * 0.08))
		tw.tween_property(g, "scale", Vector2.ONE, _s(dur * 0.1))
	else:
		tw.tween_property(g, "position", start + d * 0.5 + Vector2(0, lift), _s(dur * 0.5)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(g, "scale", Vector2.ONE * ((s0 + 1.0) * 0.5 + 0.12), _s(dur * 0.5))
		tw.parallel().tween_property(g.shadow(), "modulate:a", 0.6, _s(dur * 0.5))
		tw.tween_property(g, "position", start + d, _s(dur * 0.5)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
		tw.parallel().tween_property(g, "scale", Vector2.ONE, _s(dur * 0.5))
		tw.parallel().tween_property(g, "rotation", end_rot, _s(dur * 0.5))
		tw.parallel().tween_property(g.shadow(), "modulate:a", 0.35, _s(dur * 0.5))
	await _await_tween(tw)
	_drop(g)
	_show(dest["node"])
	if gen == _gen:
		if to_table:
			var power := SoundCues.power_of(to, Val.text(m, "newId"))
			var heavy := clampf((power - 2.0) / 6.0, 0.0, 1.0)
			_burst("dust", _center(dest) + Vector2(0, _size(dest).y * 0.5), _size(dest).x, heavy, true)
			if power >= 4:
				_shake(roundf(power * 0.8))
		elif to_stack and _valid(dest.get("node")):
			_pulse(dest["node"], Color(0.12, 0.72, 1.0, 0.9), 0.6)
	jobs.end()


func _cast_trail(gen: int, style: String, from: Vector2, to: Vector2, ms: float) -> void:
	if gen == _gen:
		await _projectile(style, from, to, ms)


## A card the viewer draws: out of the library, up to a spot on their half of the table to be read, then down into the hand.
func _show_draw(jobs: Jobs, gen: int, dest: Dictionary, origin: Dictionary, index: int, delay_ms: float) -> void:
	var g := _ghost(dest)
	_hide(dest["node"])
	var area := _table.viewer_area()
	var dest_size := _size(dest)
	var hand_top := _center(dest).y - dest_size.y * 0.5
	var room := hand_top - area.position.y - 16.0
	var s := clampf(room / maxf(1.0, dest_size.y), 1.0, 1.8)
	var w := dest_size.x * s
	var spot := Vector2(area.end.x - w * 0.5 - area.size.x * 0.13 - index * 28.0, area.position.y + 8.0 + dest_size.y * s * 0.5 + index * 10.0)
	var s0 := clampf(_size(origin).x / maxf(1.0, dest_size.x), 0.15, 2.0)
	g.global_position = _center(origin)
	g.rotation = 0.0
	g.scale = Vector2.ONE * s0
	var start := g.position
	var to_spot := spot - _center(origin)
	var to_hand := _center(dest) - _center(origin)
	if delay_ms > 0.0:
		await _sleep(delay_ms)
		if gen != _gen:
			jobs.end()
			return
	var credit := _artist_credit(g, Val.dict(dest, "view"), Val.text(dest, "id"), s)
	var tw := _tween()
	tw.tween_property(g, "position", start + to_spot, _s(SHOWN_DRAW_MS * 0.24)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE * s * 1.04, _s(SHOWN_DRAW_MS * 0.24))
	tw.parallel().tween_property(g.shadow(), "modulate:a", 0.75, _s(SHOWN_DRAW_MS * 0.24))
	tw.tween_property(g, "scale", Vector2.ONE * s, _s(SHOWN_DRAW_MS * 0.08))
	if credit != null:
		tw.parallel().tween_property(credit, "modulate:a", 1.0, _s(SHOWN_DRAW_MS * 0.08))
	tw.tween_interval(_s(SHOWN_DRAW_MS * 0.42))
	if credit != null:
		tw.tween_property(credit, "modulate:a", 0.0, _s(SHOWN_DRAW_MS * 0.06))
	tw.tween_property(g, "position", start + to_hand, _s(SHOWN_DRAW_MS * 0.26)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_IN_OUT)
	tw.parallel().tween_property(g, "scale", Vector2.ONE, _s(SHOWN_DRAW_MS * 0.26))
	tw.parallel().tween_property(g, "rotation", Val.real(dest, "rotation"), _s(SHOWN_DRAW_MS * 0.26))
	tw.parallel().tween_property(g.shadow(), "modulate:a", 0.35, _s(SHOWN_DRAW_MS * 0.26))
	await _await_tween(tw)
	_drop(g)
	_show(dest["node"])
	jobs.end()


## A Scryfall picture's artist, credited under the held-up copy (never on the picture) while it is shown to be read; null otherwise.
func _artist_credit(g: Ghost, view: Dictionary, id: String, s: float) -> Label:
	if g.picture_kind != "scryfall":
		return null
	var obj := View.object(view, id)
	var def := View.def_of(view, obj)
	var artist := Pictures.artist_of(Pictures.key_for(def, View.shown_face(def, obj)))
	if artist == "":
		return null
	var label := Label.new()
	label.text = "Illustrated by %s" % artist
	label.add_theme_font_size_override("font_size", maxi(8, roundi(12.0 / maxf(0.5, s))))
	label.add_theme_constant_override("outline_size", 4)
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.9))
	label.modulate.a = 0.0
	g.add_child(label)
	label.reset_size()
	label.position = Vector2(-label.size.x * 0.5, g.base_size.y * 0.5 + 4.0)
	return label


func _orb(jobs: Jobs, gen: int, style: String, from: Vector2, to: Vector2) -> void:
	if gen == _gen:
		await _projectile(style, from, to, 380.0)
	jobs.end()


func _fly_job(jobs: Jobs, g: Ghost, pile: Dictionary, vanish: bool) -> void:
	await _fly_to_pile(g, pile, vanish)
	jobs.end()


## A card that left: its exit, played on a copy of it where it was (`crowd`: one of three or more breaking at once).
func _depart(jobs: Jobs, m: Dictionary, old: Dictionary, after: Dictionary, crowd: bool) -> void:
	match Val.text(m, "kind"):
		"die":
			await _destroy_card(old, crowd)
		"sacrifice":
			await _consume(old)
		"exile":
			await _banish(old)
		"bounce", "toLibrary", "toGraveyard", "toHand":
			await _fly_to_pile(_ghost(old), _pile_box(after, Val.text(m, "owner"), Val.text(m, "to")), Val.flag(m, "token"))
		_:
			await _fly_to_pile(_ghost(old), {}, true)
	jobs.end()


func _materialize(jobs: Jobs, dest: Dictionary) -> void:
	await _materialize_now(dest)
	jobs.end()


## A token (or a card from nowhere on screen) scales up out of a burst of light.
func _materialize_now(dest: Dictionary) -> void:
	var node: Variant = dest.get("node")
	_burst("radiant", _center(dest), maxf(_size(dest).x, _size(dest).y), 0.5, true)
	if not _valid(node):
		return
	var card := node as CanvasItem
	var base: Vector2 = _rest_of(card)["scale"]
	card.set("scale", base * 0.3)
	var tw := _tween()
	tw.tween_property(card, "scale", base * 1.1, _s(312.0)).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
	tw.tween_property(card, "scale", base, _s(168.0))
	await _await_tween(tw)


## Everything else slides to its new place (FLIP: drawn at its old place from the first frame, then moved to the new one); a card
## turned sideways (tapped, untapped) turns there.
func _slides(before: Dictionary, after: Dictionary, arriving: Dictionary) -> void:
	for id: Variant in Val.dict(after, "cards").keys():
		if arriving.has(id):
			continue
		var now := _card(after, id)
		var was := _card(before, id)
		var zone := Val.text(now, "zone")
		if was.is_empty() or (zone != "battlefield" and zone != "hand" and zone != "back"):
			continue
		var node: Variant = now.get("node")
		if not _valid(node):
			continue
		var d := _center(was) - _center(now)
		var turn := Val.real(was, "rotation") - Val.real(now, "rotation")
		if absf(d.x) < MOVED_PX and absf(d.y) < MOVED_PX and absf(turn) < 0.01:
			continue
		var card := node as Control
		var rest := _rest_of(card)
		var base_pos: Vector2 = rest["position"]
		var base_rot: float = rest["rotation"]
		card.position = base_pos + d
		card.rotation = base_rot + turn
		var tw := _tween()
		tw.tween_interval(_s(120.0))
		tw.tween_property(card, "position", base_pos, _s(340.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)
		tw.parallel().tween_property(card, "rotation", base_rot, _s(340.0)).set_trans(Tween.TRANS_CUBIC).set_ease(Tween.EASE_OUT)


## Power and toughness changed without counters (pumps, shrinks, anthems: CR 613.4c): the card pulses and the change floats up.
func _stat_changes(events: Array, after: Dictionary, from: Dictionary, to: Dictionary) -> void:
	var countered: Dictionary = {}
	for ev: Variant in events:
		var e := Val.as_dict(ev)
		if Val.text(e, "type") == "countersChanged":
			countered[Val.text(e, "target")] = true
	var heard: Dictionary = {}
	for id: Variant in Val.dict(after, "cards").keys():
		var now := _card(after, id)
		var o1 := View.object(to, id)
		var o0 := View.object(from, id)
		if o1.is_empty() or o0.is_empty() or Val.text(now, "zone") != "battlefield" or countered.has(id):
			continue
		var c0 := Chars.of(from, o0)
		var c1 := Chars.of(to, o1)
		var p0 := Val.text(c0, "power")
		var p1 := Val.text(c1, "power")
		var t0 := Val.text(c0, "toughness")
		var t1 := Val.text(c1, "toughness")
		if not (p0.is_valid_int() and p1.is_valid_int() and t0.is_valid_int() and t1.is_valid_int()):
			continue
		var dp := p1.to_int() - p0.to_int()
		var dt := t1.to_int() - t0.to_int()
		if dp == 0 and dt == 0:
			continue
		var good := dp + dt > 0
		var sid := "stat.up" if good else "stat.down"
		if not heard.has(sid):
			heard[sid] = true
			_sound(sid, _center(now))
		_pulse(now["node"], GOOD_GLOW if good else BAD_GLOW, 1.1)
		_burst("nature" if good else "shadow", _center(now), maxf(_size(now).x, _size(now).y), 0.3, true)
		_floater(now, "%s%d/%s%d" % ["+" if dp >= 0 else "", dp, "+" if dt >= 0 else "", dt], "buff" if good else "debuff", 1, true)


## Life totals pop when they change (the hit or the light already showed why).
func _life_pops(after: Dictionary, from: Dictionary, to: Dictionary) -> void:
	for p1: Dictionary in View.players(to):
		var pid := Val.text(p1, "id")
		var p0 := View.player(from, pid)
		var disc := Val.dict(Val.dict(after, "avatars"), pid)
		if p0.is_empty() or disc.is_empty() or Val.num(p0, "life") == Val.num(p1, "life"):
			continue
		var node: Variant = disc.get("node")
		if not _valid(node):
			continue
		var panel := node as Control
		panel.pivot_offset = panel.size * 0.5
		var color := Color(0.55, 1.0, 0.67) if Val.num(p1, "life") > Val.num(p0, "life") else Color(1.0, 0.35, 0.35)
		_flash(panel, color, 520.0, 0.25)
		var tw := _tween()
		tw.tween_property(panel, "scale", Vector2.ONE * 1.12, _s(130.0)).set_trans(Tween.TRANS_BACK).set_ease(Tween.EASE_OUT)
		tw.tween_property(panel, "scale", Vector2.ONE, _s(390.0))


## "Your turn" across the middle of the table; one banner at a time.
func _banner(text: String, tone: String) -> void:
	for n: Variant in _made.duplicate():
		if is_instance_valid(n) and (n as Object).has_meta("banner"):
			_drop(n)
	var label := Label.new()
	label.set_meta("banner", true)
	label.text = text
	label.add_theme_font_size_override("font_size", 56)
	label.add_theme_constant_override("outline_size", 10)
	label.add_theme_color_override("font_outline_color", Color(0, 0, 0, 0.85))
	var colors := NeonTheme.colors()
	label.add_theme_color_override("font_color", colors[0].lightened(0.35) if tone == "mine" else colors[1].lightened(0.35))
	label.mouse_filter = Control.MOUSE_FILTER_IGNORE
	_table.fx_layer().add_child(label)
	_made.append(label)
	label.reset_size()
	label.pivot_offset = label.size * 0.5
	label.position = _table.board_rect().get_center() - label.size * 0.5
	label.scale = Vector2(0.28, 0.6)
	label.modulate.a = 0.0
	var ms := 2200.0 if tone == "win" or tone == "lose" else 760.0
	var tw := _tween()
	tw.tween_property(label, "scale", Vector2(1.06, 1.0), _s(ms * 0.18)).set_ease(Tween.EASE_OUT)
	tw.parallel().tween_property(label, "modulate:a", 1.0, _s(ms * 0.18))
	tw.tween_property(label, "scale", Vector2.ONE, _s(ms * 0.6))
	tw.tween_property(label, "scale", Vector2(1.65, 0.4), _s(ms * 0.22)).set_ease(Tween.EASE_IN)
	tw.parallel().tween_property(label, "modulate:a", 0.0, _s(ms * 0.22))
	tw.tween_callback(_drop.bind(label))


## A player lost a multiplayer game that goes on (CR 104.5, 800.4a): their panel takes the final blow and the table jolts.
func _eliminated(jobs: Jobs, lost: Array, after: Dictionary) -> void:
	var first: Variant = null
	for id: Variant in lost:
		var disc := Val.dict(Val.dict(after, "avatars"), String(id))
		if disc.is_empty():
			continue
		if first == null:
			first = _center(disc)
		_burst("fire", _center(disc), maxf(_size(disc).x, _size(disc).y), 0.8, false)
		if _valid(disc.get("node")):
			_recoil(disc["node"], 10.0, true, 0.8)
	_sound("game.finalBlow", first, 0.0, 0.8)
	_shake(12.0)
	await _sleep(600.0)
	jobs.end()


## The end (CR 104): the loser's panel takes a final blow and the table jolts hard. The result itself comes with the new view.
func _game_over(jobs: Jobs, lost: Array, after: Dictionary) -> void:
	var first: Variant = null
	for id: Variant in lost:
		var disc := Val.dict(Val.dict(after, "avatars"), String(id))
		if disc.is_empty():
			continue
		if first == null:
			first = _center(disc)
		_burst("fire", _center(disc), maxf(_size(disc).x, _size(disc).y), 1.0, false)
		if _valid(disc.get("node")):
			_recoil(disc["node"], 12.0, true, 1.0)
	_sound("game.finalBlow", first)
	_shake(20.0)
	await _sleep(700.0)
	jobs.end()


## The objects a player who left owned leave the game with them (CR 800.4a): each vanishes where it was, a few at a time; a face-down
## card revealed by the leave (CR 708.9) is named over its place first. At most 48 are animated.
func _leave_table(jobs: Jobs, gen: int, l: Dictionary, before: Dictionary) -> void:
	var gone: Array[Dictionary] = []
	for id: Variant in Val.list(l, "removed"):
		var e := _card(before, id)
		if not e.is_empty() and not _valid(e.get("node")) and gone.size() < 48:
			gone.append(e)
	if gone.is_empty():
		jobs.end()
		return
	_sound("card.exile", _center(gone[0]))
	var names: Dictionary = {}
	for r: Variant in Val.list(l, "revealed"):
		names[Val.text(Val.as_dict(r), "id")] = Val.text(Val.as_dict(r), "name")
	var inner := Jobs.new()
	for i: int in range(gone.size()):
		var e: Dictionary = gone[i]
		var shown := names.has(Val.text(e, "id"))
		if shown:
			_floater(e, String(names[Val.text(e, "id")]), "info", 1, true)
		inner.start()
		_banish_later(inner, gen, (420.0 if shown else 0.0) + mini(i, 16) * 40.0, e)
	await _wait(inner, 2400.0)
	jobs.end()


func _banish_later(jobs: Jobs, gen: int, ms: float, e: Dictionary) -> void:
	if ms > 0.0:
		await _sleep(ms)
	if gen == _gen:
		await _banish(e)
	jobs.end()

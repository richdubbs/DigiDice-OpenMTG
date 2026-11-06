class_name VfxBurst
extends GPUParticles2D
## One spell or impact effect (fx/Vfx/*.tscn: fire, lightning, arcane, shadow, leaves, radiance, dust, impact), the Godot side of the
## browser's vfx.ts canvas effects. Each scene is a one-shot GPUParticles2D with its own ParticleProcessMaterial and soft texture; the
## animator instances one per use and lets it free itself when its particles are gone. Particles are drawn on the effect layer, behind
## the cards when they strike a card (never over a card picture) and above the table for flights.
##
##   burst(at, size, power)       a one-shot burst at `at` (global canvas position), sized for a box of `size` px, `power` 0..1
##   trail(from, to, seconds)     a stream that follows a moving point from `from` to `to` (a projectile, a cast's trail); the
##                                animator tweens this node's position, the particles stay where they were emitted (global coords)

## Seconds the node lives after its last emission (particle lifetime is added).
const LINGER_S: float = 0.25


func burst(at: Vector2, size: float, power: float = 0.5) -> void:
	global_position = at
	var s := clampf(size / 120.0, 0.35, 3.0)
	scale = Vector2(s, s)
	amount_ratio = clampf(0.35 + power * 0.65, 0.2, 1.0)
	one_shot = true
	restart()
	emitting = true
	_free_after(lifetime + LINGER_S)


## Emit continuously (the animator moves this node); `stop_trail` ends it.
func trail(at: Vector2, size: float) -> void:
	global_position = at
	var s := clampf(size / 120.0, 0.35, 2.0)
	scale = Vector2(s, s)
	one_shot = false
	explosiveness = 0.0
	amount_ratio = 1.0
	restart()
	emitting = true


func stop_trail() -> void:
	emitting = false
	_free_after(lifetime + LINGER_S)


func _free_after(seconds: float) -> void:
	if not is_inside_tree():
		return
	get_tree().create_timer(seconds, false).timeout.connect(queue_free)

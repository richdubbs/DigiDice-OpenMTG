class_name Shake
extends RefCounted
## Screen shake for a hit: a port of the TypeScript source's packages/client/src/board/fx/shake.ts. 1 damage barely moves the table, 20 or more
## is a big jolt, everything in between scales smoothly, and every shake is quick (well under half a second). Pure maths; the animator
## plays the keyframes on the table's Camera2D (position, rotation and zoom, its scale).


## {amplitude (px), duration (ms, before the speed setting), rotation (degrees), zoom (extra scale at the hit)}.
static func none() -> Dictionary:
	return {"amplitude": 0.0, "duration": 0.0, "rotation": 0.0, "zoom": 0.0}


## 0 at 1 damage, 1 at 20 and more.
static func level(amount: float) -> float:
	if amount <= 1.0:
		return 0.0
	return minf(1.0, (amount - 1.0) / 19.0)


static func shake_for(amount: float) -> Dictionary:
	if not (amount > 0.0):
		return none()
	var e := pow(level(amount), 0.85)
	return {
		"amplitude": 1.2 + 26.8 * e,
		"duration": roundf(150.0 + 270.0 * e),
		"rotation": 1.6 * e * e,
		"zoom": 0.035 * e * e,
	}


## Keyframes of a decaying jolt (about 30 a second), deterministic for a seed; starts and ends at rest.
## Each is {at (0..1 of the duration), offset: Vector2 (px), rotation (degrees), scale}.
static func keyframes(s: Dictionary, seed_value: int = 7) -> Array[Dictionary]:
	var frames: int = maxi(4, roundi(Val.real(s, "duration") / 32.0))
	var r: int = (seed_value % 2147483646) + 1
	var out: Array[Dictionary] = [{"at": 0.0, "offset": Vector2.ZERO, "rotation": 0.0, "scale": 1.0}]
	var amplitude := Val.real(s, "amplitude")
	var turn := Val.real(s, "rotation")
	var zoom := Val.real(s, "zoom")
	for i: int in range(1, frames):
		var k := float(i) / float(frames)
		var decay := (1.0 - k) * (1.0 - k)
		# The first frame is the hardest hit: a full-size kick in a random direction.
		var strength := 1.0 if i == 1 else decay
		r = (r * 16807) % 2147483647
		var x := (float(r) / 2147483647.0 * 2.0 - 1.0) * amplitude * strength
		r = (r * 16807) % 2147483647
		var y := (float(r) / 2147483647.0 * 2.0 - 1.0) * amplitude * strength * 0.8
		r = (r * 16807) % 2147483647
		var rot := (float(r) / 2147483647.0 * 2.0 - 1.0) * turn * strength
		var sc := 1.0 + zoom * (1.0 if i == 1 else decay * 0.5)
		out.append({"at": k, "offset": Vector2(x, y), "rotation": rot, "scale": sc})
	out.append({"at": 1.0, "offset": Vector2.ZERO, "rotation": 0.0, "scale": 1.0})
	return out


## How hard a hit card or disc itself recoils (px), smaller than the screen shake.
static func recoil_for(amount: float) -> float:
	return 3.0 + 9.0 * pow(level(amount), 0.7)

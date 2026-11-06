class_name Val
extends RefCounted
## Safe readers for values parsed from JSON (the server's messages and views).
##
## JSON gives Variants: a field may be missing, null, or of another type than expected, and every JSON number arrives as a
## float. Reading through these helpers keeps typed GDScript from failing at runtime on a null or a float where an int was
## expected. Nothing here knows the game: it is plain JSON plumbing.


## The value as a String, or `fallback` when it is not text.
static func as_text(v: Variant, fallback: String = "") -> String:
	if v is String:
		return v
	if v is StringName:
		return String(v)
	return fallback


## The value as an int (JSON numbers arrive as floats), or `fallback` when it is not a number.
static func as_int(v: Variant, fallback: int = 0) -> int:
	if v is int:
		return v
	if v is float:
		return int(v)
	return fallback


## The value as a float, or `fallback` when it is not a number.
static func as_float(v: Variant, fallback: float = 0.0) -> float:
	if v is float:
		return v
	if v is int:
		return float(v)
	return fallback


## The value as a bool, or `fallback` when it is not one.
static func as_bool(v: Variant, fallback: bool = false) -> bool:
	if v is bool:
		return v
	return fallback


## The value as a Dictionary, or an empty one (the same empty Dictionary is never shared: a new one each call).
static func as_dict(v: Variant) -> Dictionary:
	if v is Dictionary:
		return v
	return {}


## The value as an Array, or an empty one.
static func as_list(v: Variant) -> Array:
	if v is Array:
		return v
	return []


## A list of texts (non-text entries are skipped).
static func as_texts(v: Variant) -> Array[String]:
	var out: Array[String] = []
	for x: Variant in as_list(v):
		if x is String:
			out.append(x)
	return out


static func text(d: Dictionary, key: String, fallback: String = "") -> String:
	return as_text(d.get(key), fallback)


static func num(d: Dictionary, key: String, fallback: int = 0) -> int:
	return as_int(d.get(key), fallback)


static func real(d: Dictionary, key: String, fallback: float = 0.0) -> float:
	return as_float(d.get(key), fallback)


static func flag(d: Dictionary, key: String, fallback: bool = false) -> bool:
	return as_bool(d.get(key), fallback)


static func dict(d: Dictionary, key: String) -> Dictionary:
	return as_dict(d.get(key))


static func list(d: Dictionary, key: String) -> Array:
	return as_list(d.get(key))


static func texts(d: Dictionary, key: String) -> Array[String]:
	return as_texts(d.get(key))


## Two JSON scalars are the same value (same type family and equal); numbers compare as numbers, so 3 equals 3.0.
static func same(a: Variant, b: Variant) -> bool:
	if typeof(a) == TYPE_NIL or typeof(b) == TYPE_NIL:
		return typeof(a) == TYPE_NIL and typeof(b) == TYPE_NIL
	if (a is int or a is float) and (b is int or b is float):
		return float(a) == float(b)
	if a is String and b is String:
		return a == b
	if a is bool and b is bool:
		return a == b
	return false

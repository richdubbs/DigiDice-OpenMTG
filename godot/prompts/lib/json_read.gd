extends RefCounted
## Typed reads from the server's JSON (the Dictionaries and Arrays that JSON.parse_string gives).
##
## JSON numbers arrive as floats, absent fields as missing keys and `undefined` never: every read here says what it expects and
## falls back to an empty value of that type, so a prompt never crashes on an optional field (decisions.ts marks many as optional).


## d[key] when it is a Dictionary, else {}.
static func dict(d: Dictionary, key: String) -> Dictionary:
	var v: Variant = d.get(key)
	if v is Dictionary:
		return v
	return {}


## d[key] when it is an Array, else [].
static func arr(d: Dictionary, key: String) -> Array:
	var v: Variant = d.get(key)
	if v is Array:
		return v
	return []


## The Dictionary elements of d[key] (other elements are skipped).
static func dicts(d: Dictionary, key: String) -> Array:
	var out: Array = []
	for x: Variant in arr(d, key):
		if x is Dictionary:
			out.append(x)
	return out


## The elements of d[key] as Strings.
static func strings(d: Dictionary, key: String) -> Array:
	var out: Array = []
	for x: Variant in arr(d, key):
		out.append(str(x))
	return out


## d[key] as a String; `fallback` when it is missing or null.
static func str_of(d: Dictionary, key: String, fallback: String = "") -> String:
	var v: Variant = d.get(key)
	if v == null:
		return fallback
	if v is String:
		return v
	return str(v)


## d[key] as an int (JSON numbers are floats); `fallback` when it is missing or not a number.
static func int_of(d: Dictionary, key: String, fallback: int = 0) -> int:
	var v: Variant = d.get(key)
	if v is int:
		return v
	if v is float:
		return int(v)
	return fallback


## d[key] is exactly `true`.
static func bool_of(d: Dictionary, key: String) -> bool:
	var v: Variant = d.get(key)
	return v is bool and v


## d has key with a non-null value (an optional TypeScript field that is present).
static func has(d: Dictionary, key: String) -> bool:
	return d.has(key) and d.get(key) != null


## Any Variant as an int (a float from JSON, an int, else `fallback`).
static func to_int(v: Variant, fallback: int = 0) -> int:
	if v is int:
		return v
	if v is float:
		return int(v)
	return fallback


## A list of Variants as a PackedStringArray, for String.join().
static func packed(list: Array) -> PackedStringArray:
	var out := PackedStringArray()
	for x: Variant in list:
		out.append(str(x))
	return out

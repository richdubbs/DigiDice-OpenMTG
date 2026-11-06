// The own card frame: a rounded card with a toned bevel, dark glass panels for the name, the
// type line and the rules text, a window where the procedural art sits, and a neon rim. With `sleeve` on it draws the card
// back instead (a neutral placeholder for the DigiDice sleeve of assets/brand/, which is not in this repository).
// Drawn on a ColorRect the size of the card (scenes/Card.tscn); `size` is that size in pixels (set by Card.gd).
shader_type canvas_item;

uniform vec2 size = vec2(120.0, 168.0);
uniform float radius = 7.0;
// The frame's colours (from the card's colours: one tone, or two for a two-colour card, gold for more).
uniform vec4 tone : source_color = vec4(0.45, 0.47, 0.52, 1.0);
uniform vec4 tone2 : source_color = vec4(0.45, 0.47, 0.52, 1.0);
uniform vec4 rim : source_color = vec4(0.121569, 0.721569, 1.0, 1.0);
uniform vec4 rim2 : source_color = vec4(0.960784, 0.0, 0.960784, 1.0);
uniform bool sleeve = false;
// Panels, as fractions of the card's height: name bar, art window, type bar, rules box.
uniform vec2 name_bar = vec2(0.03, 0.115);
uniform vec2 art_window = vec2(0.125, 0.56);
uniform vec2 type_bar = vec2(0.57, 0.635);
uniform vec2 text_box = vec2(0.645, 0.94);

// 1 at x = 0, falling to 0 at x = w (a soft line or edge).
float fall(float x, float w) {
	return 1.0 - smoothstep(0.0, w, x);
}

float sd_box(vec2 p, vec2 half_size, float r) {
	vec2 q = abs(p) - half_size + vec2(r);
	return length(max(q, vec2(0.0))) + min(max(q.x, q.y), 0.0) - r;
}

// Signed distance to a horizontal panel spanning [y0, y1] (fractions) with a side inset in pixels.
float panel(vec2 px, vec2 span, float inset, float r) {
	vec2 a = vec2(inset, span.x * size.y);
	vec2 b = vec2(size.x - inset, span.y * size.y);
	vec2 c = (a + b) * 0.5;
	return sd_box(px - c, (b - a) * 0.5, r);
}

void fragment() {
	vec2 px = UV * size;
	vec2 p = px - size * 0.5;
	float d = sd_box(p, size * 0.5, radius);
	float alpha = clamp(0.5 - d, 0.0, 1.0);
	if (alpha <= 0.0) {
		discard;
	}
	vec3 col;
	if (sleeve) {
		vec3 dark = vec3(0.02, 0.035, 0.08);
		float a1 = abs(fract((px.x + px.y) / 12.0) - 0.5);
		float a2 = abs(fract((px.x - px.y) / 12.0) - 0.5);
		float lattice = fall(min(a1, a2), 0.07);
		col = dark + rim2.rgb * lattice * 0.18;
		float inner = abs(sd_box(p, size * 0.5 - vec2(7.0), radius * 0.6));
		col += rim.rgb * fall(inner, 1.6) * 0.85;
		float diamond = abs(p.x) / (size.x * 0.24) + abs(p.y) / (size.y * 0.17);
		col += rim.rgb * fall(abs(diamond - 1.0), 0.07) * 0.9;
		col += rim2.rgb * fall(diamond, 1.0) * 0.12;
	} else {
		vec3 base = mix(tone.rgb, tone2.rgb, smoothstep(0.3, 0.7, UV.x));
		col = base * (0.62 + 0.3 * (1.0 - UV.y));
		// Bevel: the edge catches light at the top left and falls into shadow at the bottom right.
		float inside = -d;
		float bevel = fall(inside, 5.0);
		float lit = dot(normalize(p + vec2(0.0001)), vec2(-0.6, -0.8));
		col += vec3(bevel * lit * 0.22);
		// Dark glass panels with a faint lit edge.
		float glass = 0.0;
		float edge = 0.0;
		float pn = panel(px, name_bar, 5.0, 3.0);
		float pt = panel(px, type_bar, 5.0, 3.0);
		float pr = panel(px, text_box, 6.0, 3.0);
		float pa = panel(px, art_window, 6.0, 2.0);
		glass = max(glass, step(pn, 0.0) * 0.72);
		glass = max(glass, step(pt, 0.0) * 0.72);
		glass = max(glass, step(pr, 0.0) * 0.82);
		glass = max(glass, step(pa, 0.0) * 1.0);
		edge = max(edge, fall(abs(pn), 1.2));
		edge = max(edge, fall(abs(pt), 1.2));
		edge = max(edge, fall(abs(pr), 1.2));
		edge = max(edge, fall(abs(pa), 1.2));
		col = mix(col, vec3(0.03, 0.04, 0.07), glass);
		col += base * edge * 0.35;
	}
	// The neon rim along the card's edge.
	col += rim.rgb * fall(abs(d + 0.9), 1.8) * 0.75;
	COLOR = vec4(col, alpha * COLOR.a);
}

// A button as a physical neon slab (packages/client/src/theme/styles.css `button`): a face with a vertical gradient, a 1 px rim
// and a light along its top edge, sitting `depth` px above its side (the darker band under it), a soft drop shadow, a glow round
// it on hover, a light burst from the middle of the face on a press, and (Home's PLAY) a glint sweeping across it.
// Drawn on a quad larger than the button (pad px each side), behind the button's text (show_behind_parent).
shader_type canvas_item;

uniform vec2 quad_size = vec2(200.0, 100.0);
uniform vec2 pad = vec2(40.0, 40.0);
uniform vec2 face_size = vec2(120.0, 40.0);
uniform float radius = 10.0;
uniform float depth = 4.0;
// Up from rest in px: 1 on hover, -depth when pressed (the face sits on its side).
uniform float lift = 0.0;
uniform vec4 face_top : source_color = vec4(0.165, 0.302, 0.510, 1.0);
uniform vec4 face_mid : source_color = vec4(0.090, 0.196, 0.376, 1.0);
uniform vec4 face_bottom : source_color = vec4(0.059, 0.137, 0.278, 1.0);
uniform vec4 side : source_color = vec4(0.039, 0.290, 0.525, 1.0);
uniform vec4 rim : source_color = vec4(0.373, 0.804, 1.0, 0.7);
uniform vec4 top_light : source_color = vec4(0.745, 0.910, 1.0, 0.34);
uniform vec4 glow : source_color = vec4(0.122, 0.722, 1.0, 0.5);
// The glow's reach in px (0: none).
uniform float glow_size = 0.0;
// The press light, 1 at the press fading to 0.
uniform float flash = 0.0;
uniform vec4 flash_tint : source_color = vec4(0.122, 0.722, 1.0, 1.0);
// The glint's place across the face, 0..1 (outside: none).
uniform float glint = -1.0;
// A light over the face (the prompt's main button breathing), 0..1.
uniform float breathe = 0.0;

float box(vec2 p, vec2 half_size, float r) {
	vec2 q = abs(p) - half_size + r;
	return length(max(q, 0.0)) + min(max(q.x, q.y), 0.0) - r;
}

vec4 over(vec4 under, vec4 top) {
	float a = top.a + under.a * (1.0 - top.a);
	if (a <= 0.0001) {
		return vec4(0.0);
	}
	return vec4((top.rgb * top.a + under.rgb * under.a * (1.0 - top.a)) / a, a);
}

void fragment() {
	vec2 px = UV * quad_size;
	vec2 half_face = face_size * 0.5;
	vec2 rest = pad + half_face;
	vec2 face_c = rest - vec2(0.0, lift);
	float press = clamp(-lift / max(depth, 0.001), 0.0, 1.0);
	vec4 col = vec4(0.0);
	// The drop shadow under the slab, smaller and tighter when it is pressed down.
	float d_drop = box(px - (rest + vec2(0.0, depth + 4.0 - press * (depth + 2.0))), half_face, radius);
	col = over(col, vec4(0.0, 0.0, 0.0, 0.55 * (1.0 - smoothstep(-3.0, 12.0 - press * 8.0, d_drop))));
	// The glow round the face.
	float d_face = box(px - face_c, half_face, radius);
	if (glow_size > 0.0) {
		float g = exp(-max(d_face, 0.0) / (glow_size * 0.45)) * step(0.0, d_face);
		col = over(col, vec4(glow.rgb, glow.a * g));
	}
	// The side: a copy of the face `depth` px below its rest place; the face covers it as it sinks.
	float d_side = box(px - (rest + vec2(0.0, depth)), half_face, radius);
	col = over(col, vec4(side.rgb, side.a * clamp(0.5 - d_side, 0.0, 1.0)));
	// The face.
	float inside = clamp(0.5 - d_face, 0.0, 1.0);
	if (inside > 0.0) {
		float t = clamp((px.y - (face_c.y - half_face.y)) / face_size.y, 0.0, 1.0);
		vec3 f = t < 0.52 ? mix(face_top.rgb, face_mid.rgb, t / 0.52) : mix(face_mid.rgb, face_bottom.rgb, (t - 0.52) / 0.48);
		// The darker bottom (inset 0 -8px 16px), and pressed: the darker top and the light inside.
		float from_bottom = (face_c.y + half_face.y) - px.y;
		f *= 1.0 - 0.25 * (1.0 - smoothstep(0.0, 16.0, from_bottom));
		float from_top = px.y - (face_c.y - half_face.y);
		f *= 1.0 - press * 0.55 * (1.0 - smoothstep(0.0, 10.0, from_top));
		f += glow.rgb * glow.a * press * 0.35 * (1.0 - smoothstep(0.0, 18.0, -d_face));
		// The light along the top edge.
		f = mix(f, top_light.rgb, top_light.a * (1.0 - smoothstep(0.6, 1.6, from_top)) * (1.0 - press));
		// The glint: a skewed band of light crossing the face.
		if (glint >= 0.0 && glint <= 1.0) {
			float band = face_size.x * 0.34;
			float x0 = -1.3 * band + glint * (5.5 * band);
			float local_x = px.x - (face_c.x - half_face.x) + (px.y - face_c.y) * 0.364;
			float k = (local_x - x0) / band;
			f += vec3(1.0) * 0.5 * clamp(1.0 - abs(k - 0.5) * 2.0, 0.0, 1.0);
		}
		// The breathing light of the prompt's main button.
		f += vec3(1.0) * 0.12 * breathe;
		// The press light: from the middle of the face, white, then the neon, then nothing.
		if (flash > 0.0) {
			vec2 o = px - (face_c + vec2(0.0, half_face.y * 0.1));
			float r = length(o) / length(half_face);
			vec3 burst = mix(vec3(1.0) * 0.45, flash_tint.rgb * 0.18, smoothstep(0.0, 0.4, r)) * (1.0 - smoothstep(0.4, 0.7, r));
			f += burst * flash;
		}
		vec4 fc = vec4(f, 1.0);
		// The rim.
		fc = mix(fc, vec4(rim.rgb, 1.0), rim.a * clamp(1.0 + d_face + 0.5, 0.0, 1.0));
		col = over(col, vec4(fc.rgb, inside));
	}
	// The breathing glow round the prompt's main button.
	if (breathe > 0.0) {
		float g = exp(-max(d_face, 0.0) / 6.0) * step(0.0, d_face);
		col = over(col, vec4(glow.rgb, glow.a * g * breathe));
	}
	COLOR = col;
}

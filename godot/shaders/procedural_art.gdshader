// The art box of the own frame: a painterly picture drawn from the card's name, colours and types (a port of the browser's
// packages/client/src/cards/CardArt.tsx and artScenes.tsx). Card.gd computes every number with model/ArtSeed.gd, which ports
// the browser's hash, generator, palettes, seams and light positions exactly; this shader paints the scenes from them.
//
// Red is a fiery sky, blue deep water, green a forest canopy, black smoke under a moon, white a radiant dawn; two or three
// colours are separate scenes split by golden seams; artifacts are brass plates, colourless cards pale crystal; lands are
// landscapes. Phase 2 draws simplified motifs (noise and silhouettes, no creature figures or type overlays); the shapes are
// matched to the browser's SVG motifs in phase 3 with the replay look-alike check. Nothing here is official art.
//
// Coordinates: the browser's 100 x 70 box (x right, y down). No animation, no textures.
shader_type canvas_item;

uniform int scene_count = 1;
// Flavor ids (ArtSeed.FLAVOR_IDS): 0 W, 1 U, 2 B, 3 R, 4 G, 5 steel, 6 crystal, 7 terra.
uniform int flavor_0 = 7;
uniform int flavor_1 = 7;
uniform int flavor_2 = 7;
uniform bool land = false;
uniform bool gold = false;
uniform vec4 gold_color : source_color = vec4(0.983, 0.8215, 0.337, 1.0);

uniform vec4 sky0_0 : source_color = vec4(0.2, 0.25, 0.35, 1.0);
uniform vec4 sky1_0 : source_color = vec4(0.4, 0.4, 0.45, 1.0);
uniform vec4 sky2_0 : source_color = vec4(0.6, 0.55, 0.5, 1.0);
uniform vec4 glow_0 : source_color = vec4(1.0, 0.95, 0.8, 1.0);
uniform vec4 light_0 : source_color = vec4(0.9, 0.85, 0.7, 1.0);
uniform vec4 dark_0 : source_color = vec4(0.1, 0.1, 0.12, 1.0);
uniform vec3 glow_pos_0 = vec3(50.0, 30.0, 32.0);
uniform float seed_0 = 0.0;

uniform vec4 sky0_1 : source_color = vec4(0.2, 0.25, 0.35, 1.0);
uniform vec4 sky1_1 : source_color = vec4(0.4, 0.4, 0.45, 1.0);
uniform vec4 sky2_1 : source_color = vec4(0.6, 0.55, 0.5, 1.0);
uniform vec4 glow_1 : source_color = vec4(1.0, 0.95, 0.8, 1.0);
uniform vec4 light_1 : source_color = vec4(0.9, 0.85, 0.7, 1.0);
uniform vec4 dark_1 : source_color = vec4(0.1, 0.1, 0.12, 1.0);
uniform vec3 glow_pos_1 = vec3(50.0, 30.0, 32.0);
uniform float seed_1 = 0.0;

uniform vec4 sky0_2 : source_color = vec4(0.2, 0.25, 0.35, 1.0);
uniform vec4 sky1_2 : source_color = vec4(0.4, 0.4, 0.45, 1.0);
uniform vec4 sky2_2 : source_color = vec4(0.6, 0.55, 0.5, 1.0);
uniform vec4 glow_2 : source_color = vec4(1.0, 0.95, 0.8, 1.0);
uniform vec4 light_2 : source_color = vec4(0.9, 0.85, 0.7, 1.0);
uniform vec4 dark_2 : source_color = vec4(0.1, 0.1, 0.12, 1.0);
uniform vec3 glow_pos_2 = vec3(50.0, 30.0, 32.0);
uniform float seed_2 = 0.0;

// The seams between scenes: x at the top (y = -2) and at the bottom (y = 72) of the box.
uniform vec2 seam_0 = vec2(40.0, 28.0);
uniform vec2 seam_1 = vec2(73.0, 60.0);

float hash12(vec2 p) {
	vec3 p3 = fract(vec3(p.xyx) * 0.1031);
	p3 += dot(p3, p3.yzx + 33.33);
	return fract((p3.x + p3.y) * p3.z);
}

float noise(vec2 p) {
	vec2 i = floor(p);
	vec2 f = fract(p);
	vec2 u = f * f * (3.0 - 2.0 * f);
	float a = hash12(i);
	float b = hash12(i + vec2(1.0, 0.0));
	float c = hash12(i + vec2(0.0, 1.0));
	float d = hash12(i + vec2(1.0, 1.0));
	return mix(mix(a, b, u.x), mix(c, d, u.x), u.y);
}

float fbm(vec2 p) {
	vec2 x = p;
	float v = 0.0;
	float amp = 0.5;
	for (int i = 0; i < 4; i++) {
		v += amp * noise(x);
		x = x * 2.03 + vec2(17.1, 9.2);
		amp *= 0.5;
	}
	return v;
}

// A soft step from 0 below `edge` to 1 above it.
float above(float x, float edge) {
	return smoothstep(edge - 0.6, edge + 0.6, x);
}

// The light of the scene: the browser's radial gradient (0.95 at the centre, 0.35 at 40 %, 0 at the edge).
float halo(vec2 p, vec3 gp) {
	float r = length(p - gp.xy) / max(gp.z, 0.001);
	if (r < 0.4) {
		return mix(0.95, 0.35, r / 0.4);
	}
	return mix(0.35, 0.0, clamp((r - 0.4) / 0.6, 0.0, 1.0));
}

// The landscape line of a land of this flavor at x (y of the ridge).
float ridge_of(int flavor, float x, float sd, vec2 q) {
	if (flavor == 3) {
		return 30.0 + 18.0 * abs(fract(x / 28.0 + sd) - 0.5) * 2.0 + 7.0 * fbm(q * 6.0);
	} else if (flavor == 4) {
		return 36.0 + 12.0 * abs(fract(x / 6.5 + sd * 3.0) - 0.5) * 2.0 + 5.0 * fbm(q * 8.0);
	} else if (flavor == 1) {
		return 46.0 + 5.0 * sin(x * 0.07 + sd * 6.28) + 3.0 * fbm(q * 5.0);
	} else if (flavor == 2) {
		return 48.0 + 3.0 * fbm(q * 9.0) + 8.0 * step(0.86, fract(x / 17.0 + sd)) * (1.0 - fract(x / 17.0 + sd));
	} else if (flavor == 0) {
		return 44.0 + 4.0 * sin(x * 0.05 + sd * 6.28) + 2.0 * fbm(q * 4.0);
	}
	return 40.0 + 8.0 * fbm(q * 3.0 + sd);
}

vec3 scene(int flavor, vec3 s0, vec3 s1, vec3 s2, vec3 glow, vec3 light, vec3 dark, vec3 gp, float sd, vec2 p) {
	float v = clamp(p.y / 70.0, 0.0, 1.0);
	vec3 col = v < 0.55 ? mix(s0, s1, v / 0.55) : mix(s1, s2, (v - 0.55) / 0.45);
	col = mix(col, glow, halo(p, gp) * 0.85);
	vec2 q = p / 100.0 + vec2(sd * 7.31, sd * 3.17);
	if (land) {
		float r1 = ridge_of(flavor, p.x, sd, q);
		col = mix(col, dark * 1.1, above(p.y, r1));
		float r2 = r1 + 9.0 + 5.0 * fbm(q * 4.0 + 2.0);
		col = mix(col, dark * 0.55, above(p.y, r2));
		if (flavor == 1) {
			float wave = sin(p.x * 0.35 + p.y * 1.3 + sd * 20.0);
			col += light * smoothstep(0.92, 1.0, wave) * 0.25 * above(p.y, r1);
		}
		return col;
	}
	if (flavor == 3) {
		// Fire: flames rising from the bottom.
		float f = fbm(vec2(q.x * 9.0, p.y * 0.05) + sd * 5.0);
		float base = smoothstep(25.0, 70.0, p.y);
		float m = smoothstep(0.5, 0.68, f * 0.75 + base * 0.6 - 0.1);
		col = mix(col, light, m * 0.85);
		col = mix(col, glow, smoothstep(0.72, 0.9, f * 0.75 + base * 0.6) * 0.8);
	} else if (flavor == 1) {
		// Deep water: wave bands below the horizon line.
		float sea = above(p.y, 38.0);
		float wave = sin(p.x * 0.18 + sd * 20.0 + sin(p.y * 0.35 + sd) * 2.0);
		col = mix(col, dark, sea * 0.45 * smoothstep(38.0, 70.0, p.y));
		col += light * smoothstep(0.86, 1.0, wave) * sea * 0.3;
	} else if (flavor == 4) {
		// A forest canopy: dark leaves at the top and the bottom, light flecks.
		float leaves = fbm(q * 7.0);
		float top = smoothstep(0.5, 0.6, leaves + (1.0 - v) * 0.45 - 0.25);
		float bottom = smoothstep(0.5, 0.6, leaves + v * 0.45 - 0.3);
		col = mix(col, dark, max(top, bottom) * 0.85);
		col += light * smoothstep(0.78, 0.82, noise(p * 0.9 + sd * 40.0)) * 0.25;
	} else if (flavor == 2) {
		// Smoke under a moon.
		float s = fbm(q * 5.0 + vec2(0.0, v * 0.6));
		col = mix(col, dark, smoothstep(0.42, 0.7, s) * 0.75);
		col += light * smoothstep(0.62, 0.7, s) * (1.0 - smoothstep(0.7, 0.8, s)) * 0.18;
	} else if (flavor == 0) {
		// A radiant dawn: rays from the light.
		float ang = atan(p.y - gp.y, p.x - gp.x);
		float r = length(p - gp.xy) / max(gp.z, 0.001);
		float rays = pow(abs(sin(ang * 9.0 + sd * 10.0)), 8.0) * (1.0 - clamp(r / 3.0, 0.0, 1.0));
		col += light * rays * 0.35;
		col = mix(col, light, smoothstep(0.55, 0.62, fbm(q * 4.0)) * smoothstep(40.0, 70.0, p.y) * 0.5);
	} else if (flavor == 5) {
		// Brass plates with rivets.
		vec2 cell = fract(p / vec2(25.0, 17.5) + vec2(sd, 0.0));
		float edge = min(min(cell.x, 1.0 - cell.x) * 25.0, min(cell.y, 1.0 - cell.y) * 17.5);
		col = mix(col, light * 0.65, (1.0 - smoothstep(0.0, 0.9, edge)) * 0.6);
		vec2 c = abs(cell - 0.5) * vec2(25.0, 17.5);
		float rivet = length(c - vec2(10.5, 6.8));
		col = mix(col, light, (1.0 - smoothstep(0.6, 1.1, rivet)) * 0.7);
	} else if (flavor == 6) {
		// Pale crystal facets.
		vec2 c = p / 14.0 + sd * 3.0;
		float fa = abs(fract(c.x + c.y * 0.5) - 0.5) + abs(fract(c.y - c.x * 0.3) - 0.5);
		col = mix(col, light, smoothstep(0.8, 0.95, fa) * 0.4);
		col = mix(col, dark, smoothstep(0.0, 0.12, 0.12 - fa) * 0.3);
	} else {
		float r1 = ridge_of(7, p.x, sd, q);
		col = mix(col, dark, above(p.y, r1));
	}
	return col;
}

void fragment() {
	vec2 p = vec2(UV.x * 100.0, UV.y * 70.0);
	float t = (p.y + 2.0) / 74.0;
	float x0 = mix(seam_0.x, seam_0.y, t);
	float x1 = mix(seam_1.x, seam_1.y, t);
	int idx = 0;
	if (scene_count > 1 && p.x >= x0) {
		idx = 1;
	}
	if (scene_count > 2 && p.x >= x1) {
		idx = 2;
	}
	vec3 col;
	if (idx == 0) {
		col = scene(flavor_0, sky0_0.rgb, sky1_0.rgb, sky2_0.rgb, glow_0.rgb, light_0.rgb, dark_0.rgb, glow_pos_0, seed_0, p);
	} else if (idx == 1) {
		col = scene(flavor_1, sky0_1.rgb, sky1_1.rgb, sky2_1.rgb, glow_1.rgb, light_1.rgb, dark_1.rgb, glow_pos_1, seed_1, p);
	} else {
		col = scene(flavor_2, sky0_2.rgb, sky1_2.rgb, sky2_2.rgb, glow_2.rgb, light_2.rgb, dark_2.rgb, glow_pos_2, seed_2, p);
	}
	if (scene_count > 1) {
		float ds = abs(p.x - x0);
		if (scene_count > 2) {
			ds = min(ds, abs(p.x - x1));
		}
		col = mix(col, gold_color.rgb, (1.0 - smoothstep(0.0, 0.6, ds)) * 0.9);
		col = mix(col, gold_color.rgb, (1.0 - smoothstep(0.0, 3.5, ds)) * 0.22);
	}
	if (gold) {
		col = mix(col, gold_color.rgb, 0.08);
	}
	COLOR = vec4(col, COLOR.a);
}

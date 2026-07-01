#include ./lib/noise.glsl;

uniform float uTime;
uniform vec2 uResolution;
uniform vec3 uColorA;
uniform vec3 uColorB;
uniform float uWarp;

varying vec2 vUv;

void main() {
  vec2 uv = vUv;
  float aspect = uResolution.x / max(uResolution.y, 1.0);
  vec2 p = (uv - 0.5) * vec2(aspect, 1.0);

  float t = uTime * 0.05;

  // Domain warping: perturb the sample coordinates with two fbm passes.
  vec3 q = vec3(fbm(vec3(p * 2.0, t), 5, 2.0, 0.5),
                fbm(vec3(p * 2.0 + 5.2, t), 5, 2.0, 0.5), t);
  vec3 r = vec3(fbm(vec3(p * 2.0 + 4.0 * q.xy + 1.7, t), 5, 2.0, 0.5),
                fbm(vec3(p * 2.0 + 4.0 * q.xy + 9.2, t), 5, 2.0, 0.5), t);

  float f = fbm(vec3(p * 2.0 + uWarp * r.xy, t), 6, 2.0, 0.5);
  f = f * 0.5 + 0.5;

  // Mix palette based on warped field + fbm magnitude.
  vec3 col = mix(uColorA, uColorB, clamp(f, 0.0, 1.0));
  col = mix(col, palette(length(q) + t, vec3(0.5), vec3(0.5), vec3(1.0), vec3(0.0, 0.33, 0.67)),
            clamp(dot(q.xy, q.xy) * 0.4, 0.0, 0.6));

  // Subtle vignette.
  col *= 1.0 - 0.5 * dot(p, p);

  gl_FragColor = vec4(col, 1.0);
}

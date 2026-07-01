#include ./lib/noise.glsl;

uniform float uTime;
uniform vec3 uGlowColor;
uniform float uBands;
uniform float uSpeed;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying vec2 vUv;
varying vec3 vWorldPos;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);

  // Animated energy bands along the knot's length (uv.x runs around it).
  float bands = sin(vUv.x * uBands + uTime * uSpeed);
  bands += 0.5 * sin(vUv.y * uBands * 2.0 - uTime * uSpeed * 1.3);

  // Turbulence over the surface in world space.
  float turb = fbm(vWorldPos * 1.5 + uTime * 0.2, 4, 2.0, 0.5);

  float energy = smoothstep(0.2, 0.9, bands * 0.5 + 0.5 + turb * 0.4);

  // Fresnel glow at grazing angles.
  float fres = pow(1.0 - max(dot(N, V), 0.0), 2.5);

  vec3 hot = palette(energy + uTime * 0.05, vec3(0.5), vec3(0.5),
                     vec3(1.0), vec3(0.0, 0.1, 0.2));
  vec3 col = hot * energy;
  col += uGlowColor * fres * 1.5;
  col += uGlowColor * pow(energy, 3.0) * 0.8;

  gl_FragColor = vec4(col, 1.0);
}

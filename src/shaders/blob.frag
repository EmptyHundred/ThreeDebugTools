#include ./lib/noise.glsl;

uniform float uTime;
uniform vec3 uLightDir;
uniform float uFresnelPower;
uniform float uIridescence;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vDisplacement;

void main() {
  vec3 N = normalize(vNormal);
  vec3 V = normalize(vViewPosition);
  vec3 L = normalize(uLightDir);

  // Diffuse + specular (Blinn-Phong).
  float diff = max(dot(N, L), 0.0);
  vec3 H = normalize(L + V);
  float spec = pow(max(dot(N, H), 0.0), 64.0);

  // Fresnel rim.
  float fres = pow(1.0 - max(dot(N, V), 0.0), uFresnelPower);

  // Iridescent tint driven by fresnel + displacement + view angle.
  float t = fres * 2.0 + vDisplacement + uTime * 0.1;
  vec3 irid = palette(t, vec3(0.5), vec3(0.5), vec3(1.0),
                      vec3(0.0, 0.33, 0.67));

  vec3 base = mix(vec3(0.05, 0.07, 0.12), vec3(0.2, 0.4, 0.6), diff);
  vec3 col = base + irid * fres * uIridescence + spec * vec3(1.0);

  gl_FragColor = vec4(col, 1.0);
}

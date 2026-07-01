#include ./lib/noise.glsl;

uniform float uTime;
uniform float uDisplace;
uniform float uFreq;

varying vec3 vNormal;
varying vec3 vViewPosition;
varying float vDisplacement;

// Displace a point along its normal by fbm; used to derive normals via
// finite differences so lighting matches the deformed surface.
vec3 displace(vec3 p, out float amt) {
  amt = fbm(p * uFreq + vec3(0.0, 0.0, uTime * 0.3), 5, 2.0, 0.5);
  return p + normal * amt * uDisplace;
}

void main() {
  float amt;
  vec3 displaced = displace(position, amt);
  vDisplacement = amt;

  // Recompute normal from two tangent neighbours on the displaced surface.
  vec3 tangent = normalize(cross(normal, vec3(0.0, 1.0, 0.0) + 0.001));
  vec3 bitangent = normalize(cross(normal, tangent));
  float e = 0.05;
  float a1, a2;
  vec3 p1 = displace(position + tangent * e, a1);
  vec3 p2 = displace(position + bitangent * e, a2);
  vec3 newNormal = normalize(cross(p1 - displaced, p2 - displaced));

  vec4 mvPosition = modelViewMatrix * vec4(displaced, 1.0);
  vNormal = normalize(normalMatrix * newNormal);
  vViewPosition = -mvPosition.xyz;
  gl_Position = projectionMatrix * mvPosition;
}

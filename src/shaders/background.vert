varying vec2 vUv;

void main() {
  vUv = uv;
  // Fullscreen: the plane is rendered directly in clip space.
  gl_Position = vec4(position.xy, 0.0, 1.0);
}

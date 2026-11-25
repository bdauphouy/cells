/* A full-screen triangle pair, emitted straight in clip space: the grid is
 * drawn in screen pixels, not in the scene, so the camera (and its lean toward
 * the pointer) has no say in where a fragment lands. */
void main() {
  gl_Position = vec4(position.xy, 0.0, 1.0);
}

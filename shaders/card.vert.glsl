#define PI 3.14159265359

uniform vec2 uPlaneSizes;
uniform float uCurl;
uniform float uScrollSpeed;
uniform float uSquash;
uniform float uCenterY;
uniform float uLens;
uniform float uWhip;
uniform float uFog;
uniform float uSwell;

varying vec2 vUv;
varying float vShade;

void main() {
  // Motion smear: the card pinches vertically and spreads sideways with
  // speed. Capped so it can never widen past its angular wedge.
  float rush = min(abs(uScrollSpeed), 0.6);

  vec3 pos = position;
  pos.x *= 1.0 + rush * uSquash * 0.6;
  pos.y *= 1.0 - rush * uSquash;

  // Margin for the fragment stage's soft border — the card itself keeps its
  // size, the plane around it does not. The angular margin survives it: a
  // card only reaches its neighbour's plane past 1.77x its width, and the
  // swell tops out well under that.
  pos.xy *= uSwell;

  // Curl the sheet outward from the cylinder. Bulging along the local z
  // leaves the angular wedge untouched, so cards still cannot cross.
  float curl = sin(uv.x * PI);
  pos.z += curl * uCurl;

  vec3 worldPosition = (modelMatrix * vec4(position, 1.0)).xyz;
  vec4 modelPosition = modelMatrix * vec4(pos, 1.0);
  vec4 viewPosition = viewMatrix * modelPosition;

  // Screen-space warps. These shift the projected x only — view depth is
  // untouched, so the cards still sort correctly against each other.
  // Bow is measured from the helix's visual centre, not the world origin.
  float bowY = worldPosition.y - uCenterY;
  viewPosition.x += bowY * bowY * uLens;
  viewPosition.x += sin(uv.y * PI) * uScrollSpeed * uWhip;

  gl_Position = projectionMatrix * viewPosition;

  // Fake lighting off the curl, so the bend actually reads as a bend.
  float slope = uCurl * PI * cos(uv.x * PI) / uPlaneSizes.x;
  vec3 n = normalize(mat3(modelMatrix) * normalize(vec3(-slope, 0.0, 1.0)));
  vec3 toCamera = normalize(cameraPosition - worldPosition);
  vShade = mix(0.72, 1.08, abs(dot(n, toCamera)));

  vUv = uv;
}

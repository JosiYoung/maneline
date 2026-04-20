// Shared scroll progress pipe between GSAP ScrollTrigger (DOM side) and the
// R3F useFrame loop (3D side). A mutable module-level object avoids React
// re-renders on every scroll tick — only the GPU sees the change.
export const scrollState = {
  progress: 0,
};

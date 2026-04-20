import { Suspense, useMemo, useRef } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import {
  Environment,
  Float,
  ContactShadows,
  MeshTransmissionMaterial,
  Preload,
} from '@react-three/drei';
import * as THREE from 'three';

// Scroll progress is read from this module-level ref so ScrollTrigger (DOM)
// and useFrame (R3F) can share state without re-renders.
import { scrollState } from './scrollState';

// ---- Camera keyframes -------------------------------------------------------
// Three cinematic beats. Scroll offset [0..1] lerps between them.
//   0 — sunrise over the plains, camera low, looking into the sun
//   1 — closer on the "herb vials" drifting in shafts of light
//   2 — pulled back wide, horizon opening up, long lens
const KEYS = [
  { pos: new THREE.Vector3(0, 1.2, 7.5),  look: new THREE.Vector3(0, 1.4, 0),    fov: 38 },
  { pos: new THREE.Vector3(1.2, 0.6, 3.2), look: new THREE.Vector3(0, 0.6, 0),   fov: 32 },
  { pos: new THREE.Vector3(-0.2, 2.4, 11), look: new THREE.Vector3(0, 1.0, -4),  fov: 28 },
];

function lerpKey(t: number) {
  // t in [0..2]. Interpolate between segment endpoints.
  const i = Math.min(1, Math.floor(t));
  const f = THREE.MathUtils.clamp(t - i, 0, 1);
  const a = KEYS[i];
  const b = KEYS[i + 1] ?? KEYS[KEYS.length - 1];
  const pos = a.pos.clone().lerp(b.pos, f);
  const look = a.look.clone().lerp(b.look, f);
  const fov = THREE.MathUtils.lerp(a.fov, b.fov, f);
  return { pos, look, fov };
}

function CameraRig() {
  const smoothed = useRef(0);
  const tmp = useRef(new THREE.Vector3());

  useFrame((state, dt) => {
    // Damp raw scroll progress for inertial feel. Higher = snappier.
    const target = scrollState.progress * (KEYS.length - 1);
    smoothed.current = THREE.MathUtils.damp(smoothed.current, target, 4, dt);

    const { pos, look, fov } = lerpKey(smoothed.current);
    state.camera.position.lerp(pos, 1 - Math.exp(-dt * 5));
    tmp.current.copy(look);
    state.camera.lookAt(tmp.current);

    // @ts-expect-error PerspectiveCamera has fov, OrthographicCamera does not
    if (state.camera.fov !== fov) {
      // @ts-expect-error see above
      state.camera.fov = THREE.MathUtils.damp(state.camera.fov, fov, 4, dt);
      state.camera.updateProjectionMatrix();
    }
  });

  return null;
}

// ---- Terrain: layered silhouetted ridges, Ansel-Adams parallax --------------
function Ridge({ z, color, height, seed }: { z: number; color: string; height: number; seed: number }) {
  const geom = useMemo(() => {
    const w = 80;
    const segs = 220;
    const g = new THREE.PlaneGeometry(w, 6, segs, 1);
    const pos = g.attributes.position;
    // Carve a ridge silhouette across the top row of verts.
    for (let i = 0; i < pos.count; i++) {
      const x = pos.getX(i);
      const y = pos.getY(i);
      if (y > 0) {
        // Multi-octave noise via stacked sines keyed off seed.
        const n =
          Math.sin(x * 0.18 + seed) * 0.55 +
          Math.sin(x * 0.41 + seed * 2.3) * 0.28 +
          Math.sin(x * 0.93 + seed * 5.1) * 0.12;
        pos.setY(i, y + n * height);
      }
    }
    g.computeVertexNormals();
    return g;
  }, [height, seed]);

  return (
    <mesh geometry={geom} position={[0, 0, z]}>
      <meshStandardMaterial
        color={color}
        roughness={1}
        metalness={0}
        fog
      />
    </mesh>
  );
}

// ---- Drifting motes: dust / pollen / herb particles -------------------------
function Motes({ count = 600 }: { count?: number }) {
  const points = useRef<THREE.Points>(null!);
  const positions = useMemo(() => {
    const arr = new Float32Array(count * 3);
    for (let i = 0; i < count; i++) {
      arr[i * 3 + 0] = (Math.random() - 0.5) * 20;
      arr[i * 3 + 1] = Math.random() * 6;
      arr[i * 3 + 2] = (Math.random() - 0.5) * 16 - 2;
    }
    return arr;
  }, [count]);

  useFrame((state, dt) => {
    if (!points.current) return;
    points.current.rotation.y += dt * 0.02;
    const t = state.clock.elapsedTime;
    const attr = points.current.geometry.attributes.position as THREE.BufferAttribute;
    for (let i = 0; i < count; i++) {
      const y = attr.getY(i) + dt * 0.08 + Math.sin(t + i) * dt * 0.05;
      attr.setY(i, y > 6 ? 0 : y);
    }
    attr.needsUpdate = true;
  });

  return (
    <points ref={points}>
      <bufferGeometry>
        <bufferAttribute
          attach="attributes-position"
          args={[positions, 3]}
        />
      </bufferGeometry>
      <pointsMaterial
        size={0.022}
        color="#ffe6bf"
        transparent
        opacity={0.85}
        sizeAttenuation
        depthWrite={false}
      />
    </points>
  );
}

// ---- Hero props: floating glass "vials" at scene 2 --------------------------
function Vials() {
  const group = useRef<THREE.Group>(null!);
  useFrame((_, dt) => {
    if (group.current) group.current.rotation.y += dt * 0.08;
  });

  return (
    <group ref={group} position={[0, 0.7, 0]}>
      {[-0.9, 0, 0.9].map((x, i) => (
        <Float key={i} speed={1.2 + i * 0.3} rotationIntensity={0.4} floatIntensity={0.6}>
          <mesh position={[x, Math.sin(i) * 0.15, i === 1 ? 0 : -0.2]}>
            <cylinderGeometry args={[0.18, 0.18, 0.7, 48, 1, false]} />
            <MeshTransmissionMaterial
              thickness={0.6}
              roughness={0.05}
              transmission={1}
              ior={1.45}
              chromaticAberration={0.05}
              anisotropy={0.3}
              distortion={0.1}
              distortionScale={0.4}
              temporalDistortion={0.1}
              color="#e8d9a8"
            />
          </mesh>
          {/* cap */}
          <mesh position={[x, 0.42 + Math.sin(i) * 0.15, i === 1 ? 0 : -0.2]}>
            <cylinderGeometry args={[0.19, 0.19, 0.1, 32]} />
            <meshStandardMaterial color="#2b1d10" roughness={0.4} metalness={0.6} />
          </mesh>
        </Float>
      ))}
    </group>
  );
}

// ---- Sun disc: fat bloom cheat via sprite -----------------------------------
function Sun() {
  return (
    <mesh position={[0, 1.8, -22]}>
      <circleGeometry args={[3.2, 64]} />
      <meshBasicMaterial color="#ffd8a3" transparent opacity={0.92} toneMapped={false} />
    </mesh>
  );
}

export default function Scene3D() {
  return (
    <Canvas
      className="!fixed inset-0"
      dpr={[1, 2]}
      gl={{ antialias: true, powerPreference: 'high-performance' }}
      camera={{ position: [0, 1.2, 7.5], fov: 38, near: 0.1, far: 200 }}
      onCreated={({ gl, scene }) => {
        gl.toneMapping = THREE.ACESFilmicToneMapping;
        gl.toneMappingExposure = 1.05;
        scene.fog = new THREE.FogExp2('#e7b985', 0.035);
        scene.background = new THREE.Color('#f3c58c');
      }}
    >
      <CameraRig />

      <Suspense fallback={null}>
        <Environment preset="sunset" background={false} />
      </Suspense>

      {/* Key warm sun light + cool fill */}
      <directionalLight
        position={[-6, 4, -8]}
        intensity={2.2}
        color="#ffb773"
        castShadow
      />
      <hemisphereLight args={['#ffd7a8', '#3a2a1f', 0.4]} />

      <Sun />

      {/* Ridge layers — far to near, desaturating warmth as they recede */}
      <Ridge z={-18} color="#c88a5a" height={1.4} seed={1.1} />
      <Ridge z={-12} color="#8f5a3a" height={1.1} seed={3.7} />
      <Ridge z={-6}  color="#4a2d1e" height={0.9} seed={6.2} />

      {/* Foreground prairie plane */}
      <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.01, 0]} receiveShadow>
        <planeGeometry args={[120, 120, 1, 1]} />
        <meshStandardMaterial color="#2a1a12" roughness={1} />
      </mesh>

      <Vials />
      <Motes />
      <ContactShadows position={[0, 0.005, 0]} opacity={0.45} blur={2.5} far={4} />

      <Preload all />
    </Canvas>
  );
}

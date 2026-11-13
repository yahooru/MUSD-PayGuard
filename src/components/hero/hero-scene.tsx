"use client";

import { RoundedBox } from "@react-three/drei";
import { Canvas, useFrame } from "@react-three/fiber";
import { useMemo, useRef } from "react";
import * as THREE from "three";
import { HERO_GATES } from "./gates";

const CYAN = new THREE.Color("#45d9ec");
const PASS = new THREE.Color("#52e0a1");
const WARN = new THREE.Color("#f7bd52");
const IDLE = new THREE.Color("#2a3d5c");
const VIOLET = new THREE.Color("#a294ff");

const GATE_X = [-4.2, -2.1, 0, 2.1, 4.2];
const START_X = -6.6;
const WALLET_X = 6.4;
const CYCLE = 8.5; // seconds per full pass

/** Translucent hexagonal prism (the shield) with crisp edges. Cheap: no transmission shader. */
function Prism() {
  const geo = useMemo(() => {
    const g = new THREE.CylinderGeometry(1.75, 1.75, 14.4, 6, 1, true);
    g.rotateZ(Math.PI / 2);
    return g;
  }, []);
  const edges = useMemo(() => new THREE.EdgesGeometry(geo, 1), [geo]);
  return (
    <group>
      <mesh geometry={geo}>
        <meshStandardMaterial color="#0f2238" transparent opacity={0.16} side={THREE.DoubleSide} roughness={0.35} metalness={0.2} depthWrite={false} />
      </mesh>
      <lineSegments geometry={edges}>
        <lineBasicMaterial color="#45d9ec" transparent opacity={0.28} />
      </lineSegments>
    </group>
  );
}

function Gate({ x, index, litAt, progress }: { x: number; index: number; litAt: number; progress: React.MutableRefObject<number> }) {
  const ring = useRef<THREE.MeshStandardMaterial>(null);
  const inner = useRef<THREE.MeshStandardMaterial>(null);
  const tone = HERO_GATES[index]!.tone === "warn" ? WARN : PASS;
  useFrame(() => {
    const lit = progress.current >= litAt;
    const target = lit ? tone : IDLE;
    if (ring.current) {
      ring.current.emissive.lerp(target, 0.12);
      ring.current.emissiveIntensity = THREE.MathUtils.lerp(ring.current.emissiveIntensity, lit ? 1.8 : 0.35, 0.1);
    }
    if (inner.current) inner.current.opacity = THREE.MathUtils.lerp(inner.current.opacity, lit ? 0.16 : 0.03, 0.1);
  });
  return (
    <group position={[x, 0, 0]} rotation={[0, Math.PI / 2, 0]}>
      <mesh>
        <torusGeometry args={[1.18, 0.05, 16, 96]} />
        <meshStandardMaterial ref={ring} color="#1a2a44" emissive={IDLE} emissiveIntensity={0.35} roughness={0.3} metalness={0.6} />
      </mesh>
      <mesh>
        <circleGeometry args={[1.12, 48]} />
        <meshStandardMaterial ref={inner} color={tone} emissive={tone} emissiveIntensity={0.6} transparent opacity={0.03} side={THREE.DoubleSide} depthWrite={false} />
      </mesh>
    </group>
  );
}

function Packet({ progress }: { progress: React.MutableRefObject<number> }) {
  const ref = useRef<THREE.Group>(null);
  const trail = useRef<THREE.Mesh[]>([]);
  useFrame((state) => {
    const p = progress.current;
    const x = THREE.MathUtils.lerp(START_X, WALLET_X - 0.9, Math.min(1, p));
    if (ref.current) {
      ref.current.position.set(x, Math.sin(state.clock.elapsedTime * 2.2) * 0.05, 0);
      ref.current.rotation.x += 0.012;
      ref.current.rotation.y += 0.018;
      ref.current.visible = p < 1.02;
    }
    trail.current.forEach((m, i) => {
      if (!m) return;
      m.position.set(x - (i + 1) * 0.28, 0, 0);
      (m.material as THREE.MeshBasicMaterial).opacity = p < 1.02 ? 0.22 - i * 0.045 : 0;
    });
  });
  return (
    <>
      <group ref={ref}>
        <mesh>
          <octahedronGeometry args={[0.3, 0]} />
          <meshStandardMaterial color="#7fe8f5" emissive={CYAN} emissiveIntensity={2.4} roughness={0.2} metalness={0.3} />
        </mesh>
        <pointLight color="#45d9ec" intensity={3} distance={3.2} />
      </group>
      {[0, 1, 2, 3].map((i) => (
        <mesh key={i} ref={(m) => { if (m) trail.current[i] = m; }}>
          <sphereGeometry args={[0.12 - i * 0.02, 12, 12]} />
          <meshBasicMaterial color="#45d9ec" transparent opacity={0.2} depthWrite={false} />
        </mesh>
      ))}
    </>
  );
}

function Wallet({ progress }: { progress: React.MutableRefObject<number> }) {
  const mat = useRef<THREE.MeshStandardMaterial>(null);
  useFrame(() => {
    const arrived = progress.current >= 1;
    if (mat.current) {
      mat.current.emissive.lerp(arrived ? VIOLET : IDLE, 0.1);
      mat.current.emissiveIntensity = THREE.MathUtils.lerp(mat.current.emissiveIntensity, arrived ? 1.2 : 0.25, 0.1);
    }
  });
  return (
    <group position={[WALLET_X, 0, 0]}>
      <RoundedBox args={[0.9, 1.5, 1.1]} radius={0.14} smoothness={4}>
        <meshStandardMaterial ref={mat} color="#16243b" emissive={IDLE} emissiveIntensity={0.25} roughness={0.45} metalness={0.5} />
      </RoundedBox>
      <mesh position={[-0.46, 0, 0]} rotation={[0, -Math.PI / 2, 0]}>
        <planeGeometry args={[0.7, 0.08]} />
        <meshBasicMaterial color="#a294ff" />
      </mesh>
    </group>
  );
}

function Rig({ children }: { children: React.ReactNode }) {
  const g = useRef<THREE.Group>(null);
  useFrame((state) => {
    if (!g.current) return;
    const { x, y } = state.pointer;
    g.current.rotation.y = THREE.MathUtils.lerp(g.current.rotation.y, -0.1 + x * 0.06, 0.04);
    g.current.rotation.x = THREE.MathUtils.lerp(g.current.rotation.x, 0.12 - y * 0.05, 0.04);
  });
  return (
    <group ref={g} scale={0.66}>
      {children}
    </group>
  );
}

function Scene({ onStage }: { onStage: (s: number) => void }) {
  const progress = useRef(0);
  const stageRef = useRef(0);
  const litAt = GATE_X.map((x) => (x - START_X) / (WALLET_X - 0.9 - START_X));
  useFrame((state) => {
    const t = (state.clock.elapsedTime % CYCLE) / (CYCLE - 2.2); // last 2.2s: hold at the wallet
    progress.current = Math.min(1.05, t);
    const s = litAt.filter((a) => progress.current >= a).length + (progress.current >= 1 ? 1 : 0);
    if (s !== stageRef.current) {
      stageRef.current = s;
      onStage(s);
    }
  });
  return (
    <>
      <color attach="background" args={["#060a13"]} />
      <fog attach="fog" args={["#060a13", 9, 22]} />
      <ambientLight intensity={0.35} />
      <directionalLight position={[4, 6, 6]} intensity={1.1} color="#cfe9ff" />
      <directionalLight position={[-6, -2, -4]} intensity={0.4} color="#a294ff" />
      <Rig>
        <Prism />
        <mesh rotation={[0, 0, Math.PI / 2]}>
          <cylinderGeometry args={[0.012, 0.012, 13.2, 8]} />
          <meshBasicMaterial color="#2a3d5c" />
        </mesh>
        {GATE_X.map((x, i) => (
          <Gate key={i} x={x} index={i} litAt={litAt[i]!} progress={progress} />
        ))}
        <Packet progress={progress} />
        <Wallet progress={progress} />
      </Rig>
    </>
  );
}

export default function HeroScene({ active, onStage }: { active: boolean; onStage: (s: number) => void }) {
  return (
    <Canvas
      dpr={[1, 1.75]}
      frameloop={active ? "always" : "never"}
      camera={{ position: [0, 0.9, 13], fov: 40 }}
      gl={{ antialias: true, powerPreference: "high-performance", alpha: false }}
      aria-hidden
    >
      <Scene onStage={onStage} />
    </Canvas>
  );
}

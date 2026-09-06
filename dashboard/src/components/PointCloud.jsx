import { GizmoHelper, GizmoViewport, OrbitControls, PerspectiveCamera } from '@react-three/drei'
import { Canvas } from '@react-three/fiber'
import { useEffect, useMemo, useRef } from 'react'
import { colorForClass, hexToRgb } from '../palette'

function Cloud({ interleaved, hiddenClasses }) {
  const { positions, colors } = useMemo(() => {
    const visibleCount = Array.from({ length: interleaved.length / 4 }, (_, index) => index)
      .filter((index) => !hiddenClasses.has(Math.round(interleaved[index * 4 + 3]))).length
    const nextPositions = new Float32Array(visibleCount * 3)
    const nextColors = new Float32Array(visibleCount * 3)
    let visibleIndex = 0
    for (let index = 0; index < interleaved.length / 4; index += 1) {
      const source = index * 4
      if (hiddenClasses.has(Math.round(interleaved[source + 3]))) continue
      const target = visibleIndex * 3
      nextPositions[target] = interleaved[source]
      nextPositions[target + 1] = interleaved[source + 2]
      nextPositions[target + 2] = -interleaved[source + 1]
      const rgb = hexToRgb(colorForClass(Math.round(interleaved[source + 3])))
      nextColors.set(rgb, target)
      visibleIndex += 1
    }
    return { positions: nextPositions, colors: nextColors }
  }, [interleaved, hiddenClasses])

  return (
    <points>
      <bufferGeometry>
        <bufferAttribute attach="attributes-position" args={[positions, 3]} />
        <bufferAttribute attach="attributes-color" args={[colors, 3]} />
      </bufferGeometry>
      <pointsMaterial size={0.14} sizeAttenuation vertexColors transparent opacity={0.9} />
    </points>
  )
}

function GroundGrid() {
  return (
    <gridHelper args={[160, 32, '#23443e', '#142825']} position={[0, -3.3, 0]} />
  )
}

function EgoMarker() {
  return (
    <group position={[0, -2.85, 0]}>
      <mesh>
        <boxGeometry args={[2.1, 0.4, 4.2]} />
        <meshBasicMaterial color="#49dcb1" wireframe transparent opacity={0.8} />
      </mesh>
      <mesh position={[0, 0.1, -2.7]} rotation={[Math.PI / 2, 0, 0]}>
        <coneGeometry args={[0.65, 1.5, 3]} />
        <meshBasicMaterial color="#49dcb1" wireframe />
      </mesh>
    </group>
  )
}

export default function PointCloud({ points, hiddenClasses, linked, focus, onFocusChange }) {
  const controlsRef = useRef(null)

  useEffect(() => {
    if (!linked || !controlsRef.current) return
    const target = controlsRef.current.target
    if (Math.abs(target.x - focus.x) < 0.01 && Math.abs(target.z + focus.y) < 0.01) return
    target.set(focus.x, -1, -focus.y)
    controlsRef.current.update()
  }, [focus, linked])

  return (
    <Canvas dpr={[1, 1.5]} gl={{ antialias: true, alpha: true }}>
      <PerspectiveCamera makeDefault position={[36, 34, 58]} fov={46} />
      <color attach="background" args={['#07100f']} />
      <fog attach="fog" args={['#07100f', 90, 185]} />
      <Cloud interleaved={points} hiddenClasses={hiddenClasses} />
      <GroundGrid />
      <EgoMarker />
      <OrbitControls
        ref={controlsRef}
        makeDefault
        enableDamping
        dampingFactor={0.08}
        target={[0, -1, 0]}
        onChange={(event) => {
          if (!linked) return
          const target = event.target.target
          onFocusChange({ x: target.x, y: -target.z })
        }}
      />
      <GizmoHelper alignment="bottom-left" margin={[58, 58]}>
        <GizmoViewport axisColors={['#ff6b47', '#49dcb1', '#4eb9ff']} labelColor="#d9e7e3" />
      </GizmoHelper>
    </Canvas>
  )
}

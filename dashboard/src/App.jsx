import { useEffect, useMemo, useRef, useState } from 'react'
import Benchmarks from './components/Benchmarks'
import GridView from './components/GridView'
import PointCloud from './components/PointCloud'
import Stats from './components/Stats'
import { loadFrames } from './data'
import { colorForClass, nameForClass } from './palette'

function LoadingScreen({ progress, error }) {
  return (
    <main className="loading-screen">
      <div className="radar"><i /><i /><i /></div>
      <p className="eyebrow">GRID ENGINE // DATA LINK</p>
      <h1>{error ? 'Telemetry unavailable' : 'Building spatial model'}</h1>
      {error ? <p className="load-error">{error}</p> : (
        <>
          <div className="load-track"><span style={{ width: `${progress}%` }} /></div>
          <p>{progress}% · Initializing frame stream</p>
        </>
      )}
    </main>
  )
}

function Panel({ index, title, subtitle, tag, children }) {
  return (
    <section className="view-panel">
      <header className="panel-header">
        <div className="panel-index">0{index}</div>
        <div><h2>{title}</h2><p>{subtitle}</p></div>
        <span className="panel-tag">{tag}</span>
      </header>
      <div className="panel-viewport">{children}</div>
    </section>
  )
}

function PlayIcon({ playing }) {
  return playing
    ? <svg viewBox="0 0 24 24"><path d="M7 5h4v14H7zm6 0h4v14h-4z" /></svg>
    : <svg viewBox="0 0 24 24"><path d="m8 5 11 7-11 7z" /></svg>
}

function StepIcon({ direction }) {
  return (
    <svg viewBox="0 0 24 24" className={direction === 'next' ? '' : 'reverse'}>
      <path d="M16 5h2v14h-2zm-1 7L6 5v14z" />
    </svg>
  )
}

export default function App() {
  const [dataset, setDataset] = useState(null)
  const [progress, setProgress] = useState(0)
  const [error, setError] = useState('')
  const [frameIndex, setFrameIndex] = useState(0)
  const [playing, setPlaying] = useState(false)
  const [speed, setSpeed] = useState(1)
  const [hiddenClasses, setHiddenClasses] = useState(() => new Set())
  const [linked, setLinked] = useState(true)
  const [focus, setFocus] = useState({ x: 0, y: 0 })
  const [, setCacheRevision] = useState(0)
  const lastAdvance = useRef(0)

  useEffect(() => {
    let active = true
    loadFrames((done, total) => active && setProgress(Math.round((done / total) * 100)))
      .then((result) => active && setDataset(result))
      .catch((loadError) => active && setError(loadError.message))
    return () => { active = false }
  }, [])

  useEffect(() => {
    if (!playing || !dataset) return undefined
    let animationFrame
    const tick = (now) => {
      if (!lastAdvance.current) lastAdvance.current = now
      if (now - lastAdvance.current >= 500 / speed) {
        setFrameIndex((current) => (current + 1) % dataset.frameIds.length)
        lastAdvance.current = now
      }
      animationFrame = requestAnimationFrame(tick)
    }
    animationFrame = requestAnimationFrame(tick)
    return () => {
      cancelAnimationFrame(animationFrame)
      lastAdvance.current = 0
    }
  }, [playing, speed, dataset])

  useEffect(() => {
    if (!dataset) return undefined
    let active = true
    const currentId = dataset.frameIds[frameIndex]
    dataset.loadFrame(currentId)
      .then(() => active && setCacheRevision((value) => value + 1))
      .catch((loadError) => active && setError(loadError.message))

    for (let offset = -2; offset <= 8; offset += 1) {
      const index = (frameIndex + offset + dataset.frameIds.length) % dataset.frameIds.length
      dataset.loadFrame(dataset.frameIds[index]).catch(() => {})
    }
    return () => { active = false }
  }, [dataset, frameIndex])

  const semanticClasses = useMemo(() => {
    if (!dataset) return []
    if (dataset.semanticClasses.length) return dataset.semanticClasses
    const ids = new Set()
    for (const frame of dataset.frames.values()) {
      for (const cell of frame.grid) ids.add(cell.semantic_class)
      for (let index = 3; index < frame.points.length; index += 4) ids.add(Math.round(frame.points[index]))
    }
    return [...ids].sort((a, b) => a - b)
  }, [dataset])

  if (!dataset || error) return <LoadingScreen progress={progress} error={error} />

  const frameId = dataset.frameIds[frameIndex]
  const requestedFrame = dataset.frames.get(frameId)
  const frame = requestedFrame ?? dataset.frames.values().next().value
  const buffering = !requestedFrame
  const stepFrame = (amount) => {
    setPlaying(false)
    setFrameIndex((current) => (current + amount + dataset.frameIds.length) % dataset.frameIds.length)
  }
  const updateFocus = (nextFocus) => {
    setFocus((current) => (
      Math.abs(current.x - nextFocus.x) < 0.01 && Math.abs(current.y - nextFocus.y) < 0.01
        ? current
        : nextFocus
    ))
  }
  const toggleClass = (id) => {
    setHiddenClasses((current) => {
      const next = new Set(current)
      if (next.has(id)) next.delete(id)
      else next.add(id)
      return next
    })
  }
  return (
    <main className="app-shell">
      <header className="topbar">
        <div className="brand-mark"><span>GE</span><i /></div>
        <div className="title-block">
          <p className="eyebrow">AUTONOMY PERCEPTION SYSTEM · RUN 01</p>
          <h1>Semantic Projection <em>Lab</em></h1>
        </div>
        <div className="system-status"><i /> DATASET ONLINE <strong>{dataset.frameIds.length} FRAMES</strong></div>
      </header>

      <section className="view-grid">
        {buffering && <div className="buffer-indicator"><i /> BUFFERING ID {frameId}</div>}
        <Panel index={1} title="Classified point field" subtitle="Raw spatial returns · XYZ + semantic class" tag="3D / ORBIT">
          <PointCloud points={frame.points} hiddenClasses={hiddenClasses} linked={linked} focus={focus} onFocusChange={updateFocus} />
        </Panel>
        <button className={`sync-button ${linked ? 'active' : ''}`} onClick={() => setLinked((value) => !value)} aria-pressed={linked} aria-label="Link viewport navigation">
          <svg viewBox="0 0 24 24"><path d="M8.5 14.5 6 17a3.54 3.54 0 0 1-5-5l4-4a3.54 3.54 0 0 1 5 0l.5.5-1.4 1.4-.5-.5a1.54 1.54 0 0 0-2.2 0l-4 4a1.54 1.54 0 0 0 2.2 2.2l2.5-2.5zm7-5 2.5-2.5a1.54 1.54 0 0 1 2.2 2.2l-4 4a1.54 1.54 0 0 1-2.2 0l-.5-.5-1.4 1.4.5.5a3.54 3.54 0 0 0 5 0l4-4a3.54 3.54 0 0 0-5-5L14.1 8.1zM7.8 14.8l7-7 1.4 1.4-7 7z" /></svg>
          <span>{linked ? 'LINKED' : 'FREE'}</span>
        </button>
        <Panel index={2} title="Adaptive grid projection" subtitle="Variable-resolution 2.5D leaf cells" tag="TOP / METRIC">
          <GridView cells={frame.grid} hiddenClasses={hiddenClasses} linked={linked} focus={focus} onFocusChange={updateFocus} />
        </Panel>
      </section>

      <section className="control-deck">
        <div className="timeline-row">
          <button className="step-button" onClick={() => stepFrame(-1)} aria-label="Previous frame"><StepIcon direction="previous" /></button>
          <button className="play-button" onClick={() => setPlaying((value) => !value)} aria-label={playing ? 'Pause' : 'Play'}><PlayIcon playing={playing} /></button>
          <button className="step-button" onClick={() => stepFrame(1)} aria-label="Next frame"><StepIcon direction="next" /></button>
          <div className="frame-readout"><span>ID</span><strong>{frameId}</strong><small><b>SEQ</b> {String(frameIndex + 1).padStart(2, '0')} / {String(dataset.frameIds.length).padStart(2, '0')}</small></div>
          <input className="timeline" type="range" min="0" max={dataset.frameIds.length - 1} value={frameIndex} onChange={(event) => { setFrameIndex(Number(event.target.value)); setPlaying(false) }} style={{ '--position': `${(frameIndex / (dataset.frameIds.length - 1)) * 100}%` }} />
          <div className="speed-control">
            {[0.5, 1, 2].map((value) => <button key={value} className={speed === value ? 'active' : ''} onClick={() => setSpeed(value)}>{value}×</button>)}
          </div>
        </div>
        <Stats meta={frame.meta} />
      </section>

      <Benchmarks />

      <footer className="legend-bar">
        <div className="legend-title"><span>SEMANTIC FILTER</span><small>{semanticClasses.length - hiddenClasses.size} of {semanticClasses.length} visible</small><button onClick={() => setHiddenClasses(new Set())}>SHOW ALL</button></div>
        <div className="legend-items">
          {semanticClasses.map((id) => <button className={`legend-item ${hiddenClasses.has(id) ? 'hidden-class' : ''}`} key={id} onClick={() => toggleClass(id)} aria-pressed={!hiddenClasses.has(id)}><i style={{ background: colorForClass(id), boxShadow: `0 0 9px ${colorForClass(id)}66` }} /><span>{nameForClass(id)}</span><small>{String(id).padStart(2, '0')}</small></button>)}
        </div>
      </footer>
    </main>
  )
}

import { useEffect, useRef, useState } from 'react'
import { loadFrames } from '../data'

const API = (import.meta.env.VITE_API_URL ?? '').replace(/\/$/, '')
const MAX_BYTES = 16 * 1024 * 1024
const STAGES = [
  ['uploading', 'Upload'], ['validating', 'Validate'], ['loading_model', 'Load model'],
  ['inference', 'DL inference'], ['grid', 'Grid engine'], ['exporting', 'Export'],
]

async function api(path, options = {}) {
  let response
  try {
    response = await fetch(`${API}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(30_000) })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Cannot reach the inference server. Start the backend or check its connection.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : `Server error (${response.status}).`)
  }
  return response.json()
}

async function apiText(path, options = {}) {
  let response
  try {
    response = await fetch(`${API}${path}`, { ...options, signal: options.signal ?? AbortSignal.timeout(30_000) })
  } catch (error) {
    if (error.name === 'AbortError') throw error
    throw new Error('Cannot reach the inference server. Start the backend or check its connection.')
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null)
    throw new Error(typeof payload?.detail === 'string' ? payload.detail : `Server error (${response.status}).`)
  }
  return response.text()
}

export default function UploadPanel({ onResult, onDemo, onStart, demoLoading, hasDataset }) {
  const [file, setFile] = useState(null)
  const [stage, setStage] = useState('')
  const [messages, setMessages] = useState([])
  const [error, setError] = useState('')
  const [result, setResult] = useState(null)
  const [busy, setBusy] = useState(false)
  const [dragging, setDragging] = useState(false)
  const [health, setHealth] = useState(null)
  const [jobId, setJobId] = useState(null)
  const [retryPoll, setRetryPoll] = useState(0)
  const input = useRef(null)
  const alive = useRef(true)
  const uploadController = useRef(null)

  useEffect(() => {
    alive.current = true
    api('/api/health')
      .then((status) => { if (alive.current) setHealth(status) })
      .catch(() => { if (alive.current) setHealth({ status: 'offline' }) })
    return () => { alive.current = false; uploadController.current?.abort() }
  }, [])

  useEffect(() => {
    if (!jobId) return undefined
    let active = true
    let timer
    const controller = new AbortController()
    const poll = async () => {
      try {
        const job = await api(`/api/jobs/${jobId}`, {
          signal: AbortSignal.any([controller.signal, AbortSignal.timeout(30_000)]),
        })
        if (!active) return
        setStage(job.stage)
        setMessages(job.messages)
        if (job.stage === 'failed') {
          setError(job.error)
          setBusy(false)
          setJobId(null)
        } else if (job.stage === 'complete') {
          const base = `${API}/api/jobs/${jobId}/files`
          const [dataset, report, script] = await Promise.all([
            loadFrames(undefined, `${base}/frames`),
            api(`/api/jobs/${jobId}/files/report.json`),
            apiText(`/api/jobs/${jobId}/files/run_pipeline.py`),
          ])
          if (!active) return
          setResult({ base, report, script, filename: file.name })
          onResult({ ...dataset, source: 'upload', filename: file.name })
          setBusy(false)
          setJobId(null)
        } else {
          timer = window.setTimeout(poll, 1000)
        }
      } catch (failure) {
        if (!active) return
        setError(`${failure.message} The job may still be running; use Reconnect to check its result.`)
        setBusy(false)
      }
    }
    poll()
    return () => { active = false; controller.abort(); window.clearTimeout(timer) }
  }, [jobId, retryPoll]) // Callbacks/file belong to the active upload, which cannot change while polling.

  const choose = (candidate) => {
    if (!candidate || busy || jobId) return
    setError('')
    if (!/\.(bin|npy)$/i.test(candidate.name)) {
      setError('Choose a raw .bin or .npy file containing X, Y, Z, intensity.')
      return
    }
    if (!candidate.size || candidate.size > MAX_BYTES) {
      setError('Choose a non-empty file no larger than 16 MiB.')
      return
    }
    setFile(candidate)
    setResult(null)
    setStage('')
    setMessages([])
  }

  const run = async () => {
    if (!file || busy) return
    setBusy(true)
    setError('')
    setResult(null)
    setStage('uploading')
    setMessages([{ stage: 'uploading', message: `Uploading ${file.name}...` }])
    onStart()
    uploadController.current = new AbortController()
    try {
      const job = await api(`/api/jobs?filename=${encodeURIComponent(file.name)}`, {
        method: 'POST', headers: { 'Content-Type': 'application/octet-stream' },
        body: file, signal: uploadController.current.signal,
      })
      if (alive.current) {
        setHealth({ status: 'online' })
        setJobId(job.id)
      }
    } catch (failure) {
      if (!alive.current) return
      setError(failure.message)
      setStage('failed')
      setBusy(false)
    }
  }

  const currentStage = stage === 'complete' ? STAGES.length : STAGES.findIndex(([id]) => id === stage)
  return (
    <section className={`upload-panel ${hasDataset ? 'compact-upload' : ''}`} aria-label="Live inference">
      <div className="upload-heading">
        <div><p className="eyebrow">YOUR DATA / LIVE PROCESSING</p><h2>From raw returns to a semantic map.</h2></div>
        <span className={`api-status ${health?.status === 'online' ? 'online' : ''}`}>
          {health ? (health.status === 'online' ? 'INFERENCE SERVER ONLINE' : 'INFERENCE SERVER OFFLINE') : 'CHECKING SERVER'}
        </span>
      </div>
      <div className="upload-content">
        <div
          className={`drop-zone ${dragging ? 'dragging' : ''}`}
          onDragOver={(event) => { event.preventDefault(); if (!busy && !jobId) setDragging(true) }}
          onDragLeave={() => setDragging(false)}
          onDrop={(event) => { event.preventDefault(); setDragging(false); choose(event.dataTransfer.files[0]) }}
        >
          <span className="upload-symbol" aria-hidden="true">↑</span>
          <div>
            <strong>{file ? file.name : 'Drop a raw LiDAR scan here'}</strong>
            <p>{file ? `${(file.size / (1024 * 1024)).toFixed(2)} MiB selected` : 'BIN or NPY · X, Y, Z, intensity · up to 250,000 points / 16 MiB'}</p>
            <small>Sensor-local coordinates in meters. Labels are predicted during processing.</small>
          </div>
          <input ref={input} type="file" accept=".bin,.npy" hidden aria-label="Choose raw LiDAR scan" disabled={busy || Boolean(jobId)} onChange={(event) => { choose(event.target.files[0]); event.target.value = '' }} />
          <button className="secondary-action" disabled={busy || Boolean(jobId)} onClick={() => input.current.click()}>Choose file</button>
        </div>
        <div className="upload-actions">
          <button className="primary-action" disabled={!file || busy || Boolean(jobId) || demoLoading} onClick={run}>{busy ? 'Processing scan...' : 'Run model + grid'}</button>
          <button className="secondary-action" disabled={busy || Boolean(jobId) || demoLoading} onClick={() => { setResult(null); setStage(''); setMessages([]); setError(''); onDemo() }}>{demoLoading ? 'Loading demo...' : 'View saved demo'}</button>
        </div>
      </div>
      {(stage || messages.length > 0) && (
        <div className="pipeline-status" aria-live="polite">
          <ol className="pipeline-stages">{STAGES.map(([id, label], index) => (
            <li key={id} className={index < currentStage ? 'done' : index === currentStage ? 'current' : ''}><span>{String(index + 1).padStart(2, '0')}</span>{label}</li>
          ))}</ol>
          <div className="pipeline-log">{messages.map((message, index) => <p key={`${index}-${message.stage}`}><span>{message.stage}</span>{message.message}</p>)}</div>
        </div>
      )}
      {error && <div className="upload-error" role="alert"><p>{error}</p>{jobId && <>
        <button className="secondary-action" onClick={() => { setError(''); setBusy(true); setRetryPoll((value) => value + 1) }}>Reconnect</button>
        <button className="secondary-action" onClick={() => { setJobId(null); setError(''); setStage(''); setMessages([]) }}>Dismiss job</button>
      </>}</div>}
      {result && (
        <div className="output-panel">
          <div className="output-heading">
            <div><p className="eyebrow">GENERATED OUTPUT / {result.filename}</p><h3>Inference complete</h3></div>
            <p>DL {result.report.timings_seconds.inference.toFixed(2)}s <span>/</span> Grid {result.report.timings_seconds.grid.toFixed(2)}s</p>
          </div>
          <nav className="output-downloads" aria-label="Download generated outputs">
            {[['outputs.zip', 'All outputs (ZIP)'], ['classified.npy', 'Classified points'], ['grid.npz', 'Grid cells'], ['report.json', 'JSON report'], ['run_pipeline.py', 'Rerun script']].map(([name, label]) => <a key={name} href={`${result.base}/${name}`} download={name}>{label} ↓</a>)}
          </nav>
          <small>Downloads expire after one hour or when newer results replace them. Keep the original scan to rerun the pipeline.</small>
          <details><summary>View output report</summary><pre>{JSON.stringify(result.report, null, 2)}</pre></details>
          <details><summary>View rerun script</summary><pre>{result.script}</pre></details>
        </div>
      )}
    </section>
  )
}

const GRID_FIELDS = [
  'x_min', 'x_max', 'y_min', 'y_max', 'resolution', 'elevation',
  'semantic_class', 'semantic_confidence', 'occupancy', 'traversability', 'point_count',
]

const DEFAULT_FRAMES_BASE = `${import.meta.env.BASE_URL}frames`.replace(/\/{2,}/g, '/')

function parseGridBinary(buffer, fields) {
  const floats = new Float32Array(buffer)
  if (floats.length % fields.length !== 0) throw new Error('Invalid grid buffer')
  const cells = new Array(floats.length / fields.length)
  for (let row = 0; row < cells.length; row += 1) {
    const cell = {}
    for (let column = 0; column < fields.length; column += 1) {
      const field = fields[column]
      const value = floats[row * fields.length + column]
      cell[field] = field === 'semantic_class' ? Math.round(value) : value
    }
    cells[row] = cell
  }
  return cells
}

export async function loadFrames(onProgress, baseUrl = DEFAULT_FRAMES_BASE) {
  const manifestResponse = await fetch(`${baseUrl}/manifest.json`)
  if (!manifestResponse.ok) throw new Error('Could not load frame manifest')
  const manifest = await manifestResponse.json()
  const { frames } = manifest
  if (!frames?.length) throw new Error('Frame manifest is empty')

  const loaded = new Map()
  const pending = new Map()
  const gridFormat = manifest.grid_format ?? 'json'
  const gridFields = manifest.grid_fields ?? GRID_FIELDS

  const loadFrame = (frameId) => {
    if (loaded.has(frameId)) return Promise.resolve(loaded.get(frameId))
    if (pending.has(frameId)) return pending.get(frameId)
    const request = (async () => {
      const gridUrl = gridFormat === 'binary'
        ? `${baseUrl}/grid/${frameId}_grid.bin`
        : `${baseUrl}/grid/${frameId}_grid.json`
      const [gridResponse, pointsResponse, metaResponse] = await Promise.all([
        fetch(gridUrl), fetch(`${baseUrl}/points/${frameId}_points.bin`), fetch(`${baseUrl}/meta/${frameId}_meta.json`),
      ])
      if (![gridResponse, pointsResponse, metaResponse].every((response) => response.ok)) throw new Error(`Incomplete data for frame ${frameId}`)
      const [gridPayload, pointBuffer, meta] = await Promise.all([
        gridFormat === 'binary' ? gridResponse.arrayBuffer() : gridResponse.json(),
        pointsResponse.arrayBuffer(), metaResponse.json(),
      ])
      const grid = gridFormat === 'binary' ? parseGridBinary(gridPayload, gridFields) : gridPayload
      const points = new Float32Array(pointBuffer)
      if (points.length % 4 !== 0) throw new Error(`Invalid point buffer for ${frameId}`)
      const frame = { grid, points, meta }
      loaded.set(frameId, frame)
      pending.delete(frameId)
      while (loaded.size > 18) loaded.delete(loaded.keys().next().value)
      return frame
    })().catch((error) => { pending.delete(frameId); throw error })
    pending.set(frameId, request)
    return request
  }

  onProgress?.(0, 1)
  await loadFrame(frames[0])
  onProgress?.(1, 1)
  return {
    frameIds: frames,
    frames: loaded,
    loadFrame,
    semanticClasses: manifest.semantic_classes ?? [],
  }
}

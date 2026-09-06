import { useEffect, useRef, useState } from 'react'
import { colorForClass, nameForClass } from '../palette'

export default function GridView({ cells, hiddenClasses, linked, focus, onFocusChange }) {
  const canvasRef = useRef(null)
  const viewRef = useRef({ zoom: 1, focusX: 0, focusY: 0 })
  const dragRef = useRef(null)
  const transformRef = useRef(null)
  const [hovered, setHovered] = useState(null)

  useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas || !cells.length) return undefined
    const context = canvas.getContext('2d')

    const draw = () => {
      const bounds = cells.reduce(
        (acc, cell) => ({
          minX: Math.min(acc.minX, cell.x_min),
          maxX: Math.max(acc.maxX, cell.x_max),
          minY: Math.min(acc.minY, cell.y_min),
          maxY: Math.max(acc.maxY, cell.y_max),
        }),
        { minX: Infinity, maxX: -Infinity, minY: Infinity, maxY: -Infinity },
      )
      const dpr = Math.min(window.devicePixelRatio || 1, 2)
      const rect = canvas.getBoundingClientRect()
      canvas.width = Math.round(rect.width * dpr)
      canvas.height = Math.round(rect.height * dpr)
      context.setTransform(dpr, 0, 0, dpr, 0, 0)
      context.fillStyle = '#07100f'
      context.fillRect(0, 0, rect.width, rect.height)

      const padding = 18
      const baseScale = Math.min(
        (rect.width - padding * 2) / (bounds.maxX - bounds.minX),
        (rect.height - padding * 2) / (bounds.maxY - bounds.minY),
      )
      const view = viewRef.current
      const scale = baseScale * view.zoom
      const originX = rect.width / 2 - (view.focusX - bounds.minX) * scale
      const originY = rect.height / 2 - (bounds.maxY - view.focusY) * scale
      transformRef.current = { bounds, scale, originX, originY }

      for (const cell of cells) {
        if (hiddenClasses.has(cell.semantic_class)) continue
        const x = originX + (cell.x_min - bounds.minX) * scale
        const y = originY + (bounds.maxY - cell.y_max) * scale
        const width = Math.max(0.7, (cell.x_max - cell.x_min) * scale)
        const height = Math.max(0.7, (cell.y_max - cell.y_min) * scale)
        context.globalAlpha = 0.42 + Math.min(cell.semantic_confidence ?? 1, 1) * 0.55
        context.fillStyle = colorForClass(cell.semantic_class)
        context.fillRect(x, y, width, height)
      }
      context.globalAlpha = 1

      const egoX = originX + (0 - bounds.minX) * scale
      const egoY = originY + (bounds.maxY - 0) * scale
      context.save()
      context.translate(egoX, egoY)
      context.rotate(Math.PI / 2)
      context.beginPath()
      context.moveTo(0, -9)
      context.lineTo(6, 7)
      context.lineTo(-6, 7)
      context.closePath()
      context.fillStyle = '#07100f'
      context.fill()
      context.strokeStyle = '#49dcb1'
      context.lineWidth = 1.5
      context.stroke()
      context.restore()

      const barLength = 10 * scale
      const barX = 21
      const barY = rect.height - 28
      context.strokeStyle = '#b3c9c3'
      context.lineWidth = 1
      context.beginPath()
      context.moveTo(barX, barY - 4)
      context.lineTo(barX, barY)
      context.lineTo(barX + barLength, barY)
      context.lineTo(barX + barLength, barY - 4)
      context.stroke()
      context.fillStyle = '#78908a'
      context.font = '9px Courier New'
      context.fillText('10 METERS', barX, barY - 8)
    }

    const observer = new ResizeObserver(draw)
    observer.observe(canvas)
    draw()
    canvas.drawGrid = draw
    return () => observer.disconnect()
  }, [cells, hiddenClasses])

  useEffect(() => {
    if (!linked) return
    viewRef.current.focusX = focus.x
    viewRef.current.focusY = focus.y
    canvasRef.current?.drawGrid?.()
  }, [focus, linked])

  const cellAt = (event) => {
    const transform = transformRef.current
    if (!transform) return null
    const rect = canvasRef.current.getBoundingClientRect()
    const screenX = event.clientX - rect.left
    const screenY = event.clientY - rect.top
    const worldX = transform.bounds.minX + (screenX - transform.originX) / transform.scale
    const worldY = transform.bounds.maxY - (screenY - transform.originY) / transform.scale
    return cells.findLast?.(
      (cell) => worldX >= cell.x_min && worldX <= cell.x_max && worldY >= cell.y_min && worldY <= cell.y_max,
    ) ?? cells.find(
      (cell) => worldX >= cell.x_min && worldX <= cell.x_max && worldY >= cell.y_min && worldY <= cell.y_max,
    )
  }

  const onPointerMove = (event) => {
    if (dragRef.current) {
      const view = viewRef.current
      const transform = transformRef.current
      view.focusX = dragRef.current.focusX - (event.clientX - dragRef.current.x) / transform.scale
      view.focusY = dragRef.current.focusY + (event.clientY - dragRef.current.y) / transform.scale
      canvasRef.current.drawGrid?.()
      if (linked) onFocusChange({ x: view.focusX, y: view.focusY })
      setHovered(null)
      return
    }
    const cell = cellAt(event)
    const rect = canvasRef.current.getBoundingClientRect()
    setHovered(cell ? { cell, x: event.clientX - rect.left, y: event.clientY - rect.top } : null)
  }

  const onWheel = (event) => {
    event.preventDefault()
    viewRef.current.zoom = Math.max(0.55, Math.min(8, viewRef.current.zoom * Math.exp(-event.deltaY * 0.001)))
    canvasRef.current.drawGrid?.()
  }

  return (
    <div className="grid-wrap">
      <canvas
        ref={canvasRef}
        onPointerDown={(event) => {
          event.currentTarget.setPointerCapture(event.pointerId)
          dragRef.current = { x: event.clientX, y: event.clientY, ...viewRef.current }
        }}
        onPointerUp={() => { dragRef.current = null }}
        onPointerLeave={() => { dragRef.current = null; setHovered(null) }}
        onPointerMove={onPointerMove}
        onWheel={onWheel}
      />
      {hovered && (
        <div className="cell-tooltip" style={{ left: hovered.x + 14, top: hovered.y + 14 }}>
          <strong>{nameForClass(hovered.cell.semantic_class)}</strong>
          <span>{hovered.cell.resolution} m cell</span>
          <span>Elevation {hovered.cell.elevation.toFixed(2)} m</span>
          <span>Traversability {(hovered.cell.traversability * 100).toFixed(0)}%</span>
        </div>
      )}
      <div className="canvas-hint">DRAG TO PAN · SCROLL TO ZOOM</div>
    </div>
  )
}

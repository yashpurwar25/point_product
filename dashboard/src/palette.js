export const KNOWN_CLASSES = {
  0: 'Car',
  1: 'Bicycle',
  2: 'Motorcycle',
  3: 'Truck',
  4: 'Other-vehicle',
  5: 'Person/Pedestrian',
  6: 'Bicyclist',
  7: 'Motorcyclist',
  8: 'Road',
  9: 'Parking',
  10: 'Sidewalk',
  11: 'Other-ground',
  12: 'Building',
  13: 'Fence',
  14: 'Vegetation',
  15: 'Trunk',
  16: 'Terrain',
  17: 'Pole',
  18: 'Traffic-sign',
}

const colors = [
  '#ff0000', '#ff8000', '#ff8000', '#800000', '#800000',
  '#0000ff', '#0000ff', '#0000ff', '#808080', '#606060',
  '#a0a0a0', '#c0c0c0', '#ffd700', '#8b4513', '#008000',
  '#8b4513', '#90ee90', '#d3d3d3', '#ff00ff',
]

export function colorForClass(id) {
  const numericId = Number(id)
  return colors[((numericId % colors.length) + colors.length) % colors.length]
}

export function nameForClass(id) {
  return KNOWN_CLASSES[id] ?? `Class ${id}`
}

export function hexToRgb(hex) {
  const value = Number.parseInt(hex.slice(1), 16)
  return [(value >> 16) / 255, ((value >> 8) & 255) / 255, (value & 255) / 255]
}

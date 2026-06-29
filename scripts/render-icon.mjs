import { writeFileSync } from 'fs'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { deflateSync } from 'zlib'

const size = 1024
const samples = 4
const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const outputPath = join(root, 'build', 'icon.png')

const background = {
  x: 64,
  y: 64,
  width: 896,
  height: 896,
  radius: 220,
  top: [44, 44, 48],
  bottom: [20, 20, 22]
}

const bars = [
  { x: 360, y: 430, width: 60, height: 164, radius: 30 },
  { x: 462, y: 330, width: 60, height: 364, radius: 30 },
  { x: 564, y: 400, width: 60, height: 224, radius: 30 },
  { x: 666, y: 360, width: 60, height: 304, radius: 30 }
]

const barTop = [255, 255, 255]
const barBottom = [215, 215, 218]

function insideRoundedRect(px, py, rect) {
  if (px < rect.x || px > rect.x + rect.width || py < rect.y || py > rect.y + rect.height) {
    return false
  }

  const cx = Math.max(rect.x + rect.radius, Math.min(px, rect.x + rect.width - rect.radius))
  const cy = Math.max(rect.y + rect.radius, Math.min(py, rect.y + rect.height - rect.radius))
  const dx = px - cx
  const dy = py - cy
  return dx * dx + dy * dy <= rect.radius * rect.radius
}

function coverage(x, y, rect) {
  let hits = 0
  for (let sy = 0; sy < samples; sy += 1) {
    for (let sx = 0; sx < samples; sx += 1) {
      const px = x + (sx + 0.5) / samples
      const py = y + (sy + 0.5) / samples
      if (insideRoundedRect(px, py, rect)) hits += 1
    }
  }
  return hits / (samples * samples)
}

function mix(start, end, amount) {
  return start.map((channel, index) => Math.round(channel + (end[index] - channel) * amount))
}

function over(base, paint) {
  const outA = paint.a + base.a * (1 - paint.a)
  if (outA === 0) return { r: 0, g: 0, b: 0, a: 0 }

  return {
    r: (paint.r * paint.a + base.r * base.a * (1 - paint.a)) / outA,
    g: (paint.g * paint.a + base.g * base.a * (1 - paint.a)) / outA,
    b: (paint.b * paint.a + base.b * base.a * (1 - paint.a)) / outA,
    a: outA
  }
}

function crc32(buffer) {
  let crc = 0xffffffff
  for (const byte of buffer) {
    crc ^= byte
    for (let bit = 0; bit < 8; bit += 1) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }
  return (crc ^ 0xffffffff) >>> 0
}

function chunk(type, data = Buffer.alloc(0)) {
  const typeBuffer = Buffer.from(type, 'ascii')
  const length = Buffer.alloc(4)
  length.writeUInt32BE(data.length)

  const crc = Buffer.alloc(4)
  crc.writeUInt32BE(crc32(Buffer.concat([typeBuffer, data])))

  return Buffer.concat([length, typeBuffer, data, crc])
}

function encodePng(width, height, rgba) {
  const signature = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])
  const ihdr = Buffer.alloc(13)
  ihdr.writeUInt32BE(width, 0)
  ihdr.writeUInt32BE(height, 4)
  ihdr[8] = 8
  ihdr[9] = 6

  const stride = width * 4
  const scanlines = Buffer.alloc((stride + 1) * height)
  for (let y = 0; y < height; y += 1) {
    const rowStart = y * (stride + 1)
    scanlines[rowStart] = 0
    rgba.copy(scanlines, rowStart + 1, y * stride, (y + 1) * stride)
  }

  return Buffer.concat([
    signature,
    chunk('IHDR', ihdr),
    chunk('IDAT', deflateSync(scanlines, { level: 9 })),
    chunk('IEND')
  ])
}

const rgba = Buffer.alloc(size * size * 4)

for (let y = 0; y < size; y += 1) {
  for (let x = 0; x < size; x += 1) {
    let pixel = { r: 0, g: 0, b: 0, a: 0 }

    const bgCoverage = coverage(x, y, background)
    if (bgCoverage > 0) {
      const amount = Math.min(1, Math.max(0, (y - background.y) / background.height))
      const [r, g, b] = mix(background.top, background.bottom, amount)
      pixel = over(pixel, { r, g, b, a: bgCoverage })
    }

    for (const bar of bars) {
      const barCoverage = coverage(x, y, bar)
      if (barCoverage === 0) continue

      const amount = Math.min(1, Math.max(0, (y - bar.y) / bar.height))
      const [r, g, b] = mix(barTop, barBottom, amount)
      pixel = over(pixel, { r, g, b, a: barCoverage })
    }

    const offset = (y * size + x) * 4
    rgba[offset] = Math.round(pixel.r)
    rgba[offset + 1] = Math.round(pixel.g)
    rgba[offset + 2] = Math.round(pixel.b)
    rgba[offset + 3] = Math.round(pixel.a * 255)
  }
}

writeFileSync(outputPath, encodePng(size, size, rgba))
console.log(`Rendered ${outputPath}`)

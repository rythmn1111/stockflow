/**
 * Image downscaling, done in the renderer with a canvas.
 *
 * A phone photo is 3–8 MB and 12 megapixels; storing that per item would bloat the
 * database and every backup of it. Rather than adding an image library to the main
 * process (which would mean a native dependency, the one thing this app deliberately
 * avoids), the browser that is already here does the resizing before the bytes ever
 * cross the IPC bridge.
 *
 * Two sizes come out: a thumbnail small enough to sit in a table row, and one bounded
 * display copy.
 */

/** Longest edge, in pixels. */
const FULL_MAX = 1200
const THUMB_MAX = 96

/** JPEG quality. 0.82 is the point where artefacts stop being visible on photos. */
const FULL_QUALITY = 0.82
const THUMB_QUALITY = 0.7

export interface PreparedPhoto {
  mime: string
  fullBase64: string
  thumbBase64: string
  width: number
  height: number
  /** Size of the display copy, so the UI can say what it is about to store. */
  fullBytes: number
  /** A data URL of the display copy, for an immediate preview. */
  previewUrl: string
}

export const ACCEPTED_IMAGE_TYPES = 'image/png,image/jpeg,image/webp,image/gif,image/bmp'
const MAX_INPUT_BYTES = 25 * 1024 * 1024

function scaled(width: number, height: number, max: number): { width: number; height: number } {
  if (width <= max && height <= max) return { width, height }
  const ratio = width >= height ? max / width : max / height
  return { width: Math.round(width * ratio), height: Math.round(height * ratio) }
}

function toBase64(dataUrl: string): string {
  const comma = dataUrl.indexOf(',')
  return comma >= 0 ? dataUrl.slice(comma + 1) : dataUrl
}

function draw(source: ImageBitmap | HTMLImageElement, max: number, quality: number): { dataUrl: string; width: number; height: number } {
  const size = scaled(source.width, source.height, max)
  const canvas = document.createElement('canvas')
  canvas.width = size.width
  canvas.height = size.height
  const context = canvas.getContext('2d')
  if (!context) throw new Error('This computer could not process the image')
  // White underneath, because a transparent PNG flattened to JPEG would otherwise
  // composite onto black and look wrong.
  context.fillStyle = '#ffffff'
  context.fillRect(0, 0, size.width, size.height)
  context.imageSmoothingQuality = 'high'
  context.drawImage(source, 0, 0, size.width, size.height)
  return { dataUrl: canvas.toDataURL('image/jpeg', quality), ...size }
}

/** Reads a picked file and produces both sizes. Throws with a readable message. */
export async function preparePhoto(file: File): Promise<PreparedPhoto> {
  if (!file.type.startsWith('image/')) throw new Error('That file is not an image')
  if (file.size > MAX_INPUT_BYTES) {
    throw new Error(`That image is ${Math.round(file.size / 1024 / 1024)} MB. Pick one under 25 MB.`)
  }

  let source: ImageBitmap | HTMLImageElement
  try {
    source = await createImageBitmap(file)
  } catch {
    // Older or unusual formats that createImageBitmap refuses still load as an <img>.
    source = await new Promise<HTMLImageElement>((resolve, reject) => {
      const img = new Image()
      const url = URL.createObjectURL(file)
      img.onload = () => {
        URL.revokeObjectURL(url)
        resolve(img)
      }
      img.onerror = () => {
        URL.revokeObjectURL(url)
        reject(new Error('That image could not be read'))
      }
      img.src = url
    })
  }

  if (!source.width || !source.height) throw new Error('That image has no dimensions')

  const full = draw(source, FULL_MAX, FULL_QUALITY)
  const thumb = draw(source, THUMB_MAX, THUMB_QUALITY)
  if ('close' in source) source.close()

  const fullBase64 = toBase64(full.dataUrl)
  return {
    mime: 'image/jpeg',
    fullBase64,
    thumbBase64: toBase64(thumb.dataUrl),
    width: full.width,
    height: full.height,
    // base64 carries 3 bytes in every 4 characters.
    fullBytes: Math.round((fullBase64.length * 3) / 4),
    previewUrl: full.dataUrl
  }
}

export function formatBytes(bytes: number | null | undefined): string {
  if (bytes == null) return '—'
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 * 1024) return `${Math.round(bytes / 1024)} KB`
  return `${(bytes / 1024 / 1024).toFixed(1)} MB`
}

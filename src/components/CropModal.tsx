import { useState, useRef, useCallback, useEffect } from 'react'

interface CropModalProps {
  imageUrl: string
  onConfirm: (croppedDataUrl: string) => void
  onCancel: () => void
}

export default function CropModal({ imageUrl, onConfirm, onCancel }: CropModalProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const imgRef = useRef<HTMLImageElement | null>(null)
  const [drawing, setDrawing] = useState(false)
  const [startPos, setStartPos] = useState({ x: 0, y: 0 })
  const [endPos, setEndPos] = useState({ x: 0, y: 0 })
  const [hasCrop, setHasCrop] = useState(false)
  const [imgLoaded, setImgLoaded] = useState(false)
  const [scale, setScale] = useState(1)

  // Load image
  useEffect(() => {
    const img = new Image()
    img.crossOrigin = 'anonymous'
    img.onload = () => {
      imgRef.current = img
      setImgLoaded(true)
    }
    img.src = imageUrl
  }, [imageUrl])

  // Draw canvas
  useEffect(() => {
    if (!imgLoaded || !canvasRef.current || !imgRef.current) return
    const canvas = canvasRef.current
    const ctx = canvas.getContext('2d')
    if (!ctx) return

    const img = imgRef.current
    const maxW = Math.min(window.innerWidth - 80, 800)
    const maxH = Math.min(window.innerHeight - 200, 600)
    const s = Math.min(maxW / img.width, maxH / img.height, 1)
    setScale(s)

    canvas.width = img.width * s
    canvas.height = img.height * s

    ctx.clearRect(0, 0, canvas.width, canvas.height)
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height)

    if (hasCrop) {
      const x = Math.min(startPos.x, endPos.x)
      const y = Math.min(startPos.y, endPos.y)
      const w = Math.abs(endPos.x - startPos.x)
      const h = Math.abs(endPos.y - startPos.y)

      // Dim outside
      ctx.fillStyle = 'rgba(0,0,0,0.5)'
      ctx.fillRect(0, 0, canvas.width, y)
      ctx.fillRect(0, y + h, canvas.width, canvas.height - y - h)
      ctx.fillRect(0, y, x, h)
      ctx.fillRect(x + w, y, canvas.width - x - w, h)

      // Border
      ctx.strokeStyle = '#fff'
      ctx.lineWidth = 2
      ctx.setLineDash([6, 4])
      ctx.strokeRect(x, y, w, h)
      ctx.setLineDash([])

      // Size label
      const realW = Math.round(w / s)
      const realH = Math.round(h / s)
      ctx.fillStyle = 'rgba(0,0,0,0.7)'
      ctx.fillRect(x, y - 22, 90, 20)
      ctx.fillStyle = '#fff'
      ctx.font = '12px sans-serif'
      ctx.fillText(`${realW}×${realH}`, x + 4, y - 7)
    }
  }, [imgLoaded, startPos, endPos, hasCrop, scale])

  const getPos = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const rect = canvasRef.current?.getBoundingClientRect()
    if (!rect) return { x: 0, y: 0 }
    return { x: e.clientX - rect.left, y: e.clientY - rect.top }
  }, [])

  const handleMouseDown = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    const pos = getPos(e)
    setStartPos(pos)
    setEndPos(pos)
    setDrawing(true)
    setHasCrop(true)
  }, [getPos])

  const handleMouseMove = useCallback((e: React.MouseEvent<HTMLCanvasElement>) => {
    if (!drawing) return
    setEndPos(getPos(e))
  }, [drawing, getPos])

  const handleMouseUp = useCallback(() => {
    setDrawing(false)
  }, [])

  const handleConfirm = useCallback(() => {
    if (!imgRef.current || !hasCrop) return

    const x = Math.min(startPos.x, endPos.x) / scale
    const y = Math.min(startPos.y, endPos.y) / scale
    const w = Math.abs(endPos.x - startPos.x) / scale
    const h = Math.abs(endPos.y - startPos.y) / scale

    if (w < 20 || h < 20) return

    const offscreen = document.createElement('canvas')
    offscreen.width = w
    offscreen.height = h
    const offCtx = offscreen.getContext('2d')
    if (!offCtx) return

    offCtx.drawImage(imgRef.current, x, y, w, h, 0, 0, w, h)
    const dataUrl = offscreen.toDataURL('image/jpeg', 0.92)
    onConfirm(dataUrl)
  }, [startPos, endPos, scale, hasCrop, onConfirm])

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 9999,
      background: 'rgba(0,0,0,0.85)',
      display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center',
    }}>
      <div style={{ color: '#fff', fontSize: 14, marginBottom: 12, fontWeight: 600 }}>
        ✂️ Kırpmak istediğiniz alanı fare ile seçin
      </div>

      {imgLoaded ? (
        <canvas
          ref={canvasRef}
          onMouseDown={handleMouseDown}
          onMouseMove={handleMouseMove}
          onMouseUp={handleMouseUp}
          onMouseLeave={handleMouseUp}
          style={{ cursor: 'crosshair', borderRadius: 8, border: '2px solid rgba(255,255,255,0.3)' }}
        />
      ) : (
        <div style={{ color: '#fff', fontSize: 13 }}>Görsel yükleniyor...</div>
      )}

      <div style={{ display: 'flex', gap: 12, marginTop: 16 }}>
        <button onClick={onCancel} style={{
          padding: '10px 24px', fontSize: 13, borderRadius: 8,
          background: 'rgba(255,255,255,0.15)', color: '#fff', border: '1px solid rgba(255,255,255,0.3)',
          cursor: 'pointer',
        }}>İptal</button>
        <button onClick={handleConfirm} disabled={!hasCrop} style={{
          padding: '10px 24px', fontSize: 13, borderRadius: 8, fontWeight: 700,
          background: hasCrop ? 'var(--primary)' : '#555', color: '#fff', border: 'none',
          cursor: hasCrop ? 'pointer' : 'not-allowed',
        }}>✂️ Kırp ve Kullan</button>
      </div>
    </div>
  )
}

import { useEffect, useState } from 'react'
import { useApp } from './App'

/** 是否為網頁版版面（≥ 1024px）。 */
export function useWide() {
  const q = '(min-width: 1024px)'
  const [wide, setWide] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setWide(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return wide
}

/**
 * 伺服器「現在」（毫秒），每 tickMs 更新。demo／重播的時鐘可能和真實時間不同，
 * 以載入 /api/system 時的差值換算（系統時間為台北時間、不含時區）。
 */
export function useServerNow(tickMs = 250) {
  const { system } = useApp()
  const [offset, setOffset] = useState(0)
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (system?.now) setOffset(Date.parse(`${system.now.slice(0, 23)}+08:00`) - Date.now())
  }, [system?.now])
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), tickMs)
    return () => clearInterval(t)
  }, [tickMs])
  return now + offset
}

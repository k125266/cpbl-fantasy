import { useCallback, useEffect, useRef, useState } from 'react'
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
 * 自動更新倒數（秒）：以時間戳計算，不是一秒一秒減。手機鎖屏或分頁在背景時計時器會被暫停，
 * 回到畫面（visibilitychange、focus）時立刻重算，倒數到 0 就能馬上更新。
 */
export function useCountdown(total: number) {
  const last = useRef(Date.now())
  const [, tick] = useState(0)
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 1000)
    const back = () => { if (document.visibilityState === 'visible') tick((n) => n + 1) }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('focus', back)
    return () => {
      clearInterval(t)
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('focus', back)
    }
  }, [])
  const sec = Math.max(0, total - Math.floor((Date.now() - last.current) / 1000))
  const restart = useCallback(() => {
    last.current = Date.now()
    tick((n) => n + 1)
  }, [])
  return { sec, restart }
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

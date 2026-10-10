import { useCallback, useEffect, useRef, useState } from 'react'
import { useApp } from './App'

function useMedia(q: string) {
  const [on, setOn] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setOn(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [q])
  return on
}

/** 是否為網頁版版面（≥ 1024px）。 */
export function useWide() {
  return useMedia('(min-width: 1024px)')
}

/** 是否為寬螢幕網頁版（≥ 1680px，設計稿「1680 以上多一欄」；選秀三頁在這個寬度換成三欄版面）。 */
export function useXWide() {
  return useMedia('(min-width: 1680px)')
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
 * 回到畫面（切回分頁、從別的 app 回來、iOS 從 bfcache 還原、網路恢復）時，資料超過 maxAgeMs 沒更新就立刻重載。
 * 手機切到別的 app 時計時器會被凍結，回來不一定有 visibilitychange，所以也聽 pageshow、focus、online。
 * lastLoad 由頁面在每次載入時寫入 Date.now()。
 */
export function useResumeRefresh(reload: () => void, lastLoad: { current: number }, maxAgeMs = 20_000) {
  useEffect(() => {
    const back = () => {
      if (document.visibilityState === 'visible' && Date.now() - lastLoad.current > maxAgeMs) reload()
    }
    document.addEventListener('visibilitychange', back)
    window.addEventListener('pageshow', back)
    window.addEventListener('focus', back)
    window.addEventListener('online', back)
    return () => {
      document.removeEventListener('visibilitychange', back)
      window.removeEventListener('pageshow', back)
      window.removeEventListener('focus', back)
      window.removeEventListener('online', back)
    }
  }, [reload, lastLoad, maxAgeMs])
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

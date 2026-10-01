import { useCallback, useEffect, useState } from 'react'
import { Link } from 'react-router-dom'
import type { PlayerStatus } from './api'
import { cpblTeam } from './teams'

export function TeamChip({ code }: { code: string | null | undefined }) {
  const t = cpblTeam(code)
  return (
    <span className="team-chip" style={{ background: t.bg, color: t.fg }} title={t.short}>
      {t.short}
    </span>
  )
}

/** 出賽狀態標示。只呈現事實描述，不推測原因（規則書 6.1.3）。 */
export function StatusBadge({ status }: { status: PlayerStatus | null | undefined }) {
  if (!status || status.code === 'ACTIVE') return null
  const cls = status.code === 'DELISTED' ? 'danger' : status.code === 'MINORS' ? 'warn' : 'warn'
  return <span className={`badge ${cls}`}>{status.text}</span>
}

export function PlayerLink({ id, name, leagueId }: { id: number; name: string; leagueId?: number }) {
  return <Link to={`/players/${id}${leagueId ? `?league=${leagueId}` : ''}`}>{name}</Link>
}

export function Loading() {
  return <p className="muted">載入中…</p>
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null
  const msg = error instanceof Error ? error.message : String(error)
  return <div className="alert error">{msg}</div>
}

/** 簡易資料載入 hook。 */
export function useLoad<T>(loader: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [loading, setLoading] = useState(true)
  const reload = useCallback(() => {
    setLoading(true)
    loader()
      .then((d) => {
        setData(d)
        setError(null)
      })
      .catch(setError)
      .finally(() => setLoading(false))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps)
  useEffect(() => {
    reload()
  }, [reload])
  return { data, error, loading, reload, setData }
}

export function fmtDate(s: string | null | undefined) {
  if (!s) return ''
  const d = s.slice(0, 10).split('-')
  return `${Number(d[1])}/${Number(d[2])}`
}

export function fmtDateTime(s: string | null | undefined) {
  if (!s) return ''
  const d = new Date(s)
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit' })
}

export function fmtTime(s: string | null | undefined) {
  if (!s) return ''
  return new Date(s).toLocaleTimeString('zh-TW', { timeZone: 'Asia/Taipei', hour: '2-digit', minute: '2-digit' })
}

export const MATCHUP_STATUS: Record<string, { text: string; cls: string }> = {
  PENDING: { text: '尚未開始', cls: '' },
  LIVE: { text: '進行中', cls: 'live' },
  PROVISIONAL: { text: '暫定結果（48 小時內可能因數據修正改變）', cls: 'warn' },
  LOCKED: { text: '已確定', cls: 'ok' },
}

export function Footer() {
  return (
    <footer className="site">
      <p>
        本站為私人、非商業、免費的封閉聯盟娛樂工具，與中華職業棒球大聯盟及各球團無任何隸屬或合作關係。
        本站不涉及任何金錢、獎品或可兌換價值之元素；FAAB 為聯盟內部虛擬預算，不得儲值或轉換。
      </p>
      <p>
        資料來源：比賽統計數據取自中華職棒官方網站公開之客觀數據（僅擷取統計欄位，不擷取新聞、圖片或其他內容）。
        球隊以自訂色塊與縮寫呈現，未使用任何官方標誌。 <Link to="/privacy">隱私權政策與資料來源</Link>
      </p>
    </footer>
  )
}

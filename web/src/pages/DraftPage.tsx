import { useEffect, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftView } from '../api'
import { ErrorBox, Loading, useLoad } from '../components'
import { useServerNow } from '../hooks'
import DraftOrderPage from './DraftOrderPage'
import DraftRoom from './DraftRoomPage'
import KeeperPage from './KeeperPage'

/** 揭曉動畫的長度，與後端 DraftService.REVEAL_SECONDS 一致 */
const REVEAL_MS = 10_000

/**
 * 選秀入口：/draft/keepers（Keeper）、/draft/order（順位抽籤／揭曉）、/draft/room（選秀室）。
 * /draft 依狀態自動決定：keeper 期 → Keeper；揭曉前後到開始前 → 順位；進行中、完成 → 選秀室。
 */
export default function DraftPage() {
  const { leagueId, league, reloadLeague, reloadSystem } = useApp()
  // 選秀的倒數、揭曉動畫都以伺服器時間計算（useServerNow）。App 只在開啟時對時一次，伺服器重啟、
  // demo 快轉後會不準，所以進入選秀頁時重新對時，之後每 60 秒再對一次
  useEffect(() => {
    reloadSystem()
    const t = setInterval(reloadSystem, 60_000)
    return () => clearInterval(t)
  }, [reloadSystem])
  const { pathname } = useLocation()
  const navigate = useNavigate()
  const drafts = useLoad(() => api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const [halfNo, setHalfNo] = useState(1)
  const [when, setWhen] = useState('')
  const active = (drafts.data || []).find((d) => d.status !== 'COMPLETED') ?? (drafts.data || []).slice(-1)[0]
  const live = active?.status === 'IN_PROGRESS'
  const before = active?.status === 'SETUP' || active?.status === 'KEEPERS'
  // 不能跳過揭曉：揭曉後動畫（10 秒）播完才能開始選秀（後端同樣檢查）
  const now = useServerNow(1000)
  const revealShown = !!active?.revealedAt && now >= Date.parse(active.revealedAt) + REVEAL_MS

  // v1 以輪詢同步（SSE / WebSocket 列在工程待辦 E8）：進行中 2 秒；開始前 3 秒，讓揭曉動畫各裝置同步開始
  useEffect(() => {
    if (!live && !before) return
    const t = setInterval(() => drafts.reload(), live ? 2000 : 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live, before])

  const call = async (fn: () => Promise<unknown>) => {
    setErr(null)
    try {
      await fn()
      drafts.reload()
      reloadLeague()
    } catch (e) {
      setErr(e)
    }
  }

  if (drafts.loading && !drafts.data) return <Loading />
  const changed = () => { drafts.reload(); reloadLeague() }
  const view = !active ? null
    : pathname.startsWith('/draft/keepers') ? 'keepers'
      : pathname.startsWith('/draft/order') ? 'order'
        : pathname.startsWith('/draft/room') ? 'room'
          : active.status === 'KEEPERS' && !active.revealedAt ? 'keepers'
            : before ? 'order' : 'room'
  return (
    <div className="stack">
      <ErrorBox error={err || drafts.error} />
      {!active && <p className="muted">尚未建立選秀。</p>}
      {active && view === 'keepers' && (active.halfNo === 2
        ? <KeeperPage draft={active} onChange={changed} />
        : <p className="muted">上半季沒有 keeper。</p>)}
      {active && view === 'order' && <DraftOrderPage draft={active} onChange={changed} />}
      {active && view === 'room' && <DraftRoom draft={active} onChange={changed} />}
      {league?.commissioner && (
        <div className="card">
          <h2>聯盟管理員</h2>
          <div className="row">
            <select value={halfNo} onChange={(e) => setHalfNo(Number(e.target.value))} aria-label="半季">
              <option value={1}>上半季</option>
              <option value={2}>下半季補強選秀（含 keeper）</option>
            </select>
            <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="選秀時間" title="選秀時間（keeper 在前 10 分鐘截止）" />
            <button type="button" onClick={() => call(() => api.put(`/api/leagues/${leagueId}/drafts/half/${halfNo}`,
              { scheduledAt: when ? `${when}:00+08:00` : null }))}>設定選秀</button>
            {active && (active.status === 'SETUP' || active.status === 'KEEPERS') && !active.revealedAt && (
              <button type="button" onClick={async () => {
                await call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/reveal`))
                navigate('/draft/order') // 揭曉的人也要看到抽籤動畫
              }}>揭曉順位</button>
            )}
            {active && before && active.revealedAt && (
              <button type="button" className="primary" disabled={!revealShown}
                onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/start`))}>
                {revealShown ? '開始選秀' : '揭曉中…'}
              </button>
            )}
            {active && live && (
              <button type="button" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/auto-complete`))}>剩餘全部自動選取</button>
            )}
          </div>
          {active && active.status !== 'COMPLETED' && (
            <>
              <p className="muted" style={{ margin: '12px 0 6px' }}>託管：輪到就在 3 秒內自動選（候選清單 → 補缺位 → 排名）。電腦隊伍或缺席的人可以替他開。</p>
              <div className="row">
                {(league.teams ?? []).map((t) => {
                  const on = active.autopilotTeams.includes(t.id)
                  return (
                    <button key={t.id} type="button" aria-pressed={on} className={on ? 'primary' : ''}
                      onClick={() => call(() => api.put(`/api/leagues/${leagueId}/drafts/${active.id}/autopilot`, { teamId: t.id, on: !on }))}>
                      {t.name}・託管{on ? '開' : '關'}
                    </button>
                  )
                })}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  )
}

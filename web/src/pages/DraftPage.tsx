import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../App'
import { api, type BoardPlayer, type DraftView } from '../api'
import { celebrate, ErrorBox, Loading, TeamChip, useLoad } from '../components'
import DraftOrderPage from './DraftOrderPage'
import { PlayerList, RoomHeader, useDraftBoard, useDraftQueue } from './DraftRoomPage'
import KeeperPage from './KeeperPage'

/**
 * 選秀入口：/draft/keepers（Keeper）、/draft/order（順位抽籤／揭曉）、/draft/room（選秀室）。
 * /draft 依狀態自動決定：keeper 期 → Keeper；揭曉前後到開始前 → 順位；進行中、完成 → 選秀室。
 */
export default function DraftPage() {
  const { leagueId, league, reloadLeague } = useApp()
  const { pathname } = useLocation()
  const drafts = useLoad(() => api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const [halfNo, setHalfNo] = useState(1)
  const [when, setWhen] = useState('')
  const active = (drafts.data || []).find((d) => d.status !== 'COMPLETED') ?? (drafts.data || []).slice(-1)[0]
  const live = active?.status === 'IN_PROGRESS'
  const before = active?.status === 'SETUP' || active?.status === 'KEEPERS'

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
            <button type="button" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts`,
              { halfNo, scheduledAt: when ? `${when}:00+08:00` : null }))}>建立選秀</button>
            {active && (active.status === 'SETUP' || active.status === 'KEEPERS') && !active.revealedAt && (
              <button type="button" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/reveal`))}>揭曉順位</button>
            )}
            {active && (active.status === 'SETUP' || active.status === 'KEEPERS') && (
              <button type="button" className="primary" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/start`))}>開始選秀</button>
            )}
            {active && live && (
              <button type="button" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/auto-complete`))}>剩餘全部自動選取</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}

function DraftRoom({ draft, onChange }: { draft: DraftView; onChange: () => void }) {
  const { leagueId, league } = useApp()
  const teamName = (id: number | null) => league?.teams.find((t) => t.id === id)?.name ?? ''
  const myTurn = draft.status === 'IN_PROGRESS' && draft.currentTeamId === league?.myTeamId
  const myPicks = draft.picks.filter((p) => p.teamId === league?.myTeamId && p.playerId)
  const queue = useDraftQueue(draft)
  const board = useDraftBoard(draft)
  const [sel, setSel] = useState<number | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const pick = async (p: BoardPlayer) => {
    setErr(null)
    try {
      await api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/pick`, { playerId: p.playerId })
      celebrate()
      onChange()
    } catch (e) {
      setErr(e)
    }
  }

  return (
    <>
      <RoomHeader draft={draft} queueLen={queue.ids.length} />
      {draft.status === 'KEEPERS' && !draft.revealedAt && <p className="muted">Keeper 選擇期：<Link to="/draft/keepers">前往選擇 Keeper</Link></p>}
      <ErrorBox error={err || board.error} />
      {draft.status !== 'COMPLETED' && (
        <PlayerList draft={draft} board={board.data ?? null} queue={queue} myTurn={myTurn} onPick={pick}
          selId={sel} onSelect={(p) => setSel(p.playerId)} />
      )}
      {myPicks.length > 0 && (
        <div className="card flush">
          <div className="listhead">我的選秀 <small>{myPicks.length} / {draft.rounds}</small></div>
          <div style={{ padding: '10px 14px' }} className="row">
            {myPicks.map((p) => <span key={p.pickNo} className="badge">{p.round}. {p.playerName}{p.keeper ? '（K）' : ''}</span>)}
          </div>
        </div>
      )}
      {draft.picks.length > 0 && (
        <div className="card">
          <div className="h2" style={{ margin: '0 0 10px' }}>選秀板 <small>順序：{draft.order.map((id) => teamName(id).slice(0, 2)).join(' → ')}</small></div>
          <div className="board">
            {draft.picks.filter((p) => p.playerId || p.pickNo === draft.currentPickNo).slice(-30).reverse().map((p) => (
              <div key={p.pickNo} className={`pick ${p.pickNo === draft.currentPickNo && draft.status === 'IN_PROGRESS' ? 'current' : ''} ${p.teamId === league?.myTeamId ? 'mine' : ''}`}>
                <div className="ps">#{p.pickNo}・R{p.round}・{p.teamName}</div>
                {p.playerId ? <div><TeamChip code={p.playerTeam} /> {p.playerName}{p.keeper && <span className="badge" style={{ marginLeft: 4 }}>K</span>}{p.auto && <span className="badge" style={{ marginLeft: 4 }}>自動</span>}</div> : <div className="amber">選擇中…</div>}
              </div>
            ))}
          </div>
        </div>
      )}
    </>
  )
}

import { useEffect, useRef, useState } from 'react'
import { Link, useLocation, useNavigate } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftView, type PlayerRow } from '../api'
import { Avatar, celebrate, ErrorBox, Loading, PlayerCard, StatusBadge, TeamChip, tierOf, useLoad } from '../components'
import { cpblTeam } from '../teams'
import DraftOrderPage from './DraftOrderPage'
import { RoomHeader } from './DraftRoomPage'
import KeeperPage from './KeeperPage'
import { cardBack, cardLine } from './PlayersPage'

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
  const { league } = useApp()
  const teamName = (id: number | null) => league?.teams.find((t) => t.id === id)?.name ?? ''
  const myTurn = draft.status === 'IN_PROGRESS' && draft.currentTeamId === league?.myTeamId
  const myPicks = draft.picks.filter((p) => p.teamId === league?.myTeamId && p.playerId)

  return (
    <>
      <RoomHeader draft={draft} />
      {draft.status === 'KEEPERS' && !draft.revealedAt && <p className="muted">Keeper 選擇期：<Link to="/draft/keepers">前往選擇 Keeper</Link></p>}
      {draft.status === 'IN_PROGRESS' && <Available draft={draft} myTurn={myTurn} onPicked={onChange} />}
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

function Available({ draft, myTurn, onPicked }: { draft: DraftView; myTurn: boolean; onPicked: () => void }) {
  const { leagueId } = useApp()
  const navigate = useNavigate()
  const [pos, setPos] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const [revealed, setRevealed] = useState<PlayerRow | null>(null)
  const list = useLoad(
    () => api.get<PlayerRow[]>(`/api/leagues/${leagueId}/players?avail=draft&draftId=${draft.id}&pos=${pos}&limit=40`),
    [leagueId, draft.id, draft.currentPickNo, pos],
  )
  const wasMyTurn = useRef(myTurn)
  useEffect(() => {
    // 輪到自己時震動提示（支援的手機才有作用）
    if (myTurn && !wasMyTurn.current && 'vibrate' in navigator) navigator.vibrate?.(200)
    wasMyTurn.current = myTurn
  }, [myTurn])

  const pick = async (p: PlayerRow) => {
    setErr(null)
    try {
      await api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/pick`, { playerId: p.playerId })
      setRevealed(p)
      celebrate()
      onPicked()
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <div className="card flush">
      <div className="listhead plain">可選球員 <small>依本季表現排名</small></div>
      <div className="chips">
        {['', 'IF', 'OF', 'UTIL', 'SP', 'RP'].map((p) => <button key={p} type="button" aria-pressed={pos === p} onClick={() => setPos(p)}>{p || '全部'}</button>)}
      </div>
      <div style={{ padding: '0 14px' }}><ErrorBox error={err} /></div>
      {(list.data || []).map((p, i) => (
        <div className="arow" key={p.playerId}>
          <div className="rank">{i + 1}</div>
          <Avatar team={p.cpblTeam} number={p.jerseyNumber} />
          <button type="button" className="name" style={{ background: 'none', border: 0, padding: 0, textAlign: 'left', fontWeight: 400 }} onClick={() => navigate(`/players/${p.playerId}`)}>
            <div className="pn">{p.name}{p.foreign && <span className="badge">洋</span>}<StatusBadge status={p.status} /></div>
            <div className="ps">{cpblTeam(p.cpblTeam).short}・{p.eligible.join(',')}・{cardLine(p)}</div>
          </button>
          <button type="button" className="primary" disabled={!myTurn} onClick={() => pick(p)}>選</button>
        </div>
      ))}
      {revealed && (
        <div className="reveal" onClick={(e) => e.target === e.currentTarget && setRevealed(null)}>
          <div>
            <PlayerCard name={revealed.name} team={revealed.cpblTeam} number={revealed.jerseyNumber} positions={revealed.eligible.join('・')}
              line={cardLine(revealed)} tier={tierOf(revealed.rank)} back={cardBack(revealed)} />
            <p>選中 {revealed.name}！點空白處關閉</p>
          </div>
        </div>
      )}
    </div>
  )
}


import { useEffect, useRef, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftView, type PlayerRow, type RosterResponse } from '../api'
import { Avatar, celebrate, ErrorBox, Loading, PlayerCard, StatusBadge, TeamChip, tierOf, useLoad } from '../components'
import { cpblTeam } from '../teams'
import { cardBack, cardLine } from './PlayersPage'

const DRAFT_STATUS: Record<string, string> = {
  SETUP: '準備中', KEEPERS: 'Keeper 選擇期', IN_PROGRESS: '進行中', COMPLETED: '已完成',
}
const C = 2 * Math.PI * 44

export default function DraftPage() {
  const { leagueId, league, reloadLeague } = useApp()
  const drafts = useLoad(() => api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const [halfNo, setHalfNo] = useState(1)
  const active = (drafts.data || []).find((d) => d.status !== 'COMPLETED') ?? (drafts.data || []).slice(-1)[0]
  const live = active?.status === 'IN_PROGRESS'

  // v1 以 2 秒輪詢同步（SSE / WebSocket 列在工程待辦 E8）
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => drafts.reload(), 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

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
  return (
    <div className="stack">
      <ErrorBox error={err || drafts.error} />
      {!active && <p className="muted">尚未建立選秀。</p>}
      {active && <DraftRoom draft={active} onChange={() => { drafts.reload(); reloadLeague() }} />}
      {league?.commissioner && (
        <div className="card">
          <h2>聯盟管理員</h2>
          <div className="row">
            <select value={halfNo} onChange={(e) => setHalfNo(Number(e.target.value))} aria-label="半季">
              <option value={1}>上半季</option>
              <option value={2}>下半季補強選秀（含 keeper）</option>
            </select>
            <button type="button" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts`, { halfNo }))}>建立選秀</button>
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
  const [left, setLeft] = useState(draft.secondsLeft)
  useEffect(() => {
    setLeft(draft.secondsLeft)
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [draft.secondsLeft, draft.currentPickNo])

  const current = draft.picks.find((p) => p.pickNo === draft.currentPickNo)
  const next = draft.picks.find((p) => p.pickNo > draft.currentPickNo && !p.playerId)
  const myPicks = draft.picks.filter((p) => p.teamId === league?.myTeamId && p.playerId)

  return (
    <>
      {draft.status === 'IN_PROGRESS' ? (
        <div className={`clock ${myTurn ? '' : 'idle'}`}>
          <div className={`ring ${left <= 10 ? 'urgent' : ''}`}>
            <svg viewBox="0 0 100 100"><circle className="track" cx="50" cy="50" r="44" /><circle className="prog" cx="50" cy="50" r="44" style={{ strokeDasharray: C, strokeDashoffset: C * (1 - left / draft.pickSeconds) }} /></svg>
            <span>{left}</span>
          </div>
          <div>
            <h2 className={myTurn ? 'gold-text' : ''}>{myTurn ? '輪到你了' : `${teamName(draft.currentTeamId)} 選擇中`}</h2>
            <p>第 {current?.round} 輪・第 {draft.currentPickNo} 順位{next && <><br />下一位：{teamName(next.teamId)}</>}</p>
          </div>
        </div>
      ) : (
        <div className="card">
          <div className="spread"><h2 style={{ margin: 0 }}>{draft.halfNo === 1 ? '上' : '下'}半季選秀</h2><span className="badge gold">{DRAFT_STATUS[draft.status]}</span></div>
          <p className="ps" style={{ marginBottom: 0 }}>Snake draft・{draft.rounds} 輪・每次 {draft.pickSeconds} 秒，逾時自動選取排名最高且符合洋將上限與位置需求的球員。</p>
        </div>
      )}
      {draft.status === 'KEEPERS' && <KeeperPicker draft={draft} onChange={onChange} />}
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

function KeeperPicker({ draft, onChange }: { draft: DraftView; onChange: () => void }) {
  const { leagueId, league } = useApp()
  const roster = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${league?.myTeamId}/roster`), [leagueId])
  const [chosen, setChosen] = useState<number[]>(draft.myKeepers.map((k) => k.playerId))
  const [err, setErr] = useState<unknown>(null)
  const limit = league?.league.keeperLimit ?? 15
  const save = async () => {
    setErr(null)
    try {
      await api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/keepers`, { playerIds: chosen })
      onChange()
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <div className="card">
      <h2>選擇 keeper（至多 {limit} 人）</h2>
      <p className="ps">Keeper 不佔選秀輪次；沒保留的球員回到球員池。截止時間為選秀前 10 分鐘，順位揭曉時公開各隊 keeper。</p>
      <ErrorBox error={err} />
      {(roster.data?.players || []).map((p) => (
        <label key={p.playerId} className="row" style={{ marginBottom: 6 }}>
          <input type="checkbox" checked={chosen.includes(p.playerId)} disabled={!chosen.includes(p.playerId) && chosen.length >= limit}
            onChange={() => setChosen(chosen.includes(p.playerId) ? chosen.filter((x) => x !== p.playerId) : [...chosen, p.playerId])} />
          <TeamChip code={p.cpblTeam} /> {p.name} <StatusBadge status={p.status} />
        </label>
      ))}
      <button type="button" className="primary" onClick={save}>儲存 keeper</button>
      {draft.myKeepers.length > 0 && <p className="ps">目前 keeper：{draft.myKeepers.map((k) => k.name).join('、')}</p>}
    </div>
  )
}

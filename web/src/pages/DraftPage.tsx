import { useEffect, useState } from 'react'
import { useApp } from '../App'
import { api, type DraftView, type PlayerRow, type RosterResponse } from '../api'
import { ErrorBox, Loading, PlayerLink, StatusBadge, TeamChip, useLoad } from '../components'

const DRAFT_STATUS: Record<string, string> = {
  SETUP: '準備中', KEEPERS: 'Keeper 選擇期', IN_PROGRESS: '進行中', COMPLETED: '已完成',
}

export default function DraftPage() {
  const { leagueId, league, reloadLeague } = useApp()
  const drafts = useLoad(() => api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const [halfNo, setHalfNo] = useState(1)

  const active = (drafts.data || []).find((d) => d.status !== 'COMPLETED') ?? (drafts.data || []).slice(-1)[0]
  const live = active?.status === 'IN_PROGRESS'

  // 選秀進行中每 2 秒同步一次（v1 以輪詢實作）
  useEffect(() => {
    if (!live) return
    const t = setInterval(() => drafts.reload(), 2000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [live])

  const commissioner = league?.commissioner
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
    <>
      <h1>選秀</h1>
      <ErrorBox error={err || drafts.error} />
      {commissioner && (
        <div className="card">
          <h2>聯盟管理員</h2>
          <div className="row">
            <select value={halfNo} onChange={(e) => setHalfNo(Number(e.target.value))}>
              <option value={1}>上半季</option>
              <option value={2}>下半季（含 keeper）</option>
            </select>
            <button onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts`, { halfNo }))}>建立 / 重建選秀（隨機順序）</button>
            {active && (active.status === 'SETUP' || active.status === 'KEEPERS') && (
              <button className="primary" onClick={() => call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/start`))}>開始選秀</button>
            )}
            {active && live && (
              <button onClick={() => confirm('剩餘選擇將全部自動選取，確定？') && call(() => api.post(`/api/leagues/${leagueId}/drafts/${active.id}/auto-complete`))}>
                剩餘全部自動選取
              </button>
            )}
          </div>
        </div>
      )}
      {!active && <p className="muted">尚未建立選秀。</p>}
      {active && <DraftRoom draft={active} onChange={() => { drafts.reload(); reloadLeague() }} />}
    </>
  )
}

function DraftRoom({ draft, onChange }: { draft: DraftView; onChange: () => void }) {
  const { leagueId, league } = useApp()
  const teamName = (id: number | null) => league?.teams.find((t) => t.id === id)?.name ?? ''
  const myTurn = draft.status === 'IN_PROGRESS' && draft.currentTeamId === league?.myTeamId
  const [left, setLeft] = useState(draft.secondsLeft)
  useEffect(() => {
    setLeft(draft.secondsLeft)
    const t = setInterval(() => setLeft((x) => Math.max(0, x - 1)), 1000)
    return () => clearInterval(t)
  }, [draft.secondsLeft, draft.currentPickNo])

  const rounds = Array.from({ length: draft.rounds }, (_, i) => i + 1)
  return (
    <>
      <div className="card">
        <div className="spread">
          <h2>{draft.halfNo === 1 ? '上' : '下'}半季選秀</h2>
          <span className="badge">{DRAFT_STATUS[draft.status]}</span>
        </div>
        <p className="small muted">Snake draft・{draft.rounds} 輪・每次 {draft.pickSeconds} 秒，逾時自動選取排名最高且符合洋將上限與位置需求的球員。</p>
        <p className="small">順序：{draft.order.map((id, i) => `${i + 1}. ${teamName(id)}`).join('　')}</p>
        {draft.status === 'IN_PROGRESS' && (
          <div className={`alert ${myTurn ? 'live' : 'info'}`}>
            第 {draft.currentPickNo} 順位：{teamName(draft.currentTeamId)} {myTurn && '（輪到你了！）'}・剩餘 {left} 秒
          </div>
        )}
      </div>
      {draft.status === 'KEEPERS' && <KeeperPicker draft={draft} onChange={onChange} />}
      {draft.status === 'IN_PROGRESS' && <Available draft={draft} myTurn={myTurn} onPicked={onChange} />}
      <div className="card">
        <h2>選秀板</h2>
        {rounds.map((r) => (
          <div key={r} style={{ marginBottom: 8 }}>
            <div className="small muted">第 {r} 輪</div>
            <div className="draft-board">
              {draft.picks.filter((p) => p.round === r).map((p) => (
                <div key={p.pickNo} className={`pick ${p.pickNo === draft.currentPickNo && draft.status === 'IN_PROGRESS' ? 'current' : ''} ${p.keeper ? 'keeper' : ''}`}>
                  <div className="small muted">#{p.pickNo} {p.teamName}</div>
                  {p.playerId ? (
                    <div><TeamChip code={p.playerTeam} /> <PlayerLink id={p.playerId} name={p.playerName ?? ''} leagueId={leagueId} />
                      {p.keeper && <span className="badge" style={{ marginLeft: 4 }}>K</span>}
                      {p.auto && <span className="badge" style={{ marginLeft: 4 }}>自動</span>}
                    </div>
                  ) : <div className="muted">—</div>}
                </div>
              ))}
            </div>
          </div>
        ))}
        {draft.picks.length === 0 && <p className="muted small">選秀開始後顯示。</p>}
      </div>
    </>
  )
}

function Available({ draft, myTurn, onPicked }: { draft: DraftView; myTurn: boolean; onPicked: () => void }) {
  const { leagueId } = useApp()
  const [pos, setPos] = useState('')
  const [q, setQ] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const list = useLoad(
    () => api.get<PlayerRow[]>(`/api/leagues/${leagueId}/players?avail=draft&draftId=${draft.id}&pos=${pos}&q=${encodeURIComponent(q)}&limit=60`),
    [leagueId, draft.id, draft.currentPickNo, pos, q],
  )
  const pick = async (id: number) => {
    setErr(null)
    try {
      await api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/pick`, { playerId: id })
      onPicked()
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <div className="card">
      <h2>可選球員</h2>
      <div className="row" style={{ marginBottom: 8 }}>
        <input placeholder="搜尋" value={q} onChange={(e) => setQ(e.target.value)} style={{ width: 110 }} />
        <select value={pos} onChange={(e) => setPos(e.target.value)}>
          <option value="">全部</option>
          {['IF', 'OF', 'UTIL', 'SP', 'RP'].map((p) => <option key={p} value={p}>{p}</option>)}
        </select>
      </div>
      <ErrorBox error={err} />
      <div className="table-wrap">
        <table>
          <thead><tr><th className="num">#</th><th>球員</th><th>位置</th><th></th></tr></thead>
          <tbody>
            {(list.data || []).map((p) => (
              <tr key={p.playerId}>
                <td className="num muted">{p.rank}</td>
                <td><TeamChip code={p.cpblTeam} /> <PlayerLink id={p.playerId} name={p.name} leagueId={leagueId} />{p.foreign && <span className="badge" style={{ marginLeft: 4 }}>洋</span>} <StatusBadge status={p.status} /></td>
                <td className="small">{p.eligible.join('/')}</td>
                <td><button className="small primary" disabled={!myTurn} onClick={() => pick(p.playerId)}>選</button></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function KeeperPicker({ draft, onChange }: { draft: DraftView; onChange: () => void }) {
  const { leagueId, league } = useApp()
  const roster = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${league?.myTeamId}/roster`), [leagueId])
  const [chosen, setChosen] = useState<number[]>(draft.myKeepers.map((k) => k.playerId))
  const [err, setErr] = useState<unknown>(null)
  const limit = league?.league.keeperLimit ?? 5
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
      <p className="small muted">Keeper 佔用的輪次 = 該球員上次被選中的輪次 − 2（非選秀取得者視為最後一輪）。</p>
      <ErrorBox error={err} />
      {(roster.data?.players || []).map((p) => (
        <label key={p.playerId} className="small" style={{ marginBottom: 2 }}>
          <input
            type="checkbox"
            checked={chosen.includes(p.playerId)}
            disabled={!chosen.includes(p.playerId) && chosen.length >= limit}
            onChange={() => setChosen(chosen.includes(p.playerId) ? chosen.filter((x) => x !== p.playerId) : [...chosen, p.playerId])}
          />{' '}
          <TeamChip code={p.cpblTeam} /> {p.name} <StatusBadge status={p.status} />
        </label>
      ))}
      <button className="primary" onClick={save}>儲存 keeper</button>
      {draft.myKeepers.length > 0 && (
        <p className="small">目前 keeper：{draft.myKeepers.map((k) => `${k.name}（第 ${k.round} 輪）`).join('、')}</p>
      )}
    </div>
  )
}

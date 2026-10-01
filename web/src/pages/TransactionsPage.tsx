import { useState } from 'react'
import { useApp } from '../App'
import { api, type Claim, type RosterResponse, type Trade } from '../api'
import { ErrorBox, fmtDateTime, Loading, useLoad } from '../components'

const CLAIM_STATUS: Record<string, string> = {
  PENDING: '待結算', WON: '成功', LOST: '落選', CANCELLED: '已取消', INVALID: '無效',
}
const TRADE_STATUS: Record<string, string> = {
  PROPOSED: '等待對方回應', IN_REVIEW: '聯盟審核中', REJECTED: '已拒絕', CANCELLED: '已取消',
  VETOED: '遭否決', COMPLETED: '已完成', FAILED: '無法執行',
}

export default function TransactionsPage() {
  return (
    <>
      <h1>異動</h1>
      <Waivers />
      <Trades />
    </>
  )
}

function Waivers() {
  const { leagueId, league } = useApp()
  const { data, error, loading, reload } = useLoad(
    () => api.get<{ claims: Claim[]; players: { player_id: number; name: string; clears_at: string }[] }>(`/api/leagues/${leagueId}/waivers`),
    [leagueId],
  )
  const [err, setErr] = useState<unknown>(null)
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox error={error} />
  const cancel = async (id: number) => {
    try {
      await api.del(`/api/leagues/${leagueId}/waivers/claims/${id}`)
      reload()
    } catch (e) {
      setErr(e)
    }
  }
  return (
    <div className="card">
      <h2>Waiver（FAAB）</h2>
      <p className="small muted">
        釋出球員進入 {league?.league.waiverDays} 日 waiver 期，每日 03:00 結算。出價最高者得；同價時當前戰績較差者優先。
        FAAB 為聯盟內部虛擬預算，每半季重置。
      </p>
      <ErrorBox error={err} />
      <h3>Waiver 中的球員</h3>
      <ul className="list-plain small">
        {data.players.map((p) => (
          <li key={p.player_id}>{p.name} <span className="muted">— {fmtDateTime(p.clears_at)} 結算</span></li>
        ))}
        {data.players.length === 0 && <li className="muted">目前沒有</li>}
      </ul>
      <h3>出價紀錄</h3>
      <div className="table-wrap">
        <table>
          <thead><tr><th>隊伍</th><th>球員</th><th>釋出</th><th className="num">出價</th><th>狀態</th><th></th></tr></thead>
          <tbody>
            {data.claims.map((c) => (
              <tr key={c.id}>
                <td>{c.teamName}</td>
                <td>{c.playerName}</td>
                <td>{c.dropPlayerName ?? '—'}</td>
                <td className="num">{c.faabBid}</td>
                <td title={c.resultNote ?? ''}>{CLAIM_STATUS[c.status]}{c.resultNote && <div className="small muted">{c.resultNote}</div>}</td>
                <td>{c.status === 'PENDING' && c.teamId === league?.myTeamId && <button className="small" onClick={() => cancel(c.id)}>取消</button>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  )
}

function Trades() {
  const { leagueId, league } = useApp()
  const { data, error, loading, reload } = useLoad(() => api.get<Trade[]>(`/api/leagues/${leagueId}/trades`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const [proposing, setProposing] = useState(false)
  const me = league?.myTeamId

  const act = async (path: string, body: unknown) => {
    setErr(null)
    try {
      await api.post(`/api/leagues/${leagueId}/trades/${path}`, body)
      reload()
    } catch (e) {
      setErr(e)
    }
  }

  return (
    <div className="card">
      <div className="spread">
        <h2>交易</h2>
        <button className="small primary" onClick={() => setProposing(!proposing)}>{proposing ? '收起' : '提出交易'}</button>
      </div>
      <p className="small muted">
        雙方同意後進入 {league?.league.tradeReviewHours} 小時聯盟審核期，非當事隊伍過半數反對即否決。交易截止日為各半季最後一期對戰開始前。
      </p>
      <ErrorBox error={err} />
      {proposing && <ProposeForm onDone={() => { setProposing(false); reload() }} />}
      {loading ? <Loading /> : <ErrorBox error={error} />}
      <ul className="list-plain">
        {(data || []).map((t) => (
          <li key={t.id}>
            <div className="spread">
              <b>{t.proposerName} ⇄ {t.receiverName}</b>
              <span className="badge">{TRADE_STATUS[t.status]}</span>
            </div>
            <div className="small">
              {t.proposerName} 送出：{t.items.filter((i) => i.fromTeamId === t.proposerTeamId).map((i) => i.playerName).join('、') || '—'}<br />
              {t.receiverName} 送出：{t.items.filter((i) => i.fromTeamId === t.receiverTeamId).map((i) => i.playerName).join('、') || '—'}
            </div>
            {t.message && <div className="small muted">「{t.message}」</div>}
            {t.status === 'IN_REVIEW' && (
              <div className="small muted">審核至 {fmtDateTime(t.reviewEndsAt)}・反對 {t.objections}/{t.eligibleVoters}</div>
            )}
            {t.resultNote && <div className="small muted">{t.resultNote}</div>}
            <div className="row" style={{ marginTop: 4 }}>
              {t.status === 'PROPOSED' && t.receiverTeamId === me && (
                <>
                  <button className="small primary" onClick={() => act(`${t.id}/respond`, { accept: true })}>接受</button>
                  <button className="small" onClick={() => act(`${t.id}/respond`, { accept: false })}>拒絕</button>
                </>
              )}
              {t.status === 'PROPOSED' && t.proposerTeamId === me && (
                <button className="small" onClick={() => act(`${t.id}/respond`, { accept: false })}>撤回</button>
              )}
              {t.status === 'IN_REVIEW' && t.proposerTeamId !== me && t.receiverTeamId !== me && (
                <button className="small" onClick={() => act(`${t.id}/vote`, { object: !t.myObjection })}>
                  {t.myObjection ? '撤回反對' : '反對此交易'}
                </button>
              )}
            </div>
          </li>
        ))}
        {data && data.length === 0 && <li className="muted">尚無交易</li>}
      </ul>
    </div>
  )
}

function ProposeForm({ onDone }: { onDone: () => void }) {
  const { leagueId, league } = useApp()
  const others = (league?.teams || []).filter((t) => t.id !== league?.myTeamId)
  const [target, setTarget] = useState<number>(others[0]?.id ?? 0)
  const [give, setGive] = useState<number[]>([])
  const [receive, setReceive] = useState<number[]>([])
  const [message, setMessage] = useState('')
  const [err, setErr] = useState<unknown>(null)
  const mine = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${league?.myTeamId}/roster`), [leagueId])
  const theirs = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${target}/roster`), [leagueId, target])
  const toggle = (list: number[], set: (v: number[]) => void, id: number) =>
    set(list.includes(id) ? list.filter((x) => x !== id) : [...list, id])

  const submit = async () => {
    try {
      await api.post(`/api/leagues/${leagueId}/trades`, { receiverTeamId: target, give, receive, message })
      onDone()
    } catch (e) {
      setErr(e)
    }
  }

  return (
    <div className="card" style={{ background: 'var(--surface-2)' }}>
      <ErrorBox error={err} />
      <label>
        <span>交易對象</span>
        <select value={target} onChange={(e) => { setTarget(Number(e.target.value)); setReceive([]) }}>
          {others.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      </label>
      <div className="row" style={{ alignItems: 'flex-start' }}>
        <div className="grow">
          <h3>我方送出</h3>
          {(mine.data?.players || []).map((p) => (
            <label key={p.playerId} className="small" style={{ marginBottom: 2 }}>
              <input type="checkbox" checked={give.includes(p.playerId)} onChange={() => toggle(give, setGive, p.playerId)} /> {p.slot} {p.name}
            </label>
          ))}
        </div>
        <div className="grow">
          <h3>對方送出</h3>
          {(theirs.data?.players || []).map((p) => (
            <label key={p.playerId} className="small" style={{ marginBottom: 2 }}>
              <input type="checkbox" checked={receive.includes(p.playerId)} onChange={() => toggle(receive, setReceive, p.playerId)} /> {p.slot} {p.name}
            </label>
          ))}
        </div>
      </div>
      <label><span>附註</span><input value={message} maxLength={200} onChange={(e) => setMessage(e.target.value)} style={{ width: '100%' }} /></label>
      <button className="primary" onClick={submit} disabled={give.length + receive.length === 0}>送出提案</button>
    </div>
  )
}

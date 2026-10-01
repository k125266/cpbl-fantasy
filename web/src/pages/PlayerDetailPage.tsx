import { useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type PlayerStatus } from '../api'
import { ErrorBox, Loading, StatusBadge, TeamChip, useLoad } from '../components'

interface Detail {
  player: { id: number; name: string; team: string; foreign: boolean; listedPosition: string }
  status?: PlayerStatus
  eligible?: string[]
  season: Record<string, string>
  nameHistory: { old_name: string; new_name: string; changed_at: string }[]
  statusLog: { field: string; old_value: string | null; new_value: string; effective_date: string }[]
  gameLog: Record<string, string | number | boolean>[]
}

const FIELD: Record<string, string> = {
  first_team_status: '一軍狀態', registration_status: '註冊狀態', cpbl_team_code: '所屬球隊',
}
const VALUE: Record<string, string> = { ACTIVE: '一軍', MINORS: '二軍', REGISTERED: '註冊', DELISTED: '註銷' }

export default function PlayerDetailPage() {
  const { playerId } = useParams()
  const { leagueId } = useApp()
  const { data, error, loading } = useLoad(() => api.get<Detail>(`/api/players/${playerId}?leagueId=${leagueId}`), [playerId, leagueId])
  if (loading) return <Loading />
  if (error || !data) return <ErrorBox error={error} />
  const p = data.player
  const isPitcher = p.listedPosition === 'P'
  return (
    <>
      <h1><TeamChip code={p.team} /> {p.name} {p.foreign && <span className="badge">洋將</span>}</h1>
      <div className="card">
        <p>
          登錄位置：{{ P: '投手', C: '捕手', IF: '內野手', OF: '外野手', UNKNOWN: '未知' }[p.listedPosition]}
          {data.eligible && <>・資格：{data.eligible.join(' / ')}</>}
        </p>
        <StatusBadge status={data.status} />
        <h3>本季</h3>
        <p className="small">
          {isPitcher
            ? `IP ${data.season.IP}・QS ${data.season.QS}・K ${data.season.K}・SV+HLD ${data.season['SV+HLD']}・ERA ${data.season.ERA}・WHIP ${data.season.WHIP}`
            : `${data.season.H}/${data.season.AB}・AVG ${data.season.AVG}・R ${data.season.R}・HR ${data.season.HR}・RBI ${data.season.RBI}・SB ${data.season.SB}`}
        </p>
        {data.nameHistory.length > 0 && (
          <p className="small muted">曾用名：{data.nameHistory.map((h) => h.old_name).join('、')}</p>
        )}
      </div>
      <div className="card">
        <h2>逐場紀錄</h2>
        <div className="table-wrap">
          <table>
            <thead>
              <tr><th>日期</th><th>對手</th>{isPitcher
                ? <><th className="num">IP</th><th className="num">H</th><th className="num">BB</th><th className="num">ER</th><th className="num">K</th><th>SV/HLD</th></>
                : <><th>守位</th><th className="num">AB</th><th className="num">H</th><th className="num">R</th><th className="num">HR</th><th className="num">RBI</th><th className="num">SB</th></>}
                <th>rev</th></tr>
            </thead>
            <tbody>
              {data.gameLog.map((g, i) => (
                <tr key={i}>
                  <td>{String(g.play_date)}</td>
                  <td><TeamChip code={String(g.opponent)} /></td>
                  {isPitcher ? (
                    <>
                      <td className="num">{Math.floor(Number(g.outs) / 3)}.{Number(g.outs) % 3}{g.started ? '（先發）' : ''}</td>
                      <td className="num">{String(g.p_h)}</td><td className="num">{String(g.p_bb)}</td><td className="num">{String(g.p_er)}</td><td className="num">{String(g.p_k)}</td>
                      <td>{Number(g.sv) > 0 ? 'SV' : Number(g.hld) > 0 ? 'HLD' : ''}</td>
                    </>
                  ) : (
                    <>
                      <td>{String(g.positions || '代')}</td>
                      <td className="num">{String(g.ab)}</td><td className="num">{String(g.h)}</td><td className="num">{String(g.r)}</td>
                      <td className="num">{String(g.hr)}</td><td className="num">{String(g.rbi)}</td><td className="num">{String(g.sb)}</td>
                    </>
                  )}
                  <td className="small muted">{String(g.revision)}{g.is_final ? '' : '*'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <p className="small muted">* 表示數據尚未定版（官方記錄可能修正）。</p>
      </div>
      <div className="card">
        <h2>異動紀錄</h2>
        <ul className="list-plain small">
          {data.statusLog.map((l, i) => (
            <li key={i}>{l.effective_date}・{FIELD[l.field] ?? l.field}：{l.old_value ? VALUE[l.old_value] ?? l.old_value : '—'} → {VALUE[l.new_value] ?? l.new_value}</li>
          ))}
        </ul>
      </div>
    </>
  )
}

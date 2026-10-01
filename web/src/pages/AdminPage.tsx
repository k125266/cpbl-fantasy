import { useState } from 'react'
import { useApp } from '../App'
import { api } from '../api'
import { ErrorBox, fmtDateTime, Loading, useLoad } from '../components'

interface Status {
  now: string
  demoClock: boolean
  disabledJobs: string[]
  jobs: { id: number; job_name: string; started_at: string; status: string; items_processed: number; revisions: number; anomalies: number; summary: string }[]
  alerts: { id: number; level: string; source: string; message: string; createdAt: string; acknowledged: boolean }[]
  games: Record<string, number>
}

const JOBS = ['schedule-poller', 'registration-sync', 'settlement', 'live-poller', 'roster-maintenance', 'waiver', 'trade-review',
  'matchup-progress', 'daily-summary', 'reconciliation']

export default function AdminPage() {
  const { reloadSystem, reloadLeague } = useApp()
  const status = useLoad(() => api.get<Status>('/api/admin/status'), [])
  const revisions = useLoad(() => api.get<Record<string, unknown>[]>('/api/admin/revisions?limit=30'), [])
  const [err, setErr] = useState<unknown>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [days, setDays] = useState(1)
  const [clock, setClock] = useState('')
  const [busy, setBusy] = useState(false)

  const run = async (fn: () => Promise<unknown>) => {
    setErr(null)
    setMsg(null)
    setBusy(true)
    try {
      const r = await fn()
      setMsg(JSON.stringify(r))
      status.reload()
      revisions.reload()
      reloadSystem()
      reloadLeague()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  if (status.loading && !status.data) return <Loading />
  const s = status.data
  return (
    <>
      <h1>系統管理</h1>
      <ErrorBox error={err || status.error} />
      {msg && <div className="alert info small">{msg}</div>}
      {s?.demoClock && (
        <div className="card">
          <h2>Demo 時鐘</h2>
          <p className="small">目前模擬時間：{s.now.slice(0, 16).replace('T', ' ')}</p>
          <div className="row">
            <input type="number" min={1} max={60} value={days} onChange={(e) => setDays(Number(e.target.value))} style={{ width: 70 }} />
            <button className="primary" disabled={busy} onClick={() => run(() => api.post('/api/admin/demo/advance', { days }))}>快轉 {days} 天</button>
          </div>
          <div className="row" style={{ marginTop: 8 }}>
            <input type="datetime-local" value={clock} onChange={(e) => setClock(e.target.value)} />
            <button disabled={busy || !clock} onClick={() => run(() => api.post('/api/admin/demo/clock', { at: clock + ':00' }))}>跳到此時間</button>
          </div>
          <p className="small muted">快轉會依正式排程順序執行每日工作（維護、waiver、名單同步、賽程、結算、對戰推進）。跳到比賽時段（例如 19:30）可查看即時比分。</p>
        </div>
      )}
      {s && (
        <div className="card">
          <h2>資料狀態</h2>
          <p className="small">
            已結束 {s.games.final_games} 場・數據定版 {s.games.stats_final_games} 場・延賽中 {s.games.postponed} 場・補賽 {s.games.makeups} 場
          </p>
          {s.disabledJobs.length > 0 && (
            <div className="alert error">
              已停用的 job（收到速率限制，需人工確認）：
              {s.disabledJobs.map((j) => (
                <button key={j} className="small" style={{ marginLeft: 6 }} onClick={() => run(() => api.post(`/api/admin/jobs/${j}/enable`))}>重新啟用 {j}</button>
              ))}
            </div>
          )}
          <div className="row">
            {JOBS.map((j) => (
              <button key={j} className="small" disabled={busy} onClick={() => run(() => api.post(`/api/admin/jobs/${j}/run`))}>{j}</button>
            ))}
          </div>
        </div>
      )}
      <div className="card">
        <h2>告警</h2>
        <ul className="list-plain small">
          {(s?.alerts || []).map((a) => (
            <li key={a.id} style={{ opacity: a.acknowledged ? 0.5 : 1 }}>
              <span className={`badge ${a.level === 'ERROR' ? 'danger' : a.level === 'WARN' ? 'warn' : ''}`}>{a.level}</span> {a.source}・{fmtDateTime(a.createdAt)}
              {!a.acknowledged && <button className="small" style={{ marginLeft: 6 }} onClick={() => run(() => api.post(`/api/admin/alerts/${a.id}/ack`))}>已讀</button>}
              <pre className="mono">{a.message}</pre>
            </li>
          ))}
        </ul>
      </div>
      <div className="card">
        <h2>Job 紀錄</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>job</th><th>開始</th><th>狀態</th><th className="num">處理</th><th className="num">修正</th><th className="num">異常</th><th>摘要</th></tr></thead>
            <tbody>
              {(s?.jobs || []).map((j) => (
                <tr key={j.id}>
                  <td>{j.job_name}</td><td>{fmtDateTime(j.started_at)}</td><td>{j.status}</td>
                  <td className="num">{j.items_processed}</td><td className="num">{j.revisions}</td><td className="num">{j.anomalies}</td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{j.summary}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
      <div className="card">
        <h2>數據修正歷程</h2>
        <div className="table-wrap">
          <table>
            <thead><tr><th>時間</th><th>場次</th><th>球員</th><th>rev</th><th>變更</th></tr></thead>
            <tbody>
              {(revisions.data || []).map((r) => (
                <tr key={String(r.id)}>
                  <td>{fmtDateTime(String(r.created_at))}</td>
                  <td>#{String(r.game_sno)} {String(r.play_date)}</td>
                  <td>{String(r.name)}</td>
                  <td>{String(r.old_revision)}→{String(r.new_revision)}</td>
                  <td className="small" style={{ whiteSpace: 'normal' }}>{diff(String(r.old_values), String(r.new_values))}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  )
}

function diff(a: string, b: string) {
  try {
    const x = JSON.parse(a)
    const y = JSON.parse(b)
    return Object.keys(y).filter((k) => JSON.stringify(x[k]) !== JSON.stringify(y[k])).map((k) => `${k}: ${x[k]} → ${y[k]}`).join('，')
  } catch {
    return ''
  }
}

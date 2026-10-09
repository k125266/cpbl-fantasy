import { useState } from 'react'
import { useApp } from '../App'
import { api } from '../api'
import { ErrorBox, fmtDateTime, Loading, useLoad } from '../components'
import { cpblTeam } from '../teams'

interface Status {
  now: string
  demoClock: boolean
  disabledJobs: string[]
  jobs: { id: number; job_name: string; started_at: string; status: string; items_processed: number; revisions: number; anomalies: number; summary: string }[]
  alerts: { id: number; level: string; source: string; message: string; createdAt: string; acknowledged: boolean }[]
  games: Record<string, number>
  /** 重播模式才有 */
  replay?: {
    archivedGames: number
    archivedPlayers: number
    suggested: { opening: string | null; half1End: string | null; half2Start: string | null; seasonEnd: string | null }
    leagues: { league_id: number; name: string; half_no: number | null; start_date: string | null; draft_status: string }[]
  }
  /** 選秀參考季（上一季），模擬賽季沒有 */
  reference?: { year: number; games: number; players: number }
}

/** 接下來的比賽與開賽時間（GET /api/admin/games/upcoming），startLocal 為台北時間 */
interface UpcomingGame {
  kind: string
  sno: number
  date: string
  home: string
  away: string
  status: string
  startLocal: string | null
  manual: boolean
}

const KIND: Record<string, string> = { A: '例行賽', E: '季後挑戰賽', C: '台灣大賽' }

/** 賽程時間：官網的開賽時間有時不準，系統管理員可以手動設定（設定後賽程更新不會覆寫）；清空＝改回預設。 */
function GameTimesCard({ run, busy }: { run: (fn: () => Promise<unknown>) => void; busy: boolean }) {
  const games = useLoad(() => api.get<UpcomingGame[]>('/api/admin/games/upcoming'), [])
  const [edit, setEdit] = useState<Record<string, string>>({})
  const rows = games.data ?? []
  const keyOf = (g: UpcomingGame) => `${g.kind}-${g.sno}`
  const save = (g: UpcomingGame, at: string) =>
    run(() => api.put(`/api/admin/games/${g.kind}/${g.sno}/start-time`, { at }).finally(() => {
      setEdit((e) => { const n = { ...e }; delete n[keyOf(g)]; return n })
      games.reload()
    }))
  return (
    <div className="card">
      <h2>賽程時間</h2>
      <p className="small muted">官網的開賽時間有時會偏移。這裡可以手動改（台北時間）；手動設定後賽程更新不會覆寫，「改回預設」會取消手動設定。即時比分的輪詢不依賴這個時間，所以改錯也不會漏抓。</p>
      {games.loading && !games.data && <Loading />}
      <ErrorBox error={games.error} />
      {games.data && rows.length === 0 && <p className="small muted">接下來沒有比賽。</p>}
      {rows.map((g) => {
        const value = edit[keyOf(g)] ?? g.startLocal ?? ''
        const changed = edit[keyOf(g)] !== undefined && edit[keyOf(g)] !== (g.startLocal ?? '')
        return (
          <div key={keyOf(g)} className="row" style={{ alignItems: 'center', flexWrap: 'wrap', gap: 8, marginTop: 8 }}>
            <span className="small" style={{ minWidth: 190 }}>
              {KIND[g.kind] ?? g.kind} #{g.sno}・{g.date.slice(5)}・{cpblTeam(g.away).short} @ {cpblTeam(g.home).short}
            </span>
            <input type="datetime-local" value={value} aria-label={`${keyOf(g)} 開賽時間`}
              onChange={(e) => setEdit((x) => ({ ...x, [keyOf(g)]: e.target.value }))} />
            <button className="small" disabled={busy || !changed || !value} onClick={() => save(g, value)}>儲存</button>
            {g.manual && <button className="small" disabled={busy} onClick={() => save(g, '')}>改回預設</button>}
            {g.manual && <span className="small muted">手動</span>}
          </div>
        )
      })}
    </div>
  )
}

/** 一次性建盟碼（GET /api/admin/create-codes） */
interface CreateCode {
  code: string
  createdAt: string
  usedBy: string | null
  usedAt: string | null
  leagueName: string | null
  revokedAt: string | null
}

const DRAFT_STATUS: Record<string, string> = { NONE: '未建立', SETUP: '準備中', KEEPERS: 'Keeper 選擇中', IN_PROGRESS: '選秀中', COMPLETED: '已完成' }

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
  const codes = useLoad(() => api.get<CreateCode[]>('/api/admin/create-codes'), [])
  const [copied, setCopied] = useState<string | null>(null)

  const copyCode = (code: string) => {
    try {
      navigator.clipboard?.writeText(code)
    } catch {
      // 剪貼簿不可用時只顯示
    }
    setCopied(code)
  }

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
      {s?.replay && (
        <div className="card">
          <h2>重播 2026 球季</h2>
          <p className="small">
            已封存比賽 {s.replay.archivedGames} 場・球員 {s.replay.archivedPlayers} 人
          </p>
          <button className="primary" disabled={busy} onClick={() => run(() => api.post('/api/admin/jobs/season-archive/run'))}>
            {s.replay.archivedGames > 0 ? '續抓／更新封存' : '封存整季'}
          </button>
          <p className="small muted">
            從進階數據網站依序抓整季比賽與全部球員，請求間隔 1.5 秒，第一次約 25 分鐘，期間請勿關閉頁面。
            已結束的比賽不會重抓，中斷後再按一次即可續抓。
          </p>
          {s.replay.suggested.opening && (
            <>
              <h2 style={{ marginTop: 14 }}>建議賽季日期</h2>
              <p className="small">
                開幕 {s.replay.suggested.opening}・上半季結束 {s.replay.suggested.half1End ?? '—'}・
                下半季開始 {s.replay.suggested.half2Start ?? '—'}・季末 {s.replay.suggested.seasonEnd}
              </p>
              <p className="small muted">依封存的比賽推算（上半季為第 1～180 號比賽）。各聯盟管理員在「聯盟 → 產生賽程」填入。</p>
            </>
          )}
          <h2 style={{ marginTop: 14 }}>各聯盟選秀</h2>
          <ul className="list-plain small">
            {s.replay.leagues.length === 0 && <li className="muted">還沒有聯盟</li>}
            {s.replay.leagues.map((l, i) => (
              <li key={i}>
                {l.name}・{l.half_no ? `${l.half_no === 1 ? '上' : '下'}半季 ${l.start_date} 開始・選秀 ${DRAFT_STATUS[l.draft_status] ?? l.draft_status}` : '尚未產生賽程'}
              </li>
            ))}
          </ul>
          <p className="small muted">所有聯盟共用重播時鐘。快轉若會跨過某聯盟的半季開始日、而該半季選秀還沒完成，會被擋下。</p>
        </div>
      )}
      <div className="card">
        <h2>建盟碼</h2>
        <p className="small muted">
          封閉註冊：一般使用者要有系統管理員發的建盟碼才能建立聯盟，每個碼只能用一次。建立後會拿到該聯盟的邀請碼，再傳給朋友加入。
        </p>
        <button className="primary" disabled={busy} onClick={() => run(() => api.post('/api/admin/create-codes').finally(codes.reload))}>產生建盟碼</button>
        <ul className="list-plain small" style={{ marginTop: 10 }}>
          {codes.data?.length === 0 && <li className="muted">還沒有建盟碼</li>}
          {(codes.data || []).map((c) => (
            <li key={c.code} className="row" style={{ alignItems: 'center' }}>
              <span className="mono" style={{ opacity: c.usedAt || c.revokedAt ? 0.5 : 1 }}>{c.code}</span>
              {c.revokedAt ? <span className="badge">已撤銷</span>
                : c.usedAt ? <span className="badge">已用・{c.usedBy}・{c.leagueName ?? '—'}</span>
                : <span className="badge warn">未使用</span>}
              <span className="muted">{fmtDateTime(c.createdAt)}</span>
              {!c.usedAt && !c.revokedAt && (
                <>
                  <button className="small" onClick={() => copyCode(c.code)}>{copied === c.code ? '已複製' : '複製'}</button>
                  <button className="small" disabled={busy} onClick={() => run(() => api.post(`/api/admin/create-codes/${c.code}/revoke`).finally(codes.reload))}>撤銷</button>
                </>
              )}
            </li>
          ))}
        </ul>
      </div>
      <GameTimesCard run={run} busy={busy} />
      {s?.reference && (
        <div className="card">
          <h2>選秀參考季（{s.reference.year}）</h2>
          <p className="small">已封存比賽 {s.reference.games} 場・本季球員有參考數據 {s.reference.players} 人</p>
          <button className="primary" disabled={busy} onClick={() => run(() => api.post('/api/admin/jobs/reference-archive/run'))}>
            {s.reference.games > 0 ? '續抓／重新彙總' : `封存 ${s.reference.year} 參考季`}
          </button>
          <p className="small muted">
            開季前選秀沒有本季數據，選秀室的排名、數據、推薦、自動選與成績單改用上一季當參考（只用於選秀，不影響計分）。
            只封存比賽、不封存球員，請求間隔 1.5 秒，第一次約 25 分鐘；中斷後再按一次即可續抓。
          </p>
        </div>
      )}
      {s?.demoClock && (
        <div className="card">
          <h2>{s.replay ? '重播時鐘' : 'Demo 時鐘'}</h2>
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

import { useEffect, useState } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftView } from '../api'
import { ErrorBox, Loading, useLoad } from '../components'
import { useServerNow } from '../hooks'
import DraftOrderPage from './DraftOrderPage'
import DraftRoom from './DraftRoomPage'
import KeeperPage from './KeeperPage'

/**
 * 選秀（Yahoo「Live Standard Draft」，時間驅動，docs/decisions.md「選秀與 keeper」）：
 * 管理員設定選秀時間 T → T−30 選秀室開放 → T−10 自動揭曉順位 → T 自動開始 → 選完。
 *
 * /draft 依階段決定：揭曉前是時間軸首頁；揭曉後是順位頁（大家一起看翻牌）；開始後是選秀室。
 * /draft/keepers、/draft/order、/draft/room 可以直接進。
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
  const drafts = useLoad(() => api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const active = (drafts.data || []).find((d) => d.status !== 'COMPLETED') ?? (drafts.data || []).slice(-1)[0]
  const phase = active?.phase
  const live = phase === 'IN_PROGRESS' || phase === 'PAUSED'

  // v1 以輪詢同步（SSE / WebSocket 列在工程待辦 E8）：進行中 2 秒；開始前 3 秒，才接得到自動揭曉與自動開始
  useEffect(() => {
    if (!active || phase === 'COMPLETED') return
    const t = setInterval(() => drafts.reload(), live ? 2000 : 3000)
    return () => clearInterval(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active?.id, phase, live])

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
  const view = !active ? 'hub'
    : pathname.startsWith('/draft/keepers') ? 'keepers'
      : pathname.startsWith('/draft/order') ? 'order'
        : pathname.startsWith('/draft/room') ? 'room'
          : phase === 'REVEALED' ? 'order'
            : live || phase === 'COMPLETED' ? 'room' : 'hub'
  // 管理員要設定的半季：還沒揭曉的那場；上半季選完而下半季還沒設定時是下半季
  const setupHalf = active && (phase === 'UNSCHEDULED' || phase === 'SCHEDULED' || phase === 'LOBBY') ? active.halfNo
    : !active ? 1 : phase === 'COMPLETED' && active.halfNo === 1 ? 2 : null
  return (
    <div className="stack">
      <ErrorBox error={err || drafts.error} />
      {view === 'hub' && <DraftHub draft={active && phase !== 'COMPLETED' ? active : null} />}
      {active && view === 'keepers' && (active.halfNo === 2
        ? <KeeperPage draft={active} onChange={changed} />
        : <p className="muted">上半季沒有 keeper。</p>)}
      {active && view === 'order' && <DraftOrderPage draft={active} onChange={changed} />}
      {active && view === 'room' && <DraftRoom draft={active} onChange={changed} />}
      {league?.commissioner && view === 'hub' && setupHalf != null && (
        <DraftSetup halfNo={setupHalf} draft={active?.halfNo === setupHalf ? active : null} call={call} />
      )}
      {league?.commissioner && active && view === 'room' && phase !== 'COMPLETED' && <DraftTools draft={active} call={call} />}
    </div>
  )
}

// ------------------------------------------------------------------
// 時間軸首頁（揭曉前）
// ------------------------------------------------------------------

const fmtWhen = (iso: string | null | undefined) => iso
  ? new Date(iso).toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', weekday: 'short', hour: '2-digit', minute: '2-digit', hour12: false })
  : '—'

function fmtLeft(ms: number) {
  if (ms <= 0) return '即將'
  const s = Math.ceil(ms / 1000)
  const d = Math.floor(s / 86400), h = Math.floor((s % 86400) / 3600), m = Math.floor((s % 3600) / 60), r = s % 60
  if (d > 0) return `${d} 天 ${h} 小時`
  if (h > 0) return `${h} 小時 ${m} 分`
  return `${m}:${String(r).padStart(2, '0')}`
}

/** 五個階段；目前在第幾步 */
const STEP_OF: Record<DraftView['phase'], number> = {
  UNSCHEDULED: 0, SCHEDULED: 1, LOBBY: 2, REVEALED: 3, IN_PROGRESS: 4, PAUSED: 4, COMPLETED: 5,
}

function DraftHub({ draft }: { draft: DraftView | null }) {
  const now = useServerNow(1000)
  const { league } = useApp()
  if (!draft) {
    return (
      <div className="card dl-hub">
        <span className="lv-kicker gold">DRAFT</span>
        <h1>選秀</h1>
        <p className="dl-msg">{league?.commissioner
          ? '還沒設定選秀。在下方設定選秀時間，時間到會自動揭曉順位、自動開始。'
          : '聯盟管理員還沒設定選秀時間。'}</p>
      </div>
    )
  }
  const second = draft.halfNo === 2
  const step = STEP_OF[draft.phase]
  const steps = [
    { t: '設定選秀時間', at: draft.scheduledAt ? `每手 ${draft.pickSeconds} 秒` : '等管理員設定', time: null as string | null },
    { t: '選秀室開放', at: '可以進選秀室、排候選清單', time: draft.lobbyAt },
    { t: second ? '順位揭曉・公開 keeper' : '順位抽籤揭曉', at: second ? 'keeper 截止；依上半季戰績由差到好' : '全聯盟同步翻牌', time: draft.keeperDeadline },
    { t: '開始選秀', at: second ? `補強選秀 ${draft.rounds} 輪・每輪同順序` : `蛇形 ${draft.rounds} 輪`, time: draft.scheduledAt },
    { t: '選秀完成', at: '名單生效，沒被選的球員回到自由球員', time: null },
  ]
  // 目前這一步要等到的時間
  const nextAt = [null, draft.lobbyAt, draft.keeperDeadline, draft.scheduledAt][step] ?? null
  const msg = draft.phase === 'UNSCHEDULED' ? '還沒設定選秀時間。'
    : draft.phase === 'SCHEDULED' ? `選秀室 ${fmtWhen(draft.lobbyAt)} 開放。候選清單現在就能先排。`
      : `選秀室已開放。${fmtWhen(draft.keeperDeadline)} 自動揭曉順位，${fmtWhen(draft.scheduledAt)} 開始。`
  return (
    <div className="card dl-hub">
      <span className="lv-kicker gold">{second ? 'DRAFT · 下半季補強選秀' : 'DRAFT · 上半季選秀'}</span>
      <h1>{draft.scheduledAt ? fmtWhen(draft.scheduledAt) : '選秀時間未定'}</h1>
      <ol className="dl-steps">
        {steps.map((s, i) => (
          <li key={s.t} className={i < step ? 'done' : i === step ? 'now' : ''}>
            <i>{i < step ? '✓' : i + 1}</i>
            <div>
              <b>{s.t}</b>
              <small>{s.time ? `${fmtWhen(s.time)}・` : ''}{s.at}</small>
              {i === step && nextAt && <em>還有 {fmtLeft(Date.parse(nextAt) - now)}</em>}
            </div>
          </li>
        ))}
      </ol>
      <p className="dl-msg">{msg}</p>
      <div className="row">
        {second && draft.phase !== 'UNSCHEDULED' && (
          <Link className="dl-btn" to="/draft/keepers">選擇 Keeper（{fmtWhen(draft.keeperDeadline)} 截止）</Link>
        )}
        {draft.phase !== 'UNSCHEDULED' && (
          <Link className={`dl-btn${draft.phase === 'LOBBY' ? ' on' : ''}`} to="/draft/room">
            {draft.phase === 'LOBBY' ? '進入選秀室' : '先排候選清單'}
          </Link>
        )}
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 聯盟管理員：設定選秀（揭曉前）、選秀中工具
// ------------------------------------------------------------------

const SECONDS = [30, 45, 60, 90, 120]

/** datetime-local 的值（台北時間） */
function localValue(iso: string | null) {
  if (!iso) return ''
  return new Date(Date.parse(iso) + 8 * 3600_000).toISOString().slice(0, 16)
}

/** 伺服器現在 + 幾分鐘，轉成 datetime-local 的值（台北時間；demo 的模擬時鐘也照伺服器算） */
function afterMinutes(serverNowMs: number, minutes: number) {
  return new Date(serverNowMs + minutes * 60_000 + 8 * 3600_000).toISOString().slice(0, 16)
}

function DraftSetup({ halfNo, draft, call }: { halfNo: number; draft: DraftView | null; call: (fn: () => Promise<unknown>) => void }) {
  const { leagueId, league } = useApp()
  const now = useServerNow(30_000)
  const [when, setWhen] = useState(localValue(draft?.scheduledAt ?? null))
  const [secs, setSecs] = useState(draft?.pickSeconds ?? league?.league.draftPickSeconds ?? 60)
  useEffect(() => {
    setWhen(localValue(draft?.scheduledAt ?? null))
    if (draft) setSecs(draft.pickSeconds)
  }, [draft?.scheduledAt, draft?.pickSeconds]) // eslint-disable-line react-hooks/exhaustive-deps
  return (
    <div className="card">
      <h2>聯盟管理員・{halfNo === 2 ? '下半季補強選秀' : '上半季選秀'}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        設定選秀時間 T 之後全部自動進行：T−30 開放選秀室、T−10 {halfNo === 2 ? 'keeper 截止並' : ''}揭曉順位、T 開始。揭曉前都能改。
      </p>
      <div className="row">
        <input type="datetime-local" value={when} onChange={(e) => setWhen(e.target.value)} aria-label="選秀時間" />
        <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} aria-label="每手秒數">
          {[...new Set([...SECONDS, secs])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>每手 {s} 秒</option>)}
        </select>
        <button type="button" className="primary" disabled={!when}
          onClick={() => call(() => api.put(`/api/leagues/${leagueId}/drafts/half/${halfNo}`, { scheduledAt: `${when}:00+08:00`, pickSeconds: secs }))}>
          {draft?.scheduledAt ? '儲存' : '設定選秀'}
        </button>
      </div>
      <div className="row" style={{ marginTop: 8 }}>
        <span className="muted">快速選時間（伺服器時間起算）：</span>
        {[3, 15, 60].map((m) => (
          <button key={m} type="button" className="dl-quick" onClick={() => setWhen(afterMinutes(now, m))}>{m} 分鐘後</button>
        ))}
      </div>
      {!when && <p className="muted" style={{ margin: '8px 0 0' }}>先選好日期時間（至少 2 分鐘後），「設定選秀」才能按。</p>}
    </div>
  )
}

function DraftTools({ draft, call }: { draft: DraftView; call: (fn: () => Promise<unknown>) => void }) {
  const { leagueId, league } = useApp()
  const base = `/api/leagues/${leagueId}/drafts/${draft.id}`
  const live = draft.phase === 'IN_PROGRESS' || draft.phase === 'PAUSED'
  return (
    <div className="card">
      <h2>聯盟管理員</h2>
      {live && (
        <div className="row">
          {draft.phase === 'PAUSED'
            ? <button type="button" className="primary" onClick={() => call(() => api.post(`${base}/resume`))}>繼續選秀</button>
            : <button type="button" onClick={() => call(() => api.post(`${base}/pause`))}>暫停選秀</button>}
          <select value={draft.pickSeconds} aria-label="每手秒數"
            onChange={(e) => call(() => api.put(`${base}/pick-seconds`, { seconds: Number(e.target.value) }))}>
            {[...new Set([...SECONDS, draft.pickSeconds])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>每手 {s} 秒（下一手起）</option>)}
          </select>
          <button type="button" onClick={() => call(() => api.post(`${base}/auto-complete`))}>剩餘全部自動選（測試用）</button>
        </div>
      )}
      <p className="muted" style={{ margin: '12px 0 6px' }}>託管：輪到就在 3 秒內自動選（候選清單 → 補缺位 → 排名）。電腦隊伍或缺席的人可以替他開。</p>
      <div className="row">
        {(league?.teams ?? []).map((t) => {
          const on = draft.autopilotTeams.includes(t.id)
          return (
            <button key={t.id} type="button" aria-pressed={on} className={on ? 'primary' : ''}
              onClick={() => call(() => api.put(`${base}/autopilot`, { teamId: t.id, on: !on }))}>
              {t.name}・託管{on ? '開' : '關'}
            </button>
          )
        })}
      </div>
    </div>
  )
}

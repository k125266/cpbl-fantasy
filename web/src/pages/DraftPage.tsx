import { useEffect, useState } from 'react'
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftView } from '../api'
import { useConfirm } from '../Confirm'
import { ErrorBox, Loading, useLoad } from '../components'
import DraftOrderPage from './DraftOrderPage'
import DraftRoom from './DraftRoomPage'
import KeeperPage from './KeeperPage'

/**
 * 選秀（Yahoo「Live Standard Draft」，docs/decisions.md「選秀與 keeper」）：
 * 準備中（排候選、選 keeper）→ 管理員按「開始選秀」→ 馬上揭曉順位 → 動畫播完自動開始 → 選完。
 * 沒有預設選秀時間：玩家自己討論時間，管理員到時候按開始。
 *
 * /draft 依階段決定：準備中是首頁；揭曉後是順位頁（大家一起看翻牌）；開始後是選秀室。
 * /draft/keepers、/draft/order、/draft/room 可以直接進。
 * ?half=1|2 指定要看哪一場（已完成的選秀留作紀錄，選秀首頁的「選秀紀錄」連到這裡）；沒指定時是還沒選完的那一場，
 * 都選完就是最後一場。
 */
export default function DraftPage() {
  const { leagueId, league, reloadLeague, reloadSystem } = useApp()
  // 每手倒數、揭曉動畫都以伺服器時間計算（useServerNow）。App 只在開啟時對時一次，伺服器重啟、
  // demo 快轉後會不準，所以進入選秀頁時重新對時，之後每 60 秒再對一次
  useEffect(() => {
    reloadSystem()
    const t = setInterval(reloadSystem, 60_000)
    return () => clearInterval(t)
  }, [reloadSystem])
  const { pathname } = useLocation()
  const [params] = useSearchParams()
  const half = Number(params.get('half')) || null
  const drafts = useLoad(() => api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`), [leagueId])
  const [err, setErr] = useState<unknown>(null)
  const nav = useNavigate()
  // 在選秀室看著進行中的選秀：記住是哪一場。上半季一結束系統就會建立下半季選秀，如果直接跳過去，
  // 上半季的「選秀結束」畫面和成績單就看不到；所以看著的那一場完成後仍留在這一場，離開選秀室才換
  const [watching, setWatching] = useState<number | null>(null)
  const all = drafts.data || []
  const watched = watching != null ? all.find((d) => d.id === watching) : undefined
  const active = (half ? all.find((d) => d.halfNo === half) : undefined) ?? watched ?? all.find((d) => d.status !== 'COMPLETED') ?? all.slice(-1)[0]
  const phase = active?.phase
  const live = phase === 'IN_PROGRESS' || phase === 'PAUSED'
  const inRoom = pathname.startsWith('/draft/room')
  const atRoot = pathname === '/draft' || pathname === '/draft/'
  // 選秀進行中時 /draft 直接導到選秀室，網址才表示「人在選秀室」（下面記住這一場、離開才換的判斷靠它）
  useEffect(() => { if (live && atRoot) nav('/draft/room', { replace: true }) }, [live, atRoot, nav])
  useEffect(() => {
    if (inRoom && live && active) setWatching(active.id)
    else if (!inRoom) setWatching(null)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [inRoom, live, active?.id])

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
  // 管理員按「開始選秀」的那一場：準備中的選秀
  const preparing = active && phase === 'PREPARING' ? active : null
  return (
    <div className="stack">
      <ErrorBox error={err || drafts.error} />
      {view === 'hub' && <DraftHub draft={active && phase !== 'COMPLETED' ? active : null} />}
      {view === 'hub' && <DraftRecords drafts={all} currentId={active?.id} />}
      {active && view === 'keepers' && (active.halfNo === 2
        ? <KeeperPage draft={active} onChange={changed} />
        : <p className="muted">上半季沒有 keeper。</p>)}
      {active && view === 'order' && <DraftOrderPage draft={active} onChange={changed} />}
      {active && view === 'room' && phase === 'COMPLETED' && <DraftRecords drafts={all} currentId={active.id} compact />}
      {active && view === 'room' && <DraftRoom draft={active} onChange={changed} />}
      {league?.commissioner && view === 'hub' && preparing && <DraftBegin draft={preparing} call={call} />}
      {league?.commissioner && active && view === 'room' && phase !== 'COMPLETED' && <DraftTools draft={active} call={call} />}
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀首頁（準備中）：四步流程
// ------------------------------------------------------------------

/** 四個階段；目前在第幾步 */
const STEP_OF: Record<DraftView['phase'], number> = {
  PREPARING: 0, REVEALED: 1, IN_PROGRESS: 2, PAUSED: 2, COMPLETED: 3,
}

function DraftHub({ draft }: { draft: DraftView | null }) {
  if (!draft) {
    return (
      <div className="card dl-hub">
        <span className="lv-kicker gold">DRAFT</span>
        <h1>選秀</h1>
        <p className="dl-msg">選秀還沒準備好：要先產生賽程，而且聯盟至少要有 2 隊。</p>
      </div>
    )
  }
  const second = draft.halfNo === 2
  const step = STEP_OF[draft.phase]
  const steps = [
    { t: '準備', at: second ? '排候選清單、選 keeper；等管理員按開始' : '排候選清單；等管理員按開始' },
    { t: second ? '順位揭曉・公開 keeper' : '順位抽籤揭曉', at: '管理員按開始後馬上進行，約 10 秒，全聯盟同步翻牌' },
    { t: '選秀', at: `${second ? `補強選秀 ${draft.rounds} 輪・每輪同順序` : `蛇形 ${draft.rounds} 輪`}・每手 ${draft.pickSeconds} 秒` },
    { t: '完成', at: '名單生效，沒被選的球員回到自由球員' },
  ]
  return (
    <div className="card dl-hub">
      <span className="lv-kicker gold">{second ? 'DRAFT · 下半季補強選秀' : 'DRAFT · 上半季選秀'}</span>
      <h1>等管理員按下開始</h1>
      <ol className="dl-steps">
        {steps.map((s, i) => (
          <li key={s.t} className={i < step ? 'done' : i === step ? 'now' : ''}>
            <i>{i < step ? '✓' : i + 1}</i>
            <div>
              <b>{s.t}</b>
              <small>{s.at}</small>
            </div>
          </li>
        ))}
      </ol>
      <p className="dl-msg">
        選秀時間由玩家自己討論，說好的時間到了，管理員按下「開始選秀」。現在可以先排候選清單{second ? '、選 keeper（按下開始時鎖定）' : ''}。
      </p>
      <div className="row">
        {second && <Link className="dl-btn" to="/draft/keepers">選擇 Keeper</Link>}
        <Link className="dl-btn on" to="/draft/room">進入選秀室・排候選清單</Link>
      </div>
    </div>
  )
}

// ------------------------------------------------------------------
// 選秀紀錄：已完成的選秀留作紀錄，隨時可以回去看選秀板與成績單
// ------------------------------------------------------------------

function DraftRecords({ drafts, currentId, compact }: { drafts: DraftView[]; currentId?: number; compact?: boolean }) {
  const done = drafts.filter((d) => d.phase === 'COMPLETED')
  // 室內的小列只在有兩場以上時才有切換的意義
  if (done.length === 0 || (compact && drafts.length < 2)) return null
  return (
    <div className={`card dl-rec${compact ? ' compact' : ''}`}>
      {compact ? <span className="muted">選秀紀錄</span> : <h2>選秀紀錄</h2>}
      <div className="row">
        {done.map((d) => (
          <Link key={d.id} className={`dl-btn${d.id === currentId ? ' on' : ''}`} to={`/draft/room?half=${d.halfNo}`}>
            {d.halfNo === 2 ? '下半季補強選秀' : '上半季選秀'}・{d.picks.length} 手
          </Link>
        ))}
      </div>
      {!compact && <p className="muted" style={{ margin: '8px 0 0' }}>已完成的選秀：看選秀板、每一手的結果與成績單。</p>}
    </div>
  )
}

// ------------------------------------------------------------------
// 聯盟管理員：開始選秀（準備中）、選秀中工具
// ------------------------------------------------------------------

const SECONDS = [30, 45, 60, 90, 120]

function DraftBegin({ draft, call }: { draft: DraftView; call: (fn: () => Promise<unknown>) => void }) {
  const { leagueId } = useApp()
  const second = draft.halfNo === 2
  const [secs, setSecs] = useState(draft.pickSeconds)
  useEffect(() => setSecs(draft.pickSeconds), [draft.pickSeconds])
  const confirm = useConfirm()
  const go = () => call(() => confirm({
    title: `開始${second ? '下半季補強' : '上半季'}選秀？`,
    lead: `按下後，${second ? 'keeper 鎖定、' : ''}馬上揭曉順位，約 10 秒後自動開始選秀。`,
    points: [...(second ? ['keeper 在這一刻鎖定'] : []), '全聯盟同步看揭曉', '約 10 秒後自動開始，不能取消'],
    note: '請確認大家都在線上。',
    confirmText: '開始選秀',
    busyText: '開始中…',
    run: () => api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/begin`, { pickSeconds: secs }),
  }))
  return (
    <div className="card">
      <h2>聯盟管理員・開始{second ? '下半季補強選秀' : '上半季選秀'}</h2>
      <p className="muted" style={{ marginTop: 0 }}>
        選秀時間由玩家自己討論，不用預先設定。說好的時間到了就按「開始選秀」{second ? '（keeper 會在這一刻鎖定）' : ''}。
      </p>
      <div className="row">
        <select value={secs} onChange={(e) => setSecs(Number(e.target.value))} aria-label="每手秒數">
          {[...new Set([...SECONDS, secs])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>每手 {s} 秒</option>)}
        </select>
        <button type="button" className="primary" onClick={go}>開始選秀</button>
      </div>
    </div>
  )
}

function DraftTools({ draft, call }: { draft: DraftView; call: (fn: () => Promise<unknown>) => void }) {
  const { leagueId, league } = useApp()
  const base = `/api/leagues/${leagueId}/drafts/${draft.id}`
  const live = draft.phase === 'IN_PROGRESS' || draft.phase === 'PAUSED'
  const confirm = useConfirm()
  const pause = () => call(() => confirm({
    title: '暫停選秀？',
    lead: '暫停後倒數停住，大家都不能選人，直到你按繼續。',
    confirmText: '暫停',
    busyText: '暫停中…',
    run: () => api.post(`${base}/pause`),
  }))
  const autoAll = () => call(() => confirm({
    label: 'DANGER · TEST ONLY',
    title: '剩餘全部自動選（測試用）',
    lead: '剩下的順位會全部由系統代選，無法復原。',
    note: '按下後立即執行，無法復原。',
    confirmText: '全部自動選',
    busyText: '代選中…',
    danger: true,
    run: () => api.post(`${base}/auto-complete`),
  }))
  return (
    <div className="card">
      <h2>聯盟管理員</h2>
      {live && (
        <div className="row">
          {draft.phase === 'PAUSED'
            ? <button type="button" className="primary" onClick={() => call(() => api.post(`${base}/resume`))}>繼續選秀</button>
            : <button type="button" onClick={pause}>暫停選秀</button>}
          <select value={draft.pickSeconds} aria-label="每手秒數"
            onChange={(e) => call(() => api.put(`${base}/pick-seconds`, { seconds: Number(e.target.value) }))}>
            {[...new Set([...SECONDS, draft.pickSeconds])].sort((a, b) => a - b).map((s) => <option key={s} value={s}>每手 {s} 秒（下一手起）</option>)}
          </select>
          <button type="button" onClick={autoAll}>剩餘全部自動選（測試用）</button>
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

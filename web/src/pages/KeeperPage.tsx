import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftStats, type DraftView } from '../api'
import { ErrorBox, Loading, tierOf, useLoad } from '../components'
import { useServerNow, useWide, useXWide } from '../hooks'
import { cpblTeam } from '../teams'

/**
 * 選擇 Keeper（設計稿「Keeper 與選秀抽籤」1a 手機、1b 網頁）。E14：下半季至多 keeper_limit 人、不佔輪次；
 * 管理員按下開始選秀時鎖定；揭曉前只有自己看得到。
 */

export interface KeeperCandidate {
  playerId: number
  name: string
  jerseyNumber: string | null
  cpblTeam: string
  position: string
  pitcher: boolean
  rank: number | null
  via: string
  delisted: boolean
  /** 上半季數據（沒有數據為 null） */
  stats: DraftStats | null
  /** 可擔任的先發位置（IF、OF、UTIL、SP、RP） */
  eligible: string[]
}

/** 目前的自由球員（GET …/keeper-pool），Keeper 頁第三欄 */
interface PoolPlayer {
  playerId: number
  name: string
  jerseyNumber: string | null
  cpblTeam: string
  position: string
  pitcher: boolean
  rank: number | null
  eligible: string[]
  stats: DraftStats | null
}

/** 先發位置與名額（規則書固定：IF4、OF3、UTIL1、SP4、RP2，與後端 SlotAssigner 同一套配對） */
const SLOT_CAP: [string, number][] = [['IF', 4], ['OF', 3], ['UTIL', 1], ['SP', 4], ['RP', 2]]

/** 把球員配到先發位置（二分圖最大匹配，排前面的優先）；回傳各位置排進幾人與總人數 */
function matchSlots(players: string[][]): { counts: Record<string, number>; size: number } {
  const seats = SLOT_CAP.flatMap(([k, n]) => Array<string>(n).fill(k))
  const owner = seats.map(() => -1)
  const augment = (p: number, seen: boolean[]): boolean => {
    for (let i = 0; i < seats.length; i++) {
      if (seen[i] || !players[p].includes(seats[i])) continue
      seen[i] = true
      if (owner[i] < 0 || augment(owner[i], seen)) { owner[i] = p; return true }
    }
    return false
  }
  players.forEach((_, p) => augment(p, seats.map(() => false)))
  const counts: Record<string, number> = Object.fromEntries(SLOT_CAP.map(([k]) => [k, 0]))
  owner.forEach((o, i) => { if (o >= 0) counts[seats[i]]++ })
  return { counts, size: owner.filter((o) => o >= 0).length }
}

/** 投手顯示可擔任的 SP／RP，打者用登記守位 */
const posText = (p: { pitcher: boolean; position: string; eligible: string[] }) =>
  p.pitcher ? (['SP', 'RP'].filter((k) => p.eligible.includes(k)).join('/') || p.position) : p.position

/** 一行重點數據：打者 AVG・HR，先發 ERA・K，後援 ERA・W+SV */
function poolLine(p: PoolPlayer) {
  const s = p.stats
  if (!s) return '–'
  if (!p.pitcher) return `${s.avg == null ? '–' : s.avg.toFixed(3).replace(/^0/, '')} · ${s.hr} HR`
  return p.eligible.includes('SP') ? `${rate(s.era)} · ${s.k} K` : `${rate(s.era)} · ${s.wsv} W+SV`
}

/**
 * 名單的數據欄（設計稿「Keeper 與選秀抽籤」）：表頭上排打者、下排投手，金色為聯盟計分類別。
 * 打者 AVG、HR、R、H、BB；投手 IP、ERA、WHIP、K、W+SV。
 */
const STAT_HEAD: [string, string][] = [['AVG', 'IP'], ['HR', 'ERA'], ['R', 'WHIP'], ['H', 'K'], ['BB', 'W+SV']]
const rate = (v: number | null) => (v == null ? '–' : v.toFixed(2))
function statCells(c: KeeperCandidate): { v: string; l: string }[] {
  const s = c.stats
  if (!s) return STAT_HEAD.map(([h, p]) => ({ v: '–', l: c.pitcher ? p : h }))
  const vals = c.pitcher
    ? [`${Math.floor(s.outs / 3)}.${s.outs % 3}`, rate(s.era), rate(s.whip), String(s.k), String(s.wsv)]
    : [s.avg == null ? '–' : s.avg.toFixed(3).replace(/^0/, ''), String(s.hr), String(s.r), String(s.h), String(s.bb)]
  return vals.map((v, i) => ({ v, l: c.pitcher ? STAT_HEAD[i][1] : STAT_HEAD[i][0] }))
}

const METAL: Record<string, string> = { legend: 'var(--metal-gold)', gold: 'var(--metal-gold)', rare: 'var(--metal-silver)', common: 'var(--metal-bronze)' }

export function Medal({ rank, jersey, team, size }: { rank: number | null; jersey: string | null; team: string; size: number }) {
  return (
    <span className="kp-medal" style={{ width: size, height: size, background: METAL[tierOf(rank)] }}>
      <span style={{ boxShadow: `inset 0 0 0 2px ${cpblTeam(team).bg}`, fontSize: size * 0.4 }}>{jersey ?? '–'}</span>
    </span>
  )
}

function fmtDeadline(iso: string) {
  const d = new Date(iso)
  return d.toLocaleString('zh-TW', { timeZone: 'Asia/Taipei', month: 'numeric', day: 'numeric', hour: '2-digit', minute: '2-digit', hour12: false })
}

function remain(ms: number) {
  if (ms <= 0) return '已截止'
  const m = Math.floor(ms / 60000)
  const d = Math.floor(m / 1440), h = Math.floor((m % 1440) / 60), mm = m % 60
  return d > 0 ? `還有 ${d} 天 ${h} 小時` : h > 0 ? `還有 ${h} 小時 ${mm} 分` : `還有 ${mm} 分`
}

export default function KeeperPage({ draft, onChange }: { draft: DraftView; onChange: () => void }) {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const x = useXWide() // ≥1680：三欄（設計稿 WebKeeper），固定一屏
  const now = useServerNow(30_000)
  const cands = useLoad(() => api.get<KeeperCandidate[]>(`/api/leagues/${leagueId}/drafts/${draft.id}/keeper-candidates`), [leagueId, draft.id])
  const pool = useLoad(() => (x ? api.get<PoolPlayer[]>(`/api/leagues/${leagueId}/drafts/${draft.id}/keeper-pool`) : Promise.resolve([] as PoolPlayer[])), [leagueId, draft.id, x])
  const limit = league?.league.keeperLimit ?? 15
  const rounds = draft.rounds
  const rosterSize = league?.league.draftRounds ?? 20
  // 選秀資料每 3 秒輪詢一次，每次都是新陣列；以內容判斷，伺服器上的 keeper 真的變了（例：另一台裝置儲存）
  // 才重設，否則還沒儲存的勾選會被蓋掉
  const savedKey = draft.myKeepers.map((k) => k.playerId).join(',')
  const saved = useMemo(() => (savedKey ? savedKey.split(',').map(Number) : []), [savedKey])
  const [keep, setKeep] = useState<number[]>(saved)
  const [sort, setSort] = useState<'rank' | 'pos'>('rank')
  const [note, setNote] = useState<string | null>(null)
  const [err, setErr] = useState<unknown>(null)
  const [busy, setBusy] = useState(false)
  useEffect(() => setKeep(saved), [saved])

  const deadline = draft.keeperDeadline ? new Date(draft.keeperDeadline).getTime() : null
  const locked = draft.status !== 'KEEPERS' || !!draft.revealedAt || (deadline != null && now >= deadline)
  const dirty = keep.length !== saved.length || keep.some((id) => !saved.includes(id))

  if (cands.loading && !cands.data) return <Loading />
  if (cands.error) return <ErrorBox error={cands.error} />
  const list = [...(cands.data ?? [])].sort((a, b) =>
    (sort === 'pos' ? Number(a.pitcher) - Number(b.pitcher) : 0) || (a.rank ?? 9999) - (b.rank ?? 9999))
  const byId = new Map(list.map((c) => [c.playerId, c]))
  const kept = keep.map((id) => byId.get(id)).filter((c): c is KeeperCandidate => !!c).sort((a, b) => (a.rank ?? 9999) - (b.rank ?? 9999))
  const n = kept.length
  const open = Math.max(0, rosterSize - n - rounds)

  const flash = (m: string) => {
    setNote(m)
    window.setTimeout(() => setNote(null), 2400)
  }
  const toggle = (c: KeeperCandidate) => {
    if (locked) return
    if (keep.includes(c.playerId)) return setKeep(keep.filter((x) => x !== c.playerId))
    if (c.delisted) return flash('已註銷的球員不能保留')
    if (keep.length >= limit) return flash(`已達 ${limit} 人上限，先移出一位`)
    setKeep([...keep, c.playerId])
  }
  const save = async () => {
    if (locked || !dirty) return
    setErr(null)
    setBusy(true)
    try {
      await api.post(`/api/leagues/${leagueId}/drafts/${draft.id}/keepers`, { playerIds: keep })
      onChange()
    } catch (e) {
      setErr(e)
    } finally {
      setBusy(false)
    }
  }

  const saveLine = note ?? (locked ? 'Keeper 已截止，順位揭曉時公開'
    : dirty ? (open > 0 ? `尚未儲存・少保留的 ${open} 個位置選秀後從自由球員補` : `尚未儲存・名單剛好 ${rosterSize} 人`)
      : '已儲存・截止前都能改')
  const saveTone = note ? 'warn' : locked ? 'muted' : dirty ? '' : 'ok'
  // 揭曉或選秀開始後也算截止（例：管理員提早揭曉），不再顯示倒數
  const sub = locked ? `Keeper 已截止${draft.revealedAt ? '・順位已揭曉' : ''}`
    : draft.keeperDeadline ? `截止 ${fmtDeadline(draft.keeperDeadline)}・${remain((deadline ?? 0) - now)}` : '管理員按下開始選秀時鎖定'

  const slots = Array.from({ length: limit }, (_, i) => kept[i])
  const strip = Array.from({ length: rosterSize }, (_, i) => (i < n ? 'K' : i < n + rounds ? 'D' : ''))
  const slotGrid = (
    <div className={`kp-slots${wide ? ' w' : ''}`}>
      {slots.map((c, i) => c ? (
        <button key={c.playerId} type="button" className="kp-slot full" onClick={() => toggle(c)} disabled={locked} title={locked ? undefined : '移出'}>
          <Medal rank={c.rank} jersey={c.jerseyNumber} team={c.cpblTeam} size={wide ? 30 : 34} />
          {wide ? (
            <span className="txt"><span className="nm">{c.name}</span><span className="rk">#{c.rank ?? '–'}</span></span>
          ) : (
            <><span className="nm">{c.name}</span><span className="rk">#{c.rank ?? '–'}</span></>
          )}
          {wide && !locked && <span className="x" aria-hidden>×</span>}
        </button>
      ) : (
        <div key={`e${i}`} className="kp-slot"><span className="plus">+</span><span className="nm muted">空位</span>{!wide && <span className="rk">&nbsp;</span>}</div>
      ))}
    </div>
  )
  const stripBox = (
    <>
      <div className="kp-strip" style={{ gridTemplateColumns: `repeat(${wide ? 10 : rosterSize}, minmax(0, 1fr))` }}>
        {strip.map((t, i) => <span key={i} className={t === 'K' ? 'k' : t === 'D' ? 'd' : ''}>{t}</span>)}
      </div>
      <div className="kp-legend"><span><b>K</b> 保留</span><span><b className="d">D</b> 補強選秀 {rounds} 輪</span><span>空格 選秀後從自由球員補</span></div>
    </>
  )
  const sortSeg = (
    <div className="lv-seg">
      {([['rank', '排名'], ['pos', '打者/投手']] as const).map(([k, t]) => (
        <button key={k} type="button" aria-selected={sort === k} onClick={() => setSort(k)}>{t}</button>
      ))}
    </div>
  )
  // 不顯示設計稿的「不保留的話」：keeper 揭曉前保密，猜不準會不會被選走（docs/decisions.md）
  const delisted = (c: KeeperCandidate) => c.delisted && <i className="kp-tag">已註銷</i>
  const full = n >= limit
  const saveBar = (
    <div className={`kp-save${wide ? ' w' : ''}`}>
      <div className="t"><b>已選 {n} / {limit}</b><span className={saveTone}>{saveLine}</span></div>
      <button type="button" disabled={locked || !dirty || busy} onClick={save}>儲存 Keeper</button>
    </div>
  )

  const head = (
    <div className="kp-head">
      <div>
        <div className="lv-kicker gold">KEEPER · 下半季補強選秀前</div>
        <h1>選擇 Keeper</h1>
        <div className="sub">{sub}{wide && `・保留至多 ${limit} 人，之後補強選秀 ${rounds} 輪`}</div>
      </div>
      {wide && <Link className="kp-orderlink" to="/draft/order">{draft.scheduledAt ? `${fmtDeadline(draft.keeperDeadline ?? draft.scheduledAt)} 順位揭曉` : '順位揭曉'}</Link>}
    </div>
  )

  if (!wide) {
    return (
      <div className="kp">
        <Link to="/draft/order" className="kp-back">選秀順位 ›</Link>
        {head}
        <ErrorBox error={err} />
        <div className="kp-box">
          <div className="kp-lab"><span>保留席 · {n} / {limit}</span><span className="muted">點一下移出</span></div>
          {slotGrid}
          <div className="kp-lab sm"><span>下半季名單 {rosterSize} 人</span><span>保留 {n}・選秀 {rounds}・空位 {open}</span></div>
          {stripBox}
        </div>
        <p className="kp-note">Keeper 不佔選秀輪次。沒保留的球員回到球員池，補強選秀和之後的自由球員都可能被別隊拿走。各隊 keeper 在順位揭曉時一起公開。</p>
        <div className="lv-label"><span>你的名單 · {list.length} 人</span>{sortSeg}</div>
        <div className="kp-list">
          {list.map((c) => {
            const on = keep.includes(c.playerId)
            return (
              <button key={c.playerId} type="button" className={`kp-row${on ? ' on' : ''}${!on && (full || c.delisted) ? ' dim' : ''}`} onClick={() => toggle(c)} disabled={locked}>
                <span className="ck">{on && '✓'}</span>
                <Medal rank={c.rank} jersey={c.jerseyNumber} team={c.cpblTeam} size={38} />
                <span className="who"><span className="l1"><b>{c.name}</b><span className="pos">{c.position}</span><span className={`rk${(c.rank ?? 99) <= 10 ? ' top' : ''}`}>#{c.rank ?? '–'}</span>{delisted(c)}</span>
                  <span className="l2">{c.via}・{cpblTeam(c.cpblTeam).short}</span>
                  <span className="l3">{statCells(c).map((x) => <span key={x.l}><b>{x.v}</b>{x.l}</span>)}</span></span>
              </button>
            )
          })}
        </div>
        <p className="kp-note">已註銷的球員不能保留。</p>
        {saveBar}
      </div>
    )
  }

  // ≥1680：保留後的先發缺位、放回球員池、目前自由球員（第三欄）
  const keptEl = kept.map((c) => c.eligible)
  const base = matchSlots(keptEl)
  const miss = SLOT_CAP.filter(([k, cap]) => base.counts[k] < cap).map(([k]) => k)
  const needsBox = (
    <div className="kp-box plain">
      <div className="kp-lab"><span>保留後的先發缺位</span><span className={miss.length ? 'gold' : 'muted'}>{miss.length ? `補強選秀優先補 ${miss.join('、')}` : '先發都有人'}</span></div>
      <div className="kp-needs">
        {SLOT_CAP.map(([k, cap]) => (
          <div key={k} className={base.counts[k] >= cap ? 'full' : ''}><small>{k}</small><b>{base.counts[k]}<span>/{cap}</span></b></div>
        ))}
      </div>
    </div>
  )
  const released = list.filter((c) => !keep.includes(c.playerId))
  const poolList = pool.data ?? []
  // 這位自由球員能不能讓保留後的先發缺位變少；標出他補的是哪個位置（UTIL 不特別標）
  const fillSlot = (p: PoolPlayer) => matchSlots([...keptEl, p.eligible]).size > base.size
    ? p.eligible.find((k) => k !== 'UTIL' && miss.includes(k)) ?? null : null
  const poolBoxes = (
    <>
      <div className="kp-pbox">
        <div className="kp-phd"><span className="lv-label-t">放回球員池 · {released.length} 人</span><span className="muted">別隊可以在補強選秀選走</span></div>
        <div className="kp-rel">
          {released.map((c) => (
            <button key={c.playerId} type="button" className="kp-prow" onClick={() => toggle(c)} disabled={locked || full || c.delisted} title="加回保留席">
              <span className="nm"><i style={{ background: cpblTeam(c.cpblTeam).bg }} /><b>{c.name}</b><small>{cpblTeam(c.cpblTeam).short}</small></span>
              <span className="pos">{posText(c)}</span>
              <span className="rk">#{c.rank ?? '–'}</span>
              <span className="add">＋</span>
            </button>
          ))}
          {released.length === 0 && <div className="kp-pempty">全部保留，沒有放回的球員。</div>}
        </div>
      </div>
      <div className="kp-pbox grow">
        <div className="kp-phd"><span className="lv-label-t">目前自由球員 · 上半季排名</span><Link to="/players">全部 ›</Link></div>
        <p className="kp-pnote">補強選秀的球員池＝自由球員＋各隊沒保留的人。別隊名單揭曉前看不到。</p>
        <div className="kp-fa">
          {pool.loading && !pool.data && <div className="kp-pempty">載入中…</div>}
          {poolList.map((p) => {
            const slot = fillSlot(p), t = cpblTeam(p.cpblTeam)
            return (
              <div key={p.playerId} className="kp-frow">
                <Medal rank={p.rank} jersey={p.jerseyNumber} team={p.cpblTeam} size={30} />
                <span className="nm"><span className="l1"><b>{p.name}</b>{slot && <i className="need">補 {slot}</i>}</span><span className="l2"><s style={{ background: t.bg }} />{t.short}・{posText(p)}</span></span>
                <span className="rt"><b>#{p.rank ?? '–'}</b><small>{poolLine(p)}</small></span>
              </div>
            )
          })}
        </div>
      </div>
    </>
  )

  return (
    <div className={`kp wide${x ? ' x' : ''}`}>
      {head}
      <ErrorBox error={err} />
      <div className="kp-cols">
        <div className="kp-table">
          <div className="kp-thead"><span className="lv-label-t">你的名單 · {list.length} 人</span><span className="muted">點一列加入或移出保留席</span><span className="sp" />{sortSeg}</div>
          <div className="kp-grid head"><span /><span>球員</span><span>位置</span><span className="r">上半季排名</span><span>取得方式</span>
            {STAT_HEAD.map(([h, p]) => <span key={h} className="st"><b>{h}</b><b>{p}</b></span>)}</div>
          {list.map((c) => {
            const on = keep.includes(c.playerId), t = cpblTeam(c.cpblTeam)
            return (
              <button key={c.playerId} type="button" className={`kp-grid${on ? ' on' : ''}${!on && (full || c.delisted) ? ' dim' : ''}`} onClick={() => toggle(c)} disabled={locked}>
                <span className="ck">{on && '✓'}</span>
                <span className="who"><Medal rank={c.rank} jersey={c.jerseyNumber} team={c.cpblTeam} size={34} /><b>{c.name}</b><span className="team"><i style={{ background: t.bg }} />{t.short}</span>{delisted(c)}</span>
                <span className="pos">{x ? posText(c) : c.position}</span>
                <span className={`r rk${(c.rank ?? 99) <= 10 ? ' top' : ''}`}>{c.rank ?? '–'}</span>
                <span className="via">{c.via}</span>
                {statCells(c).map((x) => <span key={x.l} className="st">{x.v}</span>)}
              </button>
            )
          })}
          <div className="kp-tfoot">數據為上半季成績；表頭上排是打者、下排是投手，金色為聯盟計分類別。沒保留的球員回到球員池，補強選秀和之後的自由球員都可能被別隊拿走。已註銷的球員不能保留。</div>
        </div>
        <div className="kp-side">
          <div className="kp-box"><div className="kp-lab"><span>保留席 · {n} / {limit}</span><span className="muted">點 × 移出</span></div>{slotGrid}</div>
          <div className="kp-box plain"><div className="kp-lab"><span>下半季名單 · {rosterSize} 人</span><span className="muted">保留 {n}・選秀 {rounds}・空位 {open}</span></div>{stripBox}</div>
          {x && needsBox}
          <div className="sp" />
          <p className="kp-note">Keeper 不佔選秀輪次。沒保留的球員回到球員池，任何隊伍都能在補強選秀選他。<br />各隊 keeper 只有自己看得到，順位揭曉時一起公開。</p>
          {saveBar}
        </div>
        {x && <div className="kp-pool">{poolBoxes}</div>}
      </div>
    </div>
  )
}

import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftView } from '../api'
import { ErrorBox, Loading, tierOf, useLoad } from '../components'
import { useServerNow, useWide } from '../hooks'
import { cpblTeam } from '../teams'

/**
 * 選擇 Keeper（設計稿「Keeper 與選秀抽籤」1a 手機、1b 網頁）。E14：下半季至多 keeper_limit 人、不佔輪次；
 * 選秀前 10 分鐘截止；揭曉前只有自己看得到。
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
}

/** 上半季排名在此之前的球員，不保留的話很可能在補強選秀被選走（設計稿的估計） */
export const KEEPER_RISK_RANK = 60

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
  const now = useServerNow(30_000)
  const cands = useLoad(() => api.get<KeeperCandidate[]>(`/api/leagues/${leagueId}/drafts/${draft.id}/keeper-candidates`), [leagueId, draft.id])
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
  const sub = draft.keeperDeadline ? `截止 ${fmtDeadline(draft.keeperDeadline)}・${remain((deadline ?? 0) - now)}` : '順位揭曉前都能改'

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
  const hint = (c: KeeperCandidate, on: boolean) => c.delisted ? { s: '已註銷', t: '已註銷，不能保留', c: 'muted' }
    : on ? { s: '保留', t: '保留到下半季', c: 'on' }
      : c.rank != null && c.rank <= KEEPER_RISK_RANK ? { s: '可能被選走', t: '很可能在補強選秀被選走', c: 'risk' }
        : { s: '可簽回', t: '大概沒人選，之後可從自由球員簽回', c: 'muted' }
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
        <p className="kp-note">Keeper 不佔選秀輪次。沒保留的球員回到球員池，任何隊伍都能在補強選秀選他。各隊 keeper 在順位揭曉時一起公開。</p>
        <div className="lv-label"><span>你的名單 · {list.length} 人</span>{sortSeg}</div>
        <div className="kp-list">
          {list.map((c) => {
            const on = keep.includes(c.playerId), h = hint(c, on)
            return (
              <button key={c.playerId} type="button" className={`kp-row${on ? ' on' : ''}${!on && (full || c.delisted) ? ' dim' : ''}`} onClick={() => toggle(c)} disabled={locked}>
                <span className="ck">{on && '✓'}</span>
                <Medal rank={c.rank} jersey={c.jerseyNumber} team={c.cpblTeam} size={38} />
                <span className="who"><span className="l1"><b>{c.name}</b><span className="pos">{c.position}</span><span className={`rk${(c.rank ?? 99) <= 10 ? ' top' : ''}`}>#{c.rank ?? '–'}</span></span>
                  <span className="l2">{c.via}・{cpblTeam(c.cpblTeam).short}</span></span>
                <span className={`hint ${h.c}`}>{h.s}</span>
              </button>
            )
          })}
        </div>
        <p className="kp-note">右邊的提示依上半季排名：前 {KEEPER_RISK_RANK} 名不保留，很可能在補強選秀被選走；其餘大多能從自由球員簽回。</p>
        {saveBar}
      </div>
    )
  }

  return (
    <div className="kp wide">
      {head}
      <ErrorBox error={err} />
      <div className="kp-cols">
        <div className="kp-table">
          <div className="kp-thead"><span className="lv-label-t">你的名單 · {list.length} 人</span><span className="muted">點一列加入或移出保留席</span><span className="sp" />{sortSeg}</div>
          <div className="kp-grid head"><span /><span>球員</span><span>位置</span><span className="r">上半季排名</span><span>取得方式</span><span>不保留的話</span></div>
          {list.map((c) => {
            const on = keep.includes(c.playerId), h = hint(c, on), t = cpblTeam(c.cpblTeam)
            return (
              <button key={c.playerId} type="button" className={`kp-grid${on ? ' on' : ''}${!on && (full || c.delisted) ? ' dim' : ''}`} onClick={() => toggle(c)} disabled={locked}>
                <span className="ck">{on && '✓'}</span>
                <span className="who"><Medal rank={c.rank} jersey={c.jerseyNumber} team={c.cpblTeam} size={34} /><b>{c.name}</b><span className="team"><i style={{ background: t.bg }} />{t.short}</span></span>
                <span className="pos">{c.position}</span>
                <span className={`r rk${(c.rank ?? 99) <= 10 ? ' top' : ''}`}>{c.rank ?? '–'}</span>
                <span className="via">{c.via}</span>
                <span className={`hint ${h.c}`}>{h.t}</span>
              </button>
            )
          })}
          <div className="kp-tfoot">「不保留的話」依上半季排名估計：前 {KEEPER_RISK_RANK} 名很可能在補強選秀被選走，其餘大多能從自由球員簽回。已註銷的球員不能保留。</div>
        </div>
        <div className="kp-side">
          <div className="kp-box"><div className="kp-lab"><span>保留席 · {n} / {limit}</span><span className="muted">點 × 移出</span></div>{slotGrid}</div>
          <div className="kp-box plain"><div className="kp-lab"><span>下半季名單 · {rosterSize} 人</span><span className="muted">保留 {n}・選秀 {rounds}・空位 {open}</span></div>{stripBox}</div>
          <div className="sp" />
          <p className="kp-note">Keeper 不佔選秀輪次。沒保留的球員回到球員池，任何隊伍都能在補強選秀選他。<br />各隊 keeper 只有自己看得到，順位揭曉時一起公開。</p>
          {saveBar}
        </div>
      </div>
    </div>
  )
}

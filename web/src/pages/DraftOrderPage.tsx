import { useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type DraftBoard, type DraftView, type StandingRow, type TeamView } from '../api'
import { useLoad } from '../components'
import { useServerNow, useWide, useXWide } from '../hooks'
import { alpha, TeamIcon } from '../teamIdentity'
import { fantasyTeamColor } from '../teams'

/**
 * 選秀順位抽籤／揭曉（設計稿「Keeper 與選秀抽籤」1c 手機、1d 網頁）。
 *
 * <p>上半季隨機抽籤、蛇形；下半季依上半季戰績由差到好、每輪同順序，揭曉時同時公開各隊 keeper。
 * 動畫以伺服器的 revealedAt 為起點，從最後一個順位翻到第 1 順位，各裝置同步；晚進來的人直接看到結果。
 */

const FIRST_DELAY = 350
const STEP = 1700
const reduced = () => window.matchMedia('(prefers-reduced-motion: reduce)').matches

function fmt(iso: string, withDate = true) {
  return new Date(iso).toLocaleString('zh-TW', {
    timeZone: 'Asia/Taipei', hour12: false, hour: '2-digit', minute: '2-digit',
    ...(withDate ? { month: 'numeric', day: 'numeric', weekday: 'short' } : {}),
  })
}

export default function DraftOrderPage({ draft }: { draft: DraftView; onChange?: () => void }) {
  const { leagueId, league } = useApp()
  const wide = useWide()
  const x = useXWide() // ≥1680：三欄（設計稿 WebDraftOrder），固定一屏
  const now = useServerNow(200)
  const [replayAt, setReplayAt] = useState<number | null>(null)
  const second = draft.halfNo === 2
  const standings = useLoad(() => api.get<{ half1: StandingRow[] }>(`/api/leagues/${leagueId}/standings`), [leagueId])

  const teams: TeamView[] = league?.teams ?? []
  const n = draft.order.length || teams.length
  const revealed = !!draft.revealedAt
  // 本機時間落後時，揭曉時間看起來還在未來，會一直等；這時改從看到揭曉的那一刻開始播
  const seenAt = useRef<number | null>(null)
  if (draft.revealedAt && seenAt.current == null) seenAt.current = now
  const start = replayAt ?? (draft.revealedAt ? Math.min(new Date(draft.revealedAt).getTime(), seenAt.current ?? now) : null)
  const k = !revealed || start == null ? 0
    : reduced() && replayAt == null ? n
      : Math.min(n, Math.max(0, Math.floor((now - start - FIRST_DELAY) / STEP) + 1))
  const done = revealed && k >= n
  const playing = revealed && !done
  const shown = (p: number) => p > n - k // 第 p 順位已翻開
  const current = playing && k > 0 ? n - k + 1 : null

  // 第三欄的 keeper 名單要排名與守位：揭曉完成後才取（keeper 在選秀板上標為已保留）
  const board = useLoad(
    () => (x && second && done ? api.get<DraftBoard>(`/api/leagues/${leagueId}/drafts/${draft.id}/board`) : Promise.resolve(null)),
    [leagueId, draft.id, x, second, done],
  )

  const teamAt = (p: number) => teams.find((t) => t.id === draft.order[p - 1]) ?? null
  const myId = league?.myTeamId ?? null
  const rec = (teamId: number) => {
    const r = standings.data?.half1.find((x) => x.teamId === teamId)
    return r ? `上半季 ${r.wins}-${r.losses}${r.ties ? `-${r.ties}` : ''}・第 ${r.rank} 名` : ''
  }
  const color = (t: TeamView) => fantasyTeamColor(t.id, teams)
  const keepersOf = (teamId: number) => draft.keepers.find((x) => x.teamId === teamId)?.players ?? []

  const picksText = (p: number, short = false) => second
    ? (short ? `每輪第 ${p} 個選` : `R1–R${draft.rounds} 每輪第 ${p} 個選`)
    : (short ? `R1 #${p}・R2 #${n + 1 - p}・蛇形` : `R1 第 ${p} 手・R2 第 ${n + 1 - p} 手・蛇形 ${draft.rounds} 輪`)

  // 揭曉由管理員按「開始選秀」觸發（docs/decisions.md「選秀與 keeper」），這裡沒有揭曉按鈕
  const play = !revealed
    ? { label: '等管理員按下開始選秀', on: false, go: () => {} }
    : playing ? { label: '揭曉中…', on: false, go: () => {} }
      : { label: '重新播放', on: true, go: () => setReplayAt(now) }

  const status = done ? (second ? '順位確定，各隊 keeper 已公開' : '順位確定')
    : current != null ? `第 ${current} 順位・${teamAt(current)?.name ?? ''}`
      : playing ? '準備翻牌…'
        : second ? '順序依上半季戰績，由差到好' : `管理員按下開始選秀後，從第 ${n} 順位翻起`
  const curTeam = current != null ? teamAt(current) : null
  const glow = curTeam ? alpha(color(curTeam), 0.14) : 'rgba(196,202,212,.05)'

  const kick = second ? 'DRAFT ORDER · 下半季補強選秀' : 'DRAFT LOTTERY · 上半季'
  const title = second ? '選秀順位揭曉' : '選秀順位抽籤'
  const when = draft.scheduledAt ? fmt(draft.scheduledAt) : ''
  const sub = second ? `開始補強選秀・${draft.rounds} 輪` : `開始選秀・蛇形 ${draft.rounds} 輪`
  const who = second ? '順序依上半季戰績，管理員按下開始選秀後全聯盟同步揭曉' : '順序由系統隨機產生，管理員按下開始選秀後全聯盟同步揭曉'

  // 一張順位卡（背面「?」，翻開後是隊伍）
  const card = (p: number, size: 'p' | 'w') => {
    const t = shown(p) ? teamAt(p) : null
    const me = !!t && t.id === myId
    const c = t ? color(t) : '#3a404c'
    return (
      <div className={`lot-card ${size}${t ? ' open' : ''}`}>
        <div className="lot-flip">
          <div className="lot-face lot-back"><div><span className="q">?</span><span className="brand">CPBL FANTASY</span>{size === 'p' && <span className="no">第 {p} 順位</span>}</div></div>
          <div className="lot-face lot-front" style={{ background: alpha(c, me ? 0.95 : 0.6), boxShadow: me ? '0 0 36px rgba(123,140,255,.3)' : undefined }}>
            <div style={{ background: `radial-gradient(circle at 85% 0%, ${alpha(c, 0.22)}, transparent 62%), #15171c` }}>
              <div className="top"><span>DRAFT PICK</span>{me && <span className="you">你</span>}</div>
              <div className="num">{p}</div>
              <span className="sp" />
              {t && (
                <div className="team"><span style={{ color: c }}><TeamIcon icon={t.icon} size={size === 'p' ? 40 : 33} /></span>
                  <div><b>{t.name}</b><small>{second ? (size === 'w' ? rec(t.id).replace('上半季 ', '') : rec(t.id)) : t.owner}</small></div></div>
              )}
              <div className="picks">{picksText(p, size === 'w')}</div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  const pool = (
    <div className="lot-pool">
      {wide && <span className="lv-label-t">參加隊伍</span>}
      {teams.map((t) => {
        const p = draft.order.indexOf(t.id) + 1
        const got = p > 0 && shown(p)
        return (
          <span key={t.id} className={`chip${got ? ' got' : ''}${t.id === myId ? ' me' : ''}`}>
            <span style={{ color: color(t) }}><TeamIcon icon={t.icon} size={wide ? 18 : 17} /></span>{t.name}{got && <b>#{p}</b>}
          </span>
        )
      })}
    </div>
  )

  const ordinals = Array.from({ length: n }, (_, i) => i + 1)
  const enter = <Link to="/draft/room" className={`lot-enter${done ? ' on' : ''}`} aria-disabled={!done} onClick={(e) => { if (!done) e.preventDefault() }}>進入選秀室 ›</Link>
  const playBtn = <button type="button" className={`lot-play${play.on ? '' : ' off'}`} onClick={play.go} disabled={!play.on}>{play.label}</button>
  const laterNote = second ? `補強選秀只有 ${draft.rounds} 輪，每手 ${draft.pickSeconds} 秒；逾時由系統自動選。`
    : `完整選秀 ${draft.rounds} 輪蛇形，第 ${x ? 9 : 7} 輪之後在選秀室看。`

  if (!wide) {
    const deck = ordinals.slice().reverse() // 從最後一個順位開始翻
    return (
      <div className="lot" style={{ ['--lot-glow' as string]: glow }}>
        <div className="lot-head">
          <div className="lv-kicker gold">{kick}</div>
          <h1>{title}</h1>
          <div className="sub">{when && `${when}・`}{sub}</div>
        </div>
        {pool}
        <div className="lot-deck">
          {deck.map((p, i) => {
            const d = i - k
            const style = i < k - 1 ? { zIndex: 1, opacity: 0, transform: 'translateY(-34px) scale(.92)' }
              : i === k - 1 ? { zIndex: 10, opacity: 1 }
                : { zIndex: 9 - d, opacity: d < 3 ? 1 : 0, transform: `translateY(${d * 8}px) scale(${1 - d * 0.04})` }
            return <div key={p} className="slot" style={style}>{card(p, 'p')}</div>
          })}
        </div>
        <div className={`lot-status${done || current ? ' on' : ''}`}>{status}</div>
        <div className="lv-label"><span>選秀順位</span><span className="muted">{second ? '由差到好・每輪同順序' : '隨機抽出・蛇形'}</span></div>
        <div className="lot-order">
          {ordinals.map((p) => {
            const t = shown(p) ? teamAt(p) : null
            const ks = t ? keepersOf(t.id) : []
            return (
              <div key={p} className={`row${t && t.id === myId ? ' me' : ''}`}>
                <div className="l">
                  <span className={`medal${p === 1 ? ' first' : ''}`}>{p}</span>
                  <span className="ic" style={{ color: t ? color(t) : undefined }}>{t ? <TeamIcon icon={t.icon} size={24} /> : '?'}</span>
                  <span className="nm"><b>{t ? t.name : '？'}</b>{t && <small>{second ? rec(t.id).replace(/・.*/, '') : t.owner}</small>}</span>
                  <span className="pk">{t ? (second ? `保留 ${ks.length}・選 ${draft.rounds}` : `R1 #${p}・R2 #${n + 1 - p}`) : ''}</span>
                </div>
                {second && done && t && ks.length > 0 && (
                  <div className="ks">{ks.slice(0, 2).map((x) => <span key={x.playerId}><i>K</i>{x.name}</span>)}{ks.length > 2 && <em>等 {ks.length} 人</em>}</div>
                )}
              </div>
            )
          })}
        </div>
        <p className="kp-note">{second ? '下半季不抽籤：上半季戰績最差的隊伍第 1 個選，每輪同一順序。翻完後公開各隊 keeper。' : '順序由系統隨機產生，管理員按下後全聯盟同步播放。上半季沒有 keeper。'}</p>
        <div className="lot-bar">{playBtn}{done && enter}</div>
      </div>
    )
  }

  // ≥1680 的第三欄：你的手次＋各隊 keeper（下半季）／選秀前準備（上半季）
  const myTeam = teams.find((t) => t.id === myId) ?? null
  const myP = myTeam ? draft.order.indexOf(myTeam.id) + 1 : 0
  const myGot = myP > 0 && shown(myP)
  const myPicks = myP > 0 ? Array.from({ length: draft.rounds }, (_, i) => {
    const r = i + 1, no = second || r % 2 === 1 ? myP : n + 1 - myP
    return { lab: `${r}.${String(no).padStart(2, '0')}`, ov: i * n + no }
  }) : []
  const rankOf = new Map((board.data?.players ?? []).map((p) => [p.playerId, p]))
  // 每隊 keeper 取排名前 3 名（沒有排名的排最後）
  const topKeepers = (teamId: number) => keepersOf(teamId)
    .map((k) => ({ k, p: rankOf.get(k.playerId) }))
    .sort((a, b) => (a.p?.rank ?? 9999) - (b.p?.rank ?? 9999))
    .slice(0, 3)
  const posText = (p?: { pitcher: boolean; eligible: string[]; position: string }) =>
    !p ? '' : p.pitcher ? (['SP', 'RP'].filter((v) => p.eligible.includes(v)).join('/') || p.position) : p.position
  const side = (
    <div className="lot-side">
      <div className="lot-my">
        <div className="hd"><span className="lv-label-t">你的手次</span><span className="muted">{second ? `${draft.rounds} 手` : `${draft.rounds} 手・蛇形`}</span></div>
        {myGot && myTeam ? (
          <>
            <div className="who">
              <span className="ic" style={{ color: color(myTeam) }}><TeamIcon icon={myTeam.icon} size={20} /></span>
              <div><b>{myTeam.name}・第 {myP} 順位</b><small>{second ? `${rec(myTeam.id)}・每輪第 ${myP} 個選` : `奇數輪第 ${myP} 個、偶數輪第 ${n + 1 - myP} 個選`}</small></div>
            </div>
            <div className="picks">{myPicks.map((m) => <div key={m.lab}><b>{m.lab}</b><small>#{m.ov}</small></div>)}</div>
          </>
        ) : <div className="wait">翻到你的牌才會顯示</div>}
      </div>
      <div className="lot-kp">
        <div className="hd"><span className="lv-label-t">{second ? '各隊 KEEPER' : '選秀前準備'}</span><span className="muted">{second ? (done ? '已公開・依順位' : '揭曉前只有自己看得到') : ''}</span></div>
        {second ? (
          <div className="list">
            {ordinals.map((p) => {
              const t = teamAt(p)
              if (!t) return null
              const ks = keepersOf(t.id)
              return (
                <div key={p} className={`it${t.id === myId ? ' me' : ''}`}>
                  <div className="t"><span style={{ color: color(t) }}><TeamIcon icon={t.icon} size={18} /></span><b>{t.name}</b><small>#{p}</small><span className="sp" /><em>保留 {ks.length}・選 {draft.rounds}</em></div>
                  {done ? (
                    <div className="ns">{topKeepers(t.id).map(({ k, p: bp }) => <span key={k.playerId}>{k.name}<i>{posText(bp)}</i></span>)}{ks.length > 3 && <span className="more">等 {ks.length} 人</span>}</div>
                  ) : <div className="lock">翻完 {n} 張後公開</div>}
                </div>
              )
            })}
          </div>
        ) : (
          <>
            <p className="txt">上半季是完整選秀，沒有 keeper。選秀前可以先到選秀室排好候選清單；輪到你但時間到時，會照候選清單的順序自動選。</p>
            <Link to="/draft/room" className="go">去排候選清單 ›</Link>
          </>
        )}
      </div>
    </div>
  )

  const boardRounds = second ? draft.rounds : x ? 8 : 6
  return (
    <div className={`lot wide${x ? ' x' : ''}`} style={{ ['--lot-glow' as string]: glow }}>
      <div className="lot-whead">
        <div><div className="lv-kicker gold">{kick}</div><div className="t"><h1>{title}</h1><span className="sub">{when && `${when}・`}{sub}</span></div></div>
        <span className="sp" />
        <span className="who">{who}</span>
        {playBtn}
      </div>
      <div className="lot-cols">
        <div className="lot-stage">
          {pool}
          <div className="lot-row">
            {ordinals.map((p) => (
              <div key={p} className="col">
                <span className={`lab${shown(p) ? ' on' : ''}`}>第 {p} 順位</span>
                <div className={`lift${current === p ? ' up' : ''}`}>{card(p, 'w')}</div>
              </div>
            ))}
          </div>
          <div className={`lot-status${done || current ? ' on' : ''}`}>{status}</div>
        </div>
        <div className="lot-board">
          <div className="hd"><span className="lv-label-t">{second ? `選秀板 · 補強 ${draft.rounds} 輪` : `選秀板預覽 · 第 1 – ${boardRounds} 輪`}</span><span className="muted">{second ? '由差到好・每輪同順序' : '隨機抽出・蛇形'}</span></div>
          <div className="grid heads" style={{ gridTemplateColumns: `44px repeat(${n}, minmax(0, 1fr))` }}>
            <span />
            {ordinals.map((p) => {
              const t = shown(p) ? teamAt(p) : null
              return (
                <div key={p} className="head" style={t ? { background: alpha(color(t), 0.12), boxShadow: `inset 0 0 0 1px ${alpha(color(t), 0.5)}` } : undefined}>
                  <span className={t ? 'on' : ''}>{t && <span style={{ color: color(t) }}><TeamIcon icon={t.icon} size={15} /></span>}{t ? t.name : '?'}</span>
                  <small>第 {p} 順位</small>
                </div>
              )
            })}
          </div>
          <div className="rows">
            {Array.from({ length: boardRounds }, (_, i) => i + 1).map((r) => {
              const fwd = second || r % 2 === 1
              return (
                <div key={r} className="grid" style={{ gridTemplateColumns: `44px repeat(${n}, minmax(0, 1fr))` }}>
                  <div className="rd"><span>R{r}</span><span className="arrow">{fwd ? '→' : '←'}</span></div>
                  {ordinals.map((p) => {
                    const t = shown(p) ? teamAt(p) : null
                    const no = fwd ? p : n + 1 - p
                    return (
                      <div key={p} className="cell" style={t ? { background: alpha(color(t), 0.06), boxShadow: `inset 0 0 0 1px ${alpha(color(t), 0.22)}` } : undefined}>
                        <span className={`lab${t ? ' on' : ''}`}>{r}.{String(no).padStart(2, '0')}</span>
                        {t && t.id === myId && <span className="you">你</span>}
                      </div>
                    )
                  })}
                </div>
              )
            })}
          </div>
          {second && done && !x && (
            <div className="lot-keepers">
              {ordinals.map((p) => {
                const t = teamAt(p)
                const ks = t ? keepersOf(t.id) : []
                return t && <div key={p}><b style={{ color: color(t) }}>{t.name}</b><span>保留 {ks.length}：{ks.map((x) => x.name).join('、') || '—'}</span></div>
              })}
            </div>
          )}
          <div className="ft"><span>{laterNote}</span>{enter}</div>
        </div>
        {x && side}
      </div>
    </div>
  )
}

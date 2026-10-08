import { useState } from 'react'
import type { LiveGame } from '../api'
import { batText, bestBatter, bestPitcher, linesOf, pitText, standingAfter, winnerOf } from '../postseason'
import { Chip, LineScore, md, Person, Section, team, type PsCtx } from './shared'

/**
 * 戰況卡：每場結束後一行（場次、比分、本場最佳、勝隊），新的在前；
 * 點一場展開逐局比分與本場最佳打者、投手，預設只展開最新一場。
 */

export default function Recaps({ ctx }: { ctx: PsCtx }) {
  const { s, finished, tA, tB, noOf } = ctx
  // undefined＝還沒點過，用預設（最新一場）；null＝使用者收合了
  const [openId, setOpenId] = useState<number | null | undefined>(undefined)
  const recent = [...finished].reverse()
  const current = openId === undefined ? (recent[0]?.id ?? null) : openId

  const row = (g: LiveGame) => {
    const lines = linesOf(s, g)
    const w = winnerOf(g)
    const i = noOf(g)
    const b = bestBatter(lines), p = bestPitcher(lines)
    const o = g.id === current
    const after = standingAfter(s, ctx.games, i - 1)
    const sc = (code: string) => (code === g.homeTeam ? g.homeScore : g.awayScore) ?? 0
    const side = (code: string) => {
      const mine = sc(code), other = sc(code === g.homeTeam ? g.awayTeam : g.homeTeam)
      return { code, v: mine, lose: mine < other }
    }
    const a = side(g.awayTeam), h = side(g.homeTeam)
    return (
      <div key={g.id} className="pv-rc">
        <button type="button" className="pv-rcrow" aria-expanded={o} onClick={() => setOpenId(o ? null : g.id)}>
          <div className="ttl"><b>第 {i} 戰</b><small>{md(g.scheduledDate)}</small></div>
          <div className="sc">
            <Chip code={a.code} /><span className={`n${a.lose ? ' lose' : ''}`}>{a.v}</span><i className="c">:</i>
            <span className={`n${h.lose ? ' lose' : ''}`}>{h.v}</span><Chip code={h.code} />
          </div>
          <span className="best">{b && `最佳打者 ${b.name}`}{b && p && '・'}{p && `最佳投手 ${p.name}`}</span>
          <span className="res"><i style={{ background: w ? team(w).bg : 'transparent' }} />{w ? `${team(w).short}勝` : '和局'}</span>
          <i className={`pv-caret${o ? ' up' : ''}`} />
        </button>
        {o && (
          <div className="pv-rcbody">
            <div className="left">
              <LineScore g={g} size="sm" />
              <div className="after">第 {i} 戰後 {team(tA).short} {after[tA]}：{after[tB]} {team(tB).short}</div>
            </div>
            <div className="people">
              {b && <Person ctx={ctx} label="最佳打者" l={b} text={batText(b)} tone="best" />}
              {p && <Person ctx={ctx} label="最佳投手" l={p} text={pitText(p)} tone="best" />}
            </div>
          </div>
        )}
      </div>
    )
  }

  return (
    <Section title={`戰況卡 · 已打 ${finished.length} 場`} note={finished.length > 0 ? '點一場展開' : undefined}>
      {recent.length === 0 && <div className="pv-empty">第一場結束後，這裡會出現戰況卡：比分、逐局、本場最佳打者與投手。</div>}
      {recent.map(row)}
    </Section>
  )
}

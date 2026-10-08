import { useState } from 'react'
import type { LiveLine } from '../api'
import { ip } from '../live'
import { aggregate, avg, batText, ipShort, isBatLine, isPitLine, linesOf, pitText, type BatAgg, type PitAgg } from '../postseason'
import { Mine, Num, Section, team, type PsCtx } from './shared'

/**
 * 你的球員：自己 fantasy 名單上在打這個系列的球員，一人一行（今天的表現＋系列累計一句話），
 * 點開看系列累計表。只標示，不計分。超過 3 位先收合。
 */

const LIMIT = 3
const BAT_HEADS = ['G', 'PA', 'AB', 'H', 'R', 'HR', 'BB', 'AVG']
const PIT_HEADS = ['G', 'IP', 'H', 'BB', 'ER', 'K', 'W', 'SV']

interface Row {
  key: string
  p: BatAgg | PitAgg
  bat: boolean
  /** 0 正在場上、1 今天有上場、2 今天沒上場 */
  rank: number
  now: boolean
  played: boolean
  todayText: string
  ser: string
  heads: string[]
  cells: (string | number)[]
}

export default function MinePanel({ ctx }: { ctx: PsCtx }) {
  const { s, data, todayGame, live } = ctx
  const [open, setOpen] = useState<Record<string, boolean>>({})
  const [all, setAll] = useState(false)
  const mine = (x: { fantasyTeamId: number | null }) => data.myTeamId != null && x.fantasyTeamId === data.myTeamId

  const agg = aggregate(s.lines)
  const todayLine = (id: number, ok: (l: LiveLine) => boolean) => (todayGame ? linesOf(s, todayGame).find((l) => l.playerId === id && ok(l)) : undefined)
  const playing = todayGame?.status === 'IN_PROGRESS'

  const rows: Row[] = [
    ...agg.bats.filter(mine).map((p): Row => {
      const l = todayLine(p.playerId, isBatLine)
      const now = !!playing && todayGame?.batterId === p.playerId
      return {
        key: `b${p.playerId}`, p, bat: true, now, played: !!l, rank: now ? 0 : l ? 1 : 2,
        todayText: !todayGame ? '休息日，沒有比賽' : l ? batText(l) : '沒有上場',
        ser: `${p.g} 場 ${p.h} 安${p.hr ? ` ${p.hr} 轟` : ''}`,
        heads: BAT_HEADS, cells: [p.g, p.pa, p.ab, p.h, p.r, p.hr, p.bb, avg(p.h, p.ab)],
      }
    }),
    ...agg.pits.filter(mine).map((p): Row => {
      const l = todayLine(p.playerId, isPitLine)
      const now = !!playing && todayGame?.pitcherId === p.playerId
      return {
        key: `p${p.playerId}`, p, bat: false, now, played: !!l, rank: now ? 0 : l ? 1 : 2,
        todayText: !todayGame ? '休息日，沒有比賽' : l ? pitText(l) : '沒有上場',
        ser: `${p.g} 場 ${ipShort(p.outs)} 局 ${p.k} K`,
        heads: PIT_HEADS, cells: [p.g, ip(p.outs), p.h, p.bb, p.er, p.k, p.w, p.sv],
      }
    }),
  ].sort((a, b) => a.rank - b.rank)

  const playedN = rows.filter((r) => r.played).length
  const note = rows.length === 0 ? '只標示，不計分' : todayGame ? `${rows.length} 位・今天上場 ${playedN} 位・不計分` : `${rows.length} 位・不計分`
  const shown = all ? rows : rows.slice(0, LIMIT)
  const hidden = rows.slice(LIMIT)
  const hiddenTeams = [ctx.tA, ctx.tB]
    .map((c) => [team(c).short, hidden.filter((r) => r.p.team === c).length] as const)
    .filter(([, n]) => n > 0).map(([n, c]) => `${n} ${c}`).join('・')

  return (
    <Section title="你的球員" note={note}>
      {rows.length === 0 && <div className="pv-empty">你的名單上沒有人在打{s.name}。</div>}
      {shown.map((r) => {
        const o = !!open[r.key]
        return (
          <div key={r.key} className="pv-mp">
            <button type="button" className="pv-mrow" style={{ opacity: !todayGame || r.played ? 1 : 0.55 }} aria-expanded={o}
              onClick={() => setOpen({ ...open, [r.key]: !o })}>
              <Num code={r.p.team} jersey={r.p.jersey} />
              <div className="mid">
                <div className="l1">
                  <b>{r.p.name}</b><Mine ctx={ctx} fantasyTeamId={r.p.fantasyTeamId} />
                  <span className="ts">{team(r.p.team).short}・{r.bat ? r.p.pos : 'P'}</span>
                  {r.now && <span className="now">{r.bat ? '打擊中' : '投球中'}</span>}
                </div>
                <div className="l2"><span>{live ? '今天・進行中' : '今天'}</span> {r.todayText}</div>
              </div>
              <div className="ser">{r.ser}<i className={`pv-caret${o ? ' up' : ''}`} /></div>
            </button>
            {o && (
              <div className="pv-cum">
                {r.heads.map((h) => <span key={h} className="h">{h}</span>)}
                {r.cells.map((c, i) => <span key={i} className="v">{c}</span>)}
              </div>
            )}
          </div>
        )
      })}
      {rows.length > LIMIT && (
        <button type="button" className="pv-toggle" aria-expanded={all} onClick={() => setAll(!all)}>
          {all ? '收合' : `看全部 ${rows.length} 位（還有 ${hidden.length} 位：${hiddenTeams}）`}<i className={all ? 'up' : ''} />
        </button>
      )}
    </Section>
  )
}


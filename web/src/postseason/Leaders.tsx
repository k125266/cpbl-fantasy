import { useState } from 'react'
import { Link } from 'react-router-dom'
import { leaderboards, type BatAgg, type Board, type PitAgg } from '../postseason'
import { Mine, Num, Section, team, type PsCtx } from './shared'

/**
 * 系列戰排行：安打、全壘打、三振、防禦率各列第一名，點開看前三名。
 * 同數值同名次；防禦率要投滿「已打場數」局。
 */

export default function Leaders({ ctx }: { ctx: PsCtx }) {
  const { s, games, finished, live, todayNo } = ctx
  const [open, setOpen] = useState(false)
  const played = Math.max(finished.length + (games.some((g) => g.status === 'IN_PROGRESS') ? 1 : 0), 1)
  const b = leaderboards(s.lines, played)
  const boards: Board<BatAgg | PitAgg>[] = [...b.bat, ...b.pit]
  const note = live && todayNo ? `含第 ${todayNo} 戰進行中・非最終` : `${finished.length} 場累計`

  return (
    <Section title="系列戰排行" note={note}>
      <div className="pv-ld">
        {boards.map((bd) => (
          <div key={bd.key} className="b">
            <div className="bh"><b>{bd.title}</b><span className="k">{bd.key}</span><span className="note">{bd.note}</span></div>
            {bd.rows.length === 0 && <div className="empty">{bd.emptyText || '還沒有數據'}</div>}
            {(open ? bd.rows : bd.rows.slice(0, 1)).map((r, i) => (
              <div key={r.who.playerId} className={`r${i === 0 ? ' first' : ''}`}>
                <Num code={r.who.team} jersey={r.who.jersey} />
                <div className="who">
                  <div className="nm"><Link to={`/players/${r.who.playerId}`}>{r.who.name}</Link><Mine ctx={ctx} fantasyTeamId={r.who.fantasyTeamId} size={11} /></div>
                  <div className="ts">{team(r.who.team).short}・{r.sub}</div>
                </div>
                <span className="v">{r.value}</span>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button type="button" className="pv-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
        {open ? '只看第一名' : '看前三名'}<i className={open ? 'up' : ''} />
      </button>
    </Section>
  )
}

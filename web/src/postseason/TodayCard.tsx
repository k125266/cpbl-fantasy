import { useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import type { LiveGame, LiveLine } from '../api'
import { ip, OUTS_HINT, outsOf } from '../live'
import { batText, bestBatter, bestPitcher, isBatLine, isPitLine, linesOf, pitText, winnerOf } from '../postseason'
import { fantasyTeamColor } from '../teams'
import { Chip, hm, LineScore, mdw, Mine, Num, Person, resultText, Section, team, type PsCtx } from './shared'

/**
 * 今天這一戰：比分、逐局比分、場上狀況（進行中）或本場最佳（結束後）；
 * 兩隊打者與投手數據收在「展開」裡。今天沒有比賽時顯示休息日與下一戰。
 *
 * <p>沒有壘包與好壞球數（資料源沒有），場上狀況只有本半局出局數（推算）與打席序列。
 */

const BAT_HEADS = ['PA', 'AB', 'H', 'R', 'HR', 'BB']
const PIT_HEADS = ['IP', 'H', 'BB', 'ER', 'K', '勝救']

/** 一隊的打者與投手數據 */
function Box({ ctx, g, home, className }: { ctx: PsCtx; g: LiveGame; home: boolean; className: string }) {
  const rows = linesOf(ctx.s, g).filter((l) => l.home === home)
  const bats = rows.filter(isBatLine), pits = rows.filter(isPitLine)
  const code = home ? g.homeTeam : g.awayTeam
  const me = ctx.myTeam ? { '--me': fantasyTeamColor(ctx.myTeam.id, ctx.teams) } as CSSProperties : undefined
  const mine = (l: LiveLine) => (l.fantasyTeamId != null && l.fantasyTeamId === ctx.data.myTeamId ? ' me' : '')
  const cell = (v: number | string, hi?: boolean) => <span className={`r${v === 0 || v === '–' ? ' z' : hi ? ' hi' : ''}`}>{v}</span>
  const who = (l: LiveLine) => (
    <div className="who">
      <Link to={`/players/${l.playerId}`}>{l.name}</Link><Mine ctx={ctx} fantasyTeamId={l.fantasyTeamId} />
      <span className="pos m-only">{l.listedPosition}</span>
    </div>
  )
  return (
    <div className={`pv-box ${className}`} style={me}>
      <div className="bt"><Chip code={code} /><b>{team(code).name}</b></div>
      <div className="bh"><span /><span>打者</span><span className="d-only">位置</span>{BAT_HEADS.map((h) => <span key={h} className="r">{h}</span>)}</div>
      {bats.map((l) => (
        <div key={l.playerId} className={`br${mine(l)}`}>
          <Num code={l.cpblTeam} jersey={l.jerseyNumber} />{who(l)}<span className="pos d-only">{l.listedPosition}</span>
          {cell(l.pa)}{cell(l.ab)}{cell(l.h)}{cell(l.r)}{cell(l.hr, true)}{cell(l.bb)}
        </div>
      ))}
      {bats.length === 0 && <div className="pv-empty">還沒有打者數據</div>}
      <div className="bh"><span /><span>投手</span><span className="d-only" />{PIT_HEADS.map((h) => <span key={h} className="r">{h}</span>)}</div>
      {pits.map((l) => (
        <div key={l.playerId} className={`br${mine(l)}`}>
          <Num code={l.cpblTeam} jersey={l.jerseyNumber} />{who(l)}<span className="pos d-only">{l.listedPosition}</span>
          <span className="r">{ip(l.outs)}</span>{cell(l.pH)}{cell(l.pBb)}{cell(l.pEr)}{cell(l.pK)}
          <span className={`r${l.w || l.sv ? ' hi' : ' z'}`}>{l.w ? 'W' : l.sv ? 'SV' : '–'}</span>
        </div>
      ))}
      {pits.length === 0 && <div className="pv-empty">還沒有投手數據</div>}
    </div>
  )
}

export default function TodayCard({ ctx }: { ctx: PsCtx }) {
  const { todayGame: g, live, todayNo, decided, nextGame, lastFinal, noOf, s, isFinals, year } = ctx
  const [open, setOpen] = useState(false)
  const [side, setSide] = useState<'a' | 'h'>('a')
  const title = `今天這一戰${todayNo ? ` · 第 ${todayNo} 戰` : ''}`

  // 今天沒有比賽：休息日（系列戰結束後顯示結果）
  if (!g) {
    const meta = decided
      ? `${team(s.winner as string).short}${isFinals ? `奪得 ${year} 總冠軍` : '晉級台灣大賽'}。每一戰的戰況在下方。`
      : nextGame ? `第 ${noOf(nextGame)} 戰 ${mdw(nextGame.scheduledDate)}${nextGame.startTime ? ` ${hm(nextGame.startTime)}` : ''} 開打。` : '下一戰還沒有排定。'
    const prev = lastFinal ? `前一戰：第 ${noOf(lastFinal)} 戰 ${resultText(lastFinal)} ${Math.max(lastFinal.homeScore ?? 0, lastFinal.awayScore ?? 0)}：${Math.min(lastFinal.homeScore ?? 0, lastFinal.awayScore ?? 0)}，戰況卡在下方。` : ''
    return (
      <Section title="今天這一戰">
        <div className="pv-rest">
          <div className="h">{decided ? '系列戰已結束' : '今天休息'}</div>
          <p>{meta}</p>
          {prev && <small>{prev}</small>}
        </div>
      </Section>
    )
  }

  const lines = linesOf(s, g)
  const batter = g.batterId != null ? lines.find((l) => l.playerId === g.batterId) : undefined
  const pitcher = g.pitcherId != null ? lines.find((l) => l.playerId === g.pitcherId) : undefined
  const outs = outsOf(g)
  const winner = winnerOf(g)
  const inn = live ? (g.inning ?? '進行中') : g.status === 'FINAL' ? '終場' : g.startTime ? hm(g.startTime) : '—'
  const sub = live ? (outs == null ? '進行中・非最終' : `${outs} 出局・非最終`)
    : g.status === 'FINAL' ? (winner ? `${team(winner).short}勝` : '平手') : '尚未開始'

  const hasScore = g.homeScore != null && g.awayScore != null
  const sides = [
    { code: g.awayTeam, sc: g.awayScore, other: g.homeScore },
    { code: g.homeTeam, sc: g.homeScore, other: g.awayScore },
  ].map((x) => ({ ...x, lead: hasScore && (x.sc ?? 0) > (x.other ?? 0), trail: hasScore && (x.sc ?? 0) < (x.other ?? 0) }))

  const best = g.status === 'FINAL' ? { b: bestBatter(lines), p: bestPitcher(lines) } : null
  const half = g.halfInning && g.halfInning.length > 0 ? g.halfInning : null

  return (
    <Section title={title}>
      {/* 手機：兩隊疊在一起，右邊局數 */}
      <div className="pv-top">
        <div className="teams">
          {sides.map((x) => (
            <div key={x.code} className={`t${x.lead ? ' lead' : ''}${x.trail ? ' trail' : ''}`}>
              <Chip code={x.code} /><span className="nm">{team(x.code).name}</span><span className="sc">{hasScore ? x.sc : ''}</span>
            </div>
          ))}
        </div>
        <div className={`state${live ? ' live' : ''}`}><span className="inn">{live && <i />}{inn}</span><span className="sub">{sub}</span></div>
      </div>
      {/* 網頁：客隊｜局數｜主隊 的大比分列 */}
      <div className="pv-big">
        <div className={`side${sides[0].lead ? ' lead' : ''}${sides[0].trail ? ' trail' : ''}`}>
          <Chip code={sides[0].code} className="lg" /><b>{team(sides[0].code).name}</b><span className="sp" /><span className="sc">{hasScore ? sides[0].sc : ''}</span>
        </div>
        <div className={`mid${live ? ' live' : ''}`}><span className="inn">{live && <i />}{inn}</span><span className="sub">{sub}</span></div>
        <div className={`side h${sides[1].lead ? ' lead' : ''}${sides[1].trail ? ' trail' : ''}`}>
          <span className="sc">{hasScore ? sides[1].sc : ''}</span><span className="sp" /><b>{team(sides[1].code).name}</b><Chip code={sides[1].code} className="lg" />
        </div>
      </div>

      <div className="pv-split">
        <LineScore g={g} />
        <div className="pv-now">
          {live && (
            <>
              <div className="pv-half">
                <div className="l1" title={OUTS_HINT}>{g.inning}{outs != null ? `・${outs} 出局` : ''}</div>
                {half && <div className="l2">{half.map((pa, i) => <span key={i} className={pa.result == null ? 'now' : ''}>{i > 0 && <em>→</em>}{pa.name} {pa.result ?? '對決中'}</span>)}</div>}
                {batter && pitcher && <div className="duel">打擊 {batter.name}・投球 {pitcher.name}</div>}
              </div>
              {batter && <Person ctx={ctx} label="打擊中" l={batter} text={`今天 ${batter.ab} 打數 ${batter.h} 安${batter.bb ? ` ${batter.bb} 保送` : ''}`} tone="live" deskOnly />}
              {pitcher && <Person ctx={ctx} label="投球中" l={pitcher} text={`今天 ${ip(pitcher.outs)} 局 ${pitcher.pH} 安 ${pitcher.pK} K${pitcher.pEr ? ` 失 ${pitcher.pEr} 分` : ''}`} tone="live" deskOnly />}
            </>
          )}
          {best?.b && <Person ctx={ctx} label="最佳打者" l={best.b} text={batText(best.b)} tone="best" />}
          {best?.p && <Person ctx={ctx} label="最佳投手" l={best.p} text={pitText(best.p)} tone="best" />}
          {!live && !best && <div className="pv-empty">{g.status === 'SCHEDULED' ? '比賽還沒開始' : '沒有賽況資料'}</div>}
        </div>
      </div>

      {lines.length > 0 && (
        <>
          <button type="button" className="pv-toggle" aria-expanded={open} onClick={() => setOpen(!open)}>
            {open ? '收合打者與投手數據' : '展開兩隊打者與投手數據'}<i className={open ? 'up' : ''} />
          </button>
          {open && (
            <div className="pv-boxes">
              <div className="pv-seg2" role="tablist">
                {([['a', g.awayTeam], ['h', g.homeTeam]] as const).map(([k, code]) => (
                  <button key={k} type="button" role="tab" aria-selected={side === k} onClick={() => setSide(k)}>{team(code).name}</button>
                ))}
              </div>
              <Box ctx={ctx} g={g} home={false} className={side === 'a' ? 'sel' : ''} />
              <Box ctx={ctx} g={g} home className={side === 'h' ? 'sel' : ''} />
            </div>
          )}
        </>
      )}
    </Section>
  )
}

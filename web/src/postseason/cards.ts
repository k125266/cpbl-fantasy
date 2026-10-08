import type { LiveGame, LiveLine, PostseasonView, SeriesView } from '../api'
import { ip } from '../live'
import { batScore, bestBatter, bestPitcher, byOrder, ipShort, isBatLine, isPitLine, linesOf, pitScore, winnerOf } from '../postseason'
import { cpblTeam } from '../teams'
import { hm, md, mdw } from './shared'

/**
 * 季後賽紀念卡（設計稿「季後賽紀念卡 v2」）：全部由比賽資料推導，不建發卡表，重算結果一致。
 *
 * - 每戰紀念：系列中每一場結束的比賽，全聯盟都有。
 * - 高光限定：比賽「當天」在自己名單上的球員達標（LiveLine.gameDayTeamId），同一位球員同一場多項只發一張。
 * - 冠軍紀念：系列戰分出勝負，全聯盟都有。
 * 都不計分、不能交換。
 */

export type CardKind = 'game' | 'hl' | 'champ'

/** 同一時間點的排序：冠軍 → 高光 → 每戰 */
const KORD: Record<CardKind, number> = { champ: 0, hl: 1, game: 2 }
export const KIND_LABEL: Record<CardKind, string> = { game: '每戰紀念', hl: '高光限定', champ: '冠軍紀念' }

export interface Cell { v: string; c: string }
interface Side { s: string; n: string; bg: string; fg: string }
interface Who extends Side { num: string; l?: string; txt?: string }
export interface LsRow { s: string; bg: string; fg: string; cells: Cell[]; R: string; H: string; col: string }
export interface Ls { heads: number[]; rows: LsRow[] }

interface Base {
  id: string
  /** 時間順序（全部季後賽比賽依開賽時間排的序號），新的在前 */
  t: number
  label: string
  /** 系列名稱，例如「季後挑戰賽」 */
  serie: string
  dateL: string
  cap1: string
  cap2: string
  desc: string
}

export interface GameCard extends Base {
  kind: 'game'
  no: number
  band: string
  rows: { s: string; n: string; bg: string; fg: string; R: string; col: string; w: number }[]
  ls: Ls
  best: Who[]
  after: string
  afterNote: string
  teams: { s: string; n: string; bg: string; fg: string; tot: string; pits: { n: string; cells: Cell[] }[] }[]
  recv: string
  /** 卡片列表用 */
  score: string
}

export interface HlCard extends Base {
  kind: 'hl'
  no: number
  serieS: string
  dateS: string
  main: string
  mainFs: string
  more: string
  hasMore: boolean
  achText: string
  p: { num: string; n: string; pos: string; ts: string; bg: string; fg: string; glow: string; grad: string }
  stat: string
  score: string
  nCols: number
  heads: string[]
  cells: Cell[]
  achList: { t: string; d: string }[]
  ls: Ls
  owner: string
}

export interface ChampCard extends Base {
  kind: 'champ'
  title: string
  titleTop: string
  titleFs: string
  fullTitle: string
  vs: string
  team: { s: string; n: string; bg: string; fg: string; deep: string; glow: string }
  score: string
  scoreNote: string
  games: { t: string; sc: string; dot: string }[]
  glist: { t: string; d: string; a: ScoreSide; h: ScoreSide; after: string }[]
  hasBye: boolean
  byeT: string
  mvp: { num: string; n: string; ts: string; bg: string; fg: string; txt: string; heads: string[]; cells: string[]; nCols: number }
}
interface ScoreSide { s: string; bg: string; fg: string; R: string; col: string }

export type PsCardData = GameCard | HlCard | ChampCard

export interface SeriesGroup {
  kind: string
  title: string
  sub: string
  cards: GameCard[]
}

export interface DerivedCards {
  /** 新的在前 */
  flat: PsCardData[]
  byId: Record<string, PsCardData>
  /** 開卡順序：舊的先開 */
  order: PsCardData[]
  champs: ChampCard[]
  hls: HlCard[]
  /** 每戰紀念依系列分組，新的系列在前 */
  groups: SeriesGroup[]
}

const DIM = '#4a505c'
const WHITE = '#eef0f4'

/** 勝隊色塊的深色版（冠軍卡上半部漸層）；沒特別指定的球隊用底色加深 */
const DEEP: Record<string, string> = { UNI: '#9c3f0c', BRO: '#8a6a00', WEI: '#7a1a22' }
function darken(hex: string, k = 0.55): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex)
  if (!m) return hex
  const n = parseInt(m[1], 16)
  const f = (v: number) => Math.round(v * k).toString(16).padStart(2, '0')
  return `#${f((n >> 16) & 255)}${f((n >> 8) & 255)}${f(n & 255)}`
}

const side = (code: string): Side => { const t = cpblTeam(code); return { s: t.short, n: t.name, bg: t.bg, fg: t.fg } }

const scoreOf = (g: LiveGame, code: string) => (code === g.homeTeam ? g.homeScore : g.awayScore) ?? 0

// ---- 卡片用的文字（設計稿用「自責」，和戰況卡的「失分」不同）----
function batTxt(l: LiveLine): string {
  return `${l.ab} 打數 ${l.h} 安` + (l.hr ? ` ${l.hr} 轟` : '') + (l.r ? ` ${l.r} 得分` : '') + (l.bb ? ` ${l.bb} 保送` : '')
}
function pitTxt(l: LiveLine): string {
  return `${ipShort(l.outs)} 局 ${l.pK} K` + (l.pEr ? ` 自責 ${l.pEr} 分` : ' 無自責分') + (l.w ? '・勝投' : l.sv ? '・救援成功' : '')
}

function lsOf(g: LiveGame): Ls {
  const ls = g.lineScore
  if (!ls) return { heads: [], rows: [] }
  const n = Math.max(9, ls.away.length, ls.home.length)
  const row = (code: string, runs: (number | null)[], rhe: (number | null)[], oRhe: (number | null)[]): LsRow => {
    const t = cpblTeam(code), R = rhe[0] ?? 0, oR = oRhe[0] ?? 0
    return {
      s: t.short, bg: t.bg, fg: t.fg, R: String(R), H: String(rhe[1] ?? 0), col: R >= oR ? WHITE : '#8d95a4',
      cells: Array.from({ length: n }, (_, i) => { const v = runs[i]; return { v: v == null ? '' : String(v), c: v != null && v > 0 ? WHITE : '#6c7584' } }),
    }
  }
  return { heads: Array.from({ length: n }, (_, i) => i + 1), rows: [row(g.awayTeam, ls.away, ls.awayRhe, ls.homeRhe), row(g.homeTeam, ls.home, ls.homeRhe, ls.awayRhe)] }
}

function whoOf(l: LiveLine, label: string, txt: string): Who {
  const t = cpblTeam(l.cpblTeam)
  return { n: l.name, num: l.jerseyNumber ?? '', bg: t.bg, fg: t.fg, s: t.short, l: label, txt }
}

/** 先發投手：這場這一隊 seq 最小的投手（LiveLine 沒有 started 欄位） */
function isStarter(l: LiveLine, lines: LiveLine[]): boolean {
  const mates = lines.filter((x) => x.home === l.home && isPitLine(x))
  return mates.length > 0 && mates.reduce((a, b) => (b.seq < a.seq ? b : a)).playerId === l.playerId
}

function gameCard(s: SeriesView, g: LiveGame, no: number, t: number, run: Record<string, number>, format: string): GameCard {
  const [tA, tB] = s.teams
  const lines = linesOf(s, g)
  const b = bestBatter(lines), p = bestPitcher(lines)
  const best = [b && whoOf(b, '最佳打者', batTxt(b)), p && whoOf(p, '最佳投手', pitTxt(p))].filter((x): x is Who => !!x)
  const rowOf = (code: string) => {
    const R = scoreOf(g, code), oR = scoreOf(g, code === g.homeTeam ? g.awayTeam : g.homeTeam), sd = side(code)
    return { ...sd, R: String(R), col: R >= oR ? WHITE : '#8d95a4', w: R > oR ? 600 : 400 }
  }
  const rows = [rowOf(g.awayTeam), rowOf(g.homeTeam)]
  const teamBox = (home: boolean) => {
    const code = home ? g.homeTeam : g.awayTeam, sd = side(code)
    const mine = lines.filter((l) => l.home === home)
    const sum = (k: 'h' | 'hr' | 'bb') => mine.filter(isBatLine).reduce((x, l) => x + l[k], 0)
    const v = (x: number): Cell => ({ v: String(x), c: x === 0 ? DIM : WHITE })
    return {
      ...sd, tot: `R ${scoreOf(g, code)} · H ${sum('h')} · HR ${sum('hr')} · BB ${sum('bb')}`,
      pits: mine.filter(isPitLine).map((l) => ({ n: l.name, cells: [{ v: ip(l.outs), c: WHITE }, v(l.pH), v(l.pBb), v(l.pEr), v(l.pK), { v: l.w ? 'W' : l.sv ? 'SV' : '–', c: l.w || l.sv ? '#ecdfc4' : DIM }] })),
    }
  }
  const score = `${side(g.awayTeam).s} ${scoreOf(g, g.awayTeam)}：${scoreOf(g, g.homeTeam)} ${side(g.homeTeam).s}`
  const serie = s.name
  return {
    id: `g-${g.id}`, kind: 'game', t, label: KIND_LABEL.game, serie, no, dateL: mdw(g.scheduledDate), score,
    band: `linear-gradient(105deg,${cpblTeam(g.awayTeam).bg} 0 50%,${cpblTeam(g.homeTeam).bg} 50% 100%)`,
    rows, ls: lsOf(g), best,
    after: `第 ${no} 戰後 ${side(tA).s} ${run[tA]}：${run[tB]} ${side(tB).s}`,
    afterNote: s.advantageTeam ? '含保送 1 勝' : format,
    teams: [teamBox(false), teamBox(true)],
    recv: `${md(g.scheduledDate)} ${g.fetchedAt ? hm(g.fetchedAt) : ''} 收到`.trim(),
    cap1: `${serie} 第 ${no} 戰`, cap2: `${mdw(g.scheduledDate)}・${score}`,
    desc: `${score}。${best[0] ? `${best[0].n}是本場最佳打者` : ''}${best[1] ? `，${best[1].n}是最佳投手` : ''}。聯盟裡每位玩家都會收到這張。`,
  }
}

/** 高光門檻（優先順序照設計稿）：標題用達成的第一項，其餘接在「＋」後面 */
function highlightsOf(l: LiveLine, bat: boolean, starter: boolean): { t: string; d: string; hi: number }[] {
  const A: [boolean, string, string, number][] = !bat
    ? [
      [l.pK >= 10, '單場 10 K', '單場 10 次以上三振', 4],
      [starter && l.outs >= 18 && l.pEr === 0, '6 局 0 責失', '先發 6 局以上、0 自責分', 3],
      [l.sv > 0, '救援成功', '拿下救援成功', 6],
      [l.w > 0, '勝投', '拿下勝投', 5],
    ]
    : [
      [l.hr >= 1, '開轟', '單場至少 1 支全壘打', 4],
      [l.h >= 3, '猛打賞', '單場 3 支安打以上', 2],
      [l.bb >= 3, '單場 3 保送', '單場 3 次以上保送', 5],
    ]
  return A.filter((a) => a[0]).map(([, t, d, hi]) => ({ t, d, hi }))
}

function hlCard(s: SeriesView, g: LiveGame, no: number, t: number, l: LiveLine, bat: boolean, lines: LiveLine[], owner: string): HlCard | null {
  const got = highlightsOf(l, bat, !bat && isStarter(l, lines))
  if (!got.length) return null
  const tm = cpblTeam(l.cpblTeam)
  const hiSet = new Set(got.map((a) => a.hi))
  const heads = bat ? ['PA', 'AB', 'H', 'R', 'HR', 'BB'] : ['IP', 'H', 'BB', 'ER', 'K', 'W', 'SV']
  const raw: (string | number)[] = bat ? [l.pa, l.ab, l.h, l.r, l.hr, l.bb] : [ip(l.outs), l.pH, l.pBb, l.pEr, l.pK, l.w, l.sv]
  const cells = raw.map((x, i): Cell => {
    const hi = hiSet.has(i) || (!bat && hiSet.has(3) && i === 0)
    return { v: String(x), c: hi ? '#ffd9da' : x === 0 || x === '–' ? DIM : WHITE }
  })
  const main = got[0].t
  const ml = main.replace(/ /g, '').length
  const more = got.slice(1).map((a) => a.t).join('・')
  const score = `${side(g.awayTeam).s} ${scoreOf(g, g.awayTeam)}：${scoreOf(g, g.homeTeam)} ${side(g.homeTeam).s}`
  const stat = bat ? batTxt(l) : pitTxt(l)
  const achText = got.map((a) => a.t).join('＋')
  return {
    id: `h-${g.id}-${l.playerId}-${bat ? 'b' : 'p'}`, kind: 'hl', t, label: KIND_LABEL.hl, serie: s.name, serieS: `${s.name} G${no}`,
    dateS: md(g.scheduledDate), no, dateL: mdw(g.scheduledDate), main, mainFs: ml <= 2 ? '32px' : ml <= 4 ? '28px' : '24px',
    more: more ? `＋ ${more}` : '', hasMore: !!more, achText,
    p: {
      num: l.jerseyNumber ?? '', n: l.name, pos: bat ? l.listedPosition : isStarter(l, lines) ? 'SP' : 'RP', ts: tm.short, bg: tm.bg, fg: tm.fg,
      glow: `${tm.bg}55`, grad: `linear-gradient(180deg,#fff4ea 0%,#ffe2cf 38%,${tm.bg} 100%)`,
    },
    stat, score, nCols: heads.length, heads, cells, achList: got.map((a) => ({ t: a.t, d: a.d })), ls: lsOf(g),
    owner: `當天在你的名單上・${owner}`,
    cap1: `${l.name}・${got.map((a) => a.t).join('・')}`, cap2: `${mdw(g.scheduledDate)}・${s.name} 第 ${no} 戰`,
    desc: `${l.name}在${s.name}第 ${no} 戰${got.map((a) => a.t).join('、')}（${stat}）。他當天在你的名單上，所以你得到這張限定卡。`,
  }
}

function champCard(s: SeriesView, games: LiveGame[], t: number, runAfter: (i: number) => Record<string, number>, year: string, format: string): ChampCard | null {
  if (!s.winner || games.length === 0) return null
  const [tA, tB] = s.teams
  const win = s.winner, lose = win === tA ? tB : tA
  const tm = cpblTeam(win), isFinals = s.kind === 'C'
  const lastG = games[games.length - 1]
  const final = runAfter(games.length - 1)

  // 系列戰 MVP：勝隊球員的最佳球員評分加總最高者（打者投手一起比）
  const B = new Map<number, { l: LiveLine; g: number; ab: number; pa: number; h: number; r: number; hr: number; bb: number; sc: number }>()
  const P = new Map<number, { l: LiveLine; g: number; outs: number; h: number; bb: number; er: number; k: number; w: number; sv: number; sc: number }>()
  for (const g of games) {
    for (const l of linesOf(s, g)) {
      if (l.cpblTeam !== win) continue
      if (isBatLine(l)) {
        const x = B.get(l.playerId) ?? { l, g: 0, ab: 0, pa: 0, h: 0, r: 0, hr: 0, bb: 0, sc: 0 }
        x.g++; x.ab += l.ab; x.pa += l.pa; x.h += l.h; x.r += l.r; x.hr += l.hr; x.bb += l.bb; x.sc += batScore(l); B.set(l.playerId, x)
      }
      if (isPitLine(l)) {
        const x = P.get(l.playerId) ?? { l, g: 0, outs: 0, h: 0, bb: 0, er: 0, k: 0, w: 0, sv: 0, sc: 0 }
        x.g++; x.outs += l.outs; x.h += l.pH; x.bb += l.pBb; x.er += l.pEr; x.k += l.pK; x.w += l.w; x.sv += l.sv; x.sc += pitScore(l); P.set(l.playerId, x)
      }
    }
  }
  const bb = [...B.values()].sort((a, b) => b.sc - a.sc)[0], pp = [...P.values()].sort((a, b) => b.sc - a.sc)[0]
  if (!bb && !pp) return null
  const useP = !!pp && (!bb || pp.sc > bb.sc)
  const mvp = useP && pp
    ? { num: pp.l.jerseyNumber ?? '', n: pp.l.name, ts: tm.short, bg: tm.bg, fg: tm.fg, nCols: 7, heads: ['IP', 'H', 'BB', 'ER', 'K', 'W', 'SV'],
        txt: `${pp.g} 場 ${ipShort(pp.outs)} 局 ${pp.k} K 自責 ${pp.er} 分${pp.w ? ` ${pp.w} 勝` : ''}`,
        cells: [ip(pp.outs), pp.h, pp.bb, pp.er, pp.k, pp.w, pp.sv].map(String) }
    : { num: bb.l.jerseyNumber ?? '', n: bb.l.name, ts: tm.short, bg: tm.bg, fg: tm.fg, nCols: 6, heads: ['PA', 'AB', 'H', 'R', 'HR', 'BB'],
        txt: `${bb.g} 場 ${bb.ab} 打數 ${bb.h} 安 ${bb.hr} 轟 ${bb.r} 得分`, cells: [bb.pa, bb.ab, bb.h, bb.r, bb.hr, bb.bb].map(String) }

  const sd = (g: LiveGame, code: string): ScoreSide => {
    const R = scoreOf(g, code), oR = scoreOf(g, code === g.homeTeam ? g.awayTeam : g.homeTeam), c = cpblTeam(code)
    return { s: c.short, bg: c.bg, fg: c.fg, R: String(R), col: R > oR ? '#f6efe0' : '#6c7584' }
  }
  const glist = games.map((g, i) => {
    const r = runAfter(i)
    return { t: `G${i + 1}`, d: md(g.scheduledDate), a: sd(g, g.awayTeam), h: sd(g, g.homeTeam), after: `${side(tA).s} ${r[tA]}：${r[tB]}` }
  })
  const boxes = [
    ...(s.advantageTeam ? [{ t: '保送', sc: '1勝', dot: cpblTeam(s.advantageTeam).bg }] : []),
    ...games.map((g, i) => {
      const w = winnerOf(g)
      return { t: `G${i + 1}`, sc: `${Math.max(scoreOf(g, g.awayTeam), scoreOf(g, g.homeTeam))}:${Math.min(scoreOf(g, g.awayTeam), scoreOf(g, g.homeTeam))}`, dot: w ? cpblTeam(w).bg : 'transparent' }
    }),
  ]
  const fullTitle = isFinals ? `${year} 總冠軍` : '晉級台灣大賽'
  const score = `${final[win]}：${final[lose]}`
  return {
    id: `c-${s.kind}`, kind: 'champ', t, label: KIND_LABEL.champ, serie: s.name,
    title: isFinals ? '總冠軍' : '晉級台灣大賽', titleTop: isFinals ? `${year} TAIWAN SERIES` : `${year} 季後挑戰賽`, titleFs: isFinals ? '46px' : '30px',
    fullTitle, vs: side(lose).s, dateL: mdw(lastG.scheduledDate),
    team: { s: tm.short, n: tm.name, bg: tm.bg, fg: tm.fg, deep: DEEP[win] ?? darken(tm.bg), glow: `${tm.bg}80` },
    score, scoreNote: s.advantageTeam ? '含保送 1 勝' : format, games: boxes, glist, hasBye: !!s.advantageTeam,
    byeT: s.advantageTeam ? `${side(s.advantageTeam).s}保送 1 勝，系列戰從 1：0 開始` : '', mvp,
    cap1: `${tm.short} ${fullTitle}`, cap2: `${mdw(lastG.scheduledDate)}・${s.name}系列戰 ${score}`,
    desc: `${tm.name}以 ${score} ${isFinals ? `拿下 ${year} 台灣大賽總冠軍` : '贏下季後挑戰賽，晉級台灣大賽'}。系列戰 MVP 是${mvp.n}，依系列戰數據自動選出。聯盟裡每位玩家都會收到這張。`,
  }
}

/** 賽制文字，例如「七戰四勝」「四戰三勝」 */
export function formatOf(s: SeriesView): string {
  const games = s.winsNeeded * 2 - 1 - (s.advantageTeam ? 1 : 0)
  return games === 7 ? '七戰四勝' : `${games} 戰${s.winsNeeded} 勝`
}

/**
 * @param myTeamId   自己的 fantasy 隊伍（高光限定卡只發給比賽當天名單上有該球員的人）
 * @param myTeamName 卡背「當天在你的名單上・隊名」用
 */
export function deriveCards(view: PostseasonView, myTeamId: number | null, myTeamName: string): DerivedCards {
  const year = view.today.slice(0, 4)
  // 所有結束的比賽依開賽時間排序號：卡片「新的在前」用
  const allFinal = view.series.flatMap((s) => s.games.filter((g) => g.status === 'FINAL')).sort(byOrder)
  const tOf = new Map<number, number>(allFinal.map((g, i) => [g.id, i]))

  const flat: PsCardData[] = []
  const groups: SeriesGroup[] = []

  for (const s of view.series) {
    const format = formatOf(s)
    const games = [...s.games].sort(byOrder).filter((g) => g.status === 'FINAL')
    const [tA, tB] = s.teams
    // 到第 i 場為止的系列戰比分（含保送）
    const runAfter = (i: number) => {
      const w: Record<string, number> = { [tA]: 0, [tB]: 0 }
      if (s.advantageTeam && s.advantageTeam in w) w[s.advantageTeam]++
      games.slice(0, i + 1).forEach((g) => { const x = winnerOf(g); if (x && x in w) w[x]++ })
      return w
    }
    const gameCards: GameCard[] = []
    games.forEach((g, i) => {
      const t = tOf.get(g.id) ?? i
      const no = [...s.games].sort(byOrder).indexOf(g) + 1
      const gc = gameCard(s, g, no, t, runAfter(i), format)
      gameCards.push(gc)
      flat.push(gc)
      const lines = linesOf(s, g)
      for (const l of lines) {
        if (myTeamId == null || l.gameDayTeamId !== myTeamId) continue
        // 既打擊又投球的球員，打擊和投球各自判定
        for (const bat of [true, false]) {
          if (bat ? !isBatLine(l) : !isPitLine(l)) continue
          const hc = hlCard(s, g, no, t, l, bat, lines, myTeamName)
          if (hc) flat.push(hc)
        }
      }
    })
    const lastT = games.length ? (tOf.get(games[games.length - 1].id) ?? games.length - 1) : 0
    const cc = champCard(s, games, lastT, runAfter, year, format)
    if (cc) flat.push(cc)

    const wa = runAfter(games.length - 1)
    const winnerS = s.winner ? side(s.winner).s : ''
    const dates = games.length ? `${md(games[0].scheduledDate)}–${md(games[games.length - 1].scheduledDate)}` : ''
    groups.push({
      kind: s.kind, title: s.name, cards: gameCards.reverse(),
      sub: `${side(tA).s} ${wa[tA]}：${wa[tB]} ${side(tB).s}・${s.winner ? `${winnerS}${s.kind === 'C' ? '奪冠' : '晉級'}` : '進行中'}${s.advantageTeam ? '（含保送 1 勝）' : ''}${dates ? `・${dates}` : ''}`,
    })
  }
  groups.reverse() // 新的系列在前

  flat.sort((a, b) => b.t - a.t || KORD[a.kind] - KORD[b.kind])
  const byId: Record<string, PsCardData> = {}
  flat.forEach((c) => { byId[c.id] = c })
  const order = flat.slice().sort((a, b) => a.t - b.t || KORD[b.kind] - KORD[a.kind])
  return {
    flat, byId, order, groups,
    champs: flat.filter((c): c is ChampCard => c.kind === 'champ'),
    hls: flat.filter((c): c is HlCard => c.kind === 'hl'),
  }
}

// ---------------------------------------------------------------------------
// 已看過的卡（只存在這個瀏覽器；丟了就當成全部是新卡）
// ---------------------------------------------------------------------------

const seenKey = (leagueId: number, userId: number) => `postseason-seen:${leagueId}:${userId}`

export function loadSeen(leagueId: number, userId: number): Set<string> {
  try {
    const raw = localStorage.getItem(seenKey(leagueId, userId))
    return new Set(raw ? (JSON.parse(raw) as string[]) : [])
  } catch { return new Set() }
}

export function saveSeen(leagueId: number, userId: number, seen: Set<string>) {
  try { localStorage.setItem(seenKey(leagueId, userId), JSON.stringify([...seen])) } catch { /* 無法儲存就只在這次有效 */ }
}


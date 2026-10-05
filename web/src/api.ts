export class ApiError extends Error {
  status: number
  constructor(status: number, message: string) {
    super(message)
    this.status = status
  }
}

async function request<T>(method: string, path: string, body?: unknown): Promise<T> {
  const res = await fetch(path, {
    method,
    credentials: 'same-origin',
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await res.text()
  const data = text ? JSON.parse(text) : null
  if (!res.ok) {
    throw new ApiError(res.status, (data && data.error) || `HTTP ${res.status}`)
  }
  return data as T
}

export const api = {
  get: <T,>(path: string) => request<T>('GET', path),
  post: <T,>(path: string, body?: unknown) => request<T>('POST', path, body ?? {}),
  put: <T,>(path: string, body?: unknown) => request<T>('PUT', path, body ?? {}),
  patch: <T,>(path: string, body?: unknown) => request<T>('PATCH', path, body ?? {}),
  del: <T,>(path: string) => request<T>('DELETE', path),
}

export interface User {
  id: number
  username: string
  displayName: string
  admin: boolean
}

export interface SystemInfo {
  now: string
  today: string
  demo: boolean
  source: string
  seasonYear: number
}

export interface Membership {
  leagueId: number
  leagueName: string
  teamId: number
  teamName: string
  commissioner: boolean
}

export type SlotName = 'IF' | 'OF' | 'UTIL' | 'SP' | 'RP' | 'BN' | 'NA'
export const STARTING_SLOTS: SlotName[] = ['IF', 'OF', 'UTIL', 'SP', 'RP']
export const ALL_SLOTS: SlotName[] = ['IF', 'OF', 'UTIL', 'SP', 'RP', 'BN', 'NA']

export interface PlayerStatus {
  code: 'ACTIVE' | 'IDLE' | 'MINORS' | 'DELISTED'
  text: string
  earliestReturn: string | null
}

export interface TeamView {
  id: number
  name: string
  abbr: string
  userId: number
  owner: string
  faabBudget: number
  lineupLockReason: string | null
  /** 動物頭像名稱（teamIdentity.TEAM_ICONS）；舊資料為 null */
  icon: string | null
  /** 代表色 #rrggbb；舊資料為 null（依順序配色） */
  color: string | null
}

/** 邀請碼預覽（公開，註冊前） */
export interface InvitePreview {
  leagueName: string
  commissioner: string
  teamCount: number
  maxTeams: number
  seasonStarted: boolean
  teams: { name: string; icon: string | null; color: string | null }[]
}

export interface Half {
  id: number
  halfNo: number
  startDate: string
  endDate: string
  status: string
  championTeamId: number | null
}

export interface Period {
  id: number
  halfId: number
  halfNo: number
  periodNo: number
  kind: 'REGULAR' | 'FINAL'
  startDate: string
  endDate: string
  status: 'UPCOMING' | 'ACTIVE' | 'PROVISIONAL' | 'LOCKED'
  locksAt: string | null
}

export interface League {
  id: number
  name: string
  seasonYear: number
  /** 建立聯盟的回應會帶；一般讀取請用 LeagueDetail.inviteCode（只有管理員看得到） */
  inviteCode?: string
  maxTeams: number
  foreignPlayerLimit: number
  positionMinGames: number
  spMinStarts: number
  eligibilityGraceDays: number
  faabBudgetPerHalf: number
  slotsNa: number
  minorsReturnDays: number
  foreignMinorsReturnDays: number
  hitterIdleGameDays: number
  pitcherIdleDays: number
  waiverDays: number
  tradeReviewHours: number
  matchupLockHours: number
  keeperLimit: number
  draftRounds: number
  draftPickSeconds: number
  refundFaabOnDelist: boolean
  championTeamId: number | null
  championNote: string | null
  commissionerUserId: number
}

export interface LeagueDetail {
  league: League
  inviteCode: string | null
  commissioner: boolean
  myTeamId: number | null
  teams: TeamView[]
  halves: Half[]
  periods: Period[]
  currentPeriod: Period | null
  today: string
}

export interface CategoryResult {
  category: string
  label: string
  a: string
  b: string
  winner: 'A' | 'B' | 'TIE' | 'NO_DATA'
}

export interface Matchup {
  id: number
  periodId: number
  halfNo: number
  periodNo: number
  kind: 'REGULAR' | 'FINAL'
  start: string
  end: string
  teamA: number | null
  teamAName: string | null
  teamB: number | null
  teamBName: string | null
  scoreA: number | null
  scoreB: number | null
  result: 'A_WIN' | 'B_WIN' | 'TIE' | null
  status: 'PENDING' | 'LIVE' | 'PROVISIONAL' | 'LOCKED'
  locksAt: string | null
  categories: CategoryResult[]
  note: string | null
}

export interface StatTotals {
  ab: number
  h: number
  r: number
  hr: number
  /** 打者保送（投手被保送為 pBb） */
  bb: number
  outs: number
  er: number
  pH: number
  pBb: number
  k: number
  sv: number
  w: number
  qs: number
}

export interface Contribution {
  playerId: number
  name: string
  cpblTeam: string
  jerseyNumber: string | null
  slots: string
  totals: StatTotals
}

export interface MatchupDetail {
  matchup: Matchup
  playersA?: Contribution[]
  playersB?: Contribution[]
  /** playerId → 本季排名（球員卡金銀銅框用） */
  ranks?: Record<string, number>
}

export interface TodayGame {
  gameId: number
  opponent: string
  home: boolean
  startTime: string | null
  status: string
  /** 以該球員所屬球隊為準 */
  teamScore: number | null
  oppScore: number | null
  /** 進行中才有，例：7上 */
  inning: string | null
}

export interface TodayStats {
  pitched: boolean
  ab: number
  h: number
  hr: number
  bb: number
  r: number
  outs: number
  er: number
  k: number
  sv: number
  w: number
}

export interface TodayLine {
  text: string
  live: boolean
  stats: TodayStats
}

export interface RosterPlayer {
  playerId: number
  name: string
  cpblTeam: string
  jerseyNumber: string | null
  foreign: boolean
  listedPosition: string
  slot: SlotName
  eligible: SlotName[]
  status: PlayerStatus
  locked: boolean
  pendingFrom: string | null
  leavingOn: string | null
  game: TodayGame | null
  period: Record<string, string> | null
  today: TodayLine | null
  season: Record<string, string>
  /** 本季排名（金銀銅框用） */
  rank: number | null
}

export interface RosterResponse {
  teamId: number
  teamName: string
  faabBudget: number
  lineupLockReason: string | null
  today: string
  slotCounts: Record<SlotName, number>
  rosterSize: number
  foreignLimit: number
  period: Period | null
  players: RosterPlayer[]
}

export interface PlayerRow {
  playerId: number
  name: string
  cpblTeam: string
  jerseyNumber: string | null
  foreign: boolean
  eligible: SlotName[]
  status: PlayerStatus
  ownerTeam: string | null
  ownerTeamId: number | null
  onWaivers: boolean
  waiverClears: string | null
  rank: number
  score: number
  stats: Record<string, string>
}

export interface StandingRow {
  teamId: number
  teamName: string
  abbr: string
  owner: string
  wins: number
  losses: number
  ties: number
  pct: number
  pointsFor: number
  pointsAgainst: number
  provisional: number
  rank: number
}

export interface DraftPick {
  pickNo: number
  round: number
  teamId: number
  teamName: string
  playerId: number | null
  playerName: string | null
  playerTeam: string | null
  keeper: boolean
  auto: boolean
}

export interface DraftView {
  id: number
  halfNo: number
  status: 'SETUP' | 'KEEPERS' | 'IN_PROGRESS' | 'COMPLETED'
  rounds: number
  pickSeconds: number
  currentPickNo: number
  currentTeamId: number | null
  deadline: string | null
  secondsLeft: number
  order: number[]
  picks: DraftPick[]
  myKeepers: { playerId: number; name: string; round: number }[]
}

export interface Trade {
  id: number
  proposerTeamId: number
  proposerName: string
  receiverTeamId: number
  receiverName: string
  status: string
  message: string | null
  resultNote: string | null
  createdAt: string
  reviewEndsAt: string | null
  items: { playerId: number; playerName: string; fromTeamId: number }[]
  objections: number
  eligibleVoters: number
  myObjection: boolean
}

export interface Claim {
  id: number
  teamId: number
  teamName: string
  playerId: number
  playerName: string
  dropPlayerId: number | null
  dropPlayerName: string | null
  faabBid: number
  status: string
  resultNote: string | null
  createdAt: string
  processedAt: string | null
}

export interface Notification {
  id: number
  message: string
  createdAt: string
  read: boolean
}

export interface FeedItem {
  kind: 'HOT' | 'MOVE' | 'GAME' | 'LEAGUE'
  playerId: number | null
  playerName: string | null
  cpblTeam: string | null
  jerseyNumber: string | null
  text: string
  at: string | null
  live: boolean
}

export interface EligibilityProgress {
  listedPosition: string
  halfNo: number
  graceUntil: string
  inGrace: boolean
  minGames: number
  minStarts: number
  ifGames: number
  ofGames: number
  batGames: number
  starts: number
  reliefs: number
}

/** 逐局比分；未進行的局為 null，Rhe 為得分、安打、失誤 */
export interface LineScore {
  away: (number | null)[]
  home: (number | null)[]
  awayRhe: (number | null)[]
  homeRhe: (number | null)[]
}

/** 即時頁（GET /api/live）的一場比賽 */
export interface LiveGame {
  id: number
  sno: number
  status: 'SCHEDULED' | 'IN_PROGRESS' | 'FINAL' | 'POSTPONED' | 'SUSPENDED' | 'CANCELLED'
  statsFinal: boolean
  scheduledDate: string
  playDate: string
  startTime: string | null
  homeTeam: string
  awayTeam: string
  /** 進行中為即時比分，結束後為最終比分 */
  homeScore: number | null
  awayScore: number | null
  inning: string | null
  fetchedAt: string | null
  lineScore: LineScore | null
  /** 目前打者、投手（player id），進行中才有 */
  batterId: number | null
  pitcherId: number | null
  pitchCount: number | null
  /** 目前打者本場結果代碼 */
  batterResults: string[] | null
  /** 本半局打席；正在打擊的 result 為 null */
  halfInning: { jerseyNumber: string; name: string; result: string | null }[] | null
  /** 進階數據網站的這場比賽（來源標示）；模擬賽季為 null */
  sourceUrl: string | null
}

/** 一位球員在一場比賽的數據（依 box score 順序） */
export interface LiveLine {
  gameId: number
  playerId: number
  name: string
  jerseyNumber: string | null
  cpblTeam: string
  listedPosition: string
  home: boolean
  batted: boolean
  pitched: boolean
  /** 棒次 1～9，替補沿用被替換者的棒次 */
  lineupSlot: number | null
  sub: boolean
  seq: number
  pa: number; ab: number; h: number; r: number; hr: number; bb: number
  outs: number; pH: number; pBb: number; pEr: number; pK: number; w: number; sv: number
  /** true 為結算後的正式數據 */
  settled: boolean
  changedAt: string | null
  fantasyTeamId: number | null
  rosterSlot: SlotName | null
}

export interface LiveStarter {
  playerId: number
  name: string
  jerseyNumber: string | null
  cpblTeam: string
  listedPosition: string
  fantasyTeamId: number
  rosterSlot: SlotName
}

export interface LiveView {
  notice: string
  today: string
  myTeamId: number | null
  opponentTeamId: number | null
  games: LiveGame[]
  lines: LiveLine[]
  starters: LiveStarter[]
}

/** 收藏卡（GET /leagues/:id/players/:pid/card）：卡面數據、本聯盟的卡片履歷與成就印章 */
export interface CardData {
  playerId: number
  name: string
  jerseyNumber: string | null
  cpblTeam: string
  pos: string
  pitcher: boolean
  rank: number | null
  totalRanked: number
  /** 紋路種子（球員 ID） */
  seed: number
  line: string
  stats: { k: string; v: string }[]
  /** tone：team 取得或轉隊（teamId 上隊伍色）、gold MVP 與高光、muted 釋出 */
  hist: { date: string; label: string; tone: 'team' | 'gold' | 'muted'; teamId: number | null }[]
  /** date 為首次達成日，未達成為 null */
  stamps: { label: string; date: string | null }[]
}

export interface PlayerDetail {
  player: { id: number; name: string; team: string; foreign: boolean; listedPosition: string; jerseyNumber: string | null }
  today: string
  ranges: Record<'season' | '14d' | '7d', Record<string, string>>
  rank: number | null
  categoryRanks: Record<string, number | null>
  schedule: { play_date: string; scheduled_date: string; actual_play_date: string | null; status: string; start_time: string | null; opponent: string; home: boolean }[]
  status?: PlayerStatus
  eligible?: SlotName[]
  eligibilityProgress?: EligibilityProgress
  feed?: FeedItem[]
  league?: {
    ownerTeamId: number | null
    ownerTeamName: string | null
    availability: 'ROSTERED' | 'WAIVERS' | 'FREE_AGENT'
    acquiredVia: string | null
    draftRound: number | null
    teams: number
    adds7d: number
    drops7d: number
  }
  newsEnabled: boolean
  news: { title: string; source: string; publishedAt: string; url: string }[]
  nameHistory: { old_name: string; new_name: string; changed_at: string }[]
  statusLog: { field: string; old_value: string | null; new_value: string; effective_date: string }[]
  gameLog: Record<string, string | number | boolean>[]
}

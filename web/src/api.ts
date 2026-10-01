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
  rbi: number
  sb: number
  outs: number
  er: number
  pH: number
  pBb: number
  k: number
  sv: number
  hld: number
  qs: number
}

export interface Contribution {
  playerId: number
  name: string
  cpblTeam: string
  slots: string
  totals: StatTotals
}

export interface TodayGame {
  gameId: number
  opponent: string
  home: boolean
  startTime: string | null
  status: string
}

export interface TodayLine {
  text: string
  live: boolean
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

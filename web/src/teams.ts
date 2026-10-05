/**
 * 中職六隊的介面呈現（CPBLF-72 / 規則書 10.2）。
 *
 * 一律以自訂色塊 + 隊名縮寫呈現，不引用任何官方 logo、隊徽、球員照片或官方配色規範。
 * 色票為本專案自訂，僅用於區分隊伍。
 */
export interface CpblTeamStyle {
  code: string
  short: string
  /** 球隊全名（比賽卡用） */
  name: string
  bg: string
  fg: string
}

export const CPBL_TEAMS: Record<string, CpblTeamStyle> = {
  BRO: { code: 'BRO', short: '兄弟', name: '中信兄弟', bg: '#d9a400', fg: '#1a1a1a' },
  UNI: { code: 'UNI', short: '統一', name: '統一7-ELEVEn獅', bg: '#e8742a', fg: '#ffffff' },
  RAK: { code: 'RAK', short: '樂天', name: '樂天桃猿', bg: '#8a1f3d', fg: '#ffffff' },
  FUB: { code: 'FUB', short: '富邦', name: '富邦悍將', bg: '#1f4fa3', fg: '#ffffff' },
  WEI: { code: 'WEI', short: '味全', name: '味全龍', bg: '#c8323b', fg: '#ffffff' },
  TSG: { code: 'TSG', short: '台鋼', name: '台鋼雄鷹', bg: '#1b7a6e', fg: '#ffffff' },
}

export function cpblTeam(code: string | null | undefined): CpblTeamStyle {
  return (code && CPBL_TEAMS[code]) || { code: code || '?', short: code || '?', name: code || '?', bg: '#777', fg: '#fff' }
}

/**
 * Fantasy 隊伍（玩家隊伍）的識別色，用於票根色條、戰績表左側色條。與中職球隊無關。
 * 隊伍在加入聯盟時選了代表色就用它；沒選的（舊資料、demo）依隊伍 id 排序後輪流套用色盤。
 */
const FANTASY_PALETTE = ['#7b8cff', '#e8603c', '#3cb4c8', '#a77be0', '#78c27a']

export function fantasyTeamColor(teamId: number | null | undefined, teams: { id: number; color?: string | null }[]): string {
  if (teamId == null) return '#3a404c'
  const chosen = teams.find((t) => t.id === teamId)?.color
  if (chosen) return chosen
  const i = teams.map((t) => t.id).sort((a, b) => a - b).indexOf(teamId)
  return i < 0 ? '#3a404c' : FANTASY_PALETTE[i % FANTASY_PALETTE.length]
}

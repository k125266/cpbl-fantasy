/**
 * 中職六隊的介面呈現（CPBLF-72 / 規則書 10.2）。
 *
 * 一律以自訂色塊 + 隊名縮寫呈現，不引用任何官方 logo、隊徽、球員照片或官方配色規範。
 * 色票為本專案自訂，僅用於區分隊伍。
 */
export interface CpblTeamStyle {
  code: string
  short: string
  bg: string
  fg: string
}

export const CPBL_TEAMS: Record<string, CpblTeamStyle> = {
  BRO: { code: 'BRO', short: '兄弟', bg: '#d9a400', fg: '#1a1a1a' },
  UNI: { code: 'UNI', short: '統一', bg: '#e8742a', fg: '#ffffff' },
  RAK: { code: 'RAK', short: '樂天', bg: '#8a1f3d', fg: '#ffffff' },
  FUB: { code: 'FUB', short: '富邦', bg: '#1f4fa3', fg: '#ffffff' },
  WEI: { code: 'WEI', short: '味全', bg: '#c8323b', fg: '#ffffff' },
  TSG: { code: 'TSG', short: '台鋼', bg: '#1b7a6e', fg: '#ffffff' },
}

export function cpblTeam(code: string | null | undefined): CpblTeamStyle {
  return (code && CPBL_TEAMS[code]) || { code: code || '?', short: code || '?', bg: '#777', fg: '#fff' }
}

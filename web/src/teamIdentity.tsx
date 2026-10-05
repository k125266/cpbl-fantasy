import { Bird, Bug, BugBeetle, Butterfly, Cat, Cow, Dog, Fish, Horse, PawPrint, Rabbit, Shrimp, type Icon } from '@phosphor-icons/react'

/**
 * 隊伍的動物頭像與代表色（設計稿「登入與加入聯盟」）。名稱與後端 LeagueService.ICONS / COLORS 一致。
 * 一般動物圖示（Phosphor Icons，MIT），不是球隊隊徽或吉祥物（規則書 10.2）。
 */
export const TEAM_ICONS: Record<string, Icon> = {
  bird: Bird, cat: Cat, dog: Dog, rabbit: Rabbit, horse: Horse, cow: Cow,
  fish: Fish, butterfly: Butterfly, shrimp: Shrimp, 'bug-beetle': BugBeetle, bug: Bug, 'paw-print': PawPrint,
}

export const TEAM_ICON_NAMES = Object.keys(TEAM_ICONS)

export const TEAM_COLORS = ['#7b8cff', '#e8603c', '#3cb4c8', '#a77be0', '#78c27a', '#e86a9a', '#c9d65a', '#e8a23c']

/** 隊伍頭像；沒有設定時用腳印。 */
export function TeamIcon({ icon, color, size = 24 }: { icon: string | null | undefined; color?: string; size?: number }) {
  const C = (icon && TEAM_ICONS[icon]) || PawPrint
  return <C weight="fill" size={size} color={color ?? 'currentColor'} aria-hidden="true" />
}

/** #rrggbb → rgba(r,g,b,a) */
export function alpha(hex: string, a: number): string {
  const n = parseInt(hex.slice(1), 16)
  return `rgba(${n >> 16},${(n >> 8) & 255},${n & 255},${a})`
}

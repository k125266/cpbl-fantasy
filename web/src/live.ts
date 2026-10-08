import type { LiveGame } from './api'

/** 即時比分頁與季後賽專區共用的小工具 */

/** 出局數換成局數：19 → "6.1" */
export const ip = (outs: number) => `${Math.floor(outs / 3)}.${outs % 3}`

/** 官網沒有出局數，從本半局的打席結果代碼推算；盜壘刺、牽制出局不在打席結果裡，可能少算 */
export const OUTS_HINT = '出局數依本半局打席結果推算，不含盜壘刺與牽制出局'
export function outsOf(g: LiveGame): number | null {
  if (!g.halfInning || g.halfInning.length === 0) return null
  let n = 0
  for (const { result: r } of g.halfInning) {
    if (r == null) continue
    if (r === '三殺') n += 3
    else if (r === '雙殺') n += 2
    else if (r === '三振' || r === '犧短' || r === '犧飛' || /^[投捕一二三游左中右](飛|滾|平|界飛|短)$/.test(r)) n += 1
  }
  return Math.min(n, 3)
}

/** 官網賽事代碼的名稱（賽制在後端 application.yml 的 postseason-series） */
export const KIND_NAME: Record<string, string> = { E: '季後挑戰賽', C: '台灣大賽' }

import { useCallback, useState } from 'react'
import { loadSeen, saveSeen } from './cards'

/** 已打開過的紀念卡（只存在這個瀏覽器，丟了就當成全部是新卡）。 */
export function useSeenCards(leagueId: number, userId: number) {
  const [seen, setSeen] = useState<Set<string>>(() => loadSeen(leagueId, userId))
  const mark = useCallback((id: string) => {
    setSeen((prev) => {
      if (prev.has(id)) return prev
      const next = new Set(prev)
      next.add(id)
      saveSeen(leagueId, userId, next)
      return next
    })
  }, [leagueId, userId])
  return { seen, mark }
}

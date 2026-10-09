import { useCallback, useEffect, useMemo, useState } from 'react'
import { useApp } from '../App'
import { api, type PostseasonView, type SeriesView } from '../api'
import { ErrorBox, Loading } from '../components'
import { deriveCards } from '../postseason/cards'
import CardsSection from '../postseason/CardsSection'
import Leaders from '../postseason/Leaders'
import MinePanel from '../postseason/MinePanel'
import Recaps from '../postseason/Recaps'
import SeriesCard from '../postseason/SeriesCard'
import { useCountdown } from '../hooks'
import { buildCtx, mdw, SERVED } from '../postseason/shared'
import TodayCard from '../postseason/TodayCard'
import { useSeenCards } from '../postseason/useSeenCards'

/**
 * 季後賽專區（設計稿「台灣大賽專區 v2」精簡＋收合）：季後挑戰賽、台灣大賽的系列戰比分、今天這一戰、
 * 你的球員（只標示）、系列戰排行、每場戰況卡。季後賽不計入 fantasy，沒有預測、投票或計分。
 *
 * <p>這個檔案只負責載入資料、選系列、自動更新與頁首；各區塊在 web/src/postseason/。
 * 數據取自即時快照（非最終數據）；沒有好壞球數、壘包與球場（資料源沒有），改顯示本半局出局數推算。
 */

const REFRESH = 60

function clock(d: Date) {
  const p = (n: number) => String(n).padStart(2, '0')
  return `${p(d.getHours())}:${p(d.getMinutes())}:${p(d.getSeconds())}`
}

export default function PostseasonPage() {
  const { leagueId, league, user } = useApp()
  const [data, setData] = useState<PostseasonView | null>(null)
  const [error, setError] = useState<unknown>(null)
  const [upd, setUpd] = useState('')
  const [failed, setFailed] = useState(false)
  const { sec, restart } = useCountdown(REFRESH)
  const [kind, setKind] = useState<string | null>(null)

  const load = useCallback(() => {
    api.get<PostseasonView>(`/api/postseason?leagueId=${leagueId}`)
      .then((v) => { setData(v); setError(null); setFailed(false); setUpd(clock(new Date())) })
      .catch((e) => { setError(e); setFailed(true) })
    restart()
  }, [leagueId, restart])

  useEffect(() => { load() }, [load])

  const teams = useMemo(() => league?.teams ?? [], [league])
  const { seen, mark } = useSeenCards(leagueId, user.id)
  const cards = useMemo(() => {
    if (!data) return null
    return deriveCards(data, data.myTeamId, teams.find((t) => t.id === data.myTeamId)?.name ?? '')
  }, [data, teams])

  // 預設系列：已開打的最後一個；都還沒開打就是第一個
  const series: SeriesView | null = useMemo(() => {
    if (!data || data.series.length === 0) return null
    const started = data.series.filter((s) => s.games.some((g) => g.scheduledDate <= data.today))
    return data.series.find((s) => s.kind === kind) ?? started[started.length - 1] ?? data.series[0]
  }, [data, kind])

  // 今天還有比賽沒打完才每 60 秒自動更新
  const active = !!series && !!data && series.games.some((g) => g.playDate === data.today && SERVED(g) && g.status !== 'FINAL')
  useEffect(() => { if (active && sec === 0) load() }, [active, sec, load])

  if (error && !data) return <ErrorBox error={error} />
  if (!data) return <Loading />
  if (!series) {
    return (
      <div className="lv pv">
        <div className="pv-head"><div className="t"><div className="pv-kick gold">POSTSEASON</div><div className="pv-title"><h1>季後賽專區</h1></div></div></div>
        <div className="pv-card pv-series"><div className="pv-empty">季後賽還沒有賽程。季後挑戰賽、台灣大賽排定後，這裡會出現系列戰比分、每場戰況與排行（季後賽不計入 fantasy）。</div></div>
      </div>
    )
  }

  const ctx = buildCtx(data, series, teams)
  const { s, live, isFinals, year } = ctx
  const anyLive = data.series.some((x) => x.games.some((g) => g.status === 'IN_PROGRESS'))
  const games = s.winsNeeded * 2 - 1 - (s.advantageTeam ? 1 : 0)
  const format = games === 7 ? '七戰四勝' : `${games} 戰${s.winsNeeded} 勝`
  const newCards = cards ? cards.flat.filter((c) => !seen.has(c.id)).length : 0
  const ring = `conic-gradient(var(--gold) ${Math.round((sec / REFRESH) * 360)}deg, var(--line) 0)`

  return (
    <div className="lv pv">
      <div className="pv-head">
        <div className="t">
          {live || anyLive
            ? <div className="pv-kick"><i />LIVE · 非最終數據</div>
            : <div className="pv-kick gold">{isFinals ? `TAIWAN SERIES · ${year}` : `POSTSEASON · ${year}`}</div>}
          <div className="pv-title">
            <h1>{s.name}專區</h1>
            <span className="sub"><span className="date">{mdw(data.today)}・</span>{format}・季後賽不計入 fantasy</span>
          </div>
        </div>
        {active && (
          <div className="pv-refresh">
            <div className="txt"><div><b>{sec}</b> 秒後更新</div><small>上次 {upd}{failed && <em className="bad">・更新失敗，稍後重試</em>}</small></div>
            <button type="button" className="lv-ring" style={{ background: ring }} title="立即更新" aria-label={`${sec} 秒後更新，點一下立即更新`} onClick={load}>
              <span><b>{sec}</b><small>秒</small><i className="ico">↻</i></span>
            </button>
          </div>
        )}
      </div>
      {newCards > 0 && (
        <button type="button" className="pv-newcards" onClick={() => document.getElementById('cards')?.scrollIntoView({ behavior: 'smooth' })}>
          <i />{newCards} 張新紀念卡 ↓
        </button>
      )}
      {data.series.length > 1 && (
        <div className="lv-seg pv-switch" role="tablist">
          {data.series.map((x) => (
            <button key={x.kind} type="button" role="tab" aria-selected={x.kind === s.kind} onClick={() => setKind(x.kind)}>{x.name}</button>
          ))}
        </div>
      )}
      <SeriesCard ctx={ctx} />
      <TodayCard ctx={ctx} />
      <div className="pv-two"><MinePanel ctx={ctx} /><Leaders ctx={ctx} /></div>
      <Recaps ctx={ctx} />
      {cards && <CardsSection cards={cards} seen={seen} mark={mark} />}
      <p className="pv-note">{data.notice}</p>
    </div>
  )
}

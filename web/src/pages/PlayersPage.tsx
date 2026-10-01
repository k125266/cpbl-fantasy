import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useApp } from '../App'
import { api, type FeedItem, type PlayerRow, type RosterResponse } from '../api'
import { Avatar, BottomSheet, ErrorBox, FeedRow, fmtDateTime, ICONS, Loading, PlayerCard, TeamChip, tierOf, toast, useLoad } from '../components'
import { cpblTeam } from '../teams'

const POS = ['', 'IF', 'OF', 'UTIL', 'SP', 'RP']
const SORTS = ['rank', 'R', 'HR', 'RBI', 'SB', 'AVG', 'QS', 'K', 'SV+HLD', 'ERA', 'WHIP']

export function isPitcherRow(p: { eligible: string[] }) {
  return p.eligible.some((e) => e === 'SP' || e === 'RP') && !p.eligible.some((e) => e === 'IF' || e === 'OF' || e === 'UTIL')
}

export function cardLine(p: PlayerRow) {
  const s = p.stats
  return isPitcherRow(p) ? `${s.ERA} ERA ${s.K}K` : `${s.AVG} ${s.HR}HR ${s.RBI}RBI`
}

export function cardBack(p: PlayerRow): [string, string][] {
  const s = p.stats
  return isPitcherRow(p)
    ? [['防禦率', s.ERA], ['三振', s.K], ['優質先發', s.QS], ['救援+中繼', s['SV+HLD']], ['WHIP', s.WHIP], ['局數', s.IP]]
    : [['打擊率', s.AVG], ['全壘打', s.HR], ['打點', s.RBI], ['得分', s.R], ['盜壘', s.SB], ['打數', s.AB]]
}

export default function PlayersPage() {
  const { leagueId, league, reloadLeague } = useApp()
  const navigate = useNavigate()
  const [tab, setTab] = useState<'feed' | 'news'>('feed')
  const [searching, setSearching] = useState(false)
  const [q, setQ] = useState('')
  const [pos, setPos] = useState('')
  const [sort, setSort] = useState('rank')
  const [showAll, setShowAll] = useState(false)
  const [acquire, setAcquire] = useState<PlayerRow | null>(null)
  const [limit, setLimit] = useState(25)
  const avail = showAll ? 'all' : 'fa'
  const qs = (range: string, n: number) => new URLSearchParams({ q, pos, avail, sort, range, limit: String(n) }).toString()
  const season = useLoad(() => api.get<PlayerRow[]>(`/api/leagues/${leagueId}/players?${qs('season', limit)}`), [leagueId, q, pos, sort, avail, limit])
  const recent = useLoad(() => api.get<PlayerRow[]>(`/api/leagues/${leagueId}/players?${qs('7d', 300)}`), [leagueId, q, pos, sort, avail])
  const feed = useLoad(() => api.get<FeedItem[]>(`/api/leagues/${leagueId}/feed`), [leagueId])
  const mine = useLoad(() => api.get<PlayerRow[]>(`/api/leagues/${leagueId}/players?avail=rostered&limit=300`), [leagueId])
  const recentById = new Map((recent.data || []).map((p) => [p.playerId, p]))
  const myCards = (mine.data || []).filter((p) => p.ownerTeamId === league?.myTeamId)

  return (
    <div className="stack">
      <div className="quick">
        <button type="button" aria-pressed={searching} onClick={() => setSearching(!searching)}><span className="ic">{ICONS.search}</span>搜尋</button>
        <button type="button" aria-pressed={showAll} onClick={() => setShowAll(!showAll)}><span className="ic">{ICONS.players}</span>{showAll ? '顯示全部' : '只看可簽入'}</button>
        <button type="button" onClick={() => navigate('/transactions')}><span className="ic">{ICONS.swap}</span>Waiver・交易</button>
      </div>
      {searching && <input autoFocus placeholder="輸入球員姓名" value={q} onChange={(e) => setQ(e.target.value)} aria-label="搜尋球員姓名" />}

      <div className="card flush">
        <div className="listhead plain">球員消息
          <div className="seg" role="group" aria-label="消息類型">
            <button type="button" aria-pressed={tab === 'feed'} onClick={() => setTab('feed')}>動態</button>
            <button type="button" aria-pressed={tab === 'news'} onClick={() => setTab('news')}>新聞</button>
          </div>
        </div>
        {tab === 'feed' ? (
          <>
            <div className="feed">
              {(feed.data || []).slice(0, 8).map((f, i) => <FeedRow key={i} item={f} onOpen={(id) => navigate(`/players/${id}`)} />)}
              {feed.data && feed.data.length === 0 && <div className="fitem"><div /><div className="ps">最近沒有動態</div></div>}
            </div>
            <div className="feed-note">動態由比賽數據與名單異動自動產生，不包含新聞內容與傷況推測。</div>
          </>
        ) : (
          <div className="feed-note" style={{ borderTop: 0 }}>
            新聞功能尚未啟用。規劃為只顯示第三方媒體的標題與連結，點擊後到原網站閱讀；需先逐家確認媒體 RSS 的使用條款（見 docs/rulebook-amendments.md）。
          </div>
        )}
      </div>

      <div className="card flush">
        <div className="listhead plain">{showAll ? '全部球員' : '可簽入球員'}
          <select value={sort} onChange={(e) => setSort(e.target.value)} aria-label="排序" style={{ padding: '3px 8px', fontSize: 13 }}>
            {SORTS.map((s) => <option key={s} value={s}>{s === 'rank' ? '依排名' : `依 ${s}`}</option>)}
          </select>
        </div>
        <div className="chips">
          {POS.map((p) => <button key={p} type="button" aria-pressed={pos === p} onClick={() => setPos(p)}>{p || '全部'}</button>)}
        </div>
        {season.loading && !season.data ? <div style={{ padding: 14 }}><Loading /></div> : <ErrorBox error={season.error} />}
        {(season.data || []).map((p) => {
          const pit = isPitcherRow(p)
          const r7 = recentById.get(p.playerId)
          const state = p.ownerTeam ?? (p.onWaivers ? `W ${fmtDateTime(p.waiverClears).split(' ')[0]}` : p.status.code === 'MINORS' ? '二軍' : 'FA')
          const canAdd = !p.ownerTeam && (p.status.code === 'ACTIVE' || p.status.code === 'IDLE')
          return (
            <div className="frow" key={p.playerId}>
              <div className="ftop">
                <Avatar team={p.cpblTeam} number={p.jerseyNumber} />
                <button type="button" className="name" onClick={() => navigate(`/players/${p.playerId}`)}>
                  <div className="pn">{p.name}<span className="ps">{cpblTeam(p.cpblTeam).short}・{p.eligible.join(',')}</span></div>
                  <div className={`ps ${p.status.code === 'ACTIVE' ? '' : 'amber'}`}>{p.status.code === 'ACTIVE' ? '一軍' : p.status.text}</div>
                </button>
                {canAdd && (p.onWaivers
                  ? <button type="button" onClick={() => setAcquire(p)}>出價</button>
                  : <button type="button" className="primary" onClick={() => setAcquire(p)}>簽入</button>)}
              </div>
              <div className="fstats">
                <div><b>{p.rank || '—'}</b>排名</div>
                <div><b>{pit ? p.stats.ERA : p.stats.AVG}</b>{pit ? '本季 ERA' : '本季 AVG'}</div>
                <div><b>{r7 ? (pit ? r7.stats.ERA : r7.stats.AVG) : '—'}</b>近 7 日</div>
                <div><b style={{ fontSize: 15 }}>{state}</b>狀態</div>
              </div>
            </div>
          )
        })}
        {(season.data?.length ?? 0) >= limit && (
          <div style={{ padding: 12, borderTop: '1px solid var(--line)' }}>
            <button type="button" className="btn-block" onClick={() => setLimit(limit + 25)}>顯示更多</button>
          </div>
        )}
      </div>

      {myCards.length > 0 && (
        <>
          <div className="h2">球員卡收藏 <small>卡框依本季表現排名自動決定</small></div>
          <div className="pcard-grid">
            {myCards.map((p) => (
              <PlayerCard key={p.playerId} name={p.name} team={p.cpblTeam} number={p.jerseyNumber} positions={p.eligible.join('・')}
                line={cardLine(p)} tier={tierOf(p.rank)} back={cardBack(p)} />
            ))}
          </div>
          <p className="note" style={{ margin: 0 }}>金框：排名前 30・銀框：31–80・銅框：其餘。純外觀，不能交易或購買。</p>
        </>
      )}

      {acquire && league?.myTeamId && (
        <AcquireSheet player={acquire} teamId={league.myTeamId} onClose={() => setAcquire(null)}
          onDone={(msg) => { toast(msg); setAcquire(null); season.reload(); mine.reload(); reloadLeague() }} />
      )}
    </div>
  )
}

export function AcquireSheet({ player, teamId, onClose, onDone }: {
  player: { playerId: number; name: string; cpblTeam: string; onWaivers: boolean }
  teamId: number
  onClose: () => void
  onDone: (msg: string) => void
}) {
  const { leagueId } = useApp()
  const roster = useLoad(() => api.get<RosterResponse>(`/api/leagues/${leagueId}/teams/${teamId}/roster`), [leagueId, teamId])
  const [drop, setDrop] = useState('')
  const [bid, setBid] = useState(0)
  const [error, setError] = useState<unknown>(null)
  const submit = async () => {
    setError(null)
    try {
      const dropPlayerId = drop ? Number(drop) : null
      if (player.onWaivers) {
        await api.post(`/api/leagues/${leagueId}/waivers/claims`, { playerId: player.playerId, dropPlayerId, bid })
        onDone(`已對 ${player.name} 出價 ${bid} 點，結算時處理`)
      } else {
        const r = await api.post<{ effectiveDate: string }>(`/api/leagues/${leagueId}/roster/add`, { playerId: player.playerId, dropPlayerId })
        onDone(`已簽入 ${player.name}，${r.effectiveDate.slice(5).replace('-', '/')} 生效`)
      }
    } catch (e) {
      setError(e)
    }
  }
  return (
    <BottomSheet onClose={onClose} label={player.onWaivers ? 'Waiver 出價' : '簽入自由球員'}>
      <h3><TeamChip code={player.cpblTeam} />{player.onWaivers ? 'Waiver 出價' : '簽入'}：{player.name}</h3>
      <ErrorBox error={error} />
      {player.onWaivers && (
        <label>
          <span>FAAB 出價（剩餘 {roster.data?.faabBudget ?? '…'}；同價時戰績較差者優先）</span>
          <input type="number" min={0} max={roster.data?.faabBudget ?? 100} value={bid} onChange={(e) => setBid(Number(e.target.value))} />
        </label>
      )}
      <label>
        <span>同時釋出（名單已滿時必選）</span>
        <select value={drop} onChange={(e) => setDrop(e.target.value)} style={{ width: '100%' }}>
          <option value="">不釋出</option>
          {(roster.data?.players || []).map((p) => (
            <option key={p.playerId} value={p.playerId}>{p.slot} {p.name}{p.locked ? '（已鎖定，明日生效）' : ''}</option>
          ))}
        </select>
      </label>
      <p className="ps" style={{ margin: 0 }}>若相關球員今日比賽已開打，異動自明日起生效。</p>
      <div className="row2">
        <button type="button" className="primary" onClick={submit}>確認</button>
        <button type="button" onClick={onClose}>取消</button>
      </div>
    </BottomSheet>
  )
}

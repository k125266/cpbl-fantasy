import { useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import { useApp } from '../App'
import { api, type CardData, type PlayerDetail } from '../api'
import { CollectCard } from '../CollectCard'
import { Avatar, ErrorBox, FeedRow, fmtDate, Loading, TeamChip, TIER_LABEL, TIER_ZH, tierOf, toast, useLoad, weekday } from '../components'
import { cpblTeam } from '../teams'
import { AcquireSheet } from './PlayersPage'

const HIT_TILES = ['AVG', 'HR', 'H', 'R', 'BB']
const PIT_TILES = ['ERA', 'WHIP', 'K', 'QS', 'W+SV']
const RANGES: ['season' | '14d' | '7d', string][] = [['season', '本季'], ['14d', '近 14 天'], ['7d', '近 7 天']]

export default function PlayerDetailPage() {
  const { playerId } = useParams()
  const { leagueId, league, reloadLeague } = useApp()
  const navigate = useNavigate()
  const { data, error, loading, reload } = useLoad(() => api.get<PlayerDetail>(`/api/players/${playerId}?leagueId=${leagueId}`), [playerId, leagueId])
  // 收藏卡的履歷與印章以聯盟為單位；沒有聯盟時退回等級頭像
  const card = useLoad(() => leagueId ? api.get<CardData>(`/api/leagues/${leagueId}/players/${playerId}/card`) : Promise.resolve(null), [playerId, leagueId])
  const [range, setRange] = useState<'season' | '14d' | '7d'>('season')
  const [acquire, setAcquire] = useState(false)
  if (loading && !data) return <Loading />
  if (error || !data) return <ErrorBox error={error} />

  const p = data.player
  const pit = p.listedPosition === 'P'
  const tier = tierOf(data.rank)
  const tiles = pit ? PIT_TILES : HIT_TILES
  const stats = data.ranges[range]
  const rec = data.league
  const games = data.gameLog.slice(0, 10)
  const value = (g: Record<string, string | number | boolean>) => pit
    ? Math.max(0, Number(g.outs) - Number(g.p_er) * 4)
    : Number(g.h) + Number(g.hr) * 2
  const max = Math.max(1, ...games.map(value))
  const ep = data.eligibilityProgress
  const status = data.status

  const eligRows: [string, number, number, string][] = !ep ? [] : pit
    ? [['SP', ep.starts, ep.minStarts, '先發場次'], ['RP', ep.reliefs, 1, '後援出賽']]
    : [
      ['IF', ep.listedPosition === 'IF' ? ep.minGames : ep.ifGames, ep.minGames, ep.listedPosition === 'IF' ? '登錄位置' : '出賽場次'],
      ['OF', ep.listedPosition === 'OF' ? ep.minGames : ep.ofGames, ep.minGames, ep.listedPosition === 'OF' ? '登錄位置' : '出賽場次'],
    ]

  // 未來 7 天：以日期為格，沒有比賽的日子顯示休兵
  const days = Array.from({ length: 7 }, (_, i) => {
    const d = new Date(data.today + 'T00:00:00')
    d.setDate(d.getDate() + i)
    const iso = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
    return { iso, games: data.schedule.filter((g) => g.play_date === iso) }
  })

  return (
    <div className="stack">
      {/* 球員卡規範 2c：完整卡固定在詳情頁頂端，下面接數據 */}
      <div className="dcard">
        {card.data
          ? <><CollectCard card={card.data} size={240} /><span>點卡片翻面看履歷與印章</span></>
          : <div className={`tier-ring tier-${tier}`}><Avatar team={p.team} number={p.jerseyNumber} size="lg" /></div>}
      </div>
      <div className="dhero">
        <div style={{ minWidth: 0 }}>
          <div className="dname">
            {p.name}
            {status && status.code !== 'ACTIVE' && <span className={`badge ${status.code === 'MINORS' ? 'warn' : 'danger'}`}>{status.code === 'MINORS' ? '二軍' : status.code === 'DELISTED' ? '已註銷' : '未出賽'}</span>}
          </div>
          <div className="dsub">
            <TeamChip code={p.team} />
            {p.jerseyNumber && <span>#{p.jerseyNumber}</span>}
            <span>{(data.eligible ?? []).join(',')}</span>
            {p.foreign && <span>洋將</span>}
          </div>
          <div className="dsub"><span className={`pc-tier tier-${tier}`}>{TIER_LABEL[tier]}・{TIER_ZH[tier]}</span>{data.rank && <span>聯盟排名第 {data.rank}</span>}</div>
          {status && status.code !== 'ACTIVE' && <div className="dsub amber">{status.text}</div>}
        </div>
      </div>

      {rec && (
        <div className="row2">
          {rec.ownerTeamId === league?.myTeamId
            ? <button type="button" onClick={() => navigate('/')}>到名單調整位置</button>
            : rec.availability === 'ROSTERED'
              ? <button type="button" onClick={() => navigate(`/teams/${rec.ownerTeamId}`)}>看 {rec.ownerTeamName} 名單</button>
              : <button type="button" className="primary" disabled={status?.code !== 'ACTIVE' && status?.code !== 'IDLE'} onClick={() => setAcquire(true)}>{rec.availability === 'WAIVERS' ? 'FAAB 出價' : '簽入'}</button>}
          <button type="button" onClick={() => document.getElementById('news')?.scrollIntoView({ behavior: 'smooth' })}>相關新聞</button>
        </div>
      )}

      <div className="seg" role="group" aria-label="數據區間" style={{ justifySelf: 'start' }}>
        {RANGES.map(([k, label]) => <button key={k} type="button" aria-pressed={range === k} onClick={() => setRange(k)}>{label}</button>)}
      </div>
      <div className="tiles">
        {tiles.map((t) => (
          <div className="tile" key={t}>
            <b>{stats[t]}</b><span>{t}</span>
            {range === 'season' && data.categoryRanks[t] != null && <small>聯盟第 {data.categoryRanks[t]}</small>}
          </div>
        ))}
      </div>

      {games.length > 0 && (
        <div className="card">
          <div className="h2" style={{ margin: '0 0 10px' }}>近 {games.length} 場走勢 <small>{pit ? '出局數 − 自責分×4' : '安打 + 全壘打×2'}</small></div>
          <div className="spark">
            {[...games].reverse().map((g, i) => (
              <div key={i}><i className={value(g) >= max * 0.7 && value(g) > 0 ? 'hi' : ''} style={{ height: `${Math.max(6, (value(g) / max) * 100)}%` }} /><span>{fmtDate(String(g.play_date))}</span></div>
            ))}
          </div>
        </div>
      )}

      <div className="card flush">
        <div className="listhead">逐場紀錄<small>* 官方記錄修正過・† 尚未定版</small></div>
        <div className="table-wrap" style={{ padding: '0 14px' }}>
          <table>
            <thead>
              <tr><th>日期</th><th>對手</th>{pit
                ? <><th className="num">局數</th><th className="num">自責</th><th className="num">三振</th><th>結果</th></>
                : <><th>守位</th><th className="num">H/AB</th><th className="num">HR</th><th className="num">R</th><th className="num">BB</th></>}</tr>
            </thead>
            <tbody>
              {data.gameLog.slice(0, 8).map((g, i) => (
                <tr key={i}>
                  <td>{fmtDate(String(g.play_date))}{Number(g.revision) > 1 ? '*' : ''}{g.is_final ? '' : '†'}</td>
                  <td><TeamChip code={String(g.opponent)} /></td>
                  {pit ? (
                    <>
                      <td className="num">{Math.floor(Number(g.outs) / 3)}.{Number(g.outs) % 3}</td>
                      <td className="num">{String(g.p_er)}</td><td className="num">{String(g.p_k)}</td>
                      <td className="small">{g.started ? '先發' : ''}{Number(g.w) > 0 ? ' W' : ''}{Number(g.sv) > 0 ? ' SV' : ''}</td>
                    </>
                  ) : (
                    <>
                      <td className="small">{String(g.positions || '代')}</td>
                      <td className="num">{String(g.h)}/{String(g.ab)}</td><td className="num">{String(g.hr)}</td>
                      <td className="num">{String(g.r)}</td><td className="num">{String(g.bb)}</td>
                    </>
                  )}
                </tr>
              ))}
              {data.gameLog.length === 0 && <tr><td colSpan={6} className="muted">本季尚無出賽紀錄</td></tr>}
            </tbody>
          </table>
        </div>
      </div>

      {ep && (
        <div className="card">
          <div className="h2" style={{ margin: '0 0 12px' }}>位置資格 <small>{ep.halfNo === 1 ? '上' : '下'}半季重算{ep.inGrace && pit ? `・${fmtDate(ep.graceUntil)} 前 SP/RP 皆可` : ''}</small></div>
          <div className="eli">
            {eligRows.map(([pos, n, need, what]) => (
              <div className="eli-row" key={pos}>
                <b>{pos}</b>
                <div className="eli-bar"><i style={{ width: `${Math.min(100, (n / need) * 100)}%` }} /></div>
                <span className="ps">{n >= need ? '✓ 已取得' : `${n} / ${need} ${what}`}</span>
              </div>
            ))}
          </div>
        </div>
      )}

      <div>
        <div className="h2" style={{ margin: '0 0 8px' }}>未來 7 天</div>
        <div className="sched">
          {days.map((d, i) => {
            const g = d.games[0]
            const label = !g ? '休兵' : g.status === 'POSTPONED' ? '延賽' : `${g.home ? 'vs' : '@'}${cpblTeam(g.opponent).short}`
            return (
              <div key={d.iso} className={`${i === 0 ? 'today' : ''} ${g ? '' : 'off'}`}>
                <span>{weekday(d.iso)}</span><b>{Number(d.iso.slice(8))}</b><span>{label}{g && g.actual_play_date && g.actual_play_date !== g.scheduled_date ? '・補' : ''}</span>
              </div>
            )
          })}
        </div>
      </div>

      <div className="card flush">
        <div className="listhead plain">動態</div>
        <div className="feed">
          {(data.feed ?? []).map((f, i) => <FeedRow key={i} item={f} />)}
          {(data.feed ?? []).length === 0 && <div className="fitem"><div /><div className="ps">近期沒有動態</div></div>}
        </div>
      </div>

      <div className="card flush" id="news">
        <div className="listhead plain">相關新聞<small>標題與連結</small></div>
        <div className="feed-note" style={{ borderTop: 0 }}>
          {data.newsEnabled ? '' : '新聞功能尚未啟用。啟用後只顯示媒體標題、來源與時間，點擊到原網站閱讀。'}
        </div>
      </div>

      {rec && (
        <div className="card">
          <div className="h2" style={{ margin: '0 0 10px' }}>聯盟內紀錄</div>
          <dl className="kv">
            <dt>目前</dt><dd>{rec.ownerTeamName ?? (rec.availability === 'WAIVERS' ? 'Waiver 中' : '自由球員')}</dd>
            <dt>取得方式</dt><dd>{rec.acquiredVia ? ({ DRAFT: `選秀第 ${rec.draftRound} 輪`, KEEPER: 'Keeper', WAIVER: 'Waiver', FA: '自由球員簽入', TRADE: '交易' } as Record<string, string>)[rec.acquiredVia] ?? rec.acquiredVia : '—'}</dd>
            <dt>聯盟持有率</dt><dd>{rec.ownerTeamId ? 1 : 0} / {rec.teams} 隊</dd>
            <dt>近 7 天異動</dt><dd>{rec.adds7d} 次簽入・{rec.drops7d} 次釋出</dd>
          </dl>
        </div>
      )}

      {data.nameHistory.length > 0 && <p className="note">曾用名：{data.nameHistory.map((h) => h.old_name).join('、')}</p>}

      {acquire && league?.myTeamId && (
        <AcquireSheet player={{ playerId: p.id, name: p.name, cpblTeam: p.team, onWaivers: rec?.availability === 'WAIVERS' }}
          teamId={league.myTeamId} onClose={() => setAcquire(false)}
          onDone={(msg) => { toast(msg); setAcquire(false); reload(); reloadLeague() }} />
      )}
    </div>
  )
}

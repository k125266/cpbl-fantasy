import { useState } from 'react'
import { Link } from 'react-router-dom'
import { useApp } from '../App'
import { api, type League } from '../api'
import { ErrorBox, fmtDate } from '../components'

const SETTINGS: { key: string; field: keyof League; label: string }[] = [
  { key: 'foreign_player_limit', field: 'foreignPlayerLimit', label: '洋將上限' },
  { key: 'position_min_games', field: 'positionMinGames', label: '位置資格門檻（場）' },
  { key: 'sp_min_starts', field: 'spMinStarts', label: 'SP 資格門檻（先發場次）' },
  { key: 'eligibility_grace_days', field: 'eligibilityGraceDays', label: '半季初投手資格寬限（天）' },
  { key: 'faab_budget_per_half', field: 'faabBudgetPerHalf', label: 'FAAB 每半季預算' },
  { key: 'slots_na', field: 'slotsNa', label: 'NA 格數' },
  { key: 'minors_return_days', field: 'minorsReturnDays', label: '下二軍最短回歸天數' },
  { key: 'foreign_minors_return_days', field: 'foreignMinorsReturnDays', label: '洋將下二軍最短回歸天數' },
  { key: 'hitter_idle_game_days', field: 'hitterIdleGameDays', label: '野手未出賽警示（比賽日）' },
  { key: 'pitcher_idle_days', field: 'pitcherIdleDays', label: '投手未出場警示（日）' },
  { key: 'waiver_days', field: 'waiverDays', label: 'Waiver 期（日）' },
  { key: 'trade_review_hours', field: 'tradeReviewHours', label: '交易審核期（小時）' },
  { key: 'matchup_lock_hours', field: 'matchupLockHours', label: '對戰結果緩衝期（小時）' },
  { key: 'keeper_limit', field: 'keeperLimit', label: 'Keeper 上限（下半季，不佔輪次）' },
  { key: 'second_half_rounds', field: 'secondHalfRounds', label: '下半季補強選秀輪數' },
  { key: 'draft_pick_seconds', field: 'draftPickSeconds', label: '選秀每次時限（秒）' },
]

export default function LeaguePage() {
  const { leagueId, league, reloadLeague } = useApp()
  const [err, setErr] = useState<unknown>(null)
  const [msg, setMsg] = useState<string | null>(null)
  const [values, setValues] = useState<Record<string, number | boolean>>({})
  const [season, setSeason] = useState({ half1Start: '', half1End: '', half2Start: '', half2End: '', periodDays: 14, finalDays: 14 })
  const [rename, setRename] = useState({ name: '', abbr: '' })
  if (!league) return null
  const l = league.league
  const me = league.teams.find((t) => t.id === league.myTeamId)

  const run = async (fn: () => Promise<unknown>, ok: string) => {
    setErr(null)
    setMsg(null)
    try {
      await fn()
      setMsg(ok)
      reloadLeague()
    } catch (e) {
      setErr(e)
    }
  }

  return (
    <>
      <h1>聯盟</h1>
      <ErrorBox error={err} />
      {msg && <div className="alert info">{msg}</div>}
      <div className="card">
        <h2>隊伍（{league.teams.length}/{l.maxTeams}）</h2>
        <ul className="list-plain">
          {league.teams.map((t) => (
            <li key={t.id} className="spread">
              <Link to={`/teams/${t.id}`}>{t.name}（{t.abbr}）</Link>
              <span className="muted small">{t.owner}・FAAB {t.faabBudget}</span>
            </li>
          ))}
        </ul>
        {league.inviteCode && <p className="small">邀請碼：<b>{league.inviteCode}</b>（僅聯盟管理員可見）</p>}
      </div>
      <div className="card">
        <h2>我的隊伍</h2>
        <div className="row">
          <input placeholder={me?.name} value={rename.name} onChange={(e) => setRename({ ...rename, name: e.target.value })} />
          <input placeholder={me?.abbr} value={rename.abbr} maxLength={6} style={{ width: 80 }} onChange={(e) => setRename({ ...rename, abbr: e.target.value })} />
          <button onClick={() => run(() => api.patch(`/api/leagues/${leagueId}/teams/me`, rename), '已更新隊名')}>更新</button>
        </div>
      </div>
      <div className="card">
        <h2>賽程</h2>
        <ul className="list-plain small">
          {league.periods.map((p) => (
            <li key={p.id} className="spread">
              <span>{p.kind === 'FINAL' ? '總冠軍賽' : `${p.halfNo === 1 ? '上' : '下'}半季 第 ${p.periodNo} 期`}</span>
              <span className="muted">{fmtDate(p.startDate)} – {fmtDate(p.endDate)}・{p.status}</span>
            </li>
          ))}
          {league.periods.length === 0 && <li className="muted">尚未產生賽程</li>}
        </ul>
        {league.commissioner && (
          <>
            <h3>產生賽程（雙週對戰）</h3>
            <div className="row">
              {(['half1Start', 'half1End', 'half2Start', 'half2End'] as const).map((k) => (
                <label key={k}><span>{{ half1Start: '上半季開始', half1End: '上半季結束', half2Start: '下半季開始', half2End: '下半季結束' }[k]}</span>
                  <input type="date" value={season[k]} onChange={(e) => setSeason({ ...season, [k]: e.target.value })} /></label>
              ))}
              <label><span>每期天數</span><input type="number" value={season.periodDays} onChange={(e) => setSeason({ ...season, periodDays: Number(e.target.value) })} style={{ width: 70 }} /></label>
              <label><span>總冠軍賽天數</span><input type="number" value={season.finalDays} onChange={(e) => setSeason({ ...season, finalDays: Number(e.target.value) })} style={{ width: 70 }} /></label>
            </div>
            <button onClick={() => run(() => api.post(`/api/leagues/${leagueId}/season`, season), '賽程已產生')}>產生（將覆寫尚未開始的賽程）</button>
          </>
        )}
      </div>
      <div className="card">
        <h2>聯盟設定</h2>
        <div className="table-wrap">
          <table>
            <tbody>
              {SETTINGS.map((s) => (
                <tr key={s.key}>
                  <td>{s.label}</td>
                  <td className="num">
                    {league.commissioner ? (
                      <input type="number" style={{ width: 80 }} defaultValue={l[s.field] as number}
                        onChange={(e) => setValues({ ...values, [s.key]: Number(e.target.value) })} />
                    ) : (l[s.field] as number)}
                  </td>
                </tr>
              ))}
              <tr>
                <td>註銷球員退還 FAAB</td>
                <td className="num">
                  {league.commissioner ? (
                    <input type="checkbox" defaultChecked={l.refundFaabOnDelist} onChange={(e) => setValues({ ...values, refund_faab_on_delist: e.target.checked })} />
                  ) : l.refundFaabOnDelist ? '是' : '否'}
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        {league.commissioner && (
          <button className="primary" style={{ marginTop: 8 }} onClick={() => run(() => api.patch(`/api/leagues/${leagueId}/settings`, values), '設定已儲存')}>
            儲存設定
          </button>
        )}
        <p className="small muted">名單結構：IF 4 / OF 3 / UTIL 1 / SP 4 / RP 2 / 板凳 6 / NA {l.slotsNa}。計分 5x5：R、HR、H、BB、AVG／QS、K、W+SV、ERA、WHIP。</p>
      </div>
    </>
  )
}

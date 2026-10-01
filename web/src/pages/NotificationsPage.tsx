import { useApp } from '../App'
import { api, type Notification } from '../api'
import { fmtDateTime, Loading, useLoad } from '../components'

export default function NotificationsPage() {
  const { leagueId } = useApp()
  const { data, loading, reload } = useLoad(() => api.get<Notification[]>(`/api/leagues/${leagueId}/notifications`), [leagueId])
  const markRead = async () => {
    await api.post(`/api/leagues/${leagueId}/notifications/read`)
    reload()
  }
  if (loading && !data) return <Loading />
  return (
    <div className="stack">
      <div className="h2">通知 <button type="button" className="small" onClick={markRead}>全部已讀</button></div>
      <div className="card flush">
        <div className="feed">
          {(data || []).map((n) => (
            <div key={n.id} className="fitem" style={{ gridTemplateColumns: '10px 1fr' }}>
              <span style={{ width: 8, height: 8, borderRadius: '50%', marginTop: 8, background: n.read ? 'transparent' : 'var(--gold)' }} />
              <div><div className="t" style={{ fontWeight: n.read ? 400 : 700 }}>{n.message}</div><div className="when">{fmtDateTime(n.createdAt)}</div></div>
            </div>
          ))}
          {data && data.length === 0 && <div className="fitem"><div /><div className="ps">沒有通知</div></div>}
        </div>
      </div>
    </div>
  )
}

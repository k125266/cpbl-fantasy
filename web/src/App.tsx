import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { Navigate, NavLink, Route, Routes, useLocation, useNavigate } from 'react-router-dom'
import { api, type LeagueDetail, type Membership, type Notification, type SystemInfo, type User } from './api'
import { Footer, ICONS, Loading } from './components'
import LoginPage from './pages/LoginPage'
import TeamPage from './pages/TeamPage'
import MatchupPage from './pages/MatchupPage'
import PlayersPage from './pages/PlayersPage'
import PlayerDetailPage from './pages/PlayerDetailPage'
import TransactionsPage from './pages/TransactionsPage'
import DraftPage from './pages/DraftPage'
import LeagueHubPage from './pages/LeagueHubPage'
import LivePage from './pages/LivePage'
import LeaguePage from './pages/LeaguePage'
import AdminPage from './pages/AdminPage'
import PrivacyPage from './pages/PrivacyPage'
import NotificationsPage from './pages/NotificationsPage'
import NoLeaguePage from './pages/NoLeaguePage'

interface Ctx {
  user: User
  system: SystemInfo | null
  leagueId: number
  league: LeagueDetail | null
  reloadLeague: () => void
  reloadSystem: () => void
  logout: () => void
}

const AppContext = createContext<Ctx | null>(null)

export function useApp(): Ctx {
  const c = useContext(AppContext)
  if (!c) throw new Error('no context')
  return c
}

export default function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined)
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [memberships, setMemberships] = useState<Membership[] | null>(null)
  const [league, setLeague] = useState<LeagueDetail | null>(null)
  const navigate = useNavigate()

  const reloadSystem = useCallback(() => {
    api.get<SystemInfo>('/api/system').then(setSystem).catch(() => setSystem(null))
  }, [])

  useEffect(() => {
    reloadSystem()
    api.get<User>('/api/auth/me').then(setUser).catch(() => setUser(null))
  }, [reloadSystem])

  useEffect(() => {
    if (!user) return
    api.get<Membership[]>('/api/me/leagues').then(setMemberships)
  }, [user])

  const leagueId = memberships && memberships.length > 0 ? memberships[0].leagueId : null

  const reloadLeague = useCallback(() => {
    if (leagueId == null) return
    api.get<LeagueDetail>(`/api/leagues/${leagueId}`).then(setLeague)
  }, [leagueId])

  useEffect(() => {
    reloadLeague()
  }, [reloadLeague])

  const logout = useCallback(async () => {
    await api.post('/api/auth/logout')
    setUser(null)
    setMemberships(null)
    setLeague(null)
    navigate('/')
  }, [navigate])

  if (user === undefined) {
    return <div className="app"><Loading /></div>
  }

  if (user === null) {
    return (
      <div className="app">
        <Routes>
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="*" element={<LoginPage onLogin={(u) => setUser(u)} />} />
        </Routes>
        <Footer />
      </div>
    )
  }

  if (memberships === null) {
    return <div className="app"><Loading /></div>
  }

  if (leagueId == null) {
    return (
      <AppContext.Provider value={{ user, system, leagueId: 0, league: null, reloadLeague, reloadSystem, logout }}>
        <div className="app">
          <TopBar title="CPBL Fantasy" subtitle={user.displayName} />
          <Routes>
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="/admin" element={user.admin ? <AdminPage /> : <Navigate to="/" />} />
            <Route path="*" element={<NoLeaguePage onJoined={() => api.get<Membership[]>('/api/me/leagues').then(setMemberships)} />} />
          </Routes>
          <Footer />
        </div>
      </AppContext.Provider>
    )
  }

  return (
    <AppContext.Provider value={{ user, system, leagueId, league, reloadLeague, reloadSystem, logout }}>
      <div className="app">
        <LeagueTopBar />
        {!league ? <Loading /> : (
          <Routes>
            <Route path="/" element={<TeamPage />} />
            <Route path="/teams/:teamId" element={<TeamPage />} />
            <Route path="/roster" element={<Navigate to="/" />} />
            <Route path="/matchups" element={<MatchupPage />} />
            <Route path="/matchups/:matchupId" element={<MatchupPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/players/:playerId" element={<PlayerDetailPage />} />
            <Route path="/draft" element={<DraftPage />} />
            <Route path="/league" element={<LeagueHubPage />} />
            <Route path="/league/settings" element={<LeaguePage />} />
            <Route path="/standings" element={<Navigate to="/league" />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/notifications" element={<NotificationsPage />} />
            <Route path="/admin" element={user.admin ? <AdminPage /> : <Navigate to="/" />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        )}
        <Footer />
        <Dock />
      </div>
    </AppContext.Provider>
  )
}

function LeagueTopBar() {
  const { league, leagueId, system } = useApp()
  const location = useLocation()
  const navigate = useNavigate()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    api.get<Notification[]>(`/api/leagues/${leagueId}/notifications`).then((ns) => setUnread(ns.filter((n) => !n.read).length)).catch(() => {})
  }, [leagueId, location.pathname])
  const p = league?.currentPeriod
  const sub = p ? (p.kind === 'FINAL' ? '總冠軍賽' : `${p.halfNo === 1 ? '上' : '下'}半季 第 ${p.periodNo} 期`) : 'H2H 類別'
  const isRoot = ['/', '/matchups', '/players', '/draft', '/league'].includes(location.pathname)
  return (
    <TopBar
      title={league?.league.name ?? ''}
      subtitle={`H2H 類別・${sub}`}
      left={isRoot ? undefined : <button type="button" className="round" aria-label="返回" onClick={() => navigate(-1)}>{ICONS.back}</button>}
      right={<button type="button" className="round" aria-label="通知" onClick={() => navigate('/notifications')}>{ICONS.bell}{unread > 0 && <span className="dot" />}</button>}
      demo={system?.demo ? `Demo 模式・模擬賽季（虛構球員）・模擬時間 ${system.now.slice(5, 16).replace('T', ' ')}` : undefined}
    />
  )
}

function TopBar({ title, subtitle, left, right, demo }: { title: string; subtitle?: string; left?: React.ReactNode; right?: React.ReactNode; demo?: string }) {
  const { logout } = useAppOptional() ?? { logout: undefined }
  return (
    <header className="topbar">
      <div className="topbar-row">
        <div>{left ?? (logout && <button type="button" className="round" aria-label="登出" onClick={logout}>{ICONS.logout}</button>)}</div>
        <div className="title">{title}{subtitle && <small>{subtitle}</small>}</div>
        <div>{right}</div>
      </div>
      {demo && <div className="demo-bar" style={{ paddingBottom: 6 }}>{demo}</div>}
    </header>
  )
}

function useAppOptional() {
  return useContext(AppContext)
}

function Dock() {
  const items: [string, string, React.ReactNode][] = [
    ['/', '隊伍', ICONS.team],
    ['/matchups', '對戰', ICONS.matchup],
    ['/players', '球員', ICONS.players],
    ['/draft', '選秀', ICONS.draft],
    ['/league', '聯盟', ICONS.trophy],
  ]
  return (
    <nav className="dock" aria-label="主選單">
      <div className="dock-in">
        {items.map(([to, label, icon]) => (
          <NavLink key={to} to={to} end={to === '/'}>{icon}{label}</NavLink>
        ))}
      </div>
    </nav>
  )
}

import { createContext, useCallback, useContext, useEffect, useState } from 'react'
import { NavLink, Navigate, Route, Routes, useNavigate } from 'react-router-dom'
import { api, ApiError, type LeagueDetail, type Membership, type SystemInfo, type User } from './api'
import { Footer, Loading } from './components'
import LoginPage from './pages/LoginPage'
import HomePage from './pages/HomePage'
import MatchupPage from './pages/MatchupPage'
import RosterPage from './pages/RosterPage'
import PlayersPage from './pages/PlayersPage'
import TransactionsPage from './pages/TransactionsPage'
import DraftPage from './pages/DraftPage'
import StandingsPage from './pages/StandingsPage'
import LivePage from './pages/LivePage'
import LeaguePage from './pages/LeaguePage'
import AdminPage from './pages/AdminPage'
import PrivacyPage from './pages/PrivacyPage'
import PlayerDetailPage from './pages/PlayerDetailPage'
import NoLeaguePage from './pages/NoLeaguePage'

interface Ctx {
  user: User
  system: SystemInfo | null
  leagueId: number
  league: LeagueDetail | null
  reloadLeague: () => void
  reloadSystem: () => void
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

  const reloadSystem = useCallback(() => {
    api.get<SystemInfo>('/api/system').then(setSystem).catch(() => setSystem(null))
  }, [])

  useEffect(() => {
    reloadSystem()
    api
      .get<User>('/api/auth/me')
      .then(setUser)
      .catch((e) => {
        if (e instanceof ApiError && e.status === 401) setUser(null)
        else setUser(null)
      })
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

  if (user === undefined) {
    return (
      <div className="app">
        <Loading />
      </div>
    )
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
    return (
      <div className="app">
        <Loading />
      </div>
    )
  }

  if (leagueId == null) {
    return (
      <div className="app">
        <Header user={user} system={system} onLogout={() => setUser(null)} showNav={false} admin={user.admin} />
        <Routes>
          <Route path="/privacy" element={<PrivacyPage />} />
          <Route path="/admin" element={user.admin ? <AdminStandalone user={user} system={system} reloadSystem={reloadSystem} /> : <Navigate to="/" />} />
          <Route path="*" element={<NoLeaguePage onJoined={() => api.get<Membership[]>('/api/me/leagues').then(setMemberships)} />} />
        </Routes>
        <Footer />
      </div>
    )
  }

  return (
    <AppContext.Provider value={{ user, system, leagueId, league, reloadLeague, reloadSystem }}>
      <div className="app">
        <Header user={user} system={system} onLogout={() => setUser(null)} showNav admin={user.admin} />
        {!league ? (
          <Loading />
        ) : (
          <Routes>
            <Route path="/" element={<HomePage />} />
            <Route path="/matchups" element={<MatchupPage />} />
            <Route path="/matchups/:matchupId" element={<MatchupPage />} />
            <Route path="/roster" element={<RosterPage />} />
            <Route path="/teams/:teamId" element={<RosterPage />} />
            <Route path="/players" element={<PlayersPage />} />
            <Route path="/players/:playerId" element={<PlayerDetailPage />} />
            <Route path="/transactions" element={<TransactionsPage />} />
            <Route path="/draft" element={<DraftPage />} />
            <Route path="/standings" element={<StandingsPage />} />
            <Route path="/live" element={<LivePage />} />
            <Route path="/league" element={<LeaguePage />} />
            <Route path="/admin" element={user.admin ? <AdminPage /> : <Navigate to="/" />} />
            <Route path="/privacy" element={<PrivacyPage />} />
            <Route path="*" element={<Navigate to="/" />} />
          </Routes>
        )}
        <Footer />
      </div>
    </AppContext.Provider>
  )
}

function AdminStandalone({ user, system, reloadSystem }: { user: User; system: SystemInfo | null; reloadSystem: () => void }) {
  return (
    <AppContext.Provider value={{ user, system, leagueId: 0, league: null, reloadLeague: () => {}, reloadSystem }}>
      <AdminPage />
    </AppContext.Provider>
  )
}

function Header({ user, system, onLogout, showNav, admin }: {
  user: User
  system: SystemInfo | null
  onLogout: () => void
  showNav: boolean
  admin: boolean
}) {
  const navigate = useNavigate()
  const logout = async () => {
    await api.post('/api/auth/logout')
    onLogout()
    navigate('/')
  }
  return (
    <>
      <header className="top">
        <div className="top-row">
          <NavLink to="/" className="brand">CPBL Fantasy</NavLink>
          <div className="row small">
            <span className="muted">{user.displayName}</span>
            <button className="small" onClick={logout}>登出</button>
          </div>
        </div>
        {showNav && (
          <nav className="tabs">
            <NavLink to="/" end>首頁</NavLink>
            <NavLink to="/matchups">對戰</NavLink>
            <NavLink to="/roster">我的名單</NavLink>
            <NavLink to="/players">球員</NavLink>
            <NavLink to="/transactions">異動</NavLink>
            <NavLink to="/standings">戰績</NavLink>
            <NavLink to="/live">即時</NavLink>
            <NavLink to="/draft">選秀</NavLink>
            <NavLink to="/league">聯盟</NavLink>
            {admin && <NavLink to="/admin">系統</NavLink>}
          </nav>
        )}
      </header>
      {system?.demo && (
        <div className="demo-bar">
          Demo 模式：資料為模擬賽季（虛構球員），目前模擬時間 {system.now.slice(0, 16).replace('T', ' ')}
        </div>
      )}
    </>
  )
}

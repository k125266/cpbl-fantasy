import { Bell, CaretDown, Gear, ShieldCheck, SignOut } from '@phosphor-icons/react'
import { useEffect, useRef, useState } from 'react'
import { Link, NavLink, useLocation } from 'react-router-dom'
import { useApp } from './App'
import { api, type DraftView, type Notification, type PostseasonView, type SystemInfo } from './api'
import { alpha, TeamIcon } from './teamIdentity'
import { fantasyTeamColor } from './teams'

/**
 * 網頁版（≥1024px）頂部導覽列（設計稿「網頁版全版面」「WebNav」）。手機版仍用 TopBar＋Dock。
 * 「選秀」只在選秀期出現、「季後賽」只在有賽程時出現（比賽中帶紅點）；選單沒有改密碼（E21 待辦）。
 */

/** 通知鈴鐺的未讀數；換頁時重新讀取。手機版 TopBar 與網頁版導覽列共用。 */
export function useUnread(leagueId: number) {
  const { pathname } = useLocation()
  const [unread, setUnread] = useState(0)
  useEffect(() => {
    api.get<Notification[]>(`/api/leagues/${leagueId}/notifications`).then((ns) => setUnread(ns.filter((n) => !n.read).length)).catch(() => {})
  }, [leagueId, pathname])
  return unread
}

/** Demo／重播模式的提示文字；正式環境為 undefined。 */
export function demoNote(system: SystemInfo | null) {
  if (system?.demo) return `Demo 模式・模擬賽季（虛構球員）・模擬時間 ${system.now.slice(5, 16).replace('T', ' ')}`
  if (system?.source === 'replay') return `重播模式・${system.seasonYear} 真實球季・重播時間 ${system.now.slice(5, 16).replace('T', ' ')}`
  return undefined
}

export function WebNav() {
  const { user, league, leagueId, system, logout } = useApp()
  const { pathname } = useLocation()
  const unread = useUnread(leagueId)
  const [drafts, setDrafts] = useState<DraftView[]>([])
  const [post, setPost] = useState<PostseasonView | null>(null)
  const [open, setOpen] = useState(false)
  const menu = useRef<HTMLDivElement>(null)

  // 選秀分頁是否出現、季後賽有沒有賽程與進行中的比賽：換頁時讀取，季後賽另外每分鐘更新（紅點）
  useEffect(() => {
    api.get<DraftView[]>(`/api/leagues/${leagueId}/drafts`).then(setDrafts).catch(() => setDrafts([]))
  }, [leagueId, pathname])
  useEffect(() => {
    const load = () => api.get<PostseasonView>(`/api/postseason?leagueId=${leagueId}`).then(setPost).catch(() => setPost(null))
    load()
    const t = setInterval(load, 60_000)
    return () => clearInterval(t)
  }, [leagueId])
  useEffect(() => setOpen(false), [pathname])
  useEffect(() => {
    if (!open) return
    const away = (e: PointerEvent) => { if (!menu.current?.contains(e.target as Node)) setOpen(false) }
    const esc = (e: KeyboardEvent) => { if (e.key === 'Escape') setOpen(false) }
    document.addEventListener('pointerdown', away)
    document.addEventListener('keydown', esc)
    return () => {
      document.removeEventListener('pointerdown', away)
      document.removeEventListener('keydown', esc)
    }
  }, [open])

  const showDraft = pathname.startsWith('/draft') || drafts.some((d) => d.status !== 'COMPLETED')
  const showPost = (post?.series.length ?? 0) > 0
  const postLive = !!post?.series.some((s) => s.games.some((g) => g.status === 'IN_PROGRESS'))
  const tabs: { to: string; label: string; end?: boolean; dot?: boolean }[] = [
    { to: '/', label: '隊伍', end: true },
    { to: '/matchups', label: '對戰' },
    { to: '/players', label: '球員' },
    { to: '/league', label: '聯盟' },
    ...(showDraft ? [{ to: '/draft', label: '選秀' }] : []),
    ...(showPost ? [{ to: '/postseason', label: '季後賽', dot: postLive }] : []),
  ]
  const teams = league?.teams ?? []
  const mine = teams.find((t) => t.id === league?.myTeamId)
  const color = mine ? fantasyTeamColor(mine.id, teams) : '#8d95a4'
  const note = demoNote(system)
  const avatar = (size: number, icon: number) => (
    <span className="wav" style={{ width: size, height: size, background: alpha(color, 0.14), boxShadow: `inset 0 0 0 1.5px ${color}`, color }}>
      <TeamIcon icon={mine?.icon} color={color} size={icon} />
    </span>
  )

  return (
    <header className="wn">
      <div className="wn-bar">
        <div className="wn-in">
          <div className="wn-brand"><b>CPBL</b><span>FANTASY</span></div>
          <nav className="wn-tabs" aria-label="主選單">
            {tabs.map((t) => (
              <NavLink key={t.to} to={t.to} end={t.end}>{t.label}{t.dot && <i className="live" aria-label="比賽中" />}</NavLink>
            ))}
          </nav>
          <span className="sp" />
          <Link className="wn-bell" to="/notifications" aria-label="通知" title="通知">
            <Bell weight="fill" size={20} />
            {unread > 0 && <span className="n">{unread > 9 ? '9+' : unread}</span>}
          </Link>
          <div className="wn-me" ref={menu}>
            <button type="button" className="who" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen(!open)}>
              {avatar(30, 17)}
              <span className="tx"><b>{mine?.name ?? user.displayName}</b><small>{mine?.owner ?? ''}</small></span>
              <CaretDown weight="fill" size={11} />
            </button>
            {open && (
              <div className="wn-menu" role="menu">
                <div className="hd">
                  {avatar(38, 21)}
                  <div><b>{mine?.name ?? user.displayName}</b><small>{mine?.owner ? `${mine.owner}・` : ''}{league?.league.name}</small></div>
                </div>
                <Link role="menuitem" to="/privacy"><ShieldCheck weight="fill" size={16} />隱私・資料來源</Link>
                {user.admin && <Link role="menuitem" to="/admin"><Gear weight="fill" size={16} />系統管理</Link>}
                <button type="button" role="menuitem" className="out" onClick={logout}><SignOut weight="fill" size={16} />登出</button>
              </div>
            )}
          </div>
        </div>
      </div>
      {note && <div className="wn-demo">{note}</div>}
    </header>
  )
}

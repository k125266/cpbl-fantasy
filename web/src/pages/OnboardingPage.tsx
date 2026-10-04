import { useEffect, useRef, useState, type CSSProperties } from 'react'
import { Link } from 'react-router-dom'
import { api, type InvitePreview, type League, type LeagueDetail, type User } from '../api'
import { alpha, TEAM_COLORS, TEAM_ICON_NAMES, TeamIcon } from '../teamIdentity'

/**
 * 登入與加入聯盟（設計稿「登入與加入聯盟」）：帳號 → 聯盟 → 隊伍 → 入隊。
 *
 * <p>封閉註冊：新帳號在最後一步才和隊伍一起建立（邀請碼加入，或建盟碼建立聯盟），失敗時不會留下孤兒帳號。
 * 已登入但還沒有聯盟的人從第 2 步開始。手機單欄；寬螢幕（≥ 1024px）左側品牌、右側表單。
 */

type Step = 'auth' | 'hub' | 'team' | 'done'
const GOLD = '#d8b25a'
const STEPS = ['帳號', '聯盟', '隊伍', '入隊']

interface Done {
  kind: 'join' | 'create'
  icon: string
  color: string
  name: string
  abbr: string
  no: number
  league: string
  inviteCode: string | null
  teamCount: number
  maxTeams: number
}

function message(e: unknown): string {
  return e instanceof Error ? e.message : String(e)
}

export default function OnboardingPage({ user, onEnter, onLogout }: {
  /** 已登入但沒有聯盟時傳入；未登入為 null */
  user: User | null
  /** 完成或登入後已有聯盟：交回 App 載入聯盟 */
  onEnter: (u: User) => void
  onLogout: () => void
}) {
  const [step, setStep] = useState<Step>(user ? 'hub' : 'auth')
  const [me, setMe] = useState<User | null>(user)
  const [mode, setMode] = useState<'login' | 'reg'>('login')
  const [f, setF] = useState({ user: '', pass: '', name: '' })
  const [err, setErr] = useState<string | null>(null)
  const [code, setCode] = useState('')
  const [codeErr, setCodeErr] = useState<string | null>(null)
  const [preview, setPreview] = useState<InvitePreview | null>(null)
  const [kind, setKind] = useState<'join' | 'create'>('join')
  const [lgName, setLgName] = useState('')
  const [createCode, setCreateCode] = useState('')
  const [tm, setTm] = useState<{ name: string; abbr: string; ic: string | null; c: string | null }>({ name: '', abbr: '', ic: null, c: null })
  const [tErr, setTErr] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [done, setDone] = useState<Done | null>(null)
  const [shown, setShown] = useState(false)
  const [copied, setCopied] = useState(false)
  const [toast, setToast] = useState<string | null>(null)
  const timers = useRef<number[]>([])
  useEffect(() => () => timers.current.forEach((t) => window.clearTimeout(t)), [])

  const say = (m: string) => {
    setToast(m)
    timers.current.push(window.setTimeout(() => setToast(null), 2200))
  }

  const reg = mode === 'reg'
  const join = kind === 'join'
  const who = me?.displayName || f.name.trim() || f.user.trim() || '你'
  const taken = join && preview ? preview.teams : []
  const tc = tm.c ?? GOLD
  const idx = { auth: 0, hub: 1, team: 2, done: 3 }[step]
  const glow = step === 'team' || step === 'done' ? alpha(tc, .16) : 'rgba(216,178,90,.12)'
  const ready = tm.name.trim() && tm.ic && tm.c && (join || lgName.trim())

  // ---------- 第 1 步：帳號 ----------
  const submitAuth = async () => {
    if (!f.user.trim() || !f.pass) return setErr('請填帳號和密碼')
    if (reg && f.pass.length < 8) return setErr('密碼至少 8 個字')
    if (reg && !f.name.trim()) return setErr('請填顯示名稱')
    setErr(null)
    if (reg) {
      // 封閉註冊：帳號在最後一步和隊伍一起建立
      setStep('hub')
      return
    }
    setBusy(true)
    try {
      const u = await api.post<User>('/api/auth/login', { username: f.user.trim(), password: f.pass })
      const mine = await api.get<unknown[]>('/api/me/leagues')
      if (mine.length > 0) {
        onEnter(u)
        return
      }
      setMe(u)
      setStep('hub')
    } catch (e) {
      setErr(message(e))
    } finally {
      setBusy(false)
    }
  }

  // ---------- 第 2 步：聯盟 ----------
  const lookup = async () => {
    const c = code.trim()
    if (!c) return setCodeErr('請輸入邀請碼')
    setBusy(true)
    try {
      const p = await api.get<InvitePreview>(`/api/invites/${encodeURIComponent(c)}`)
      if (p.seasonStarted) return setCodeErr('這個聯盟已經產生賽程，無法再加入')
      if (p.teamCount >= p.maxTeams) return setCodeErr(`聯盟已滿（${p.maxTeams} 隊）`)
      setPreview(p)
      setKind('join')
      setTm({ name: '', abbr: '', ic: null, c: null })
      setTErr(null)
      setStep('team')
    } catch (e) {
      setCodeErr(message(e))
    } finally {
      setBusy(false)
    }
  }

  const goCreate = () => {
    setKind('create')
    setPreview(null)
    setTm({ name: '', abbr: '', ic: null, c: null })
    setTErr(null)
    setStep('team')
  }

  // ---------- 第 3 步：隊伍 ----------
  const submitTeam = async () => {
    if (!join && !lgName.trim()) return setTErr('請取一個聯盟名稱')
    if (!tm.name.trim()) return setTErr('請填隊名')
    if (!tm.ic || !tm.c) return setTErr('請選頭像和代表色')
    setTErr(null)
    setBusy(true)
    const team = { teamName: tm.name.trim(), teamAbbr: tm.abbr.trim(), teamIcon: tm.ic, teamColor: tm.c }
    try {
      let inviteCode: string | null = null
      if (me) {
        if (join) {
          await api.post('/api/leagues/join', { inviteCode: code.trim(), ...team })
        } else {
          const l = await api.post<League>('/api/leagues', { name: lgName.trim(), createCode: createCode.trim() || null, ...team })
          inviteCode = l.inviteCode ?? null
        }
      } else {
        const u = await api.post<User>('/api/auth/register', {
          username: f.user.trim(), password: f.pass, displayName: f.name.trim(),
          inviteCode: join ? code.trim() : null, createCode: join ? null : createCode.trim() || null,
          leagueName: join ? null : lgName.trim(), ...team,
        })
        setMe(u)
        if (!join) {
          const mine = await api.get<{ leagueId: number }[]>('/api/me/leagues')
          if (mine.length > 0) inviteCode = (await api.get<LeagueDetail>(`/api/leagues/${mine[0].leagueId}`)).inviteCode
        }
      }
      const count = join && preview ? preview.teamCount + 1 : 1
      setDone({
        kind, icon: tm.ic, color: tm.c, name: tm.name.trim(), abbr: tm.abbr.trim().toUpperCase() || '—', no: count,
        league: join && preview ? preview.leagueName : lgName.trim(), inviteCode, teamCount: count,
        maxTeams: join && preview ? preview.maxTeams : 5,
      })
      setStep('done')
      setShown(false)
      setCopied(false)
      timers.current.push(window.setTimeout(() => setShown(true), 80))
    } catch (e) {
      const m = message(e)
      // 帳號相關錯誤（帳號已被使用等）回到第 1 步修正
      if (!me && /帳號|密碼|顯示名稱/.test(m)) {
        setMode('reg')
        setErr(m)
        setStep('auth')
      } else {
        setTErr(m)
      }
    } finally {
      setBusy(false)
    }
  }

  const copy = () => {
    try {
      navigator.clipboard?.writeText(done?.inviteCode ?? '')
    } catch {
      // 剪貼簿不可用時只顯示，不中斷
    }
    setCopied(true)
  }

  const logout = async () => {
    if (me) await api.post('/api/auth/logout').catch(() => undefined)
    setMe(null)
    setF({ user: '', pass: '', name: '' })
    setStep('auth')
    onLogout()
  }

  // ---------- 畫面 ----------
  const authForm = (
    <>
      <div className="ob-seg">
        {([['login', '登入'], ['reg', '註冊']] as const).map(([k, t]) => (
          <button key={k} type="button" aria-pressed={mode === k} onClick={() => { setMode(k); setErr(null) }}>{t}</button>
        ))}
      </div>
      <form className="ob-fields" onSubmit={(e) => { e.preventDefault(); submitAuth() }}>
        <label>帳號<input value={f.user} onChange={(e) => setF({ ...f, user: e.target.value })} autoComplete="username" /></label>
        <label>密碼<input type="password" value={f.pass} placeholder={reg ? '至少 8 個字' : ''}
          onChange={(e) => setF({ ...f, pass: e.target.value })} autoComplete={reg ? 'new-password' : 'current-password'} /></label>
        {reg && <label>顯示名稱<input value={f.name} placeholder="朋友在聯盟裡看到的名字" onChange={(e) => setF({ ...f, name: e.target.value })} /></label>}
        {err && <div className="ob-err">{err}</div>}
        <button type="submit" className="ob-cta" disabled={busy}>{reg ? '註冊' : '登入'}</button>
      </form>
      <div className="ob-note">
        {reg ? <>註冊即表示同意<Link to="/privacy">隱私權政策</Link>。本站只蒐集帳號、顯示名稱與密碼雜湊，不用 email 或電話。註冊需要聯盟邀請碼或建盟碼，下一步輸入。</>
          : '忘記密碼請找聯盟管理員重設。'}
      </div>
    </>
  )

  const hub = (
    <>
      <div className="ob-kicker">STEP 2 · 聯盟</div>
      <div className="ob-title">嗨，{who}</div>
      <div className="ob-sub">你還沒有加入任何聯盟。</div>
      <div className="ob-box">
        <div className="ob-label">用邀請碼加入</div>
        <input className={`ob-code ${codeErr ? 'bad' : ''}`} value={code} maxLength={12} placeholder="XXXXXXXX" aria-label="邀請碼"
          onChange={(e) => { setCode(e.target.value.toUpperCase()); setCodeErr(null) }}
          onKeyDown={(e) => e.key === 'Enter' && lookup()} />
        {codeErr && <div className="ob-err">{codeErr}</div>}
        <div className="ob-row"><span className="ob-sp" /><button type="button" className="ob-btn" disabled={busy} onClick={lookup}>查詢聯盟</button></div>
      </div>
      <div className="ob-or"><span />或<span /></div>
      <button type="button" className="ob-create" onClick={goCreate}>
        <div><b>建立新聯盟</b><small>你會成為聯盟管理員，再把邀請碼傳給朋友</small></div>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="#8d95a4" strokeWidth="1.8"><path d="m9 18 6-6-6-6" /></svg>
      </button>
      <button type="button" className="ob-link" onClick={logout}>{me ? '登出' : '返回登入'}</button>
      {me?.admin && <Link className="ob-link" to="/admin">系統管理・建盟碼</Link>}
    </>
  )

  const slots = join && preview ? [
    ...preview.teams.map((t) => ({ n: t.name, c: t.color ?? '#c4cad4', ic: t.icon, mine: false, empty: false })),
    { n: tm.name.trim() || '你', c: tm.c ?? '#4a505c', ic: tm.ic, mine: true, empty: false },
    ...Array.from({ length: Math.max(0, preview.maxTeams - preview.teamCount - 1) }, () => ({ n: '空位', c: '#3a404c', ic: null, mine: false, empty: true })),
  ] : []

  const teamStep = (
    <>
      <button type="button" className="ob-back" onClick={() => { setStep('hub'); setTErr(null) }}>
        <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8"><path d="m15 18-6-6 6-6" /></svg>返回
      </button>
      <div className="ob-kicker">STEP 3 · 隊伍</div>
      <div className="ob-title sm">{join ? '加入聯盟，設定你的隊伍' : '建立聯盟，設定你的隊伍'}</div>
      {join && preview && (
        <div className="ob-league">
          <div className="hd"><b>{preview.leagueName}</b><span>{preview.teamCount} / {preview.maxTeams}</span></div>
          <div className="sub">管理員 {preview.commissioner}・H2H 類別・{preview.maxTeams} 隊・你是第 {preview.teamCount + 1} 隊</div>
          <div className="slots" style={{ gridTemplateColumns: `repeat(${slots.length}, 1fr)` }}>
            {slots.map((s, i) => (
              <div key={i} className={s.mine || s.empty ? 'dash' : ''} style={s.mine && tm.c ? { borderColor: alpha(tm.c, .6) } : undefined}>
                <span style={{ color: s.empty ? '#3a404c' : s.c }}><TeamIcon icon={s.ic} size={24} /></span>
                <i style={{ color: s.mine && tm.c ? 'var(--text)' : s.empty || (s.mine && !tm.c) ? 'var(--silver-lo)' : 'var(--silver)' }}>{s.n}</i>
              </div>
            ))}
          </div>
        </div>
      )}
      {!join && (
        <>
          <label className="ob-lab">聯盟名稱<input value={lgName} placeholder="例如：台北夜場聯盟" onChange={(e) => { setLgName(e.target.value); setTErr(null) }} /></label>
          {!me?.admin && (
            <label className="ob-lab">建盟碼<input value={createCode} placeholder="向系統管理員索取" maxLength={12}
              onChange={(e) => { setCreateCode(e.target.value.toUpperCase()); setTErr(null) }} /></label>
          )}
          <div className="ob-hint">預設 5 隊・H2H 類別 5×5・蛇形選秀，之後可在聯盟設定修改</div>
        </>
      )}
      <div className="ob-tname">
        <span className="pv" style={{ color: tm.c ?? '#3a404c' }}><TeamIcon icon={tm.ic} size={50} /></span>
        <input value={tm.name} placeholder="隊名" maxLength={40} onChange={(e) => { setTm({ ...tm, name: e.target.value }); setTErr(null) }} />
        <input className="abbr" value={tm.abbr} placeholder="縮寫" maxLength={6} onChange={(e) => setTm({ ...tm, abbr: e.target.value.toUpperCase() })} />
      </div>
      <div className="ob-label sm">{join ? '頭像・變暗的已被其他隊選走' : '頭像'}</div>
      <div className="ob-icons">
        {TEAM_ICON_NAMES.map((ic) => {
          const by = taken.find((t) => t.icon === ic)
          const on = tm.ic === ic
          return (
            <button key={ic} type="button" aria-label={ic} aria-pressed={on} disabled={false}
              className={by ? 'taken' : ''}
              style={{ borderColor: on ? 'rgba(216,178,90,.7)' : undefined, background: on ? alpha(tm.c ?? GOLD, .14) : undefined }}
              onClick={() => by ? say(`${by.name} 已經用了`) : setTm({ ...tm, ic })}>
              <span style={{ color: by ? '#6c7584' : on ? (tm.c ?? '#c4cad4') : '#c4cad4' }}><TeamIcon icon={ic} size={24} /></span>
              {by && <i style={{ background: by.color ?? '#6c7584' }} />}
            </button>
          )
        })}
      </div>
      <div className="ob-label sm">代表色</div>
      <div className="ob-colors">
        {TEAM_COLORS.map((c) => {
          const by = taken.find((t) => t.color === c)
          const on = tm.c === c
          return (
            <button key={c} type="button" aria-label={`代表色 ${c}`} aria-pressed={on}
              style={{ background: c, boxShadow: on ? `0 0 0 2px #0e1014,0 0 0 3.5px ${c}` : 'none', opacity: by ? .22 : 1, cursor: by ? 'not-allowed' : 'pointer' }}
              onClick={() => by ? say(`${by.name} 已經用了這個顏色`) : setTm({ ...tm, c })} />
          )
        })}
      </div>
      {tErr && <div className="ob-err">{tErr}</div>}
      <button type="button" className="ob-cta" style={{ opacity: ready ? 1 : .45 }} disabled={busy} onClick={submitTeam}>
        {join ? '加入聯盟' : '建立聯盟'}
      </button>
    </>
  )

  const card: CSSProperties | undefined = done ? {
    background: `linear-gradient(135deg,${alpha(done.color, .95)},${alpha(done.color, .25)} 55%,${alpha(done.color, .8)})`,
    boxShadow: `0 24px 60px rgba(0,0,0,.55),0 0 50px ${alpha(done.color, .22)}`,
    transform: shown ? 'rotateY(0deg) translateY(0)' : 'rotateY(-90deg) translateY(16px)',
    opacity: shown ? 1 : 0,
  } : undefined

  const doneStep = done && (
    <>
      <div className="ob-done-hd">
        <div className="ob-kicker c">{done.kind === 'join' ? 'WELCOME TO THE LEAGUE' : 'LEAGUE CREATED'}</div>
        <div className="ob-title sm">{done.kind === 'join' ? `歡迎加入${done.league}` : `${done.league} 成立了`}</div>
      </div>
      <div className="ob-card-wrap">
        <div className="ob-card" style={card}>
          <div className="in">
            <div className="grid" />
            <div className="top"><span>{done.abbr}</span><span>TEAM {String(done.no).padStart(2, '0')}</span></div>
            <span className="ic" style={{ color: done.color, filter: `drop-shadow(0 6px 24px ${alpha(done.color, .5)})` }}><TeamIcon icon={done.icon} size={104} /></span>
            <span className="ob-sp" />
            <div className="nm">{done.name}</div>
            <div className="ow">{who}{done.kind === 'create' ? '・聯盟管理員' : ''}</div>
            <div className="lg">{done.league}</div>
          </div>
        </div>
      </div>
      {done.kind === 'create' && done.inviteCode && (
        <div className="ob-box row">
          <div style={{ flex: 1 }}><div className="ob-sub" style={{ margin: 0 }}>邀請碼・傳給另外 4 位朋友</div><div className="ob-newcode">{done.inviteCode}</div></div>
          <button type="button" className="ob-btn plain" onClick={copy}>{copied ? '已複製' : '複製'}</button>
        </div>
      )}
      <div className="ob-done-note">
        {done.kind === 'create' ? `目前 1 / ${done.maxTeams} 隊，人到齊就能排選秀。`
          : done.teamCount >= done.maxTeams ? `${done.maxTeams} 隊到齊了。選秀日期由管理員安排，到時會通知你。`
            : `目前 ${done.teamCount} / ${done.maxTeams} 隊，人到齊後由管理員安排選秀。`}
      </div>
      <button type="button" className="ob-cta" onClick={() => me && onEnter(me)}>進入聯盟</button>
    </>
  )

  return (
    <div className="ob" style={{ ['--glow' as string]: glow }}>
      <aside className="ob-hero">
        <div className="wm">00</div>
        <div className="logo"><b>CPBL</b><span>FANTASY</span></div>
        <span className="ob-sp" />
        <div className="big">FIVE<br /><em>FRIENDS.</em><br />ONE<br />LEAGUE.</div>
        <p>中華職棒 fantasy baseball 私人聯盟。非商業、封閉、免費。</p>
        <ol className="ob-steps">
          {STEPS.map((t, i) => (
            <li key={t} className={i < idx ? 'past' : i === idx ? 'now' : ''}><span>{i + 1}</span>{t}</li>
          ))}
        </ol>
        <div className="ob-legal">與中華職業棒球大聯盟及各球團無隸屬關係・<Link to="/privacy">隱私・資料來源</Link></div>
      </aside>
      <main className={`ob-panel step-${step}`}>
        {step === 'auth' && (
          <>
            <div className="ob-brand">
              <div className="wm">00</div>
              <div className="logo"><b>CPBL</b><span>FANTASY</span></div>
              <p>中華職棒 fantasy baseball 私人聯盟。<br />非商業、封閉、免費。</p>
            </div>
            <div className="ob-auth-hd">
              <div className="ob-kicker">STEP 1 · 帳號</div>
              <div className="ob-title">{reg ? '建立帳號' : '歡迎回來'}</div>
            </div>
            {authForm}
            <span className="ob-sp" />
            <div className="ob-legal mobile">與中華職業棒球大聯盟及各球團無隸屬關係・<Link to="/privacy">隱私・資料來源</Link></div>
          </>
        )}
        {step === 'hub' && hub}
        {step === 'team' && teamStep}
        {step === 'done' && doneStep}
      </main>
      {toast && <div className="ob-toast" role="status">{toast}</div>}
    </div>
  )
}

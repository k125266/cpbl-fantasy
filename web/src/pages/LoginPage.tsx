import { useState } from 'react'
import { Link } from 'react-router-dom'
import { api, type User } from '../api'
import { ErrorBox } from '../components'

export default function LoginPage({ onLogin }: { onLogin: (u: User) => void }) {
  const [mode, setMode] = useState<'login' | 'register'>('login')
  const [form, setForm] = useState({ username: '', password: '', displayName: '', inviteCode: '', teamName: '', teamAbbr: '' })
  const [error, setError] = useState<unknown>(null)
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [k]: e.target.value })

  const submit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    try {
      const u =
        mode === 'login'
          ? await api.post<User>('/api/auth/login', { username: form.username, password: form.password })
          : await api.post<User>('/api/auth/register', form)
      onLogin(u)
    } catch (err) {
      setError(err)
    }
  }

  return (
    <div className="center-box">
      <h1>CPBL Fantasy</h1>
      <p className="muted small">中華職棒 fantasy baseball 私人聯盟。非商業、封閉、免費。</p>
      <div className="card">
        <div className="row" style={{ marginBottom: 12 }}>
          <button className={mode === 'login' ? 'primary' : ''} onClick={() => setMode('login')}>登入</button>
          <button className={mode === 'register' ? 'primary' : ''} onClick={() => setMode('register')}>以邀請碼註冊</button>
        </div>
        <ErrorBox error={error} />
        <form onSubmit={submit}>
          <label><span>帳號</span><input value={form.username} onChange={set('username')} autoComplete="username" required /></label>
          <label><span>密碼</span><input type="password" value={form.password} onChange={set('password')} autoComplete={mode === 'login' ? 'current-password' : 'new-password'} required /></label>
          {mode === 'register' && (
            <>
              <label><span>顯示名稱</span><input value={form.displayName} onChange={set('displayName')} required /></label>
              <label><span>邀請碼（向聯盟管理員索取；第一位使用者可留空）</span><input value={form.inviteCode} onChange={set('inviteCode')} /></label>
              <label><span>隊名</span><input value={form.teamName} onChange={set('teamName')} /></label>
              <label><span>隊名縮寫（最多 6 字）</span><input value={form.teamAbbr} onChange={set('teamAbbr')} maxLength={6} /></label>
              <p className="small muted">
                註冊即表示同意 <Link to="/privacy">隱私權政策</Link>。本站僅蒐集帳號、顯示名稱與密碼雜湊。
              </p>
            </>
          )}
          <button className="primary" type="submit">{mode === 'login' ? '登入' : '註冊'}</button>
        </form>
      </div>
    </div>
  )
}

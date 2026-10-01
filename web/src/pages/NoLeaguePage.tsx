import { useState } from 'react'
import { api } from '../api'
import { ErrorBox } from '../components'

export default function NoLeaguePage({ onJoined }: { onJoined: () => void }) {
  const [invite, setInvite] = useState({ inviteCode: '', teamName: '', teamAbbr: '' })
  const [create, setCreate] = useState({ name: '', teamName: '', teamAbbr: '' })
  const [error, setError] = useState<unknown>(null)

  const join = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/leagues/join', invite)
      onJoined()
    } catch (err) {
      setError(err)
    }
  }
  const createLeague = async (e: React.FormEvent) => {
    e.preventDefault()
    try {
      await api.post('/api/leagues', create)
      onJoined()
    } catch (err) {
      setError(err)
    }
  }
  return (
    <>
      <h1>尚未加入聯盟</h1>
      <ErrorBox error={error} />
      <div className="card">
        <h2>以邀請碼加入</h2>
        <form onSubmit={join}>
          <label><span>邀請碼</span><input value={invite.inviteCode} onChange={(e) => setInvite({ ...invite, inviteCode: e.target.value })} required /></label>
          <label><span>隊名</span><input value={invite.teamName} onChange={(e) => setInvite({ ...invite, teamName: e.target.value })} /></label>
          <label><span>縮寫</span><input value={invite.teamAbbr} maxLength={6} onChange={(e) => setInvite({ ...invite, teamAbbr: e.target.value })} /></label>
          <button className="primary">加入</button>
        </form>
      </div>
      <div className="card">
        <h2>建立新聯盟（你將成為聯盟管理員）</h2>
        <form onSubmit={createLeague}>
          <label><span>聯盟名稱</span><input value={create.name} onChange={(e) => setCreate({ ...create, name: e.target.value })} required /></label>
          <label><span>你的隊名</span><input value={create.teamName} onChange={(e) => setCreate({ ...create, teamName: e.target.value })} /></label>
          <label><span>縮寫</span><input value={create.teamAbbr} maxLength={6} onChange={(e) => setCreate({ ...create, teamAbbr: e.target.value })} /></label>
          <button className="primary">建立</button>
        </form>
      </div>
    </>
  )
}

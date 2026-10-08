import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useWide } from '../hooks'
import { KIND_LABEL, type ChampCard, type DerivedCards, type GameCard, type HlCard, type PsCardData } from './cards'
import PsCard from './PsCard'

/**
 * 紀念卡區塊（設計稿「季後賽紀念卡 v2」）：冠軍紀念（最上、最大）→ 高光限定 → 每戰紀念（依系列戰橫向排）。
 * 新卡先顯示封面（依卡種換色），點一下播開卡動畫；點已開的卡放大、翻面看詳細數據。
 * 開啟「減少動態效果」時不翻轉、不閃光，直接淡入。紀念用，不計分，不能交換。
 */

interface Overlay {
  mode: 'open' | 'view'
  id: string
  /** 開卡階段：0 封面浮起、1 亮兩下、2 翻到正面、3 顯示名稱與按鈕 */
  ph: number
  face: 'front' | 'back'
}

const KICK_COLOR: Record<string, string> = { hl: '#ff9a9e', champ: '#e6cf9c', game: '#c8ad7f' }

function useStill(): boolean {
  const q = '(prefers-reduced-motion: reduce)'
  const [still, setStill] = useState(() => window.matchMedia(q).matches)
  useEffect(() => {
    const m = window.matchMedia(q)
    const f = () => setStill(m.matches)
    m.addEventListener('change', f)
    return () => m.removeEventListener('change', f)
  }, [])
  return still
}

function Icon({ kind }: { kind: 'champ' | 'hl' | 'game' }) {
  const d = kind === 'champ'
    ? 'M7 3h10v3h3v2a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V6h3V3Zm-1 5a2 2 0 0 0 2 2V8H6Zm12 0h-2v2a2 2 0 0 0 2-2Z'
    : kind === 'hl'
      ? 'M12 2c.6 4.6 2.2 7.4 6 8-3.8.6-5.4 3.4-6 8-.6-4.6-2.2-7.4-6-8 3.8-.6 5.4-3.4 6-8Zm7 12c.3 2.2 1 3.4 3 3.7-2 .3-2.7 1.5-3 3.7-.3-2.2-1-3.4-3-3.7 2-.3 2.7-1.5 3-3.7Z'
      : 'M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-6.7 8h2.1a8 8 0 0 0 1.4-4.3A7 7 0 0 1 5.3 11Zm0 2a7 7 0 0 0 3.5 4.3A8 8 0 0 1 7.4 13H5.3Zm13.4 0h-2.1a8 8 0 0 1-1.4 4.3 7 7 0 0 0 3.5-4.3Zm0-2a7 7 0 0 0-3.5-4.3A8 8 0 0 1 16.6 11h2.1Z'
  return <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor" aria-hidden><path d={d} /></svg>
}

export default function CardsSection({ cards, seen, mark }: { cards: DerivedCards; seen: Set<string>; mark: (id: string) => void }) {
  const wide = useWide()
  const still = useStill()
  const [ov, setOv] = useState<Overlay | null>(null)
  const timers = useRef<ReturnType<typeof setTimeout>[]>([])

  const clearTimers = useCallback(() => { timers.current.forEach(clearTimeout); timers.current = [] }, [])
  useEffect(() => clearTimers, [clearTimers])

  const total = cards.flat.length
  const unseen = cards.flat.filter((c) => !seen.has(c.id))

  const open = useCallback((id: string) => {
    clearTimers()
    if (still) { setOv({ mode: 'open', id, ph: 3, face: 'front' }); mark(id); return }
    setOv({ mode: 'open', id, ph: 0, face: 'back' })
    timers.current.push(setTimeout(() => setOv({ mode: 'open', id, ph: 1, face: 'back' }), 60))
    timers.current.push(setTimeout(() => { setOv({ mode: 'open', id, ph: 2, face: 'front' }); mark(id) }, 1100))
    timers.current.push(setTimeout(() => setOv({ mode: 'open', id, ph: 3, face: 'front' }), 1950))
  }, [clearTimers, mark, still])

  const view = useCallback((id: string) => { clearTimers(); setOv({ mode: 'view', id, ph: 3, face: 'front' }) }, [clearTimers])
  const close = useCallback(() => { clearTimers(); setOv(null) }, [clearTimers])
  const skip = () => {
    if (!ov || ov.mode !== 'open' || ov.ph >= 2) return
    clearTimers()
    mark(ov.id)
    setOv({ ...ov, ph: 2, face: 'front' })
    timers.current.push(setTimeout(() => setOv((o) => (o ? { ...o, ph: 3 } : o)), 850))
  }
  const tap = (id: string) => (seen.has(id) ? view(id) : open(id))

  useEffect(() => {
    if (!ov) return
    const f = (e: KeyboardEvent) => { if (e.key === 'Escape') close() }
    window.addEventListener('keydown', f)
    return () => window.removeEventListener('keydown', f)
  }, [ov, close])

  if (total === 0) return null

  /** 列表上的一張卡：新卡顯示封面與「新」標 */
  const item = (c: PsCardData, size: number, caption: ReactNode, cls = '') => {
    const isNew = !seen.has(c.id)
    return (
      <button key={c.id} type="button" className={`pc-item ${cls}`} onClick={() => tap(c.id)} aria-label={c.cap1}>
        <span className="art">
          <PsCard card={c} size={size} face={isNew ? 'back' : 'front'} sealed={isNew} still={still} />
          {isNew && <span className="pc-new">新</span>}
        </span>
        {caption}
      </button>
    )
  }

  const champSize = wide ? 220 : 150, hlSize = wide ? 184 : 165, gameSize = wide ? 136 : 112

  const champ = (c: ChampCard) => {
    const isNew = !seen.has(c.id)
    return (
      <div key={c.id} className="pc-champ" role="button" tabIndex={0} onClick={() => tap(c.id)}
        onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); tap(c.id) } }}>
        <span className="art">
          <PsCard card={c} size={champSize} face={isNew ? 'back' : 'front'} sealed={isNew} still={still} />
          {isNew && <span className="pc-new">新</span>}
        </span>
        <div className="txt">
          <div className="kick">{c.serie}・{c.dateL}</div>
          <div className="ttl">{c.cap1}</div>
          <div className="l">系列戰 {c.score}・對{c.vs}</div>
          <div className="l">MVP {c.mvp.n}・{c.mvp.txt}</div>
          <div className={`cta${isNew ? ' new' : ''}`}>{isNew ? '新卡・點一下打開' : '點一下放大看'}</div>
        </div>
      </div>
    )
  }

  const hl = (c: HlCard) => {
    const isNew = !seen.has(c.id)
    return item(c, hlSize, (
      <>
        <span className={`cap1${isNew ? ' new' : ' hl'}`}>{isNew ? '新高光卡・點一下打開' : c.achText}</span>
        <span className="cap2">{isNew ? `${c.dateL}・${c.serie}` : `${c.p.n}・${c.serieS}・${c.dateS}`}</span>
      </>
    ), 'hl')
  }

  const game = (c: GameCard) => {
    const isNew = !seen.has(c.id)
    return item(c, gameSize, (
      <>
        <span className={`cap1${isNew ? ' new' : ''}`}>{isNew ? `第 ${c.no} 戰・新卡` : `第 ${c.no} 戰`}</span>
        <span className="cap2">{c.rows[0].s} {c.rows[0].R}：{c.rows[1].R} {c.rows[1].s}</span>
      </>
    ), 'game')
  }

  // ---------------- 覆蓋層：開卡、放大 ----------------
  const cur = ov ? cards.byId[ov.id] : undefined
  let overlay: ReactNode = null
  if (ov && cur && ov.mode === 'open') {
    const ph = ov.ph
    const next = cards.order.filter((x) => !seen.has(x.id) && x.id !== cur.id)
    const burst = cur.kind === 'champ'
      ? `radial-gradient(circle,${(cur as ChampCard).team.bg}66 0%,rgba(200,173,127,.18) 32%,transparent 62%)`
      : cur.kind === 'hl' ? 'radial-gradient(circle,rgba(216,67,75,.34) 0%,transparent 60%)' : 'radial-gradient(circle,rgba(236,223,196,.14) 0%,transparent 60%)'
    overlay = (
      <div className="pc-ov open" role="dialog" aria-modal="true" aria-label="開啟紀念卡" onClick={skip}>
        <div className="burst" style={{ background: burst, transform: still ? 'none' : ph >= 2 ? 'scale(1.15)' : 'scale(.55)', opacity: still ? 0.7 : ph >= 2 ? 1 : 0.35 }} />
        <div className="kicker" style={{ color: KICK_COLOR[cur.kind] }}>{ph >= 2 ? `新紀念卡・${cur.label}` : '新紀念卡・點一下直接打開'}</div>
        <div className="stage" style={{ transform: still || ph > 0 ? 'none' : 'scale(.82) translateY(18px)', opacity: ph === 0 && !still ? 0 : 1 }}>
          <PsCard card={cur} size={wide ? 320 : 250} face={ph >= 2 ? 'front' : 'back'} sealed={ph < 2} glow={ph === 1} sweep={ph >= 2} anim still={still} />
        </div>
        <div className="cap" style={{ opacity: ph >= 3 ? 1 : 0 }}>
          <div className="c1">{cur.cap1}</div>
          <div className="c2">{cur.cap2}</div>
          <div className="btns">
            <button type="button" className="ghost" onClick={(e) => { e.stopPropagation(); view(cur.id) }}>放大看</button>
            <button type="button" className="gold" onClick={(e) => { e.stopPropagation(); if (next.length) open(next[0].id); else close() }}>
              {next.length ? `打開下一張（還有 ${next.length} 張）` : '收進紀念卡'}
            </button>
          </div>
        </div>
      </div>
    )
  } else if (ov && cur) {
    const back = ov.face === 'back'
    overlay = (
      <div className="pc-ov view" role="dialog" aria-modal="true" aria-label="紀念卡" onClick={close}>
        <div className="panel" onClick={(e) => e.stopPropagation()}>
          <div className="top">
            <span className="kicker" style={{ color: KICK_COLOR[cur.kind] }}>{cur.label}・{cur.serie}</span>
            <button type="button" className="x" onClick={close} aria-label="關閉">✕</button>
          </div>
          <button type="button" className="cardface" onClick={() => setOv({ ...ov, face: back ? 'front' : 'back' })} aria-label="翻面">
            <PsCard card={cur} size={wide ? 340 : 280} face={ov.face} anim still={still} />
          </button>
          <div className="side">
            <div className="c1">{cur.cap1}</div>
            <div className="c2">{cur.cap2}</div>
            <p className="desc">{cur.desc}</p>
            <button type="button" className="ghost" onClick={() => setOv({ ...ov, face: back ? 'front' : 'back' })}>{back ? '看正面' : '翻面看詳細數據'}</button>
          </div>
        </div>
      </div>
    )
  }

  return (
    <section className="pc" id="cards">
      <div className="pc-head">
        <span>紀念卡 · 已收到 {total} 張</span>
        {unseen.length > 0 && <em className="new"><i />{unseen.length} 張新卡{wide ? '，點封面打開' : ''}</em>}
      </div>
      <p className="pc-desc">每場結束全聯盟都會收到紀念卡；你名單上的球員有高光表現，另外得到限定卡。紀念用，不計分。</p>

      {cards.champs.length > 0 && (
        <>
          <div className="pc-gh champ"><span className="ico"><Icon kind="champ" /></span><div><div className="t"><b>{KIND_LABEL.champ}</b><span className="n">{cards.champs.length} 張</span></div><small>系列戰結束時，全聯盟都會收到</small></div></div>
          <div className="pc-champs">{cards.champs.map(champ)}</div>
        </>
      )}
      {cards.hls.length > 0 && (
        <>
          <div className="pc-gh hl"><span className="ico"><Icon kind="hl" /></span><div><div className="t"><b>{KIND_LABEL.hl}</b><span className="n">{cards.hls.length} 張</span></div><small>你名單上的球員達標才有，只屬於你</small></div></div>
          <div className="pc-hls">{cards.hls.map(hl)}</div>
        </>
      )}
      <div className="pc-gh game"><span className="ico"><Icon kind="game" /></span><div><div className="t"><b>{KIND_LABEL.game}</b><span className="n">{cards.groups.reduce((n, g) => n + g.cards.length, 0)} 張</span></div><small>每場結束，全聯盟都會收到{wide ? '' : '・左右滑動'}</small></div></div>
      {cards.groups.map((g) => (
        <div key={g.kind} className="pc-games">
          <div className="gt"><b>{g.title}</b><span>{g.sub}</span></div>
          <div className="rw">{g.cards.map(game)}</div>
        </div>
      ))}
      <p className="pc-foot">季後賽不計入 fantasy 計分。紀念卡只供收藏與分享，不能交換。</p>
      {overlay}
    </section>
  )
}

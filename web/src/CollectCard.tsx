import { useMemo, useRef, useState, type CSSProperties, type PointerEvent } from 'react'
import { useApp } from './App'
import type { CardData } from './api'
import { tierOf, TIER_LABEL, type Tier } from './components'
import { cpblTeam, fantasyTeamColor } from './teams'

/**
 * 收藏卡（設計稿 CollectCard.dc.html、球員卡規範）。
 *
 * <p>以 240×336 為基準繪製，依 size 等比縮放。平常靜止，指標移上去才傾斜、反光；可翻面看卡片履歷與成就印章。
 * 依規則書 10.2 不放照片、隊徽，球隊只用簡稱文字加代表色；卡背印非官方聲明。純展示，不可交易或兌換。
 */

interface TierStyle {
  /** 稀有度鑽石數（◆） */
  d: number
  ink: string
  /** 紋理線條色 */
  gl: string
  line: string
  frame: string
  fsize: string
  num: string
  holo: string
  /** 指標在卡上時的全息強度、平常的強度 */
  ho: number
  rest: number
  inset: string
  glare: number
  pad: string
  /** 玫瑰紋路透明度（0 = 不畫） */
  ro: number
  shadow: string
  calm: string
}

// 數值照設計稿 CollectCard.dc.html
const TIERS: Record<Tier, TierStyle> = {
  legend: {
    d: 4, ink: '#f6e1a2', gl: 'rgba(246,225,162,.05)', line: 'rgba(246,225,162,.32)', fsize: '300% 300%',
    frame: 'linear-gradient(125deg,#f6e1a2 0%,#a8e6d6 18%,#c3b4ff 36%,#ffbfd3 54%,#f6e1a2 72%,#a8e6d6 90%,#c3b4ff 100%)',
    num: 'linear-gradient(160deg,#fff4cf 0%,#f6e1a2 22%,#a8e6d6 48%,#c3b4ff 72%,#ffbfd3 100%)',
    holo: 'linear-gradient(115deg,transparent 22%,rgba(255,120,170,.5) 36%,rgba(255,225,120,.5) 44%,rgba(120,255,205,.5) 52%,rgba(120,170,255,.5) 60%,transparent 76%)',
    ho: .55, rest: .07, inset: 'rgba(246,225,162,.32)', glare: .24, pad: '5px', ro: .42,
    shadow: '0 20px 50px rgba(0,0,0,.55),0 0 50px rgba(195,180,255,.2)', calm: '0 12px 28px rgba(0,0,0,.45),0 0 28px rgba(195,180,255,.1)',
  },
  gold: {
    d: 3, ink: '#d8b25a', gl: 'rgba(216,178,90,.05)', line: 'rgba(216,178,90,.32)', fsize: '100% 100%',
    frame: 'linear-gradient(135deg,#f6e1a2 0%,#d8b25a 42%,#8d6a20 100%)', num: 'linear-gradient(180deg,#f6e1a2,#d8b25a 60%,#8d6a20)',
    holo: 'linear-gradient(115deg,transparent 30%,rgba(246,225,162,.5) 44%,rgba(255,250,235,.4) 50%,rgba(246,225,162,.5) 56%,transparent 70%)',
    ho: .4, rest: 0, inset: 'transparent', glare: .18, pad: '4px', ro: .3,
    shadow: '0 18px 40px rgba(0,0,0,.5),0 0 36px rgba(216,178,90,.14)', calm: '0 10px 24px rgba(0,0,0,.4)',
  },
  rare: {
    d: 2, ink: '#c4cad4', gl: 'transparent', line: 'rgba(196,202,212,.26)', fsize: '100% 100%',
    frame: 'linear-gradient(135deg,#f3f5f8 0%,#c4cad4 45%,#6c7584 100%)', num: 'linear-gradient(180deg,#f3f5f8,#c4cad4 55%,#6c7584)',
    holo: 'linear-gradient(115deg,transparent 34%,rgba(230,236,245,.45) 48%,rgba(230,236,245,.45) 52%,transparent 66%)',
    ho: .25, rest: 0, inset: 'transparent', glare: .14, pad: '3px', ro: 0,
    shadow: '0 16px 34px rgba(0,0,0,.45)', calm: '0 8px 20px rgba(0,0,0,.35)',
  },
  common: {
    d: 1, ink: '#c48455', gl: 'transparent', line: 'rgba(196,132,85,.24)', fsize: '100% 100%',
    frame: 'linear-gradient(135deg,#f0bf96 0%,#c48455 45%,#6e3f22 100%)', num: 'linear-gradient(180deg,#f0bf96,#c48455 55%,#6e3f22)',
    holo: 'none', ho: 0, rest: 0, inset: 'transparent', glare: .08, pad: '2px', ro: 0,
    shadow: '0 14px 30px rgba(0,0,0,.4)', calm: '0 6px 16px rgba(0,0,0,.3)',
  },
}

const STAMP_TILT = [-8, 6, -4, 10]
const roseCache = new Map<string, string>()

/** 玫瑰曲線紋路（設計稿同一套演算法）：七層同心曲線，形狀由種子決定，所以每張卡都不一樣。 */
function rose(seed: number, num: string | null): string {
  const key = `${seed}|${num ?? ''}`
  const hit = roseCache.get(key)
  if (hit) return hit
  let h = 7
  for (const v of [seed, Number(num) || 0]) h = (h * 31 + Math.round(v * 1000)) % 100003
  const n1 = 6 + h % 7, n2 = 13 + (h >> 3) % 11, a1 = 8 + h % 9, a2 = 3 + (h >> 5) % 5, ph = (h % 360) * Math.PI / 180
  let d = ''
  for (let j = 0; j < 7; j++) {
    const s = 1 - j * .085, rot = j * Math.PI / n1 / 2
    for (let i = 0; i <= 300; i++) {
      const a = i / 300 * Math.PI * 2, r = s * (66 + a1 * Math.cos(n1 * a) + a2 * Math.cos(n2 * a + ph))
      d += (i ? 'L' : 'M') + (r * Math.cos(a + rot)).toFixed(1) + ' ' + (r * Math.sin(a + rot)).toFixed(1)
    }
    d += 'Z'
  }
  roseCache.set(key, d)
  return d
}

function md(iso: string | null): string {
  if (!iso) return '—'
  const [, m, d] = iso.split('-')
  return `${Number(m)}/${Number(d)}`
}

function reducedMotion(): boolean {
  try {
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  } catch {
    return false
  }
}

export function CollectCard({ card, size = 240, face = 'front', flippable }: {
  card: CardData
  size?: number
  face?: 'front' | 'back'
  /** 預設：240 px 以上的完整卡可翻面，小卡不可 */
  flippable?: boolean
}) {
  const { league } = useApp()
  const tier = tierOf(card.rank)
  const t = TIERS[tier]
  const team = cpblTeam(card.cpblTeam)
  const canFlip = flippable ?? size >= 200
  const still = useMemo(reducedMotion, [])
  const [pt, setPt] = useState<{ x: number; y: number } | null>(null)
  const [flip, setFlip] = useState(face === 'back')
  const [flipping, setFlipping] = useState(false)
  const timer = useRef<number>(undefined)

  const hov = pt != null && !still
  const x = hov ? pt.x : .5, y = hov ? pt.y : .5
  const tiltY = hov ? (x - .5) * 18 : 0, tiltX = hov ? (.5 - y) * 14 : 0
  const hp = `${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%`
  const no = String(card.rank ?? 0).padStart(3, '0')
  const histColor = (h: CardData['hist'][number]) =>
    h.tone === 'gold' ? '#f6e1a2' : h.tone === 'muted' ? '#6c7584' : h.teamId != null ? fantasyTeamColor(h.teamId, league?.teams ?? []) : '#7b8cff'

  const move = (e: PointerEvent<HTMLDivElement>) => {
    const r = e.currentTarget.getBoundingClientRect()
    setPt({ x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) })
  }
  const toggle = () => {
    if (!canFlip) return
    window.clearTimeout(timer.current)
    setFlip(!flip)
    setFlipping(true)
    timer.current = window.setTimeout(() => setFlipping(false), 700)
  }

  const frame: CSSProperties = { padding: t.pad, background: t.frame, backgroundSize: t.fsize }
  const vars = { ['--ink' as string]: t.ink, ['--gl' as string]: t.gl, ['--cline' as string]: t.line, ['--inset' as string]: t.inset } as CSSProperties

  return (
    <div className="cc" style={{ width: size, height: size * 1.4, ...vars }}>
      <div className="cc-scale" style={{ transform: `scale(${size / 240})` }}>
        <div className="cc-persp" style={{ cursor: canFlip ? 'pointer' : 'default' }}
          onPointerMove={move} onPointerLeave={() => setPt(null)} onClick={toggle}
          role={canFlip ? 'button' : undefined} aria-label={`${card.name} ${TIER_LABEL[tier]} 收藏卡${canFlip ? '，點擊翻面' : ''}`}>
          <div className="cc-rot" style={{
            transform: `rotateX(${tiltX.toFixed(2)}deg) rotateY(${((flip ? 180 : 0) + tiltY).toFixed(2)}deg)`,
            transition: still ? 'none' : hov && !flipping ? 'transform .08s linear' : 'transform .7s cubic-bezier(.2,.7,.2,1)',
          }}>
            {/* 正面 */}
            <div className="cc-face" style={{ ...frame, backgroundPosition: hp, boxShadow: hov ? t.shadow : t.calm, visibility: flip ? 'hidden' : 'visible' }}>
              <div className="cc-in" style={{ background: `radial-gradient(130% 75% at 50% 0%,${team.bg}55 0%,${team.bg}14 45%,transparent 70%),linear-gradient(180deg,#1a1c22,#111216)` }}>
                <div className="cc-dots" />
                {t.ro > 0 && (
                  <svg className="cc-rose" viewBox="-100 -100 200 200" aria-hidden="true">
                    <path d={rose(card.seed, card.jerseyNumber)} fill="none" stroke={t.ink} strokeWidth=".45" opacity={t.ro} />
                  </svg>
                )}
                <div className="cc-inset" />
                <div className="cc-body">
                  <div className="cc-top"><span>NO.{no}</span><span className="cc-season">{league?.league.seasonYear ?? ''} · S1</span></div>
                  <div className="cc-numwrap"><span className="cc-num" style={{ backgroundImage: t.num }}>{card.jerseyNumber ?? ''}</span></div>
                  <div className="cc-team"><span style={{ background: team.bg, color: team.fg }}>{team.short}</span><b>{card.pos}</b></div>
                  <div className="cc-name">{card.name}</div>
                  <div className="cc-foot">
                    <span className="cc-tier"><span className="cc-dia"><i>{'◆'.repeat(t.d)}</i>{'◆'.repeat(4 - t.d)}</span><b>{TIER_LABEL[tier]}</b></span>
                    <span className="cc-line">{card.line}</span>
                  </div>
                </div>
                <div className="cc-holo" style={{ background: t.holo, backgroundSize: '250% 250%', backgroundPosition: hp, opacity: hov ? t.ho : t.rest }} />
                <div className="cc-glare" style={{ background: `radial-gradient(circle at ${(x * 100).toFixed(1)}% ${(y * 100).toFixed(1)}%,rgba(255,255,255,${hov ? t.glare : 0}),transparent 55%)` }} />
              </div>
            </div>
            {/* 背面 */}
            <div className="cc-face cc-back" style={{ ...frame, boxShadow: t.shadow, visibility: flip ? 'visible' : 'hidden' }}>
              <div className="cc-in cc-in-back">
                <div className="cc-hatch" />
                <div className="cc-inset" />
                <div className="cc-body cc-body-back">
                  <div className="cc-top"><span>NO.{no} / {card.totalRanked}</span><span>{TIER_LABEL[tier]}</span></div>
                  <div className="cc-bname">
                    <b>{card.name}</b><em>#{card.jerseyNumber ?? ''}</em><span className="cc-sp" />
                    <span className="cc-chip" style={{ background: team.bg, color: team.fg }}>{team.short}</span><i>{card.pos}</i>
                  </div>
                  <div className="cc-stats">{card.stats.map((s) => <div key={s.k}><small>{s.k}</small><b>{s.v}</b></div>)}</div>
                  <div className="cc-sec">卡片履歷 · PROVENANCE</div>
                  <div className="cc-hist">
                    {card.hist.length === 0 && <div className="cc-none">本季尚無紀錄</div>}
                    {card.hist.map((h, i) => (
                      <div key={i}><span className="d">{md(h.date)}</span><i style={{ background: histColor(h) }} /><span className="l">{h.label}</span></div>
                    ))}
                  </div>
                  <div className="cc-sec">成就印章 · STAMPS</div>
                  <div className="cc-stamps">
                    {card.stamps.map((s, i) => {
                      const on = s.date != null
                      return (
                        <div key={s.label} style={{
                          borderColor: on ? t.ink : '#3a404c', color: on ? t.ink : '#3a404c', background: on ? `${t.ink}14` : 'transparent',
                          transform: `rotate(${STAMP_TILT[i % 4]}deg)`,
                        }}>
                          <span>{s.label}</span><small>{on ? md(s.date) : '—'}</small>
                        </div>
                      )
                    })}
                  </div>
                  <span className="cc-sp" />
                  <div className="cc-legal">非官方私人聯盟遊戲卡。球員姓名與成績僅作遊戲資料使用；卡面紋路依球員產生，每張不同。</div>
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

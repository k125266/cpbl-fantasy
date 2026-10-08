import type { CSSProperties, ReactNode } from 'react'
import type { ChampCard, GameCard, HlCard, Ls, PsCardData } from './cards'

/**
 * 季後賽紀念卡本體（設計稿 PostseasonCard2）：以 240×336 為基準繪製，依 size 等比縮放。
 * 三種卡：每戰紀念（鋼藍、最低調）、高光限定（深紅、橫幅式成就名稱）、冠軍紀念（香檳金、上半鋪勝隊色）。
 * 依規則書 10.2 不放照片與隊徽，球隊只用簡稱色塊，球員用背號；每張都印「紀念用，不計分」。
 *
 * <p>face 是要看的那一面；sealed 是還沒打開的新卡（封面）；anim 讓兩面都存在，才有翻轉動畫；
 * still 是「減少動態效果」：不翻轉、不閃光，直接淡入。
 */

const cache = new Map<string, CSSProperties>()
/** 把設計稿的內嵌 CSS 字串轉成 React 的 style 物件，讓版面可以和設計稿逐字對照 */
function st(css: string): CSSProperties {
  const hit = cache.get(css)
  if (hit) return hit
  const out: Record<string, string> = {}
  for (const part of css.split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    const k = part.slice(0, i).trim(), v = part.slice(i + 1).trim()
    if (!k) continue
    out[k.startsWith('--') ? k : k.replace(/^-(\w)/, (_, c: string) => c.toUpperCase()).replace(/-(\w)/g, (_, c: string) => c.toUpperCase())] = v
  }
  cache.set(css, out)
  return out
}

const KIND = {
  game: {
    pad: '3px', fsize: '100% 100%', label: '每戰紀念', ink: '#a9b8cc', icon: 'game', shadow: '0 10px 18px rgba(0,0,0,.45)',
    frame: 'linear-gradient(160deg,#c9d3e0 0%,#6d7b90 30%,#2a3342 55%,#6d7b90 80%,#c9d3e0 100%)', inner: 'linear-gradient(180deg,#1e2733,#121820)',
    cover: 'linear-gradient(180deg,#2a3546,#141a24)',
  },
  hl: {
    pad: '5px', fsize: '100% 100%', label: '高光限定', ink: '#ff9a9e', icon: 'hl', shadow: '0 14px 26px rgba(120,20,30,.45)',
    frame: 'linear-gradient(150deg,#ffb3b5 0%,#c23440 16%,#5a1219 48%,#a3262f 78%,#ffb3b5 100%)', inner: 'linear-gradient(180deg,#3a1016,#170a0c)',
    cover: 'linear-gradient(180deg,#7a1a24,#2a0c11)',
  },
  champ: {
    pad: '6px', fsize: '200% 100%', label: '冠軍紀念', ink: '#ffe9a8', icon: 'champ', shadow: '0 16px 34px rgba(226,191,106,.32)',
    frame: 'linear-gradient(115deg,#fff6dc 0%,#e2bf6a 14%,#8a6420 28%,#ffe9a8 40%,#b98d2c 54%,#fff6dc 66%,#e2bf6a 80%,#8a6420 90%,#fff6dc 100%)', inner: 'linear-gradient(180deg,#17130c,#0d0b08)',
    cover: 'linear-gradient(180deg,#6b4c14,#1c140a)',
  },
} as const

/** 封面中央的圖示（用 inline SVG，不依賴圖示字型） */
function KindIcon({ kind, color }: { kind: keyof typeof KIND; color: string }) {
  const common = { width: 46, height: 46, viewBox: '0 0 24 24', fill: color } as const
  if (kind === 'champ') {
    return <svg {...common}><path d="M7 3h10v3h3v2a4 4 0 0 1-4 4h-.3A5 5 0 0 1 13 15.9V18h3v3H8v-3h3v-2.1A5 5 0 0 1 8.3 12H8a4 4 0 0 1-4-4V6h3V3Zm-1 5a2 2 0 0 0 2 2V8H6Zm12 0h-2v2a2 2 0 0 0 2-2Z" /></svg>
  }
  if (kind === 'hl') {
    return <svg {...common}><path d="M12 2c.6 4.6 2.2 7.4 6 8-3.8.6-5.4 3.4-6 8-.6-4.6-2.2-7.4-6-8 3.8-.6 5.4-3.4 6-8Zm7 12c.3 2.2 1 3.4 3 3.7-2 .3-2.7 1.5-3 3.7-.3-2.2-1-3.4-3-3.7 2-.3 2.7-1.5 3-3.7Z" /></svg>
  }
  return <svg {...common}><path d="M12 3a9 9 0 1 0 0 18 9 9 0 0 0 0-18Zm-6.7 8h2.1a8 8 0 0 0 1.4-4.3A7 7 0 0 1 5.3 11Zm0 2a7 7 0 0 0 3.5 4.3A8 8 0 0 1 7.4 13H5.3Zm13.4 0h-2.1a8 8 0 0 1-1.4 4.3 7 7 0 0 0 3.5-4.3Zm0-2a7 7 0 0 0-3.5-4.3A8 8 0 0 1 16.6 11h2.1Z" /></svg>
}

const CLIP14 = 'clip-path:polygon(14px 0,calc(100% - 14px) 0,100% 14px,100% calc(100% - 14px),calc(100% - 14px) 100%,14px 100%,0 calc(100% - 14px),0 14px)'
const clip = (n: number) => `clip-path:polygon(${n}px 0,calc(100% - ${n}px) 0,100% ${n}px,100% calc(100% - ${n}px),calc(100% - ${n}px) 100%,${n}px 100%,0 calc(100% - ${n}px),0 ${n}px)`

/** 迷你逐局比分（卡面用） */
function MiniLs({ ls, headColor }: { ls: Ls; headColor: string }) {
  if (ls.heads.length === 0) return null
  const cols = `24px repeat(${ls.heads.length},minmax(0,1fr)) 17px 17px`
  return (
    <div style={st('border-top:1px solid #2c3644;padding-top:3px')}>
      <div style={{ ...st(`display:grid;align-items:center;height:13px;font:600 8.5px 'Barlow Condensed';color:${headColor};text-align:center`), gridTemplateColumns: cols }}>
        <span />{ls.heads.map((h) => <span key={h}>{h}</span>)}<span>R</span><span>H</span>
      </div>
      {ls.rows.map((r) => (
        <div key={r.s} style={{ ...st("display:grid;align-items:center;height:15px;font:600 10.5px 'Barlow Condensed';text-align:center"), gridTemplateColumns: cols }}>
          <span style={st(`width:20px;height:11px;border-radius:2px;background:${r.bg};color:${r.fg};font:700 7.5px/11px 'Noto Sans TC'`)}>{r.s}</span>
          {r.cells.map((x, i) => <span key={i} style={{ color: x.c }}>{x.v}</span>)}
          <span style={{ fontWeight: 700, color: r.col }}>{r.R}</span>
          <span style={{ color: '#8d95a4' }}>{r.H}</span>
        </div>
      ))}
    </div>
  )
}

function GameFront({ c }: { c: GameCard }) {
  return (
    <div style={st(`position:absolute;inset:0;padding:3px;box-sizing:border-box;${CLIP14};background:linear-gradient(160deg,#c9d3e0 0%,#6d7b90 30%,#2a3342 55%,#6d7b90 80%,#c9d3e0 100%)`)}>
      <div style={st(`position:relative;width:100%;height:100%;${clip(12)};background:linear-gradient(180deg,#1e2733,#121820)`)}>
        <div style={{ height: 5, background: c.band }} />
        <div style={st('display:flex;flex-direction:column;gap:7px;height:calc(100% - 5px);box-sizing:border-box;padding:9px 13px 9px')}>
          <div style={st('display:flex;justify-content:space-between;align-items:center;gap:8px;white-space:nowrap')}>
            <span style={st('font-size:26px;font-weight:900;line-height:1.1')}>第 {c.no} 戰</span>
            <div style={{ textAlign: 'right' }}>
              <div style={st('font-size:10px;font-weight:700;color:#a9b8cc')}>{c.serie}・每戰紀念</div>
              <div style={st('font-size:10px;color:#8d95a4')}>{c.dateL}</div>
            </div>
          </div>
          <div style={st('display:flex;flex-direction:column;gap:5px')}>
            {c.rows.map((t) => (
              <div key={t.s} style={st('display:flex;align-items:center;gap:8px')}>
                <span style={st(`flex:none;width:34px;height:20px;border-radius:3px;background:${t.bg};color:${t.fg};font-size:11px;font-weight:700;display:flex;align-items:center;justify-content:center`)}>{t.s}</span>
                <span style={st(`flex:1;min-width:0;font-size:12px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;color:${t.col};font-weight:${t.w}`)}>{t.n}</span>
                <span style={st(`font:700 30px/1 'Barlow Condensed';color:${t.col}`)}>{t.R}</span>
              </div>
            ))}
          </div>
          <MiniLs ls={c.ls} headColor="#6c7584" />
          <div style={st('display:flex;flex-direction:column;gap:5px;border-top:1px solid #2c3644;padding-top:6px')}>
            {c.best.map((x) => (
              <div key={x.l} style={st('display:grid;grid-template-columns:40px 18px minmax(0,1fr);gap:6px;align-items:center')}>
                <span style={st('font-size:9px;color:#a9b8cc;white-space:nowrap')}>{x.l}</span>
                <span style={st(`width:18px;height:18px;border-radius:4px;background:${x.bg};color:${x.fg};font:700 10.5px/18px 'Barlow Condensed';text-align:center`)}>{x.num}</span>
                <div style={{ minWidth: 0 }}>
                  <div style={st('display:flex;align-items:baseline;gap:4px;white-space:nowrap')}>
                    <span style={st('font-size:11.5px;font-weight:600')}>{x.n}</span><span style={st('font-size:9px;color:#6c7584')}>{x.s}</span>
                  </div>
                  <div style={st('font-size:9.5px;color:#c4cad4;white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{x.txt}</div>
                </div>
              </div>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <div style={st('display:flex;align-items:center;justify-content:space-between;gap:6px;padding:5px 8px;border-radius:4px;border:1px solid rgba(169,184,204,.28);background:rgba(169,184,204,.07);white-space:nowrap')}>
            <span style={st('font-size:10.5px;font-weight:600')}>{c.after}</span><span style={st('font-size:8.5px;color:#8d95a4')}>{c.afterNote}</span>
          </div>
          <div style={st('display:flex;justify-content:space-between;font-size:8.5px;color:#6c7584;white-space:nowrap')}>
            <span>紀念用，不計分</span><span style={st("font:600 8.5px 'Barlow Condensed';letter-spacing:.18em")}>POSTSEASON 2026</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function HlFront({ c }: { c: HlCard }) {
  return (
    <div style={st(`position:absolute;inset:0;padding:5px;box-sizing:border-box;${CLIP14};background:linear-gradient(150deg,#ffb3b5 0%,#c23440 16%,#5a1219 48%,#a3262f 78%,#ffb3b5 100%)`)}>
      <div style={st(`position:relative;width:100%;height:100%;overflow:hidden;${clip(11)};background:radial-gradient(110% 50% at 50% 58%,${c.p.glow} 0%,transparent 70%),linear-gradient(180deg,#4a121a 0%,#2a0c11 55%,#170a0c 100%)`)}>
        <div style={st('position:absolute;left:5px;top:96px;bottom:30px;width:7px;background:repeating-linear-gradient(-38deg,transparent 0 3px,#ff6b72 3px 4.6px,transparent 4.6px 7px);opacity:.85')} />
        <div style={st('position:absolute;right:5px;top:96px;bottom:30px;width:7px;background:repeating-linear-gradient(38deg,transparent 0 3px,#ff6b72 3px 4.6px,transparent 4.6px 7px);opacity:.85')} />
        <div style={st('position:relative;display:flex;flex-direction:column;height:100%;box-sizing:border-box;padding:10px 0 9px')}>
          <div style={st('display:flex;justify-content:space-between;align-items:baseline;padding:0 14px;white-space:nowrap')}>
            <span style={st('font-size:10px;font-weight:700;color:#ffb3b5')}>高光限定</span>
            <span style={st('font-size:10px;color:#e8c9cb')}>{c.serieS}・{c.dateS}</span>
          </div>
          <div style={st('margin-top:8px;padding:6px 10px 7px;background:linear-gradient(90deg,#8f1d27,#c8343f 50%,#8f1d27);border-top:1px solid #ff8a8f;border-bottom:1px solid #ff8a8f;text-align:center')}>
            <div style={st(`font-size:${c.mainFs};font-weight:900;line-height:1.15;letter-spacing:.06em;color:#fff4ea;white-space:nowrap`)}>{c.main}</div>
            {c.hasMore && <div style={st('font-size:10px;font-weight:700;color:#ffd9da;margin-top:1px;white-space:nowrap')}>{c.more}</div>}
          </div>
          <div style={st('flex:1;min-height:0;display:flex;align-items:center;justify-content:center')}>
            <span style={st(`display:inline-block;font:800 92px/1 'Barlow Condensed';letter-spacing:-.02em;padding:0 4px;background-image:${c.p.grad};-webkit-background-clip:text;background-clip:text;-webkit-text-fill-color:transparent;color:transparent`)}>{c.p.num}</span>
          </div>
          <div style={{ padding: '0 18px' }}>
            <div style={st('display:flex;align-items:center;gap:6px')}>
              <span style={st(`background:${c.p.bg};color:${c.p.fg};font-size:10px;font-weight:600;border-radius:3px;padding:0 5px;line-height:16px`)}>{c.p.ts}</span>
              <span style={st("font:600 11.5px 'Barlow Condensed';letter-spacing:.08em;color:#e8c9cb")}>{c.p.pos}</span>
            </div>
            <div style={st('font-size:21px;font-weight:900;letter-spacing:.04em;margin-top:2px;white-space:nowrap')}>{c.p.n}</div>
            <div style={st('font-size:11px;margin-top:5px;padding-top:5px;border-top:1px solid rgba(255,138,143,.35);white-space:nowrap')}>{c.stat}</div>
            <div style={st('font-size:9.5px;color:#c9a9ac;margin-top:2px;white-space:nowrap')}>{c.score}</div>
            <div style={st('display:flex;justify-content:space-between;font-size:8.5px;color:#a07f83;margin-top:6px;white-space:nowrap')}>
              <span>紀念用，不計分</span><span style={st("font:600 8.5px 'Barlow Condensed';letter-spacing:.18em")}>POSTSEASON 2026</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

function ChampFront({ c, sheen }: { c: ChampCard; sheen: string }) {
  return (
    <div style={{ ...st(`position:absolute;inset:0;padding:6px;box-sizing:border-box;${CLIP14};background:linear-gradient(115deg,#fff6dc 0%,#e2bf6a 14%,#8a6420 28%,#ffe9a8 40%,#b98d2c 54%,#fff6dc 66%,#e2bf6a 80%,#8a6420 90%,#fff6dc 100%);background-size:200% 100%`), animation: sheen }}>
      <div style={st(`position:relative;width:100%;height:100%;overflow:hidden;${clip(11)};background:linear-gradient(180deg,#17130c,#0d0b08)`)}>
        <div style={st(`position:relative;height:150px;box-sizing:border-box;padding:12px 16px 0;background:linear-gradient(160deg,${c.team.bg} 0%,${c.team.deep} 100%);color:${c.team.fg}`)}>
          <div style={st('position:absolute;inset:0;background:repeating-linear-gradient(120deg,rgba(255,240,200,.10) 0 2px,transparent 2px 14px);pointer-events:none')} />
          <div style={st('position:relative;display:flex;justify-content:space-between;align-items:baseline;white-space:nowrap')}>
            <span style={st('font-size:10px;font-weight:700')}>冠軍紀念</span>
            <span style={st("font:600 9px 'Barlow Condensed';letter-spacing:.2em")}>2026 CPBL POSTSEASON</span>
          </div>
          <div style={st("position:relative;font:800 15px 'Barlow Condensed';letter-spacing:.2em;margin-top:10px;white-space:nowrap")}>{c.titleTop}</div>
          <div style={st(`position:relative;font-size:${c.titleFs};font-weight:900;line-height:1.05;letter-spacing:.04em;white-space:nowrap`)}>{c.title}</div>
          <div style={st('position:relative;display:flex;align-items:center;gap:6px;margin-top:8px;font-size:12px;font-weight:700;white-space:nowrap')}>{c.team.n}</div>
        </div>
        <div style={st('height:3px;background:linear-gradient(90deg,#8a6420,#ffe9a8,#8a6420)')} />
        <div style={st('position:relative;display:flex;flex-direction:column;gap:7px;height:calc(100% - 153px);box-sizing:border-box;padding:9px 16px 9px')}>
          <div style={st('display:flex;align-items:baseline;justify-content:space-between;white-space:nowrap')}>
            <span style={st('font-size:10px;color:#c8ad7f')}>系列戰・{c.scoreNote}</span>
            <span style={st("font:700 30px/1 'Barlow Condensed';color:#fff6dc")}>{c.score}</span>
          </div>
          <div style={{ ...st('display:grid;gap:3px'), gridTemplateColumns: `repeat(${Math.max(7, c.games.length)},minmax(0,1fr))` }}>
            {c.games.map((g, i) => (
              <div key={i} style={st('padding:2px 0 0;border:1px solid rgba(226,191,106,.3);background:rgba(0,0,0,.3);text-align:center;overflow:hidden')}>
                <div style={st("font:600 7.5px 'Barlow Condensed';letter-spacing:.06em;color:#8d95a4")}>{g.t}</div>
                <div style={st("font:700 12px/1.15 'Barlow Condensed'")}>{g.sc}</div>
                <div style={{ height: 3, marginTop: 2, background: g.dot }} />
              </div>
            ))}
          </div>
          <span style={{ flex: 1 }} />
          <div style={st('display:flex;align-items:center;gap:8px;border-top:1px solid rgba(226,191,106,.35);padding-top:7px')}>
            <span style={st(`flex:none;width:28px;height:28px;border-radius:5px;background:${c.mvp.bg};color:${c.mvp.fg};font:700 16px/28px 'Barlow Condensed';text-align:center`)}>{c.mvp.num}</span>
            <div style={{ minWidth: 0 }}>
              <div style={st('display:flex;align-items:baseline;gap:5px;white-space:nowrap')}>
                <span style={st('font-size:9.5px;font-weight:700;color:#e2bf6a')}>系列戰 MVP</span><span style={st('font-size:14px;font-weight:900')}>{c.mvp.n}</span>
              </div>
              <div style={st('font-size:9.5px;color:#ecdfc4;white-space:nowrap')}>{c.mvp.txt}</div>
            </div>
          </div>
          <div style={st('display:flex;justify-content:space-between;font-size:8.5px;color:#6c7584;white-space:nowrap')}>
            <span>紀念用，不計分</span><span>MVP 依數據自動選出</span>
          </div>
        </div>
      </div>
    </div>
  )
}

function Back({ c, label, ink }: { c: PsCardData; label: string; ink: string }) {
  return (
    <>
      <div style={st('position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(236,223,196,.025) 0 1px,transparent 1px 8px)')} />
      <div style={st('position:relative;display:flex;flex-direction:column;gap:7px;height:100%;box-sizing:border-box;padding:12px 14px 10px')}>
        <div style={st('display:flex;justify-content:space-between;align-items:baseline;white-space:nowrap')}>
          <span style={st(`font-size:10px;font-weight:700;color:${ink}`)}>{label}・背面</span>
          <span style={st('font-size:9.5px;color:#8d95a4')}>{c.dateL}</span>
        </div>
        {c.kind === 'game' && <GameBack c={c} />}
        {c.kind === 'hl' && <HlBack c={c} />}
        {c.kind === 'champ' && <ChampBack c={c} />}
        <div style={st('font-size:8.5px;color:#6c7584;white-space:nowrap')}>季後賽不計入 fantasy・紀念用，不計分</div>
      </div>
    </>
  )
}

function GameBack({ c }: { c: GameCard }) {
  return (
    <>
      <div style={st('font-size:13px;font-weight:700;white-space:nowrap')}>{c.serie} 第 {c.no} 戰・詳細數據</div>
      {c.teams.map((t) => (
        <div key={t.s} style={st('border-radius:4px;background:rgba(40,50,64,.7);padding:5px 7px 4px')}>
          <div style={st('display:flex;align-items:center;gap:6px;white-space:nowrap')}>
            <span style={st(`width:28px;height:15px;border-radius:2px;background:${t.bg};color:${t.fg};font-size:9px;font-weight:700;display:flex;align-items:center;justify-content:center`)}>{t.s}</span>
            <span style={st('flex:1;font-size:10.5px;color:#c4cad4')}>{t.n}</span>
            <span style={st("font:600 10.5px 'Barlow Condensed';letter-spacing:.04em;color:#eef0f4")}>{t.tot}</span>
          </div>
          <div style={st("display:grid;grid-template-columns:minmax(0,1fr) repeat(6,20px);gap:2px;margin-top:4px;font:600 8px 'Barlow Condensed','Noto Sans TC';color:#6c7584;text-align:right")}>
            <span style={{ textAlign: 'left' }}>投手</span><span>IP</span><span>H</span><span>BB</span><span>ER</span><span>K</span><span>勝救</span>
          </div>
          {t.pits.map((p) => (
            <div key={p.n} style={st("display:grid;grid-template-columns:minmax(0,1fr) repeat(6,20px);gap:2px;align-items:center;height:14px;font:600 10.5px 'Barlow Condensed';text-align:right")}>
              <span style={st("text-align:left;font:400 10px 'Noto Sans TC';white-space:nowrap;overflow:hidden")}>{p.n}</span>
              {p.cells.map((x, i) => <span key={i} style={{ color: x.c }}>{x.v}</span>)}
            </div>
          ))}
        </div>
      ))}
      <span style={{ flex: 1 }} />
      <div style={st('font-size:9.5px;line-height:1.5;color:#8d95a4')}>{c.recv}・聯盟裡每位玩家都會收到這張</div>
    </>
  )
}

function HlBack({ c }: { c: HlCard }) {
  return (
    <>
      <div style={st('display:flex;align-items:center;gap:7px')}>
        <span style={st(`width:24px;height:24px;border-radius:5px;background:${c.p.bg};color:${c.p.fg};font:700 13px/24px 'Barlow Condensed';text-align:center`)}>{c.p.num}</span>
        <span style={st('font-size:15px;font-weight:900;white-space:nowrap')}>{c.p.n}</span>
        <span style={st('font-size:9.5px;color:#c9a9ac;white-space:nowrap')}>{c.p.ts}・{c.p.pos}</span>
      </div>
      <div style={st('font-size:10px;color:#e8c9cb;white-space:nowrap')}>{c.serie} 第 {c.no} 戰・{c.score}</div>
      <div style={{ ...st('display:grid;padding:5px 2px 4px;border-radius:4px;background:rgba(0,0,0,.3);text-align:center'), gridTemplateColumns: `repeat(${c.nCols},minmax(0,1fr))` }}>
        {c.heads.map((h) => <span key={h} style={st("font:600 8.5px 'Barlow Condensed';letter-spacing:.06em;color:#c9a9ac")}>{h}</span>)}
        {c.cells.map((x, i) => <span key={i} style={{ ...st("font:700 15px/1.2 'Barlow Condensed'"), color: x.c }}>{x.v}</span>)}
      </div>
      <div style={st('font-size:9px;font-weight:700;color:#c9a9ac;margin-top:2px')}>達成的高光</div>
      <div style={st('display:flex;flex-direction:column;gap:4px')}>
        {c.achList.map((a) => (
          <div key={a.t} style={st('display:flex;align-items:baseline;gap:7px;white-space:nowrap')}>
            <span style={st('font-size:11.5px;font-weight:700;color:#ffd9da')}>{a.t}</span><span style={st('font-size:9.5px;color:#c9a9ac')}>{a.d}</span>
          </div>
        ))}
      </div>
      <MiniLs ls={c.ls} headColor="#a07f83" />
      <span style={{ flex: 1 }} />
      <div style={st('display:flex;align-items:center;gap:5px;font-size:9.5px;color:#9aa6ff;white-space:nowrap')}>{c.owner}</div>
    </>
  )
}

function ChampBack({ c }: { c: ChampCard }) {
  return (
    <>
      <div style={st('font-size:13px;font-weight:700;white-space:nowrap')}>{c.fullTitle}・系列戰紀錄</div>
      <div style={st('display:flex;flex-direction:column')}>
        {c.hasBye && (
          <div style={st('display:grid;grid-template-columns:18px 28px minmax(0,1fr);gap:4px;align-items:center;height:16px;font-size:9.5px;color:#8d95a4')}>
            <span style={st("font:600 9px 'Barlow Condensed'")}>—</span><span /><span style={st('white-space:nowrap;overflow:hidden;text-overflow:ellipsis')}>{c.byeT}</span>
          </div>
        )}
        {c.glist.map((g) => (
          <div key={g.t} style={st('display:grid;grid-template-columns:18px 28px 22px 13px 6px 13px 22px minmax(0,1fr);gap:4px;align-items:center;height:17px;border-top:1px solid rgba(200,173,127,.14)')}>
            <span style={st("font:600 9.5px 'Barlow Condensed';color:#8d95a4")}>{g.t}</span>
            <span style={st("font:600 9.5px 'Barlow Condensed';color:#6c7584")}>{g.d}</span>
            <span style={st(`height:12px;border-radius:2px;background:${g.a.bg};color:${g.a.fg};font:700 7.5px/12px 'Noto Sans TC';text-align:center`)}>{g.a.s}</span>
            <span style={st(`font:700 12px 'Barlow Condensed';text-align:right;color:${g.a.col}`)}>{g.a.R}</span>
            <span style={st("font:600 10px 'Barlow Condensed';color:#4a505c;text-align:center")}>:</span>
            <span style={st(`font:700 12px 'Barlow Condensed';color:${g.h.col}`)}>{g.h.R}</span>
            <span style={st(`height:12px;border-radius:2px;background:${g.h.bg};color:${g.h.fg};font:700 7.5px/12px 'Noto Sans TC';text-align:center`)}>{g.h.s}</span>
            <span style={st('font-size:9px;color:#c4cad4;text-align:right;white-space:nowrap')}>{g.after}</span>
          </div>
        ))}
      </div>
      <div style={st('border-top:1px solid rgba(200,173,127,.35);padding-top:6px')}>
        <div style={st('display:flex;align-items:baseline;gap:6px;white-space:nowrap')}>
          <span style={st('font-size:9.5px;font-weight:700;color:#e2bf6a')}>MVP</span>
          <span style={st('font-size:12.5px;font-weight:900')}>{c.mvp.n}</span>
          <span style={st('font-size:9.5px;color:#8d95a4')}>#{c.mvp.num}・{c.mvp.ts}</span>
        </div>
        <div style={{ ...st('display:grid;margin-top:5px;padding:4px 2px 3px;border-radius:4px;background:rgba(0,0,0,.3);text-align:center'), gridTemplateColumns: `repeat(${c.mvp.nCols},minmax(0,1fr))` }}>
          {c.mvp.heads.map((h) => <span key={h} style={st("font:600 8px 'Barlow Condensed';letter-spacing:.06em;color:#8d95a4")}>{h}</span>)}
          {c.mvp.cells.map((x, i) => <span key={i} style={st("font:700 14px/1.2 'Barlow Condensed'")}>{x}</span>)}
        </div>
      </div>
      <span style={{ flex: 1 }} />
      <div style={st('font-size:8.5px;line-height:1.5;color:#6c7584;text-wrap:pretty')}>MVP 依系列戰數據自動選出：打者看安打、全壘打、得分與保送；投手看局數、三振與自責分。</div>
    </>
  )
}

export interface PsCardProps {
  card: PsCardData
  size?: number
  face?: 'front' | 'back'
  /** 還沒打開的新卡：顯示封面 */
  sealed?: boolean
  /** 減少動態效果：不翻轉、不閃光、直接淡入 */
  still?: boolean
  /** 開卡／放大檢視：兩面都畫出來，才有翻轉動畫 */
  anim?: boolean
  /** 翻到正面時掃過一道光 */
  sweep?: boolean
  /** 封面亮兩下 */
  glow?: boolean
}

export default function PsCard({ card: c, size = 240, face = 'front', sealed = false, still = false, anim = false, sweep = false, glow = false }: PsCardProps): ReactNode {
  const k = KIND[c.kind]
  const sc = size / 240
  const back = face === 'back'
  const showFront = !back || anim
  const showBack = back || anim
  const rot = still ? 'none' : back ? 'rotateY(180deg)' : 'rotateY(0deg)'
  const fo = still ? (back ? 0 : 1) : 1
  const bo = still ? (back ? 1 : 0) : 1
  const vd = still ? '.15s' : '.3s'
  const sheen = c.kind === 'champ' && !still && anim ? 'pc-sheen 7s linear infinite' : 'none'
  const sweepAnim = sweep && !still ? 'pc-sweep 1.2s ease-out .45s both' : 'none'
  const pulse = glow && !still ? 'pc-pulse .9s ease-in-out 2' : 'none'
  const sealedShown = sealed && showBack
  const contentBack = !sealed && showBack

  return (
    <div style={st(`position:relative;width:${size}px;height:${size * 1.4}px;font-family:'Noto Sans TC','PingFang TC',system-ui,sans-serif;color:#eef0f4;font-variant-numeric:tabular-nums;text-align:left`)}>
      <div style={st(`position:absolute;left:0;top:0;width:240px;height:336px;transform-origin:0 0;transform:scale(${sc})`)}>
        <div style={st(`position:absolute;inset:8px 10px 4px;border-radius:12px;box-shadow:${k.shadow};pointer-events:none`)} />
        <div style={{ ...st('position:relative;width:240px;height:336px;perspective:1100px'), animation: pulse }}>
          <div style={st(`position:relative;width:100%;height:100%;transform-style:preserve-3d;transition:transform .8s cubic-bezier(.2,.75,.2,1);transform:${rot}`)}>
            {/* 正面 */}
            <div style={st(`position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;opacity:${fo};visibility:${back ? 'hidden' : 'visible'};transition:opacity .3s,visibility 0s linear ${vd}`)}>
              {showFront && c.kind === 'game' && <GameFront c={c} />}
              {showFront && c.kind === 'hl' && <HlFront c={c} />}
              {showFront && c.kind === 'champ' && <ChampFront c={c} sheen={sheen} />}
              <div style={st(`position:absolute;inset:0;overflow:hidden;pointer-events:none;${CLIP14}`)}>
                <div style={{ ...st('position:absolute;top:-10%;bottom:-10%;left:0;width:42%;background:linear-gradient(90deg,transparent,rgba(255,250,235,.55),transparent);mix-blend-mode:screen;opacity:0'), animation: sweepAnim }} />
              </div>
            </div>
            {/* 背面（或還沒打開的封面） */}
            <div style={st(`position:absolute;inset:0;backface-visibility:hidden;-webkit-backface-visibility:hidden;transform:${still ? 'none' : 'rotateY(180deg)'};opacity:${bo};visibility:${back ? 'visible' : 'hidden'};transition:opacity .3s,visibility 0s linear ${vd}`)}>
              <div style={st(`position:absolute;inset:0;padding:${k.pad};box-sizing:border-box;${CLIP14};background:${k.frame};background-size:${k.fsize}`)}>
                <div style={st(`position:relative;width:100%;height:100%;overflow:hidden;${clip(11)};background:${k.inner}`)}>
                  {sealedShown && (
                    <>
                      <div style={st(`position:absolute;inset:0;background:${k.cover}`)} />
                      <div style={st('position:absolute;inset:0;background:repeating-linear-gradient(45deg,rgba(255,246,220,.05) 0 1px,transparent 1px 8px),repeating-linear-gradient(-45deg,rgba(255,246,220,.05) 0 1px,transparent 1px 8px)')} />
                      <div style={st('position:relative;height:100%;display:flex;flex-direction:column;align-items:center;justify-content:center;gap:10px;text-align:center')}>
                        <KindIcon kind={k.icon} color={k.ink} />
                        <div style={st('font-size:26px;font-weight:900;letter-spacing:.08em;color:#fff6ea;white-space:nowrap')}>{k.label}</div>
                        <div style={st(`font:600 10px 'Barlow Condensed';letter-spacing:.3em;color:${k.ink};white-space:nowrap`)}>POSTSEASON 2026</div>
                        <div style={st(`margin-top:10px;padding:4px 12px;border:1px solid ${k.ink};color:${k.ink};font-size:11px;font-weight:700;white-space:nowrap`)}>新卡・點一下打開</div>
                        <div style={st(`position:absolute;left:0;right:0;bottom:16px;font-size:9px;color:${k.ink};opacity:.75`)}>紀念用，不計分</div>
                      </div>
                    </>
                  )}
                  {contentBack && <Back c={c} label={k.label} ink={k.ink} />}
                </div>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

import { CircleNotch, Prohibit, Warning } from '@phosphor-icons/react'
import { createContext, useCallback, useContext, useEffect, useRef, useState, type ReactNode } from 'react'

/**
 * 確認對話框（設計稿「確認對話框」）：App 裡所有需要二次確認的操作共用。
 * 結構固定：小標籤＋標題、說明、編號清單、提醒列（琥珀＝需要注意、銀灰＝無法復原）、取消與確認。
 * 網頁版置中加遮罩，手機版從底部滑出；Esc、點遮罩、取消都會關閉。
 *
 *   const confirm = useConfirm()
 *   if (await confirm({ title: '暫停選秀？', confirmText: '暫停' })) ...
 *
 * 有給 run 時，按確認後兩顆按鈕停用、主要按鈕顯示處理中，run 結束才關閉；run 丟出的錯誤會原樣丟給呼叫端。
 */
export type ConfirmOptions = {
  /** 小標籤，預設一般＝CONFIRM、危險＝DANGER */
  label?: string
  title: string
  lead?: string
  points?: string[]
  note?: string
  /** 提醒列色調，預設一般＝amber、危險＝silver */
  tone?: 'amber' | 'silver'
  confirmText?: string
  busyText?: string
  cancelText?: string
  /** 危險版：銀灰底紅字的主要按鈕 */
  danger?: boolean
  run?: () => Promise<unknown>
}

type Confirm = (opts: ConfirmOptions) => Promise<boolean>

const ConfirmContext = createContext<Confirm>(() => Promise.resolve(window.confirm('確定要執行嗎？')))

export const useConfirm = () => useContext(ConfirmContext)

type Pending = { opts: ConfirmOptions; resolve: (ok: boolean) => void; reject: (e: unknown) => void }

/** 關閉動畫的時間，要和 styles.css 的 .cf-* 轉場一致 */
const CLOSE_MS = 320

export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [pending, setPending] = useState<Pending | null>(null)
  const [shown, setShown] = useState(false)
  const [busy, setBusy] = useState(false)
  const cancelRef = useRef<HTMLButtonElement>(null)
  const returnFocus = useRef<HTMLElement | null>(null)

  const confirm = useCallback<Confirm>((opts) => new Promise<boolean>((resolve, reject) => {
    returnFocus.current = document.activeElement as HTMLElement | null
    setBusy(false)
    setPending({ opts, resolve, reject })
    // 先以隱藏狀態掛上，下一個畫面才套用顯示，轉場才會播
    requestAnimationFrame(() => requestAnimationFrame(() => setShown(true)))
  }), [])

  const finish = useCallback((p: Pending, ok: boolean, error?: unknown) => {
    setShown(false)
    setBusy(false)
    setTimeout(() => {
      setPending((cur) => (cur === p ? null : cur))
      returnFocus.current?.focus?.()
    }, CLOSE_MS)
    if (error !== undefined) p.reject(error)
    else p.resolve(ok)
  }, [])

  const cancel = () => { if (pending && !busy) finish(pending, false) }
  const ok = async () => {
    if (!pending || busy) return
    if (!pending.opts.run) return finish(pending, true)
    setBusy(true)
    try {
      await pending.opts.run()
      finish(pending, true)
    } catch (e) {
      finish(pending, false, e ?? new Error('失敗'))
    }
  }

  useEffect(() => {
    if (!pending) return
    const onKey = (e: KeyboardEvent) => {
      if (e.key !== 'Escape' || busy) return
      e.preventDefault()
      finish(pending, false)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [pending, busy, finish])
  // 預設把焦點放在「取消」，避免手滑按 Enter 就執行
  useEffect(() => { if (shown) cancelRef.current?.focus() }, [shown])

  const o = pending?.opts
  const danger = !!o?.danger
  const tone = o?.tone ?? (danger ? 'silver' : 'amber')
  return (
    <ConfirmContext.Provider value={confirm}>
      {children}
      {o && (
        <div className={`cf${shown ? ' on' : ''}${danger ? ' danger' : ''}`}>
          <div className={`cf-mask${busy ? ' busy' : ''}`} onClick={cancel} />
          <div className="cf-wrap">
            <div className="cf-box" role="dialog" aria-modal="true" aria-labelledby="cf-title">
              <i className="cf-edge" aria-hidden />
              <i className="cf-grip" aria-hidden />
              <div className="cf-kick">{o.label ?? (danger ? 'DANGER' : 'CONFIRM')}</div>
              <div className="cf-title" id="cf-title">{o.title}</div>
              {o.lead && <p className="cf-lead">{o.lead}</p>}
              {!!o.points?.length && (
                <ol className="cf-points">
                  {o.points.map((t, i) => <li key={i}><span>{String(i + 1).padStart(2, '0')}</span><span>{t}</span></li>)}
                </ol>
              )}
              {o.note && (
                <div className={`cf-note ${tone}`}>
                  {tone === 'amber' ? <Warning weight="fill" /> : <Prohibit weight="fill" />}
                  <span>{o.note}</span>
                </div>
              )}
              <div className="cf-btns">
                <button type="button" className="cf-cancel" ref={cancelRef} disabled={busy} onClick={cancel}>{o.cancelText ?? '取消'}</button>
                <button type="button" className="cf-ok" disabled={busy} onClick={ok}>
                  {busy && <CircleNotch weight="bold" className="cf-spin" />}
                  <span>{busy ? o.busyText ?? '處理中…' : o.confirmText ?? '確定'}</span>
                </button>
              </div>
              <div className="cf-hint">按 Esc 或點遮罩＝取消</div>
            </div>
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  )
}

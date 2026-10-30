import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { ChevronLeft, ChevronRight, Copy, X } from 'lucide-react'
import type { Meme } from '@shared/types'
import { useStore } from '@/store'
import { mediaUrl } from '@/lib'

/** Visualização rápida em tela cheia (Espaço), como o Quick Look do macOS. */
export function QuickLook({ memes }: { memes: Meme[] }) {
  const quickLookId = useStore((s) => s.quickLookId)
  const index = memes.findIndex((m) => m.id === quickLookId)
  const meme = index >= 0 ? memes[index] : null

  useEffect(() => {
    if (!meme) return
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      if (e.key === 'Escape' || e.key === ' ') s.openQuickLook(null)
      else if (e.key === 'ArrowRight') openAt(memes, index + 1)
      else if (e.key === 'ArrowLeft') openAt(memes, index - 1)
      else if (e.key === 'c' && e.ctrlKey) void s.copyMeme(meme.id)
      else return
      e.preventDefault()
      e.stopImmediatePropagation()
    }
    // Captura antes dos atalhos globais do App.
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [meme, index, memes])

  const close = () => useStore.getState().openQuickLook(null)

  return (
    <AnimatePresence>
      {meme && (
        <motion.div
          className="fixed inset-0 z-40 flex items-center justify-center bg-overlay backdrop-blur-xl"
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          onClick={close}
        >
          <motion.div
            key={meme.id}
            className="flex max-h-[86vh] max-w-[86vw] flex-col overflow-hidden rounded-2xl bg-elevated shadow-mac"
            initial={{ scale: 0.94, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 420, damping: 32 }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="flex h-10 items-center gap-2 border-b border-separator px-3">
              <button aria-label="Fechar" onClick={close} className="rounded-md p-1 text-label-secondary hover:bg-fill">
                <X className="size-4" />
              </button>
              <span className="flex-1 truncate text-center text-[13px] font-medium">{meme.title}</span>
              <button
                onClick={() => void useStore.getState().copyMeme(meme.id)}
                className="flex h-6 items-center gap-1.5 rounded-md bg-accent px-2.5 text-[12px] font-medium text-white hover:brightness-110"
              >
                <Copy className="size-3.5" /> Copiar
              </button>
            </div>
            <div className="flex min-h-0 items-center justify-center bg-black/5">
              {meme.kind === 'video' ? (
                <video src={mediaUrl(meme)} autoPlay controls loop className="max-h-[calc(86vh-40px)] max-w-full" />
              ) : (
                <img src={mediaUrl(meme)} alt={meme.title} className="max-h-[calc(86vh-40px)] max-w-full object-contain" />
              )}
            </div>
          </motion.div>

          {memes.length > 1 && (
            <>
              <NavButton side="left" onClick={() => openAt(memes, index - 1)} />
              <NavButton side="right" onClick={() => openAt(memes, index + 1)} />
            </>
          )}
        </motion.div>
      )}
    </AnimatePresence>
  )
}

function openAt(memes: Meme[], i: number) {
  const next = memes[(i + memes.length) % memes.length]
  useStore.getState().openQuickLook(next.id)
  useStore.getState().setSelection([next.id])
}

function NavButton({ side, onClick }: { side: 'left' | 'right'; onClick(): void }) {
  const Icon = side === 'left' ? ChevronLeft : ChevronRight
  return (
    <button
      aria-label={side === 'left' ? 'Anterior' : 'Próximo'}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={`absolute ${side === 'left' ? 'left-5' : 'right-5'} flex size-10 items-center justify-center rounded-full bg-elevated/80 text-label shadow-mac backdrop-blur hover:bg-elevated`}
    >
      <Icon className="size-5" />
    </button>
  )
}

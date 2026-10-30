import { useEffect } from 'react'
import { AnimatePresence, motion } from 'motion/react'
import { Archive, FolderOpen, ImageDown, TriangleAlert } from 'lucide-react'
import { useStore } from '@/store'
import { TrafficLights } from './TrafficLights'

const TOAST_MS = 2200

/** Aviso flutuante no rodapé ("Copiado", "3 memes adicionados"...). */
export function Toast() {
  const toast = useStore((s) => s.toast)

  useEffect(() => {
    if (!toast) return
    const t = setTimeout(() => useStore.setState({ toast: null }), TOAST_MS)
    return () => clearTimeout(t)
  }, [toast])

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-6 z-50 flex justify-center">
      <AnimatePresence>
        {toast && (
          <motion.div
            key={toast.id}
            initial={{ y: 16, opacity: 0, scale: 0.96 }}
            animate={{ y: 0, opacity: 1, scale: 1 }}
            exit={{ y: 8, opacity: 0 }}
            transition={{ type: 'spring', stiffness: 500, damping: 34 }}
            className="rounded-full border border-separator bg-elevated/85 px-4 py-2 text-[13px] font-medium shadow-mac backdrop-blur-2xl"
          >
            {toast.text}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  )
}

/** Tela inicial: escolher a pasta que será a biblioteca (ou reconectar a que sumiu). */
export function Welcome() {
  const { chooseLibrary, rescan, libraryDir, libraryError } = useStore()
  const offline = Boolean(libraryDir && libraryError)

  return (
    <div data-tauri-drag-region className="flex h-full flex-col bg-content">
      <div className="flex h-[52px] shrink-0 items-center px-4">
        <TrafficLights />
      </div>
      <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 pb-24 text-center">
        <div className="mb-2 flex size-24 items-center justify-center rounded-[26px] bg-gradient-to-b from-accent/85 to-accent text-white shadow-mac">
          {offline ? <TriangleAlert className="size-11" strokeWidth={1.5} /> : <Archive className="size-12" strokeWidth={1.5} />}
        </div>
        {offline ? (
          <>
            <h1 className="text-[22px] font-semibold tracking-tight">Pasta não encontrada</h1>
            <p className="max-w-96 text-label-secondary">
              Não foi possível abrir <span className="font-medium text-label">{libraryDir}</span>. Se ela está num HD
              externo ou no OneDrive, conecte e tente de novo. Suas tags continuam salvas na pasta.
            </p>
          </>
        ) : (
          <>
            <h1 className="text-[22px] font-semibold tracking-tight">Bem-vindo ao Meme na Gaveta</h1>
            <p className="max-w-96 text-label-secondary">
              Escolha a pasta onde você guarda seus memes. Nada é copiado nem movido: o app só indexa os arquivos e
              guarda tags, coleções e favoritos num arquivo <code className="text-label">.memenagaveta.json</code>{' '}
              dentro dela.
            </p>
          </>
        )}
        <div className="mt-2 flex gap-2">
          {offline && (
            <button
              onClick={() => void rescan()}
              className="h-8 rounded-lg bg-accent px-5 text-[13px] font-medium text-white hover:brightness-110"
            >
              Tentar de novo
            </button>
          )}
          <button
            onClick={() => void chooseLibrary()}
            className={
              offline
                ? 'h-8 rounded-lg bg-fill px-5 text-[13px] font-medium hover:bg-fill-secondary'
                : 'flex h-8 items-center gap-2 rounded-lg bg-accent px-5 text-[13px] font-medium text-white hover:brightness-110'
            }
          >
            {!offline && <FolderOpen className="size-4" />}
            {offline ? 'Escolher outra pasta…' : 'Escolher pasta…'}
          </button>
        </div>
      </div>
    </div>
  )
}

export function EmptyState({ filtered }: { filtered: boolean }) {
  const addDialog = useStore((s) => s.addDialog)
  return (
    <div className="flex flex-1 flex-col items-center justify-center gap-3 p-8 text-center">
      <div className="flex size-20 items-center justify-center rounded-[22px] bg-gradient-to-b from-accent/90 to-accent text-white shadow-mac">
        <Archive className="size-10" strokeWidth={1.5} />
      </div>
      {filtered ? (
        <>
          <h2 className="text-[17px] font-semibold">Nenhum meme por aqui</h2>
          <p className="max-w-72 text-label-secondary">Tente outra busca ou outro filtro.</p>
        </>
      ) : (
        <>
          <h2 className="text-[17px] font-semibold">Nenhum meme nesta pasta</h2>
          <p className="max-w-80 text-label-secondary">
            Coloque imagens, GIFs ou vídeos na pasta pelo Explorer (eles aparecem aqui sozinhos), arraste para esta
            janela ou cole com Ctrl+V.
          </p>
          <div className="mt-1 flex gap-2">
            <button
              onClick={() => void window.api.openLibraryFolder()}
              className="h-7 rounded-[7px] bg-accent px-4 text-[13px] font-medium text-white hover:brightness-110"
            >
              Abrir pasta no Explorer
            </button>
            <button
              onClick={() => void addDialog('files')}
              className="h-7 rounded-[7px] bg-fill px-4 text-[13px] font-medium hover:bg-fill-secondary"
            >
              Copiar arquivos…
            </button>
          </div>
        </>
      )}
    </div>
  )
}

export function DropOverlay({ visible }: { visible: boolean }) {
  return (
    <AnimatePresence>
      {visible && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.12 }}
          className="pointer-events-none fixed inset-3 z-30 flex flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-accent bg-accent-soft backdrop-blur-sm"
        >
          <ImageDown className="size-10 text-accent" strokeWidth={1.5} />
          <p className="text-[15px] font-semibold text-accent">Solte para adicionar à gaveta</p>
        </motion.div>
      )}
    </AnimatePresence>
  )
}

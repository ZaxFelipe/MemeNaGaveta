import { useEffect, useMemo, useRef, useState } from 'react'
import { getCurrentWebview } from '@tauri-apps/api/webview'
import { filterMemes, useStore } from './store'
import { internalDrag } from './lib'
import { Sidebar } from './components/Sidebar'
import { Toolbar } from './components/Toolbar'
import { MemeGrid } from './components/MemeGrid'
import { Inspector, MultiInspector } from './components/Inspector'
import { QuickLook } from './components/QuickLook'
import { ContextMenuHost } from './components/ContextMenu'
import { DropOverlay, EmptyState, Toast, Welcome } from './components/Feedback'

export function App() {
  const { loaded, libraryDir, libraryError, memes, view, search, kindFilter, sort, selection, load, addPaths } = useStore()
  const searchRef = useRef<HTMLInputElement>(null)
  const [dragging, setDragging] = useState(false)

  useEffect(() => void load(), [load])

  const visible = useMemo(() => filterMemes(memes, view, search, kindFilter, sort), [memes, view, search, kindFilter, sort])
  const selected = useMemo(() => memes.filter((m) => selection.includes(m.id)), [memes, selection])

  useGlobalShortcuts(visible.map((m) => m.id), searchRef)

  // Arrastar e soltar arquivos: o Tauri entrega os caminhos direto (não há eventos HTML5).
  // Sobre uma coleção da sidebar, o arquivo entra nela; em qualquer outro lugar, é importado.
  useEffect(() => {
    const collectionAt = ({ x, y }: { x: number; y: number }) => {
      // A posição vem em pixels físicos; o DOM usa pixels lógicos.
      const el = document.elementFromPoint(x / devicePixelRatio, y / devicePixelRatio)
      return el?.closest<HTMLElement>('[data-collection-id]')?.dataset.collectionId ?? null
    }
    const reset = () => {
      setDragging(false)
      useStore.getState().setDropCollection(null)
    }
    const unlisten = getCurrentWebview().onDragDropEvent(({ payload }) => {
      const s = useStore.getState()
      if (!s.libraryDir) return
      if (payload.type === 'leave') return reset()
      const target = collectionAt(payload.position)
      if (payload.type === 'drop') {
        reset()
        if (target) void addPaths(payload.paths, target)
        else if (!internalDrag.active) void addPaths(payload.paths)
        return
      }
      s.setDropCollection(target)
      // Arraste que saiu do próprio grid só serve para soltar em coleções: sem overlay.
      setDragging(!internalDrag.active && !target)
    })
    return () => void unlisten.then((fn) => fn())
  }, [addPaths])

  if (loaded && (!libraryDir || libraryError)) {
    return (
      <>
        <Welcome />
        <ContextMenuHost />
        <Toast />
      </>
    )
  }

  return (
    <div className="flex h-full">
      <Sidebar />
      <main className="flex min-w-0 flex-1 flex-col bg-content">
        <Toolbar ref={searchRef} count={visible.length} />
        <div className="flex min-h-0 flex-1">
          {!loaded ? (
            <div className="flex-1" />
          ) : visible.length ? (
            <MemeGrid memes={visible} />
          ) : (
            <EmptyState filtered={memes.length > 0} />
          )}
          {selected.length === 1 && <Inspector meme={selected[0]} />}
          {selected.length > 1 && <MultiInspector count={selected.length} />}
        </div>
      </main>
      <QuickLook memes={visible} />
      <DropOverlay visible={dragging} />
      <ContextMenuHost />
      <Toast />
    </div>
  )
}

function isTyping(e: KeyboardEvent): boolean {
  const el = e.target as HTMLElement
  return el.tagName === 'INPUT' || el.tagName === 'TEXTAREA' || el.tagName === 'SELECT' || el.isContentEditable
}

/** Atalhos de teclado do app. Os do Quick Look ficam no próprio componente. */
function useGlobalShortcuts(visibleIds: string[], searchRef: React.RefObject<HTMLInputElement | null>) {
  const idsRef = useRef(visibleIds)
  idsRef.current = visibleIds

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const s = useStore.getState()
      const ctrl = e.ctrlKey || e.metaKey
      if (ctrl && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        searchRef.current?.focus()
        return
      }
      if (isTyping(e)) return

      const current = s.selection[s.selection.length - 1]
      const key = e.key.toLowerCase()
      if (ctrl && key === 'v') void s.addClipboard()
      else if (ctrl && key === 'a') s.setSelection(idsRef.current)
      else if (ctrl && key === 'c' && current) void s.copyMeme(current)
      else if (ctrl && key === 'o') void s.addDialog(e.shiftKey ? 'folder' : 'files')
      else if (e.key === ' ' && current) s.openQuickLook(current)
      else if (e.key === 'Enter' && current) void s.copyMeme(current)
      else if (e.key === 'Delete' && s.selection.length) void s.deleteMemes(s.selection)
      else if (key === 'f' && !ctrl && s.selection.length) void s.toggleFavorite(s.selection)
      else if (e.key === 'Escape') s.setSelection([])
      else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && idsRef.current.length) {
        const i = idsRef.current.indexOf(current)
        const next = i < 0 ? 0 : Math.min(Math.max(i + (e.key === 'ArrowRight' ? 1 : -1), 0), idsRef.current.length - 1)
        s.setSelection([idsRef.current[next]])
      } else return
      e.preventDefault()
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [searchRef])
}

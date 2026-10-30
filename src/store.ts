import { create } from 'zustand'
import type {
  AddTarget,
  Collection,
  ImportMode,
  ImportResult,
  LibrarySnapshot,
  LinkedFolder,
  Meme,
  MemeKind,
  MemePatch
} from '@shared/types'
import { normalize, plural, setMediaRoots } from './lib'

export type View =
  | { type: 'all' }
  | { type: 'favorites' }
  | { type: 'recent' }
  | { type: 'untagged' }
  // source: pasta adicionada (ausente = biblioteca); path vazio = a pasta adicionada inteira.
  | { type: 'folder'; source?: string; path: string }
  | { type: 'collection'; id: string }
  | { type: 'tag'; tag: string }

export type KindFilter = 'all' | MemeKind
export type SortKey = 'added' | 'used' | 'name'

interface State {
  loaded: boolean
  libraryDir: string | null
  libraryError: string | undefined
  memes: Meme[]
  collections: Collection[]
  folders: string[]
  linkedFolders: LinkedFolder[]
  view: View
  search: string
  kindFilter: KindFilter
  sort: SortKey
  tileSize: number
  selection: string[]
  quickLookId: string | null
  toast: { id: number; text: string } | null
  /** Coleção da sidebar sob o cursor durante um arraste de arquivos (para destacar). */
  dropCollectionId: string | null

  load(): Promise<void>
  applySnapshot(snapshot: LibrarySnapshot): void
  chooseLibrary(): Promise<void>
  rescan(): Promise<void>
  setView(view: View): void
  setSearch(search: string): void
  setKindFilter(kind: KindFilter): void
  setSort(sort: SortKey): void
  setTileSize(size: number): void
  select(id: string, mode?: 'single' | 'toggle' | 'range', visibleIds?: string[]): void
  setSelection(ids: string[]): void
  openQuickLook(id: string | null): void
  showToast(text: string): void
  setDropCollection(id: string | null): void

  addPaths(paths: string[], collectionId?: string): Promise<void>
  addDialog(mode?: ImportMode): Promise<void>
  addClipboard(): Promise<void>
  updateMeme(id: string, patch: MemePatch): Promise<void>
  toggleFavorite(ids: string[]): Promise<void>
  deleteMemes(ids: string[]): Promise<void>
  removeLinkedFolder(id: string): Promise<void>
  copyMeme(id: string): Promise<void>
  createCollection(name: string): Promise<Collection>
  renameCollection(id: string, name: string): Promise<void>
  deleteCollection(id: string): Promise<void>
}

const PREFS_KEY = 'mng:prefs'

function loadPrefs(): Partial<Pick<State, 'sort' | 'tileSize'>> {
  try {
    return JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}')
  } catch {
    return {}
  }
}

function savePrefs(state: Pick<State, 'sort' | 'tileSize'>): void {
  try {
    localStorage.setItem(PREFS_KEY, JSON.stringify({ sort: state.sort, tileSize: state.tileSize }))
  } catch {
    // Preferências são só conveniência; ignorar falhas de storage.
  }
}

const prefs = loadPrefs()
let toastSeq = 0
let unsubscribe: (() => void) | null = null

export const useStore = create<State>((set, get) => {
  /** Destino do que for adicionado agora: a subpasta e/ou coleção que está aberta. */
  const currentTarget = (): AddTarget => {
    const view = get().view
    if (view.type === 'folder') return { source: view.source, folder: view.path || undefined }
    if (view.type === 'collection') return { collectionId: view.id }
    return {}
  }

  const reportAdd = (result: ImportResult): void => {
    if (result.canceled) return
    const parts: string[] = []
    if (result.added) parts.push(plural(result.added, 'meme adicionado', 'memes adicionados'))
    if (result.alreadyInLibrary) parts.push(plural(result.alreadyInLibrary, 'já estava na gaveta', 'já estavam na gaveta'))
    if (result.failed) parts.push(plural(result.failed, 'arquivo ignorado', 'arquivos ignorados'))
    get().showToast(parts.length ? parts.join(' · ') : 'Nenhum meme encontrado')
  }

  return {
    loaded: false,
    libraryDir: null,
    libraryError: undefined,
    memes: [],
    collections: [],
    folders: [],
    linkedFolders: [],
    view: { type: 'all' },
    search: '',
    kindFilter: 'all',
    sort: prefs.sort ?? 'added',
    tileSize: prefs.tileSize ?? 180,
    selection: [],
    quickLookId: null,
    toast: null,
    dropCollectionId: null,

    async load() {
      // O backend avisa sempre que a pasta muda no disco (arquivo novo, movido, apagado).
      unsubscribe ??= window.api.onLibraryChanged((snapshot) => get().applySnapshot(snapshot))
      get().applySnapshot(await window.api.getLibrary())
    },

    applySnapshot(snapshot) {
      setMediaRoots(snapshot)
      set((s) => {
        const ids = new Set(snapshot.memes.map((m) => m.id))
        const viewGone =
          (s.view.type === 'folder' && !folderExists(snapshot, s.view.source, s.view.path)) ||
          (s.view.type === 'collection' && !snapshot.collections.some((c) => s.view.type === 'collection' && c.id === s.view.id))
        return {
          loaded: true,
          libraryDir: snapshot.libraryDir,
          libraryError: snapshot.error,
          memes: snapshot.memes,
          collections: snapshot.collections,
          folders: snapshot.folders,
          linkedFolders: snapshot.linkedFolders,
          view: viewGone ? { type: 'all' } : s.view,
          selection: s.selection.filter((id) => ids.has(id)),
          quickLookId: s.quickLookId && ids.has(s.quickLookId) ? s.quickLookId : null
        }
      })
    },

    async chooseLibrary() {
      const snapshot = await window.api.chooseLibrary()
      if (!snapshot) return
      set({ view: { type: 'all' }, selection: [], search: '' })
      get().applySnapshot(snapshot)
      if (!snapshot.error) get().showToast(plural(snapshot.memes.length, 'meme encontrado', 'memes encontrados'))
    },

    async rescan() {
      get().applySnapshot(await window.api.rescan())
    },

    setView: (view) => set({ view, selection: [] }),
    setSearch: (search) => set({ search }),
    setKindFilter: (kindFilter) => set({ kindFilter }),
    setSort: (sort) => {
      set({ sort })
      savePrefs(get())
    },
    setTileSize: (tileSize) => {
      set({ tileSize })
      savePrefs(get())
    },

    select(id, mode = 'single', visibleIds = []) {
      const { selection } = get()
      if (mode === 'toggle') {
        set({ selection: selection.includes(id) ? selection.filter((s) => s !== id) : [...selection, id] })
      } else if (mode === 'range' && selection.length) {
        const anchor = visibleIds.indexOf(selection[selection.length - 1])
        const target = visibleIds.indexOf(id)
        if (anchor < 0 || target < 0) return set({ selection: [id] })
        const [a, b] = anchor < target ? [anchor, target] : [target, anchor]
        set({ selection: visibleIds.slice(a, b + 1) })
      } else {
        set({ selection: [id] })
      }
    },
    setSelection: (selection) => set({ selection }),
    openQuickLook: (quickLookId) => set({ quickLookId }),
    showToast: (text) => set({ toast: { id: ++toastSeq, text } }),
    setDropCollection: (dropCollectionId) => set({ dropCollectionId }),

    async addPaths(paths, collectionId) {
      if (!paths.length) return
      const target = collectionId ? { collectionId } : currentTarget()
      const result = await window.api.addPaths(paths, target)
      await get().load()
      if (!collectionId) return reportAdd(result)
      // Solto sobre uma coleção: memes que já estavam na pasta só entram na coleção.
      const name = get().collections.find((c) => c.id === collectionId)?.name ?? 'coleção'
      const total = result.added + result.alreadyInLibrary
      if (total) get().showToast(`${plural(total, 'meme', 'memes')} em “${name}”`)
    },
    async addDialog(mode = 'files') {
      const result = await window.api.addDialog(mode, currentTarget())
      if (result.canceled) return
      await get().load()
      reportAdd(result)
    },
    async addClipboard() {
      const result = await window.api.addClipboard(currentTarget())
      if (!result.added && !result.alreadyInLibrary && !result.failed) return get().showToast('Nada para colar')
      await get().load()
      reportAdd(result)
    },

    async updateMeme(id, patch) {
      const updated = await window.api.updateMeme(id, patch)
      set((s) => ({ memes: s.memes.map((m) => (m.id === id ? updated : m)) }))
    },
    async toggleFavorite(ids) {
      const memes = get().memes.filter((m) => ids.includes(m.id))
      const favorite = !memes.every((m) => m.favorite)
      await Promise.all(memes.map((m) => get().updateMeme(m.id, { favorite })))
    },
    async deleteMemes(ids) {
      if (!ids.length) return
      await window.api.deleteMemes(ids)
      set((s) => ({
        memes: s.memes.filter((m) => !ids.includes(m.id)),
        selection: s.selection.filter((id) => !ids.includes(id)),
        quickLookId: s.quickLookId && ids.includes(s.quickLookId) ? null : s.quickLookId
      }))
      get().showToast(`${plural(ids.length, 'arquivo movido', 'arquivos movidos')} para a Lixeira`)
    },
    async removeLinkedFolder(id) {
      const name = get().linkedFolders.find((f) => f.id === id)?.name ?? 'pasta'
      if (!(await window.api.removeLinkedFolder(id))) return
      // O snapshot já vem sem a pasta; applySnapshot volta para "Todos" se ela estava aberta.
      get().applySnapshot(await window.api.getLibrary())
      get().showToast(`“${name}” removida do app`)
    },
    async copyMeme(id) {
      await window.api.copyMeme(id)
      set((s) => ({
        memes: s.memes.map((m) => (m.id === id ? { ...m, useCount: m.useCount + 1, lastUsedAt: Date.now() } : m))
      }))
      get().showToast('Copiado para a área de transferência')
    },

    async createCollection(name) {
      const collection = await window.api.createCollection(name)
      set((s) => ({ collections: [...s.collections, collection] }))
      return collection
    },
    async renameCollection(id, name) {
      const updated = await window.api.renameCollection(id, name)
      set((s) => ({ collections: s.collections.map((c) => (c.id === id ? updated : c)) }))
    },
    async deleteCollection(id) {
      await window.api.deleteCollection(id)
      set((s) => ({
        collections: s.collections.filter((c) => c.id !== id),
        memes: s.memes.map((m) => ({ ...m, collectionIds: m.collectionIds.filter((c) => c !== id) })),
        view: s.view.type === 'collection' && s.view.id === id ? { type: 'all' } : s.view
      }))
    }
  }
})

const RECENT_LIMIT = 60

/** Aplica visão, busca, filtro de tipo e ordenação. Pura, para usar com useMemo. */
export function filterMemes(
  memes: Meme[],
  view: View,
  search: string,
  kindFilter: KindFilter,
  sort: SortKey
): Meme[] {
  let list = memes
  switch (view.type) {
    case 'favorites':
      list = list.filter((m) => m.favorite)
      break
    case 'recent':
      list = list.filter((m) => m.lastUsedAt !== null)
      break
    case 'untagged':
      list = list.filter((m) => m.tags.length === 0)
      break
    case 'folder':
      // Inclui subpastas, como abrir a pasta no Explorer e buscar dentro dela.
      list = list.filter((m) => m.source === view.source && (!view.path || m.relPath.startsWith(`${view.path}/`)))
      break
    case 'collection':
      list = list.filter((m) => m.collectionIds.includes(view.id))
      break
    case 'tag':
      list = list.filter((m) => m.tags.includes(view.tag))
      break
  }
  if (kindFilter !== 'all') list = list.filter((m) => m.kind === kindFilter)

  const terms = normalize(search).split(/\s+/).filter(Boolean)
  if (terms.length) {
    list = list.filter((m) => {
      const haystack = normalize(`${m.title} ${m.tags.join(' ')} ${m.relPath}`)
      return terms.every((t) => haystack.includes(t.replace(/^#/, '')))
    })
  }

  if (view.type === 'recent') {
    return [...list].sort((a, b) => (b.lastUsedAt ?? 0) - (a.lastUsedAt ?? 0)).slice(0, RECENT_LIMIT)
  }
  const sorted = [...list]
  if (sort === 'added') sorted.sort((a, b) => b.mtime - a.mtime)
  else if (sort === 'used') sorted.sort((a, b) => b.useCount - a.useCount || b.mtime - a.mtime)
  else sorted.sort((a, b) => a.title.localeCompare(b.title, 'pt-BR', { numeric: true }))
  return sorted
}

export function folderName(path: string): string {
  return path.slice(path.lastIndexOf('/') + 1)
}

/** A subpasta `path` (da biblioteca ou da pasta adicionada `source`) ainda existe no snapshot. */
function folderExists(snapshot: LibrarySnapshot, source: string | undefined, path: string): boolean {
  if (!source) return snapshot.folders.includes(path)
  const linked = snapshot.linkedFolders.find((f) => f.id === source)
  return !!linked && (!path || linked.folders.includes(path))
}

export function viewTitle(view: View, collections: Collection[], linkedFolders: LinkedFolder[]): string {
  switch (view.type) {
    case 'all':
      return 'Todos os memes'
    case 'favorites':
      return 'Favoritos'
    case 'recent':
      return 'Usados recentemente'
    case 'untagged':
      return 'Sem tags'
    case 'folder':
      if (view.path) return folderName(view.path)
      return linkedFolders.find((f) => f.id === view.source)?.name ?? 'Pasta'
    case 'collection':
      return collections.find((c) => c.id === view.id)?.name ?? 'Coleção'
    case 'tag':
      return `#${view.tag}`
  }
}

import { useMemo, useState, type ReactNode } from 'react'
import {
  Clock,
  Folder,
  FolderClosed,
  FolderMinus,
  FolderOpen,
  FolderSearch,
  FolderSymlink,
  HardDrive,
  Hash,
  Heart,
  Images,
  Pencil,
  Plus,
  RefreshCw,
  Tag,
  Trash2
} from 'lucide-react'
import { folderName, useStore, type View } from '@/store'
import { cn } from '@/lib'
import { TrafficLights } from './TrafficLights'
import { useContextMenu } from './ContextMenu'

const TOP_TAGS = 12

function sameView(a: View, b: View): boolean {
  if (a.type !== b.type) return false
  if (a.type === 'collection' && b.type === 'collection') return a.id === b.id
  if (a.type === 'tag' && b.type === 'tag') return a.tag === b.tag
  if (a.type === 'folder' && b.type === 'folder') return a.source === b.source && a.path === b.path
  return true
}

/** Chave da contagem por pasta: pasta adicionada (vazio = biblioteca) + subpasta. */
function folderKey(source: string | undefined, path: string): string {
  return `${source ?? ''}|${path}`
}

/** Subpasta (da biblioteca ou de uma pasta adicionada), recuada conforme a profundidade. */
function FolderItem({ source, path, depth = 0, count }: { source?: string; path: string; depth?: number; count: number }) {
  const { view, setView } = useStore()
  const target: View = { type: 'folder', source, path }
  return (
    <div style={{ paddingLeft: (depth + path.split('/').length - 1) * 14 }}>
      <Item
        icon={<FolderClosed />}
        label={folderName(path)}
        count={count}
        active={sameView(view, target)}
        onClick={() => setView(target)}
      />
    </div>
  )
}

export function Sidebar() {
  const {
    memes,
    collections,
    folders,
    libraryDir,
    view,
    setView,
    createCollection,
    renameCollection,
    deleteCollection,
    linkedFolders,
    removeLinkedFolder,
    dropCollectionId,
    rescan,
    chooseLibrary
  } = useStore()
  const openMenu = useContextMenu((s) => s.open)
  const [editingId, setEditingId] = useState<string | null>(null)

  const counts = useMemo(() => {
    const byCollection = new Map<string, number>()
    const byTag = new Map<string, number>()
    for (const m of memes) {
      for (const c of m.collectionIds) byCollection.set(c, (byCollection.get(c) ?? 0) + 1)
      for (const t of m.tags) byTag.set(t, (byTag.get(t) ?? 0) + 1)
    }
    const tags = [...byTag.entries()].sort((a, b) => b[1] - a[1]).slice(0, TOP_TAGS)
    // Contagem recursiva: cada meme conta para todas as pastas acima dele (e para a pasta
    // adicionada de onde veio, chave com path vazio).
    const byFolder = new Map<string, number>()
    for (const m of memes) {
      const parts = m.relPath.split('/').slice(0, -1)
      for (let i = m.source ? 0 : 1; i <= parts.length; i++) {
        const key = folderKey(m.source, parts.slice(0, i).join('/'))
        byFolder.set(key, (byFolder.get(key) ?? 0) + 1)
      }
    }
    return {
      favorites: memes.filter((m) => m.favorite).length,
      untagged: memes.filter((m) => !m.tags.length).length,
      byCollection,
      byFolder,
      tags
    }
  }, [memes])

  // Só subpastas que têm memes (direto ou em subpastas). Pastas adicionadas sempre aparecem,
  // para dar para removê-las mesmo vazias ou indisponíveis.
  const visibleFolders = folders.filter((f) => counts.byFolder.has(folderKey(undefined, f)))

  const newCollection = async () => {
    const c = await createCollection('Nova coleção')
    setView({ type: 'collection', id: c.id })
    setEditingId(c.id)
  }

  return (
    <aside data-tauri-drag-region className="flex w-[232px] shrink-0 flex-col bg-sidebar">
      <div data-tauri-drag-region className="flex h-[52px] shrink-0 items-center px-4">
        <TrafficLights />
      </div>

      <nav className="flex-1 overflow-y-auto px-2.5 pb-4">
        <Section title="Biblioteca">
          <Item icon={<Images />} label="Todos os memes" count={memes.length} active={sameView(view, { type: 'all' })} onClick={() => setView({ type: 'all' })} />
          <Item icon={<Heart />} label="Favoritos" count={counts.favorites} active={sameView(view, { type: 'favorites' })} onClick={() => setView({ type: 'favorites' })} />
          <Item icon={<Clock />} label="Recentes" active={sameView(view, { type: 'recent' })} onClick={() => setView({ type: 'recent' })} />
          <Item icon={<Tag />} label="Sem tags" count={counts.untagged} active={sameView(view, { type: 'untagged' })} onClick={() => setView({ type: 'untagged' })} />
        </Section>

        {(visibleFolders.length > 0 || linkedFolders.length > 0) && (
          <Section title="Pastas">
            {visibleFolders.map((path) => (
              <FolderItem key={path} path={path} count={counts.byFolder.get(folderKey(undefined, path)) ?? 0} />
            ))}
            {linkedFolders.map((linked) => (
              <div key={linked.id} className="flex flex-col gap-px">
                <Item
                  icon={<FolderSymlink />}
                  label={linked.available ? linked.name : `${linked.name} (indisponível)`}
                  count={counts.byFolder.get(folderKey(linked.id, '')) ?? 0}
                  active={sameView(view, { type: 'folder', source: linked.id, path: '' })}
                  onClick={() => setView({ type: 'folder', source: linked.id, path: '' })}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    openMenu(e.clientX, e.clientY, [
                      { type: 'header', label: linked.path },
                      { label: 'Remover do app', icon: <FolderMinus />, danger: true, onSelect: () => void removeLinkedFolder(linked.id) }
                    ])
                  }}
                  action={
                    <button
                      aria-label="Remover pasta do app"
                      title="Remover do app (os arquivos continuam no computador)"
                      className="rounded p-1 text-label-secondary hover:bg-fill hover:text-danger"
                      onClick={() => void removeLinkedFolder(linked.id)}
                    >
                      <FolderMinus className="size-3.5" strokeWidth={1.75} />
                    </button>
                  }
                />
                {linked.folders
                  .filter((path) => counts.byFolder.has(folderKey(linked.id, path)))
                  .map((path) => (
                    <FolderItem
                      key={path}
                      source={linked.id}
                      path={path}
                      depth={1}
                      count={counts.byFolder.get(folderKey(linked.id, path)) ?? 0}
                    />
                  ))}
              </div>
            ))}
          </Section>
        )}

        <Section
          title="Coleções"
          action={
            <button aria-label="Nova coleção" className="rounded p-0.5 text-label-secondary hover:bg-fill" onClick={newCollection}>
              <Plus className="size-3.5" />
            </button>
          }
        >
          {collections.length === 0 && (
            <p className="px-2 py-1 text-[12px] text-label-tertiary">Crie coleções com o botão +</p>
          )}
          {collections.map((c) => (
            // data-collection-id: o App descobre a coleção sob o cursor ao soltar arquivos.
            <div key={c.id} data-collection-id={c.id}>
              {editingId === c.id ? (
                <input
                  autoFocus
                  defaultValue={c.name}
                  onFocus={(e) => e.currentTarget.select()}
                  onBlur={(e) => {
                    void renameCollection(c.id, e.currentTarget.value)
                    setEditingId(null)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') e.currentTarget.blur()
                    if (e.key === 'Escape') setEditingId(null)
                  }}
                  className="h-7 w-full rounded-md bg-content px-2 text-[13px] outline-none ring-3 ring-accent-soft"
                />
              ) : (
                <Item
                  icon={<Folder />}
                  label={c.name}
                  count={counts.byCollection.get(c.id) ?? 0}
                  active={sameView(view, { type: 'collection', id: c.id })}
                  highlighted={dropCollectionId === c.id}
                  onClick={() => setView({ type: 'collection', id: c.id })}
                  onDoubleClick={() => setEditingId(c.id)}
                  onContextMenu={(e) => {
                    e.preventDefault()
                    openMenu(e.clientX, e.clientY, [
                      { label: 'Renomear', icon: <Pencil />, onSelect: () => setEditingId(c.id) },
                      { type: 'separator' },
                      { label: 'Apagar coleção', icon: <Trash2 />, danger: true, onSelect: () => void deleteCollection(c.id) }
                    ])
                  }}
                />
              )}
            </div>
          ))}
        </Section>

        {counts.tags.length > 0 && (
          <Section title="Tags">
            {counts.tags.map(([tag, n]) => (
              <Item
                key={tag}
                icon={<Hash />}
                label={tag}
                count={n}
                active={sameView(view, { type: 'tag', tag })}
                onClick={() => setView({ type: 'tag', tag })}
              />
            ))}
          </Section>
        )}
      </nav>

      {libraryDir && (
        <button
          className="mx-2.5 mb-2.5 flex items-center gap-2 rounded-lg px-2 py-1.5 text-left hover:bg-fill-secondary"
          title={libraryDir}
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openMenu(r.left, r.top - 110, [
              { label: 'Abrir no Explorer', icon: <FolderOpen />, onSelect: () => void window.api.openLibraryFolder() },
              { label: 'Reindexar pasta', icon: <RefreshCw />, onSelect: () => void rescan() },
              { type: 'separator' },
              { label: 'Trocar pasta…', icon: <FolderSearch />, onSelect: () => void chooseLibrary() }
            ])
          }}
        >
          <HardDrive className="size-4 shrink-0 text-label-secondary" strokeWidth={1.75} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[12px] font-medium">{folderName(libraryDir.replace(/\\/g, '/'))}</span>
            <span className="block truncate text-[11px] text-label-tertiary">{libraryDir}</span>
          </span>
        </button>
      )}
    </aside>
  )
}

function Section({ title, action, children }: { title: string; action?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-3 first:mt-0">
      <div className="flex h-6 items-center justify-between px-2 text-[11px] font-semibold text-label-tertiary">
        {title}
        {action}
      </div>
      <div className="flex flex-col gap-px">{children}</div>
    </div>
  )
}

interface ItemProps {
  icon: ReactNode
  label: string
  count?: number
  active: boolean
  highlighted?: boolean
  onClick(): void
  onDoubleClick?(): void
  onContextMenu?(e: React.MouseEvent): void
  /** Botão que aparece no lugar da contagem ao passar o mouse (fica fora do botão do item). */
  action?: ReactNode
}

function Item({ icon, label, count, active, highlighted, onClick, onDoubleClick, onContextMenu, action }: ItemProps) {
  return (
    <div className="group relative">
      <button
        onClick={onClick}
        onDoubleClick={onDoubleClick}
        onContextMenu={onContextMenu}
        className={cn(
          'flex h-7 w-full items-center gap-2 rounded-md px-2 text-left text-[13px] transition-colors',
          active ? 'bg-fill font-medium' : 'hover:bg-fill-secondary',
          highlighted && 'bg-accent text-white'
        )}
      >
        <span className={cn('flex [&>svg]:size-4 [&>svg]:stroke-[1.75]', highlighted ? 'text-white' : 'text-accent')}>{icon}</span>
        <span className={cn('flex-1 truncate', !!action && 'group-hover:pr-5')}>{label}</span>
        {count !== undefined && count > 0 && (
          <span
            className={cn(
              'text-[12px] tabular-nums',
              highlighted ? 'text-white/80' : 'text-label-tertiary',
              !!action && 'group-hover:invisible'
            )}
          >
            {count}
          </span>
        )}
      </button>
      {action && <div className="absolute inset-y-0 right-1 hidden items-center group-hover:flex">{action}</div>}
    </div>
  )
}

import { forwardRef } from 'react'
import { ArrowUpDown, FileImage, FolderInput, FolderOpen, Plus, Search, X } from 'lucide-react'
import { useStore, viewTitle, type KindFilter, type SortKey } from '@/store'
import { cn, plural } from '@/lib'
import { useContextMenu } from './ContextMenu'

const KINDS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: 'Tudo' },
  { value: 'image', label: 'Imagens' },
  { value: 'gif', label: 'GIFs' },
  { value: 'video', label: 'Vídeos' }
]

const SORTS: { value: SortKey; label: string }[] = [
  { value: 'added', label: 'Mais recentes' },
  { value: 'used', label: 'Mais usados' },
  { value: 'name', label: 'Nome' }
]

export const Toolbar = forwardRef<HTMLInputElement, { count: number }>(function Toolbar({ count }, searchRef) {
  const {
    view,
    collections,
    linkedFolders,
    search,
    setSearch,
    kindFilter,
    setKindFilter,
    sort,
    setSort,
    tileSize,
    setTileSize,
    addDialog
  } = useStore()
  const openMenu = useContextMenu((s) => s.open)

  return (
    <header data-tauri-drag-region className="flex h-[52px] shrink-0 items-center gap-3 border-b border-separator bg-toolbar px-4 backdrop-blur-xl">
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-[15px] leading-tight font-semibold">{viewTitle(view, collections, linkedFolders)}</h1>
        <p className="text-[11px] leading-tight text-label-secondary">{plural(count, 'meme', 'memes')}</p>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex rounded-[7px] bg-fill p-0.5" role="tablist">
          {KINDS.map((k) => (
            <button
              key={k.value}
              role="tab"
              aria-selected={kindFilter === k.value}
              onClick={() => setKindFilter(k.value)}
              className={cn(
                'h-[22px] rounded-[5px] px-2.5 text-[12px] transition-all',
                kindFilter === k.value ? 'bg-elevated font-medium shadow-[0_1px_3px_rgba(0,0,0,0.12)]' : 'text-label-secondary hover:text-label'
              )}
            >
              {k.label}
            </button>
          ))}
        </div>

        <label className="relative flex items-center text-label-secondary" title="Ordenar">
          <ArrowUpDown className="pointer-events-none absolute left-2 size-3.5" />
          <select
            value={sort}
            onChange={(e) => setSort(e.target.value as SortKey)}
            className="h-[26px] appearance-none rounded-[7px] bg-fill pr-2.5 pl-7 text-[12px] text-label outline-none"
          >
            {SORTS.map((s) => (
              <option key={s.value} value={s.value}>
                {s.label}
              </option>
            ))}
          </select>
        </label>

        <input
          type="range"
          min={110}
          max={340}
          value={tileSize}
          onChange={(e) => setTileSize(Number(e.target.value))}
          aria-label="Tamanho das miniaturas"
          className="w-20 accent-accent"
        />

        <div className="relative flex items-center">
          <Search className="pointer-events-none absolute left-2 size-3.5 text-label-secondary" />
          <input
            ref={searchRef}
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            onKeyDown={(e) => e.key === 'Escape' && (setSearch(''), e.currentTarget.blur())}
            placeholder="Buscar"
            className="h-[26px] w-48 rounded-[7px] bg-fill pr-6 pl-7 text-[13px] outline-none placeholder:text-label-tertiary focus:ring-3 focus:ring-accent-soft"
          />
          {search && (
            <button aria-label="Limpar busca" className="absolute right-1.5 text-label-tertiary" onClick={() => setSearch('')}>
              <X className="size-3.5" />
            </button>
          )}
        </div>

        <button
          onClick={(e) => {
            const r = e.currentTarget.getBoundingClientRect()
            openMenu(r.left, r.bottom + 4, [
              { type: 'header', label: 'Adicionar à gaveta' },
              { label: 'Copiar arquivos…', icon: <FileImage />, onSelect: () => void addDialog('files') },
              { label: 'Adicionar pasta…', icon: <FolderInput />, onSelect: () => void addDialog('folder') },
              { type: 'separator' },
              { label: 'Abrir pasta no Explorer', icon: <FolderOpen />, onSelect: () => void window.api.openLibraryFolder() }
            ])
          }}
          title="Adicionar memes à pasta"
          className="flex size-[26px] items-center justify-center rounded-[7px] text-label-secondary hover:bg-fill hover:text-label"
        >
          <Plus className="size-[18px]" strokeWidth={1.75} />
        </button>
      </div>
    </header>
  )
})

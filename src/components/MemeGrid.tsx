import { memo, useRef, type MouseEvent } from 'react'
import { Copy, Eye, FolderOpen, Heart, Play, Trash2 } from 'lucide-react'
import type { Meme } from '@shared/types'
import { useStore } from '@/store'
import { cn, mediaUrl } from '@/lib'
import { useContextMenu, type MenuItem } from './ContextMenu'


export function memeMenuItems(ids: string[]): MenuItem[] {
  const s = useStore.getState()
  const memes = s.memes.filter((m) => ids.includes(m.id))
  const first = memes[0]
  const allFav = memes.every((m) => m.favorite)
  const items: MenuItem[] = []
  if (memes.length === 1) {
    items.push(
      { label: 'Copiar', icon: <Copy />, onSelect: () => void s.copyMeme(first.id) },
      { label: 'Visualizar', icon: <Eye />, onSelect: () => s.openQuickLook(first.id) },
      { label: 'Mostrar no Explorer', icon: <FolderOpen />, onSelect: () => void window.api.revealMeme(first.id) },
      { type: 'separator' }
    )
  }
  items.push({ label: allFav ? 'Remover dos favoritos' : 'Favoritar', icon: <Heart />, onSelect: () => void s.toggleFavorite(ids) })
  if (s.collections.length) {
    items.push({ type: 'separator' }, { type: 'header', label: 'Coleções' })
    for (const c of s.collections) {
      const inAll = memes.every((m) => m.collectionIds.includes(c.id))
      items.push({
        label: c.name,
        checked: inAll,
        onSelect: () =>
          memes.forEach((m) =>
            void s.updateMeme(m.id, {
              collectionIds: inAll ? m.collectionIds.filter((id) => id !== c.id) : [...m.collectionIds, c.id]
            })
          )
      })
    }
  }
  items.push(
    { type: 'separator' },
    {
      label: memes.length > 1 ? `Mover ${memes.length} para a Lixeira` : 'Mover para a Lixeira',
      icon: <Trash2 />,
      danger: true,
      onSelect: () => void s.deleteMemes(ids)
    }
  )
  return items
}

export function MemeGrid({ memes }: { memes: Meme[] }) {
  const tileSize = useStore((s) => s.tileSize)
  const selection = useStore((s) => s.selection)
  const idsRef = useRef<string[]>([])
  idsRef.current = memes.map((m) => m.id)

  return (
    <div
      className="flex-1 overflow-y-auto p-5"
      onMouseDown={(e) => e.target === e.currentTarget && useStore.getState().setSelection([])}
    >
      <div className="grid gap-3" style={{ gridTemplateColumns: `repeat(auto-fill, minmax(${tileSize}px, 1fr))` }}>
        {memes.map((m) => (
          <MemeCard key={m.id} meme={m} selected={selection.includes(m.id)} visibleIds={idsRef} />
        ))}
      </div>
    </div>
  )
}

const MemeCard = memo(function MemeCard({
  meme,
  selected,
  visibleIds
}: {
  meme: Meme
  selected: boolean
  visibleIds: React.RefObject<string[]>
}) {
  const videoRef = useRef<HTMLVideoElement>(null)
  const openMenu = useContextMenu((s) => s.open)

  const onClick = (e: MouseEvent) => {
    const mode = e.shiftKey ? 'range' : e.ctrlKey || e.metaKey ? 'toggle' : 'single'
    useStore.getState().select(meme.id, mode, visibleIds.current)
  }

  const onContextMenu = (e: MouseEvent) => {
    e.preventDefault()
    const s = useStore.getState()
    const ids = s.selection.includes(meme.id) ? s.selection : [meme.id]
    if (!s.selection.includes(meme.id)) s.setSelection([meme.id])
    openMenu(e.clientX, e.clientY, memeMenuItems(ids))
  }

  return (
    <div
      draggable
      onDragStart={(e) => {
        // Arraste nativo (ver api.ts): solta o arquivo no Discord, WhatsApp, Explorer...
        e.preventDefault()
        window.api.startDrag(meme.id)
      }}
      onClick={onClick}
      onDoubleClick={() => useStore.getState().openQuickLook(meme.id)}
      onContextMenu={onContextMenu}
      onMouseEnter={() => void videoRef.current?.play().catch(() => {})}
      onMouseLeave={() => videoRef.current?.pause()}
      className="group flex flex-col gap-1.5"
    >
      <div
        className={cn(
          'relative aspect-square overflow-hidden rounded-xl bg-fill-secondary transition-shadow',
          selected ? 'ring-[3px] ring-accent' : 'ring-1 ring-separator'
        )}
      >
        {meme.kind === 'video' ? (
          <video ref={videoRef} src={mediaUrl(meme)} muted loop preload="metadata" className="size-full object-cover" />
        ) : (
          <img src={mediaUrl(meme)} alt={meme.title} loading="lazy" decoding="async" draggable={false} className="size-full object-cover" />
        )}

        {meme.kind !== 'image' && (
          <span className="absolute bottom-1.5 left-1.5 flex items-center gap-0.5 rounded-[5px] bg-black/55 px-1.5 py-px text-[10px] font-semibold text-white backdrop-blur">
            {meme.kind === 'gif' ? 'GIF' : <Play className="size-2.5 fill-white" />}
          </span>
        )}
        {meme.favorite && (
          <Heart className="absolute right-1.5 bottom-1.5 size-4 fill-favorite text-favorite drop-shadow" />
        )}

        <button
          title="Copiar"
          onClick={(e) => {
            e.stopPropagation()
            void useStore.getState().copyMeme(meme.id)
          }}
          className="absolute top-1.5 right-1.5 flex size-7 items-center justify-center rounded-full bg-black/45 text-white opacity-0 backdrop-blur-md transition-opacity group-hover:opacity-100 hover:bg-black/65"
        >
          <Copy className="size-3.5" />
        </button>
      </div>
      <span className={cn('truncate px-0.5 text-center text-[12px]', selected ? 'font-medium text-accent' : 'text-label-secondary')}>
        {meme.title}
      </span>
    </div>
  )
})

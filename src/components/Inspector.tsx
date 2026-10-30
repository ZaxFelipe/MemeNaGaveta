import { useState, type ReactNode } from 'react'
import { Copy, FolderOpen, Heart, Trash2, X } from 'lucide-react'
import type { Meme } from '@shared/types'
import { useStore } from '@/store'
import { cn, formatBytes, formatDate, mediaUrl, plural } from '@/lib'

const KIND_LABEL = { image: 'Imagem', gif: 'GIF', video: 'Vídeo' } as const

/** Painel lateral direito com detalhes e edição do meme selecionado. */
export function Inspector({ meme }: { meme: Meme }) {
  const { updateMeme, toggleFavorite, deleteMemes, copyMeme, collections, linkedFolders } = useStore()
  const sourceName = linkedFolders.find((f) => f.id === meme.source)?.name

  return (
    <aside className="flex w-[280px] shrink-0 flex-col overflow-y-auto border-l border-separator bg-content">
      <div className="p-4">
        {/* Vídeo não tem preview aqui: toca no hover da grade e no Quick Look */}
        {meme.kind !== 'video' && (
          <div className="mb-3 overflow-hidden rounded-xl bg-fill-secondary ring-1 ring-separator">
            <img src={mediaUrl(meme)} alt={meme.title} className="max-h-64 w-full object-contain" />
          </div>
        )}

        {/* key força remontar o input quando muda o meme selecionado */}
        <input
          key={meme.id}
          defaultValue={meme.title}
          onBlur={(e) => e.currentTarget.value !== meme.title && void updateMeme(meme.id, { title: e.currentTarget.value })}
          onKeyDown={(e) => e.key === 'Enter' && e.currentTarget.blur()}
          className="w-full rounded-md bg-transparent px-1 py-0.5 text-[15px] font-semibold outline-none hover:bg-fill-secondary focus:bg-fill-secondary focus:ring-3 focus:ring-accent-soft"
        />

        <div className="mt-3 grid grid-cols-4 gap-1.5">
          <Action icon={<Copy />} label="Copiar" onClick={() => void copyMeme(meme.id)} primary />
          <Action
            icon={<Heart className={cn(meme.favorite && 'fill-favorite text-favorite')} />}
            label="Favorito"
            onClick={() => void toggleFavorite([meme.id])}
          />
          <Action icon={<FolderOpen />} label="Explorer" onClick={() => void window.api.revealMeme(meme.id)} />
          <Action icon={<Trash2 />} label="Apagar" onClick={() => void deleteMemes([meme.id])} />
        </div>
      </div>

      <Group title="Tags">
        <TagEditor meme={meme} />
      </Group>

      {collections.length > 0 && (
        <Group title="Coleções">
          <div className="flex flex-wrap gap-1.5">
            {collections.map((c) => {
              const active = meme.collectionIds.includes(c.id)
              return (
                <button
                  key={c.id}
                  onClick={() =>
                    void updateMeme(meme.id, {
                      collectionIds: active ? meme.collectionIds.filter((id) => id !== c.id) : [...meme.collectionIds, c.id]
                    })
                  }
                  className={cn(
                    'h-6 rounded-full px-2.5 text-[12px] transition-colors',
                    active ? 'bg-accent text-white' : 'bg-fill text-label-secondary hover:text-label'
                  )}
                >
                  {c.name}
                </button>
              )
            })}
          </div>
        </Group>
      )}

      <Group title="Informações">
        <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1 text-[12px]">
          <Info label="Arquivo" value={[sourceName, ...meme.relPath.split('/')].filter(Boolean).join(' › ')} />
          <Info label="Tipo" value={`${KIND_LABEL[meme.kind]} · ${meme.ext.toUpperCase()}`} />
          <Info label="Tamanho" value={formatBytes(meme.size)} />
          <Info label="Modificado" value={formatDate(meme.mtime)} />
          <Info label="Usado" value={meme.useCount ? plural(meme.useCount, 'vez', 'vezes') : 'Nunca'} />
        </dl>
      </Group>
    </aside>
  )
}

function TagEditor({ meme }: { meme: Meme }) {
  const updateMeme = useStore((s) => s.updateMeme)
  const [draft, setDraft] = useState('')

  const commit = () => {
    const newTags = draft.split(',').map((t) => t.trim()).filter(Boolean)
    if (newTags.length) void updateMeme(meme.id, { tags: [...meme.tags, ...newTags] })
    setDraft('')
  }

  return (
    <div className="flex flex-wrap items-center gap-1.5 rounded-lg bg-fill-secondary p-1.5 focus-within:ring-3 focus-within:ring-accent-soft">
      {meme.tags.map((t) => (
        <span key={t} className="flex h-6 items-center gap-1 rounded-full bg-accent-soft pr-1 pl-2.5 text-[12px] text-accent">
          {t}
          <button
            aria-label={`Remover ${t}`}
            className="rounded-full p-0.5 hover:bg-accent hover:text-white"
            onClick={() => void updateMeme(meme.id, { tags: meme.tags.filter((x) => x !== t) })}
          >
            <X className="size-2.5" strokeWidth={3} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ',') {
            e.preventDefault()
            commit()
          } else if (e.key === 'Backspace' && !draft && meme.tags.length) {
            void updateMeme(meme.id, { tags: meme.tags.slice(0, -1) })
          }
        }}
        onBlur={commit}
        placeholder={meme.tags.length ? '' : 'Adicionar tag…'}
        className="h-6 min-w-16 flex-1 bg-transparent px-1 text-[12px] outline-none placeholder:text-label-tertiary"
      />
    </div>
  )
}

function Group({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="border-t border-separator px-4 py-3">
      <h3 className="mb-2 text-[11px] font-semibold text-label-tertiary">{title}</h3>
      {children}
    </section>
  )
}

function Info({ label, value }: { label: string; value: string }) {
  return (
    <>
      <dt className="text-label-secondary">{label}</dt>
      <dd className="min-w-0 text-right break-words tabular-nums">{value}</dd>
    </>
  )
}

function Action({ icon, label, onClick, primary }: { icon: ReactNode; label: string; onClick(): void; primary?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={cn(
        'flex flex-col items-center gap-1 rounded-lg py-2 text-[11px] transition-colors [&>svg]:size-4 [&>svg]:stroke-[1.75]',
        primary ? 'bg-accent text-white hover:brightness-110' : 'bg-fill-secondary text-label-secondary hover:bg-fill hover:text-label'
      )}
    >
      {icon}
      {label}
    </button>
  )
}

/** Mostrado quando há vários memes selecionados. */
export function MultiInspector({ count }: { count: number }) {
  return (
    <aside className="flex w-[280px] shrink-0 flex-col items-center justify-center gap-1 border-l border-separator bg-content p-6 text-center">
      <p className="text-[15px] font-semibold">{plural(count, 'meme selecionado', 'memes selecionados')}</p>
      <p className="text-[12px] text-label-secondary">Clique com o botão direito para favoritar, mover para uma coleção ou apagar.</p>
    </aside>
  )
}

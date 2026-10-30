import { convertFileSrc } from '@tauri-apps/api/core'
import type { LibrarySnapshot, Meme } from '@shared/types'

/** Pasta da biblioteca e das pastas adicionadas (por id); a store atualiza a cada snapshot. */
let mediaRoot = ''
let linkedRoots = new Map<string, string>()

export function setMediaRoots(snapshot: LibrarySnapshot): void {
  mediaRoot = snapshot.libraryDir ?? ''
  linkedRoots = new Map(snapshot.linkedFolders.map((f) => [f.id, f.path]))
}

/**
 * URL do arquivo via protocolo `asset` do Tauri (suporta Range, então vídeos têm seek).
 * O backend só libera no escopo a biblioteca e as pastas adicionadas. `v` invalida o cache
 * quando o arquivo é substituído no mesmo caminho.
 */
export function mediaUrl(meme: Meme): string {
  const root = meme.source ? (linkedRoots.get(meme.source) ?? '') : mediaRoot
  const path = `${root.replace(/\\$/, '')}\\${meme.relPath.replaceAll('/', '\\')}`
  return `${convertFileSrc(path)}?v=${meme.mtime}`
}

/** Marca um arraste que saiu de dentro do app, para o overlay de importação não aparecer. */
export const internalDrag = { active: false }

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(0)} KB`
  return `${(bytes / 1024 ** 2).toFixed(1)} MB`
}

export function formatDate(ts: number): string {
  return new Date(ts).toLocaleDateString('pt-BR', { day: 'numeric', month: 'short', year: 'numeric' })
}

export function plural(n: number, singular: string, pluralForm: string): string {
  return `${n.toLocaleString('pt-BR')} ${n === 1 ? singular : pluralForm}`
}

/** Normaliza texto para busca: minúsculas e sem acentos. */
export function normalize(text: string): string {
  return text.normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase()
}

export function cn(...classes: Array<string | false | null | undefined>): string {
  return classes.filter(Boolean).join(' ')
}

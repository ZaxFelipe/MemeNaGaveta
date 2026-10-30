export type MemeKind = 'image' | 'gif' | 'video'

export interface Meme {
  /** Id estável; sobrevive a o arquivo ser movido/renomeado dentro da pasta. */
  id: string
  /** Caminho relativo à pasta da biblioteca, sempre com `/` (ex.: `reações/gato.gif`). */
  relPath: string
  /** Nome exibido. Começa como o nome do arquivo sem extensão; editar não renomeia o arquivo. */
  title: string
  ext: string
  kind: MemeKind
  size: number
  /** mtime do arquivo em ms; também usado para invalidar o cache de imagens. */
  mtime: number
  /** Hash rápido do conteúdo, usado para reconhecer arquivos movidos/renomeados. */
  hash: string
  tags: string[]
  collectionIds: string[]
  favorite: boolean
  /** Quando o arquivo entrou no índice. */
  addedAt: number
  lastUsedAt: number | null
  useCount: number
  /** Id da pasta adicionada (`LinkedFolder`) de onde o meme vem; ausente = pasta da biblioteca. */
  source?: string
}

/** Pasta externa adicionada pelo usuário: indexada onde está, sem cópia. */
export interface LinkedFolder {
  id: string
  /** Caminho absoluto no Windows. */
  path: string
  name: string
  /** Subpastas (relativas à pasta adicionada, com `/`), ordenadas. */
  folders: string[]
  /** false quando a pasta não está acessível (HD desconectado, renomeada...). */
  available: boolean
}

export interface Collection {
  id: string
  name: string
  createdAt: number
}

export interface LibrarySnapshot {
  /** null enquanto o usuário não escolheu uma pasta. */
  libraryDir: string | null
  memes: Meme[]
  collections: Collection[]
  /** Subpastas (relativas, com `/`), ordenadas. */
  folders: string[]
  linkedFolders: LinkedFolder[]
  /** Mensagem quando a pasta escolhida não pôde ser aberta (ex.: HD desconectado). */
  error?: string
}

export interface ImportResult {
  added: number
  /** Caminhos que o app já lia (na biblioteca ou numa pasta adicionada): não entram de novo. */
  alreadyInLibrary: number
  failed: number
  /** true quando o usuário fechou o diálogo sem escolher nada. */
  canceled?: boolean
}

/** O que adicionar pelo diálogo: arquivos soltos ou uma pasta inteira. */
export type ImportMode = 'files' | 'folder'

/**
 * Onde colocar o que for adicionado: pasta de destino dos arquivos copiados (pasta adicionada
 * `source` ou a biblioteca, e subpasta `folder`) e/ou coleção. Pastas não são copiadas.
 */
export interface AddTarget {
  source?: string
  folder?: string
  collectionId?: string
}

export type MemePatch = Partial<Pick<Meme, 'title' | 'tags' | 'collectionIds' | 'favorite'>>

/** API exposta pelo preload em `window.api`. */
export interface MemeApi {
  getLibrary(): Promise<LibrarySnapshot>
  /** Abre o seletor de pasta e troca a biblioteca. null se cancelado. */
  chooseLibrary(): Promise<LibrarySnapshot | null>
  rescan(): Promise<LibrarySnapshot>
  openLibraryFolder(): Promise<void>
  onLibraryChanged(cb: (snapshot: LibrarySnapshot) => void): () => void
  addPaths(paths: string[], target?: AddTarget): Promise<ImportResult>
  addDialog(mode: ImportMode, target?: AddTarget): Promise<ImportResult>
  addClipboard(target?: AddTarget): Promise<ImportResult>
  updateMeme(id: string, patch: MemePatch): Promise<Meme>
  deleteMemes(ids: string[]): Promise<void>
  /** Confirma e tira uma pasta adicionada do app, sem apagar do disco. false se cancelado. */
  removeLinkedFolder(id: string): Promise<boolean>
  copyMeme(id: string): Promise<void>
  revealMeme(id: string): Promise<void>
  startDrag(id: string): void
  createCollection(name: string): Promise<Collection>
  renameCollection(id: string, name: string): Promise<Collection>
  deleteCollection(id: string): Promise<void>
  window: {
    minimize(): void
    toggleMaximize(): void
    close(): void
    onMaximizedChange(cb: (maximized: boolean) => void): () => void
  }
}

export const SUPPORTED_EXTENSIONS: Record<string, MemeKind> = {
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  webp: 'image',
  bmp: 'image',
  avif: 'image',
  gif: 'gif',
  mp4: 'video',
  webm: 'video',
  mov: 'video'
}

/** Índice gravado na raiz da pasta da biblioteca. */
export const INDEX_FILE = '.memenagaveta.json'


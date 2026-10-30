import { invoke } from '@tauri-apps/api/core'
import { listen } from '@tauri-apps/api/event'
import { getCurrentWindow } from '@tauri-apps/api/window'
import { open } from '@tauri-apps/plugin-dialog'
import { startDrag } from '@crabnebula/tauri-plugin-drag'
import { SUPPORTED_EXTENSIONS, type LibrarySnapshot, type MemeApi } from '@shared/types'
import { internalDrag } from './lib'

/**
 * Implementação da `MemeApi` sobre o Tauri. É o único arquivo do frontend que conhece o
 * backend: componentes e store só usam `window.api`, como na versão Electron.
 */
const api: MemeApi = {
  getLibrary: () => invoke('get_library'),

  async chooseLibrary() {
    const dir = await open({ title: 'Escolha a pasta dos seus memes', directory: true })
    if (typeof dir !== 'string') return null
    return invoke<LibrarySnapshot>('set_library', { dir })
  },

  rescan: () => invoke('rescan'),
  openLibraryFolder: () => invoke('open_library_folder'),

  onLibraryChanged(cb) {
    const unlisten = listen<LibrarySnapshot>('library:changed', (e) => cb(e.payload))
    return () => void unlisten.then((fn) => fn())
  },

  addPaths: (paths, target) => invoke('add_paths', { paths, target }),

  async addDialog(mode, target) {
    // No Windows o diálogo não aceita arquivos e pastas ao mesmo tempo, por isso dois modos.
    const picked = await open(
      mode === 'folder'
        ? { title: 'Adicionar pasta à gaveta', directory: true, multiple: true }
        : {
            title: 'Copiar memes para a gaveta',
            multiple: true,
            filters: [{ name: 'Memes', extensions: Object.keys(SUPPORTED_EXTENSIONS) }]
          }
    )
    if (!picked || !picked.length) return { added: 0, alreadyInLibrary: 0, failed: 0, canceled: true }
    return invoke('add_paths', { paths: picked, target })
  },

  addClipboard: (target) => invoke('add_clipboard', { target }),
  updateMeme: (id, patch) => invoke('update_meme', { id, patch }),
  deleteMemes: (ids) => invoke('delete_memes', { ids }),
  removeLinkedFolder: (id) => invoke('remove_linked_folder', { id }),
  copyMeme: (id) => invoke('copy_meme', { id }),
  revealMeme: (id) => invoke('reveal_meme', { id }),

  startDrag(id) {
    // Arraste nativo: dá para soltar o arquivo no Discord, WhatsApp, Explorer...
    internalDrag.active = true
    void invoke<{ path: string; icon: string }>('drag_info', { id })
      .then(({ path, icon }) => startDrag({ item: [path], icon }, () => (internalDrag.active = false)))
      .catch(() => (internalDrag.active = false))
  },

  createCollection: (name) => invoke('create_collection', { name }),
  renameCollection: (id, name) => invoke('rename_collection', { id, name }),
  deleteCollection: (id) => invoke('delete_collection', { id }),

  window: {
    minimize: () => void getCurrentWindow().minimize(),
    toggleMaximize: () => void getCurrentWindow().toggleMaximize(),
    close: () => void getCurrentWindow().close(),
    onMaximizedChange(cb) {
      const win = getCurrentWindow()
      const unlisten = win.onResized(async () => cb(await win.isMaximized()))
      return () => void unlisten.then((fn) => fn())
    }
  }
}

window.api = api

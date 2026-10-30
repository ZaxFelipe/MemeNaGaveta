//! Comandos chamados pelo frontend (`src/api.ts`). Um por método da `MemeApi`.

use crate::library::{AddTarget, Collection, ImportResult, Library, Meme, MemePatch, Snapshot};
use crate::{open_library, refresh_sources, settings, snapshot, AppState};
use serde::Serialize;
use std::borrow::Cow;
use std::io::Cursor;
use std::path::PathBuf;
use tauri::{AppHandle, Manager, State};
use tauri_plugin_dialog::{DialogExt, MessageDialogButtons, MessageDialogKind};
use tauri_plugin_opener::OpenerExt;

/// Ícone de arraste para formatos que não são imagem estática (GIF/vídeo).
const DRAG_ICON: &[u8] = include_bytes!("../icons/128x128.png");
/// Formatos que o crate `image` decodifica para copiar como bitmap.
const BITMAP_EXTS: &[&str] = &["png", "jpg", "jpeg", "bmp", "webp"];

type Res<T> = Result<T, String>;

/// Executa `f` com a biblioteca aberta, ou falha se nenhuma pasta estiver aberta.
fn with_lib<T>(state: &State<AppState>, f: impl FnOnce(&mut Library) -> Res<T>) -> Res<T> {
    let mut guard = state.library.lock().map_err(|e| e.to_string())?;
    let lib = guard.as_mut().ok_or("Nenhuma pasta de memes aberta")?;
    f(lib)
}

#[tauri::command]
pub fn get_library(app: AppHandle) -> Snapshot {
    snapshot(&app)
}

#[tauri::command]
pub async fn set_library(app: AppHandle, dir: String) -> Res<Snapshot> {
    let state = app.state::<AppState>();
    let mut current = settings::load(&state.data_dir);
    current.library_dir = Some(dir.clone());
    settings::save(&state.data_dir, &current)?;
    open_library(&app, PathBuf::from(dir));
    Ok(snapshot(&app))
}

#[tauri::command]
pub async fn rescan(app: AppHandle) -> Res<Snapshot> {
    let state = app.state::<AppState>();
    let has_lib = state.library.lock().map_err(|e| e.to_string())?.is_some();
    if has_lib {
        with_lib(&state, |lib| lib.scan().map(|_| ()))?;
        // Uma pasta adicionada que estava indisponível pode ter voltado: vigia de novo.
        refresh_sources(&app);
    } else if let Some(dir) = settings::load(&state.data_dir).library_dir {
        // Sem biblioteca aberta (ex.: pasta estava offline), tenta abrir de novo.
        open_library(&app, PathBuf::from(dir));
    }
    Ok(snapshot(&app))
}

#[tauri::command]
pub fn open_library_folder(app: AppHandle, state: State<AppState>) -> Res<()> {
    let dir = with_lib(&state, |lib| Ok(lib.dir.clone()))?;
    app.opener().open_path(dir.to_string_lossy(), None::<&str>).map_err(|e| e.to_string())
}

/// `Library::add_paths` + passa a vigiar (e servir via asset://) as pastas que forem adicionadas.
fn add_and_watch(app: &AppHandle, paths: &[String], target: &AddTarget) -> Res<ImportResult> {
    let state = app.state::<AppState>();
    let (result, linked) = with_lib(&state, |lib| {
        let before = lib.source_dirs();
        let result = lib.add_paths(paths, target)?;
        Ok((result, lib.source_dirs() != before))
    })?;
    if linked {
        refresh_sources(app);
    }
    Ok(result)
}

#[tauri::command]
pub async fn add_paths(app: AppHandle, paths: Vec<String>, target: Option<AddTarget>) -> Res<ImportResult> {
    add_and_watch(&app, &paths, &target.unwrap_or_default())
}

#[tauri::command]
pub async fn add_clipboard(app: AppHandle, state: State<'_, AppState>, target: Option<AddTarget>) -> Res<ImportResult> {
    let target = target.unwrap_or_default();
    // Arquivos copiados no Explorer: adiciona os originais (preserva GIF/vídeo).
    let files: Vec<String> =
        clipboard_win::get_clipboard(clipboard_win::formats::FileList).unwrap_or_default();
    if !files.is_empty() {
        return add_and_watch(&app, &files, &target);
    }
    let Ok(image) = arboard::Clipboard::new().and_then(|mut c| c.get_image()) else {
        return Ok(ImportResult::default());
    };
    let rgba = image::RgbaImage::from_raw(image.width as u32, image.height as u32, image.bytes.into_owned())
        .ok_or("Imagem da área de transferência inválida")?;
    let mut png = Cursor::new(Vec::new());
    rgba.write_to(&mut png, image::ImageFormat::Png).map_err(|e| e.to_string())?;
    let name = format!("Colado {}.png", chrono::Local::now().format("%Y-%m-%d %H-%M-%S"));
    with_lib(&state, |lib| lib.add_buffer(png.get_ref(), &name, &target))
}

#[tauri::command]
pub fn update_meme(state: State<AppState>, id: String, patch: MemePatch) -> Res<Meme> {
    with_lib(&state, |lib| lib.update_meme(&id, patch))
}

#[tauri::command]
pub async fn delete_memes(state: State<'_, AppState>, ids: Vec<String>) -> Res<()> {
    let paths = with_lib(&state, |lib| Ok(lib.remove_memes(&ids)))?;
    // Sempre Lixeira, nunca exclusão definitiva: são os arquivos originais do usuário.
    trash::delete_all(&paths).map_err(|e| e.to_string())
}

/// Tira uma pasta adicionada do app (não apaga nada do disco), depois de confirmar. `false` se cancelado.
#[tauri::command]
pub async fn remove_linked_folder(app: AppHandle, state: State<'_, AppState>, id: String) -> Res<bool> {
    let (name, count) = with_lib(&state, |lib| lib.linked_folder_summary(&id))?;
    let memes = if count == 1 { "1 meme".to_string() } else { format!("{count} memes") };
    let mut dialog = app
        .dialog()
        .message(format!(
            "A pasta “{name}” ({memes}) deixa de aparecer no Meme na Gaveta. Os arquivos continuam \
             no computador.\n\nTags e coleções desses memes serão perdidas."
        ))
        .title("Remover pasta do app?")
        .kind(MessageDialogKind::Warning)
        .buttons(MessageDialogButtons::OkCancelCustom("Remover do app".into(), "Cancelar".into()));
    if let Some(win) = app.get_webview_window("main") {
        dialog = dialog.parent(&win);
    }
    if !dialog.blocking_show() {
        return Ok(false);
    }
    with_lib(&state, |lib| {
        lib.unlink_folder(&id);
        Ok(())
    })?;
    refresh_sources(&app);
    Ok(true)
}

#[tauri::command]
pub async fn copy_meme(state: State<'_, AppState>, id: String) -> Res<()> {
    let (path, ext) = with_lib(&state, |lib| {
        let meme = lib.get_meme(&id)?;
        Ok((lib.file_path(meme)?, meme.ext.clone()))
    })?;
    let bitmap = BITMAP_EXTS.contains(&ext.as_str()).then(|| image::open(&path).ok()).flatten();
    match bitmap {
        Some(img) => {
            let rgba = img.to_rgba8();
            let data = arboard::ImageData {
                width: rgba.width() as usize,
                height: rgba.height() as usize,
                bytes: Cow::Owned(rgba.into_raw()),
            };
            arboard::Clipboard::new().and_then(|mut c| c.set_image(data)).map_err(|e| e.to_string())?;
        }
        // GIF, vídeo e avif vão como arquivo (CF_HDROP): Discord/WhatsApp/Explorer colam o
        // arquivo original, e o GIF continua animado.
        None => {
            let file = path.to_string_lossy().into_owned();
            let _clip = clipboard_win::Clipboard::new_attempts(10).map_err(|e| e.to_string())?;
            clipboard_win::empty().map_err(|e| e.to_string())?;
            clipboard_win::raw::set_file_list(&[file.as_str()]).map_err(|e| e.to_string())?;
        }
    }
    with_lib(&state, |lib| lib.mark_used(&id))
}

#[tauri::command]
pub fn reveal_meme(state: State<AppState>, id: String) -> Res<()> {
    let path = with_lib(&state, |lib| lib.file_path(lib.get_meme(&id)?))?;
    tauri_plugin_opener::reveal_item_in_dir(path).map_err(|e| e.to_string())
}

#[derive(Serialize)]
pub struct DragInfo {
    path: String,
    icon: String,
}

/// Caminho do arquivo e do ícone para o arraste nativo (feito no frontend pelo plugin drag).
#[tauri::command]
pub fn drag_info(state: State<AppState>, id: String) -> Res<DragInfo> {
    let icon_fallback = state.data_dir.join("drag-icon.png");
    if !icon_fallback.exists() {
        std::fs::write(&icon_fallback, DRAG_ICON).map_err(|e| e.to_string())?;
    }
    with_lib(&state, |lib| {
        let meme = lib.get_meme(&id)?;
        let path = lib.file_path(meme)?;
        let icon = if BITMAP_EXTS.contains(&meme.ext.as_str()) { path.clone() } else { icon_fallback };
        lib.mark_used(&id)?;
        Ok(DragInfo { path: path.to_string_lossy().into_owned(), icon: icon.to_string_lossy().into_owned() })
    })
}

#[tauri::command]
pub fn create_collection(state: State<AppState>, name: String) -> Res<Collection> {
    with_lib(&state, |lib| Ok(lib.create_collection(&name)))
}

#[tauri::command]
pub fn rename_collection(state: State<AppState>, id: String, name: String) -> Res<Collection> {
    with_lib(&state, |lib| lib.rename_collection(&id, &name))
}

#[tauri::command]
pub fn delete_collection(state: State<AppState>, id: String) -> Res<()> {
    with_lib(&state, |lib| {
        lib.delete_collection(&id);
        Ok(())
    })
}

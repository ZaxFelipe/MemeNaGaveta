mod commands;
pub mod library;
mod settings;

use library::{Library, Snapshot, INDEX_FILE};
use notify_debouncer_mini::notify::{RecommendedWatcher, RecursiveMode};
use notify_debouncer_mini::{new_debouncer, DebounceEventResult, Debouncer};
use std::path::PathBuf;
use std::sync::Mutex;
use std::time::Duration;
use tauri::utils::config::WindowEffectsConfig;
use tauri::window::Effect;
use tauri::{AppHandle, Emitter, Manager, RunEvent, WebviewUrl, WebviewWindowBuilder};

const WATCH_DEBOUNCE: Duration = Duration::from_millis(500);
const SAVE_INTERVAL: Duration = Duration::from_millis(400);

pub struct AppState {
    pub library: Mutex<Option<Library>>,
    pub error: Mutex<Option<String>>,
    watcher: Mutex<Option<Debouncer<RecommendedWatcher>>>,
    /// `MemeNaGaveta-dados\` ao lado do exe (o app é portátil).
    pub data_dir: PathBuf,
}

/// Estado completo para o frontend. Sem biblioteca aberta, informa a pasta salva e o erro.
pub fn snapshot(app: &AppHandle) -> Snapshot {
    let state = app.state::<AppState>();
    if let Some(lib) = state.library.lock().unwrap().as_ref() {
        return lib.snapshot();
    }
    let error = state.error.lock().unwrap().clone();
    Snapshot {
        library_dir: settings::load(&state.data_dir).library_dir,
        memes: vec![],
        collections: vec![],
        folders: vec![],
        linked_folders: vec![],
        error,
    }
}

/// Fecha a biblioteca atual (se houver), abre `dir`, libera o protocolo asset para ela e
/// começa a vigiar a pasta.
pub fn open_library(app: &AppHandle, dir: PathBuf) {
    let state = app.state::<AppState>();
    state.watcher.lock().unwrap().take();
    if let Some(mut old) = state.library.lock().unwrap().take() {
        let _ = old.flush();
    }
    match Library::open(dir) {
        Ok(lib) => {
            *state.library.lock().unwrap() = Some(lib);
            *state.error.lock().unwrap() = None;
            refresh_sources(app);
        }
        Err(err) => *state.error.lock().unwrap() = Some(err),
    }
}

/// Libera no asset:// e passa a vigiar a pasta da biblioteca e as pastas adicionadas.
/// Chamado ao abrir a biblioteca e quando uma pasta é adicionada ou removida.
pub fn refresh_sources(app: &AppHandle) {
    let state = app.state::<AppState>();
    let dirs = match state.library.lock().unwrap().as_ref() {
        Some(lib) => lib.source_dirs(),
        None => return,
    };
    // Só essas pastas podem ser lidas pelo frontend. Uma pasta removida continua liberada
    // até fechar o app: `forbid` no escopo é permanente e impediria adicioná-la de novo.
    for dir in &dirs {
        let _ = app.asset_protocol_scope().allow_directory(dir, true);
    }
    let watcher = start_watcher(app, &dirs);
    *state.watcher.lock().unwrap() = watcher;
}

/// Mudanças nas pastas (Explorer, outro app) disparam uma varredura e um snapshot novo.
/// Pastas indisponíveis (HD desconectado) ficam de fora; "Reindexar" as pega de volta.
fn start_watcher(app: &AppHandle, dirs: &[PathBuf]) -> Option<Debouncer<RecommendedWatcher>> {
    let handle = app.clone();
    let mut debouncer = new_debouncer(WATCH_DEBOUNCE, move |res: DebounceEventResult| {
        let Ok(events) = res else { return };
        let only_index = events.iter().all(|e| {
            e.path.file_name().is_some_and(|n| n.to_string_lossy().starts_with(INDEX_FILE))
        });
        if only_index {
            return;
        }
        let changed = {
            let state = handle.state::<AppState>();
            let mut guard = state.library.lock().unwrap();
            guard.as_mut().map(|lib| lib.scan().unwrap_or(false)).unwrap_or(false)
        };
        if changed {
            let _ = handle.emit("library:changed", snapshot(&handle));
        }
    })
    .ok()?;
    for dir in dirs {
        let _ = debouncer.watcher().watch(dir, RecursiveMode::Recursive);
    }
    Some(debouncer)
}

fn flush_library(app: &AppHandle) {
    if let Some(lib) = app.state::<AppState>().library.lock().unwrap().as_mut() {
        if let Err(err) = lib.flush() {
            eprintln!("Falha ao gravar índice: {err}");
        }
    }
}

/// Erro antes de existir janela: caixa de mensagem nativa do Windows.
fn fatal(message: &str) {
    use windows_sys::Win32::UI::WindowsAndMessaging::{MessageBoxW, MB_ICONERROR, MB_OK};
    let wide = |s: &str| s.encode_utf16().chain(Some(0)).collect::<Vec<u16>>();
    unsafe {
        MessageBoxW(std::ptr::null_mut(), wide(message).as_ptr(), wide("Meme na Gaveta").as_ptr(), MB_OK | MB_ICONERROR);
    }
}

pub fn run() {
    let data_dir = settings::data_dir();
    if let Err(err) = settings::ensure_writable(&data_dir) {
        fatal(&format!(
            "O Meme na Gaveta guarda as configurações na própria pasta, mas não conseguiu gravar em:\n{}\n\n\
             Mova o app para uma pasta sua (por exemplo, Documentos) e abra de novo.\n\n({err})",
            data_dir.display()
        ));
        return;
    }

    let app = tauri::Builder::default()
        .plugin(tauri_plugin_single_instance::init(|app, _args, _cwd| {
            if let Some(win) = app.get_webview_window("main") {
                let _ = win.unminimize();
                let _ = win.set_focus();
            }
        }))
        .plugin(tauri_plugin_dialog::init())
        .plugin(tauri_plugin_opener::init())
        .plugin(tauri_plugin_drag::init())
        .manage(AppState {
            library: Mutex::new(None),
            error: Mutex::new(None),
            watcher: Mutex::new(None),
            data_dir: data_dir.clone(),
        })
        .setup(move |app| {
            WebviewWindowBuilder::new(app, "main", WebviewUrl::default())
                .title("Meme na Gaveta")
                .inner_size(1280.0, 820.0)
                .min_inner_size(900.0, 580.0)
                // Sem barra nativa: os "semáforos" estilo macOS são desenhados no frontend.
                .decorations(false)
                .shadow(true)
                .transparent(true)
                .effects(WindowEffectsConfig { effects: vec![Effect::Mica], ..Default::default() })
                // Sem isso o WebView2 grava cache e localStorage em %LOCALAPPDATA%.
                .data_directory(data_dir.join("webview"))
                .build()?;

            // Abre a biblioteca salva fora da thread principal (pastas grandes demoram).
            let handle = app.handle().clone();
            std::thread::spawn(move || {
                if let Some(dir) = settings::load(&handle.state::<AppState>().data_dir).library_dir {
                    open_library(&handle, PathBuf::from(dir));
                    let _ = handle.emit("library:changed", snapshot(&handle));
                }
            });

            // Grava o índice periodicamente quando há mudanças (escrita atômica na Library).
            let handle = app.handle().clone();
            std::thread::spawn(move || loop {
                std::thread::sleep(SAVE_INTERVAL);
                flush_library(&handle);
            });
            Ok(())
        })
        .invoke_handler(tauri::generate_handler![
            commands::get_library,
            commands::set_library,
            commands::rescan,
            commands::open_library_folder,
            commands::add_paths,
            commands::add_clipboard,
            commands::update_meme,
            commands::delete_memes,
            commands::remove_linked_folder,
            commands::copy_meme,
            commands::reveal_meme,
            commands::drag_info,
            commands::create_collection,
            commands::rename_collection,
            commands::delete_collection,
        ])
        .build(tauri::generate_context!())
        .expect("falha ao iniciar o Meme na Gaveta");

    app.run(|app, event| {
        if let RunEvent::Exit = event {
            flush_library(app);
        }
    });
}

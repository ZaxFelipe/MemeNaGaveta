//! Configurações locais. O app é portátil: tudo fica em `MemeNaGaveta-dados\` ao lado do
//! executável, nunca em AppData. Os dados dos memes ficam na própria pasta da biblioteca.

use serde::{Deserialize, Serialize};
use std::fs;
use std::path::{Path, PathBuf};

const DATA_DIR: &str = "MemeNaGaveta-dados";
const SETTINGS_FILE: &str = "settings.json";

#[derive(Serialize, Deserialize, Default)]
#[serde(rename_all = "camelCase")]
pub struct Settings {
    pub library_dir: Option<String>,
}

/// `<pasta do .exe>\MemeNaGaveta-dados`.
pub fn data_dir() -> PathBuf {
    let exe = std::env::current_exe().expect("caminho do executável");
    exe.parent().expect("pasta do executável").join(DATA_DIR)
}

/// Garante que dá para gravar ao lado do exe (falha, por exemplo, dentro de Program Files).
pub fn ensure_writable(dir: &Path) -> std::io::Result<()> {
    fs::create_dir_all(dir)?;
    let probe = dir.join(".teste-escrita");
    fs::write(&probe, b"ok")?;
    fs::remove_file(probe)
}

pub fn load(dir: &Path) -> Settings {
    fs::read_to_string(dir.join(SETTINGS_FILE))
        .ok()
        .and_then(|s| serde_json::from_str(crate::library::strip_bom(&s)).ok())
        .unwrap_or_default()
}

pub fn save(dir: &Path, settings: &Settings) -> Result<(), String> {
    let json = serde_json::to_string_pretty(settings).map_err(|e| e.to_string())?;
    fs::write(dir.join(SETTINGS_FILE), json).map_err(|e| e.to_string())
}

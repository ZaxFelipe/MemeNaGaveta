//! Biblioteca = uma pasta escolhida pelo usuário. Os arquivos ficam onde estão; o app só
//! mantém um índice (`.memenagaveta.json` na raiz da pasta) com tags, coleções e uso.
//! O índice é reconciliado com o disco a cada varredura (abertura + mudanças na pasta).
//! O formato do JSON é o mesmo da versão Electron, então as duas abrem a mesma pasta.

use serde::{Deserialize, Serialize};
use sha1::{Digest, Sha1};
use std::collections::{HashMap, HashSet};
use std::fs;
use std::io::{Read, Seek, SeekFrom};
use std::path::{Component, Path, PathBuf};
use std::time::{SystemTime, UNIX_EPOCH};

pub const INDEX_FILE: &str = ".memenagaveta.json";
/// Bytes lidos do início e do fim de cada arquivo para o hash rápido.
const HASH_CHUNK: u64 = 64 * 1024;

pub fn kind_for_ext(ext: &str) -> Option<&'static str> {
    match ext {
        "png" | "jpg" | "jpeg" | "webp" | "bmp" | "avif" => Some("image"),
        "gif" => Some("gif"),
        "mp4" | "webm" | "mov" => Some("video"),
        _ => None,
    }
}

#[derive(Serialize, Deserialize, Clone, Debug, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Meme {
    pub id: String,
    /// Caminho relativo à pasta, sempre com `/`.
    pub rel_path: String,
    pub title: String,
    pub ext: String,
    pub kind: String,
    pub size: u64,
    pub mtime: u64,
    pub hash: String,
    #[serde(default)]
    pub tags: Vec<String>,
    #[serde(default)]
    pub collection_ids: Vec<String>,
    #[serde(default)]
    pub favorite: bool,
    pub added_at: u64,
    pub last_used_at: Option<u64>,
    #[serde(default)]
    pub use_count: u64,
    /// Id da pasta adicionada (`LinkedFolder`) de onde o meme vem; `None` = pasta da biblioteca.
    /// `rel_path` é relativo a essa pasta.
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source: Option<String>,
}

/// Pasta externa adicionada pelo usuário: é indexada onde está, sem cópia.
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolder {
    pub id: String,
    pub path: String,
    pub added_at: u64,
}

/// Pasta adicionada como o frontend vê: subpastas e se está acessível agora.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct LinkedFolderInfo {
    pub id: String,
    pub path: String,
    pub name: String,
    pub folders: Vec<String>,
    pub available: bool,
}

#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Collection {
    pub id: String,
    pub name: String,
    pub created_at: u64,
}

#[derive(Serialize, Deserialize, Debug)]
struct IndexData {
    version: u32,
    #[serde(default)]
    memes: Vec<Meme>,
    #[serde(default)]
    collections: Vec<Collection>,
    #[serde(default, rename = "linkedFolders", skip_serializing_if = "Vec::is_empty")]
    linked_folders: Vec<LinkedFolder>,
}

impl Default for IndexData {
    fn default() -> Self {
        Self { version: 2, memes: vec![], collections: vec![], linked_folders: vec![] }
    }
}

#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct Snapshot {
    pub library_dir: Option<String>,
    pub memes: Vec<Meme>,
    pub collections: Vec<Collection>,
    pub folders: Vec<String>,
    pub linked_folders: Vec<LinkedFolderInfo>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
}

#[derive(Serialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ImportResult {
    pub added: u32,
    pub already_in_library: u32,
    pub failed: u32,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct AddTarget {
    /// Pasta adicionada de destino; `None` = pasta da biblioteca.
    pub source: Option<String>,
    pub folder: Option<String>,
    pub collection_id: Option<String>,
}

#[derive(Deserialize, Default, Debug)]
#[serde(rename_all = "camelCase")]
pub struct MemePatch {
    pub title: Option<String>,
    pub tags: Option<Vec<String>>,
    pub collection_ids: Option<Vec<String>>,
    pub favorite: Option<bool>,
}

struct Found {
    source: Option<String>,
    rel: String,
    size: u64,
    mtime: u64,
}

/// Onde um arquivo está: pasta de origem (`None` = biblioteca) + caminho relativo com `/`.
type Location = (Option<String>, String);

pub struct Library {
    pub dir: PathBuf,
    data: IndexData,
    /// Subpastas da pasta da biblioteca.
    folders: Vec<String>,
    /// Subpastas de cada pasta adicionada que está acessível; ausente = indisponível.
    linked_folders: HashMap<String, Vec<String>>,
    dirty: bool,
}

impl Library {
    pub fn open(dir: PathBuf) -> Result<Self, String> {
        ensure_available(&dir)?;
        let mut lib =
            Library { dir, data: IndexData::default(), folders: vec![], linked_folders: HashMap::new(), dirty: false };
        let index = lib.dir.join(INDEX_FILE);
        if index.exists() {
            let parsed = fs::read_to_string(&index)
                .map_err(|e| e.to_string())
                .and_then(|s| serde_json::from_str::<IndexData>(strip_bom(&s)).map_err(|e| e.to_string()));
            match parsed {
                Ok(data) => lib.data = IndexData { version: 2, ..data },
                Err(err) => {
                    // Índice corrompido: guarda uma cópia e reindexa do zero em vez de travar o app.
                    eprintln!("Índice inválido, criando backup: {err}");
                    let backup = lib.dir.join(format!(".memenagaveta.corrupt-{}.json", now_ms()));
                    let _ = fs::copy(&index, backup);
                }
            }
        }
        lib.scan()?;
        Ok(lib)
    }

    pub fn snapshot(&self) -> Snapshot {
        // Memes de pastas adicionadas indisponíveis ficam no índice (com tags), mas não aparecem.
        let visible = |m: &&Meme| m.source.as_ref().is_none_or(|s| self.linked_folders.contains_key(s));
        Snapshot {
            library_dir: Some(self.dir.to_string_lossy().into_owned()),
            memes: self.data.memes.iter().filter(visible).cloned().collect(),
            collections: self.data.collections.clone(),
            folders: self.folders.clone(),
            linked_folders: self
                .data
                .linked_folders
                .iter()
                .map(|l| LinkedFolderInfo {
                    id: l.id.clone(),
                    path: l.path.clone(),
                    name: folder_display_name(&l.path),
                    folders: self.linked_folders.get(&l.id).cloned().unwrap_or_default(),
                    available: self.linked_folders.contains_key(&l.id),
                })
                .collect(),
            error: None,
        }
    }

    /// Pastas que o app lê: a da biblioteca e as adicionadas (para watcher e protocolo asset).
    pub fn source_dirs(&self) -> Vec<PathBuf> {
        std::iter::once(self.dir.clone())
            .chain(self.data.linked_folders.iter().map(|l| PathBuf::from(&l.path)))
            .collect()
    }

    fn base_dir(&self, source: Option<&str>) -> Result<PathBuf, String> {
        match source {
            None => Ok(self.dir.clone()),
            Some(id) => self
                .data
                .linked_folders
                .iter()
                .find(|l| l.id == id)
                .map(|l| PathBuf::from(&l.path))
                .ok_or_else(|| format!("Pasta adicionada não encontrada: {id}")),
        }
    }

    pub fn file_path(&self, meme: &Meme) -> Result<PathBuf, String> {
        Ok(rel_to_path(&self.base_dir(meme.source.as_deref())?, &meme.rel_path))
    }

    pub fn get_meme(&self, id: &str) -> Result<&Meme, String> {
        self.data.memes.iter().find(|m| m.id == id).ok_or_else(|| format!("Meme não encontrado: {id}"))
    }

    fn get_meme_mut(&mut self, id: &str) -> Result<&mut Meme, String> {
        self.data.memes.iter_mut().find(|m| m.id == id).ok_or_else(|| format!("Meme não encontrado: {id}"))
    }

    /// Varre a pasta e reconcilia com o índice. Devolve `true` se algo mudou.
    pub fn scan(&mut self) -> Result<bool, String> {
        // Pasta indisponível (HD desconectado, OneDrive offline): não varrer, senão
        // "nenhum arquivo encontrado" apagaria todas as tags do índice.
        ensure_available(&self.dir)?;

        let mut files = Vec::new();
        let mut folders = Vec::new();
        walk(&self.dir, "", None, &mut files, &mut folders);
        folders.sort_by_key(|f| f.to_lowercase());

        // Pasta adicionada indisponível (HD desconectado): mesma regra da biblioteca, os memes
        // dela ficam intactos no índice até ela voltar ou ser removida.
        let mut linked_folders = HashMap::new();
        for linked in &self.data.linked_folders {
            let dir = PathBuf::from(&linked.path);
            if !dir.is_dir() {
                continue;
            }
            let mut sub = Vec::new();
            walk(&dir, "", Some(&linked.id), &mut files, &mut sub);
            sub.sort_by_key(|f| f.to_lowercase());
            linked_folders.insert(linked.id.clone(), sub);
        }

        let mut changed = folders != self.folders || linked_folders != self.linked_folders;
        let (offline, online): (Vec<Meme>, Vec<Meme>) = self
            .data
            .memes
            .drain(..)
            .partition(|m| m.source.as_ref().is_some_and(|s| !linked_folders.contains_key(s)));
        let mut by_path: HashMap<Location, Meme> =
            online.into_iter().map(|m| ((m.source.clone(), m.rel_path.clone()), m)).collect();
        let mut next = offline;
        let mut new_files = Vec::new();

        for f in files {
            match by_path.remove(&(f.source.clone(), f.rel.clone())) {
                Some(mut meme) => {
                    if meme.size != f.size || meme.mtime != f.mtime {
                        meme.size = f.size;
                        meme.mtime = f.mtime;
                        meme.hash = quick_hash(&self.found_path(&f), f.size).unwrap_or_default();
                        changed = true;
                    }
                    next.push(meme);
                }
                None => new_files.push(f),
            }
        }

        // O que sobrou em by_path sumiu do disco. Se um arquivo novo tiver o mesmo hash,
        // foi movido/renomeado: transfere tags e coleções em vez de perder tudo.
        let mut missing_by_hash: HashMap<String, Meme> =
            by_path.into_values().map(|m| (m.hash.clone(), m)).collect();
        for f in new_files {
            let Ok(hash) = quick_hash(&self.found_path(&f), f.size) else { continue };
            match missing_by_hash.remove(&hash) {
                Some(mut moved) => {
                    if moved.title == title_from(&moved.rel_path) {
                        moved.title = title_from(&f.rel);
                    }
                    moved.source = f.source;
                    moved.rel_path = f.rel;
                    moved.size = f.size;
                    moved.mtime = f.mtime;
                    next.push(moved);
                }
                None => next.push(new_meme(f, hash)),
            }
            changed = true;
        }
        if !missing_by_hash.is_empty() {
            changed = true;
        }

        self.folders = folders;
        self.linked_folders = linked_folders;
        self.data.memes = next;
        if changed {
            self.dirty = true;
        }
        Ok(changed)
    }

    /// Adiciona caminhos externos. Pastas são indexadas onde estão (viram `LinkedFolder`, sem
    /// cópia); arquivos soltos são copiados para o destino. Caminhos que o app já lê não são
    /// adicionados de novo; com `collection_id` só entram na coleção.
    pub fn add_paths(&mut self, paths: &[String], target: &AddTarget) -> Result<ImportResult, String> {
        let mut result = ImportResult::default();
        let target_dir = self.target_dir(target)?;
        // Arquivo ou pasta alcançados; rel vazio = a pasta adicionada inteira.
        let mut touched: Vec<Location> = Vec::new();

        for src in paths {
            let src = PathBuf::from(src);
            if let Some(found) = self.locate(&src) {
                result.already_in_library += 1;
                touched.push(found);
                continue;
            }
            let Ok(meta) = fs::metadata(&src) else {
                result.failed += 1;
                continue;
            };
            if meta.is_dir() {
                match self.link_folder(&src) {
                    Ok(id) => touched.push((Some(id), String::new())),
                    Err(err) => {
                        eprintln!("Falha ao adicionar {}: {err}", src.display());
                        result.failed += 1;
                    }
                }
                continue;
            }
            let Some(name) = src.file_name().filter(|_| is_supported(&src)) else {
                result.failed += 1;
                continue;
            };
            let dest = unique_path(&target_dir.join(name));
            match fs::create_dir_all(&target_dir).and_then(|_| fs::copy(&src, &dest)) {
                Ok(_) => touched.extend(self.locate(&dest)),
                Err(err) => {
                    eprintln!("Falha ao adicionar {}: {err}", src.display());
                    result.failed += 1;
                }
            }
        }

        let before: HashSet<String> = self.data.memes.iter().map(|m| m.id.clone()).collect();
        self.scan()?;
        let is_hit = |m: &Meme| {
            touched.iter().any(|(source, t)| {
                m.source == *source && (t.is_empty() || m.rel_path == *t || m.rel_path.starts_with(&format!("{t}/")))
            })
        };
        result.added = self.data.memes.iter().filter(|m| is_hit(m) && !before.contains(&m.id)).count() as u32;
        if let Some(cid) = &target.collection_id {
            for m in self.data.memes.iter_mut().filter(|m| is_hit(m)) {
                if !m.collection_ids.contains(cid) {
                    m.collection_ids.push(cid.clone());
                }
            }
            self.dirty = true;
        }
        Ok(result)
    }

    /// Salva uma imagem (ex.: colada da área de transferência) dentro da biblioteca.
    pub fn add_buffer(&mut self, bytes: &[u8], file_name: &str, target: &AddTarget) -> Result<ImportResult, String> {
        let target_dir = self.target_dir(target)?;
        fs::create_dir_all(&target_dir).map_err(|e| e.to_string())?;
        let dest = unique_path(&target_dir.join(file_name));
        fs::write(&dest, bytes).map_err(|e| e.to_string())?;
        let (source, rel) = self.locate(&dest).unwrap_or_default();
        self.scan()?;
        let meme = self.data.memes.iter_mut().find(|m| m.source == source && m.rel_path == rel);
        let added = meme.is_some();
        if let (Some(meme), Some(cid)) = (meme, &target.collection_id) {
            meme.collection_ids.push(cid.clone());
            self.dirty = true;
        }
        Ok(ImportResult { added: added as u32, already_in_library: 0, failed: (!added) as u32 })
    }

    fn target_dir(&self, target: &AddTarget) -> Result<PathBuf, String> {
        let base = self.base_dir(target.source.as_deref())?;
        match &target.folder {
            // Recusa `..` para nunca escrever fora da pasta de destino.
            Some(f) if f.split('/').any(|p| p == ".." || p.is_empty()) => Err("Pasta de destino inválida".into()),
            Some(f) => Ok(rel_to_path(&base, f)),
            None => Ok(base),
        }
    }

    fn found_path(&self, f: &Found) -> PathBuf {
        // A origem veio da própria lista de pastas adicionadas, então sempre existe.
        rel_to_path(&self.base_dir(f.source.as_deref()).unwrap_or_else(|_| self.dir.clone()), &f.rel)
    }

    /// Onde `path` está, se for algo que o app já lê: dentro da biblioteca, ou uma pasta
    /// adicionada (rel vazio) ou algo dentro dela.
    fn locate(&self, path: &Path) -> Option<Location> {
        if let Some(rel) = relative_to(&self.dir, path).filter(|r| !r.is_empty()) {
            return Some((None, rel));
        }
        self.data
            .linked_folders
            .iter()
            .find_map(|l| relative_to(Path::new(&l.path), path).map(|rel| (Some(l.id.clone()), rel)))
    }

    /// Registra uma pasta externa para ser indexada onde está. Recusa pastas que contêm a
    /// biblioteca ou outra pasta adicionada (os memes apareceriam duas vezes).
    fn link_folder(&mut self, dir: &Path) -> Result<String, String> {
        if relative_to(dir, &self.dir).is_some() {
            return Err("a pasta contém a biblioteca".into());
        }
        if self.data.linked_folders.iter().any(|l| relative_to(dir, Path::new(&l.path)).is_some()) {
            return Err("a pasta contém outra pasta já adicionada".into());
        }
        let id = uuid::Uuid::new_v4().to_string();
        self.data.linked_folders.push(LinkedFolder {
            id: id.clone(),
            path: dir.to_string_lossy().into_owned(),
            added_at: now_ms(),
        });
        self.dirty = true;
        Ok(id)
    }

    /// Nome e quantidade de memes de uma pasta adicionada (para a confirmação de remoção).
    pub fn linked_folder_summary(&self, id: &str) -> Result<(String, usize), String> {
        let linked = self
            .data
            .linked_folders
            .iter()
            .find(|l| l.id == id)
            .ok_or_else(|| format!("Pasta adicionada não encontrada: {id}"))?;
        let count = self.data.memes.iter().filter(|m| m.source.as_deref() == Some(id)).count();
        Ok((folder_display_name(&linked.path), count))
    }

    /// Tira uma pasta adicionada do app: some do índice com seus memes (tags e coleções
    /// deles se perdem). Nada é apagado do disco.
    pub fn unlink_folder(&mut self, id: &str) {
        self.data.linked_folders.retain(|l| l.id != id);
        self.data.memes.retain(|m| m.source.as_deref() != Some(id));
        self.linked_folders.remove(id);
        self.dirty = true;
    }

    pub fn update_meme(&mut self, id: &str, patch: MemePatch) -> Result<Meme, String> {
        let meme = self.get_meme_mut(id)?;
        if let Some(title) = patch.title {
            let title = title.trim();
            if !title.is_empty() {
                meme.title = title.to_string();
            }
        }
        if let Some(tags) = patch.tags {
            meme.tags = normalize_tags(tags);
        }
        if let Some(ids) = patch.collection_ids {
            meme.collection_ids = dedupe(ids);
        }
        if let Some(fav) = patch.favorite {
            meme.favorite = fav;
        }
        let updated = meme.clone();
        self.dirty = true;
        Ok(updated)
    }

    pub fn mark_used(&mut self, id: &str) -> Result<(), String> {
        let meme = self.get_meme_mut(id)?;
        meme.use_count += 1;
        meme.last_used_at = Some(now_ms());
        self.dirty = true;
        Ok(())
    }

    /// Remove do índice e devolve os caminhos para o chamador mandar à Lixeira.
    pub fn remove_memes(&mut self, ids: &[String]) -> Vec<PathBuf> {
        let (removed, kept): (Vec<Meme>, Vec<Meme>) =
            self.data.memes.drain(..).partition(|m| ids.contains(&m.id));
        self.data.memes = kept;
        self.dirty = true;
        removed.iter().filter_map(|m| self.file_path(m).ok()).collect()
    }

    pub fn create_collection(&mut self, name: &str) -> Collection {
        let name = name.trim();
        let collection = Collection {
            id: uuid::Uuid::new_v4().to_string(),
            name: if name.is_empty() { "Nova coleção".into() } else { name.into() },
            created_at: now_ms(),
        };
        self.data.collections.push(collection.clone());
        self.dirty = true;
        collection
    }

    pub fn rename_collection(&mut self, id: &str, name: &str) -> Result<Collection, String> {
        let c = self
            .data
            .collections
            .iter_mut()
            .find(|c| c.id == id)
            .ok_or_else(|| format!("Coleção não encontrada: {id}"))?;
        if !name.trim().is_empty() {
            c.name = name.trim().to_string();
        }
        let updated = c.clone();
        self.dirty = true;
        Ok(updated)
    }

    pub fn delete_collection(&mut self, id: &str) {
        self.data.collections.retain(|c| c.id != id);
        for m in &mut self.data.memes {
            m.collection_ids.retain(|c| c != id);
        }
        self.dirty = true;
    }

    /// Grava o índice de forma atômica (arquivo temporário + rename), só se houver mudança.
    pub fn flush(&mut self) -> Result<(), String> {
        if !self.dirty || !self.dir.is_dir() {
            return Ok(());
        }
        let index = self.dir.join(INDEX_FILE);
        let tmp = self.dir.join(format!("{INDEX_FILE}.tmp"));
        let json = serde_json::to_string_pretty(&self.data).map_err(|e| e.to_string())?;
        fs::write(&tmp, json).and_then(|_| fs::rename(&tmp, &index)).map_err(|e| e.to_string())?;
        self.dirty = false;
        Ok(())
    }
}

fn ensure_available(dir: &Path) -> Result<(), String> {
    if dir.is_dir() {
        Ok(())
    } else {
        Err(format!("Pasta da biblioteca não encontrada: {}", dir.display()))
    }
}

/// Ignora pastas/arquivos ocultos ou de sistema (`.algo`, `$RECYCLE.BIN`...).
fn is_ignored(name: &str) -> bool {
    name.starts_with('.') || name.starts_with('$')
}

fn ext_of(path: &Path) -> String {
    path.extension().map(|e| e.to_string_lossy().to_lowercase()).unwrap_or_default()
}

fn is_supported(path: &Path) -> bool {
    kind_for_ext(&ext_of(path)).is_some()
}

fn walk(dir: &Path, prefix: &str, source: Option<&str>, files: &mut Vec<Found>, folders: &mut Vec<String>) {
    let Ok(entries) = fs::read_dir(dir) else { return };
    for entry in entries.flatten() {
        let name = entry.file_name().to_string_lossy().into_owned();
        if is_ignored(&name) {
            continue;
        }
        let rel = if prefix.is_empty() { name.clone() } else { format!("{prefix}/{name}") };
        let Ok(ft) = entry.file_type() else { continue };
        // Links simbólicos ficam de fora para não entrar em loop.
        if ft.is_dir() {
            folders.push(rel.clone());
            walk(&entry.path(), &rel, source, files, folders);
        } else if ft.is_file() && is_supported(Path::new(&name)) {
            if let Ok(meta) = entry.metadata() {
                files.push(Found { source: source.map(str::to_string), rel, size: meta.len(), mtime: mtime_ms(&meta) });
            }
        }
    }
}

/// Caminho relativo (com `/`) de `path` dentro de `base`; vazio se forem a mesma pasta.
/// Compara sem diferenciar maiúsculas, como o sistema de arquivos do Windows.
fn relative_to(base: &Path, path: &Path) -> Option<String> {
    let norm = |p: &Path| -> Vec<String> {
        p.components()
            .filter(|c| !matches!(c, Component::CurDir))
            .map(|c| c.as_os_str().to_string_lossy().into_owned())
            .collect()
    };
    let base = norm(base);
    let full = norm(path);
    if full.len() < base.len() {
        return None;
    }
    let same = base.iter().zip(&full).all(|(a, b)| a.to_lowercase() == b.to_lowercase());
    same.then(|| full[base.len()..].join("/"))
}

/// Nome exibido de uma pasta adicionada (último componente; o caminho todo se for uma unidade).
fn folder_display_name(path: &str) -> String {
    Path::new(path).file_name().map_or_else(|| path.to_string(), |n| n.to_string_lossy().into_owned())
}

/// Hash rápido: tamanho + primeiros e últimos 64 KB (mesmo algoritmo da versão Electron).
fn quick_hash(path: &Path, size: u64) -> std::io::Result<String> {
    let mut hasher = Sha1::new();
    hasher.update(size.to_string().as_bytes());
    let mut file = fs::File::open(path)?;
    let mut head = vec![0u8; HASH_CHUNK.min(size) as usize];
    file.read_exact(&mut head)?;
    hasher.update(&head);
    if size > HASH_CHUNK * 2 {
        let mut tail = vec![0u8; HASH_CHUNK as usize];
        file.seek(SeekFrom::Start(size - HASH_CHUNK))?;
        file.read_exact(&mut tail)?;
        hasher.update(&tail);
    }
    Ok(hasher.finalize().iter().map(|b| format!("{b:02x}")).collect())
}

fn new_meme(f: Found, hash: String) -> Meme {
    let ext = ext_of(Path::new(&f.rel));
    Meme {
        id: uuid::Uuid::new_v4().to_string(),
        title: title_from(&f.rel),
        kind: kind_for_ext(&ext).unwrap_or("image").to_string(),
        ext,
        rel_path: f.rel,
        size: f.size,
        mtime: f.mtime,
        hash,
        tags: vec![],
        collection_ids: vec![],
        favorite: false,
        added_at: now_ms(),
        last_used_at: None,
        use_count: 0,
        source: f.source,
    }
}

pub fn rel_to_path(dir: &Path, rel: &str) -> PathBuf {
    let mut p = dir.to_path_buf();
    p.extend(rel.split('/'));
    p
}

fn title_from(rel: &str) -> String {
    Path::new(rel).file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default()
}

/// `meme.png` → `meme (2).png` se já existir.
fn unique_path(path: &Path) -> PathBuf {
    if !path.exists() {
        return path.to_path_buf();
    }
    let stem = path.file_stem().map(|s| s.to_string_lossy().into_owned()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    let parent = path.parent().unwrap_or(Path::new(""));
    (2..)
        .map(|i| parent.join(format!("{stem} ({i}){ext}")))
        .find(|p| !p.exists())
        .expect("sempre existe um nome livre")
}

fn normalize_tags(tags: Vec<String>) -> Vec<String> {
    dedupe(
        tags.into_iter()
            .map(|t| t.trim().trim_start_matches('#').to_lowercase())
            .filter(|t| !t.is_empty())
            .collect(),
    )
}

fn dedupe(items: Vec<String>) -> Vec<String> {
    let mut seen = HashSet::new();
    items.into_iter().filter(|i| seen.insert(i.clone())).collect()
}

fn mtime_ms(meta: &fs::Metadata) -> u64 {
    meta.modified().ok().and_then(|t| t.duration_since(UNIX_EPOCH).ok()).map_or(0, |d| d.as_millis() as u64)
}

/// JSON salvo pelo Bloco de Notas ou pelo PowerShell 5.1 começa com BOM, que o serde recusa.
pub fn strip_bom(s: &str) -> &str {
    s.strip_prefix('\u{feff}').unwrap_or(s)
}

pub fn now_ms() -> u64 {
    SystemTime::now().duration_since(UNIX_EPOCH).map_or(0, |d| d.as_millis() as u64)
}

#[cfg(test)]
mod tests {
    use super::*;

    fn write(dir: &Path, rel: &str, content: &[u8]) {
        let p = rel_to_path(dir, rel);
        fs::create_dir_all(p.parent().unwrap()).unwrap();
        fs::write(p, content).unwrap();
    }

    fn rels(lib: &Library) -> Vec<String> {
        let mut v: Vec<String> = lib.snapshot().memes.into_iter().map(|m| m.rel_path).collect();
        v.sort();
        v
    }

    #[test]
    fn varre_subpastas_e_ignora_nao_memes() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "a.png", b"a");
        write(tmp.path(), "reações/b.gif", b"b");
        write(tmp.path(), "reações/antigos/c.mp4", b"c");
        write(tmp.path(), "notas.txt", b"x");
        write(tmp.path(), ".oculta/d.png", b"d");
        let lib = Library::open(tmp.path().to_path_buf()).unwrap();
        assert_eq!(rels(&lib), ["a.png", "reações/antigos/c.mp4", "reações/b.gif"]);
        assert_eq!(lib.snapshot().folders, ["reações", "reações/antigos"]);
    }

    #[test]
    fn arquivo_movido_mantem_tags_e_favorito() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "reações/stonks.png", b"conteudo do stonks");
        let mut lib = Library::open(tmp.path().to_path_buf()).unwrap();
        let id = lib.snapshot().memes[0].id.clone();
        let patch = MemePatch { tags: Some(vec!["#Dinheiro".into()]), favorite: Some(true), ..Default::default() };
        lib.update_meme(&id, patch).unwrap();

        fs::create_dir_all(tmp.path().join("trabalho")).unwrap();
        fs::rename(tmp.path().join("reações/stonks.png"), tmp.path().join("trabalho/stonks.png")).unwrap();
        assert!(lib.scan().unwrap());

        let meme = lib.get_meme(&id).unwrap();
        assert_eq!(meme.rel_path, "trabalho/stonks.png");
        assert_eq!(meme.tags, ["dinheiro"]);
        assert!(meme.favorite);
    }

    #[test]
    fn arquivo_novo_e_apagado_por_fora() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "a.png", b"a");
        let mut lib = Library::open(tmp.path().to_path_buf()).unwrap();
        write(tmp.path(), "novo.webp", b"n");
        fs::remove_file(tmp.path().join("a.png")).unwrap();
        assert!(lib.scan().unwrap());
        assert_eq!(rels(&lib), ["novo.webp"]);
        assert!(!lib.scan().unwrap(), "segunda varredura sem mudanças");
    }

    #[test]
    fn pasta_indisponivel_nao_apaga_o_indice() {
        let tmp = tempfile::tempdir().unwrap();
        let dir = tmp.path().join("memes");
        write(&dir, "a.png", b"a");
        let mut lib = Library::open(dir.clone()).unwrap();
        let id = lib.snapshot().memes[0].id.clone();
        lib.update_meme(&id, MemePatch { tags: Some(vec!["x".into()]), ..Default::default() }).unwrap();
        lib.flush().unwrap();

        fs::rename(&dir, tmp.path().join("desconectada")).unwrap();
        assert!(lib.scan().is_err());
        assert_eq!(lib.snapshot().memes.len(), 1, "índice em memória preservado");

        fs::rename(tmp.path().join("desconectada"), &dir).unwrap();
        let reopened = Library::open(dir).unwrap();
        assert_eq!(reopened.get_meme(&id).unwrap().tags, ["x"]);
    }

    #[test]
    fn adicionar_copia_arquivos_e_indexa_pastas_onde_estao() {
        let tmp = tempfile::tempdir().unwrap();
        let lib_dir = tmp.path().join("lib");
        let fora = tmp.path().join("fora");
        write(&lib_dir, "gato.png", b"gato original");
        write(&fora, "gato.png", b"outro gato");
        write(&fora, "pasta/x.gif", b"x");
        write(&fora, "pasta/sub/y.mp4", b"y");
        let mut lib = Library::open(lib_dir.clone()).unwrap();
        let c = lib.create_collection("Reações");
        let target = AddTarget { collection_id: Some(c.id.clone()), ..Default::default() };

        let paths = vec![
            fora.join("gato.png").to_string_lossy().into_owned(),
            fora.join("pasta").to_string_lossy().into_owned(),
            lib_dir.join("gato.png").to_string_lossy().into_owned(),
        ];
        let r = lib.add_paths(&paths, &target).unwrap();
        assert_eq!((r.added, r.already_in_library, r.failed), (3, 1, 0));
        assert_eq!(rels(&lib), ["gato (2).png", "gato.png", "sub/y.mp4", "x.gif"]);
        assert!(!lib_dir.join("pasta").exists(), "pasta não é copiada");
        assert!(lib.snapshot().memes.iter().all(|m| m.collection_ids == [c.id.clone()]));
        assert!(fora.join("gato.png").exists(), "original não é movido");

        let snap = lib.snapshot();
        let linked = &snap.linked_folders[0];
        assert_eq!((linked.name.as_str(), linked.folders.clone(), linked.available), ("pasta", vec!["sub".to_string()], true));
        let x = snap.memes.iter().find(|m| m.rel_path == "x.gif").unwrap();
        assert_eq!(lib.file_path(x).unwrap(), fora.join("pasta").join("x.gif"));

        // Soltar de novo a mesma pasta (ou algo dentro dela) não duplica nada.
        let again = vec![fora.join("pasta").to_string_lossy().into_owned(), fora.join("pasta/x.gif").to_string_lossy().into_owned()];
        let r = lib.add_paths(&again, &AddTarget::default()).unwrap();
        assert_eq!((r.added, r.already_in_library), (0, 2));
        assert_eq!(lib.snapshot().linked_folders.len(), 1);

        // Pasta que contém a biblioteca ou uma pasta já adicionada é recusada.
        let r = lib.add_paths(&[tmp.path().to_string_lossy().into_owned()], &AddTarget::default()).unwrap();
        assert_eq!(r.failed, 1);
    }

    #[test]
    fn remover_pasta_adicionada_nao_apaga_do_disco() {
        let tmp = tempfile::tempdir().unwrap();
        let lib_dir = tmp.path().join("lib");
        let fora = tmp.path().join("fora");
        write(&lib_dir, "a.png", b"a");
        write(&fora, "b.gif", b"b");
        let mut lib = Library::open(lib_dir.clone()).unwrap();
        lib.add_paths(&[fora.to_string_lossy().into_owned()], &AddTarget::default()).unwrap();
        let id = lib.snapshot().linked_folders[0].id.clone();
        assert_eq!(lib.linked_folder_summary(&id).unwrap(), ("fora".to_string(), 1));

        // A referência fica gravada no índice e vale ao reabrir.
        lib.flush().unwrap();
        let mut lib = Library::open(lib_dir.clone()).unwrap();
        assert_eq!(rels(&lib), ["a.png", "b.gif"]);

        lib.unlink_folder(&id);
        assert_eq!(rels(&lib), ["a.png"]);
        assert!(lib.snapshot().linked_folders.is_empty());
        assert!(fora.join("b.gif").exists(), "arquivo continua no disco");
        assert!(!lib.scan().unwrap(), "varredura não traz a pasta de volta");
    }

    #[test]
    fn pasta_adicionada_indisponivel_mantem_tags() {
        let tmp = tempfile::tempdir().unwrap();
        let lib_dir = tmp.path().join("lib");
        let fora = tmp.path().join("fora");
        fs::create_dir_all(&lib_dir).unwrap();
        write(&fora, "b.gif", b"b");
        let mut lib = Library::open(lib_dir).unwrap();
        lib.add_paths(&[fora.to_string_lossy().into_owned()], &AddTarget::default()).unwrap();
        let id = lib.snapshot().memes[0].id.clone();
        lib.update_meme(&id, MemePatch { tags: Some(vec!["x".into()]), ..Default::default() }).unwrap();

        fs::rename(&fora, tmp.path().join("desconectada")).unwrap();
        lib.scan().unwrap();
        let snap = lib.snapshot();
        assert!(snap.memes.is_empty(), "memes da pasta indisponível não aparecem");
        assert!(!snap.linked_folders[0].available);

        fs::rename(tmp.path().join("desconectada"), &fora).unwrap();
        lib.scan().unwrap();
        assert_eq!(lib.get_meme(&id).unwrap().tags, ["x"]);
    }

    #[test]
    fn destino_com_ponto_ponto_e_recusado() {
        let tmp = tempfile::tempdir().unwrap();
        let mut lib = Library::open(tmp.path().to_path_buf()).unwrap();
        let target = AddTarget { folder: Some("../fora".into()), ..Default::default() };
        assert!(lib.add_buffer(b"x", "a.png", &target).is_err());
    }

    #[test]
    fn le_indice_gerado_pela_versao_electron() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "a.png", b"a");
        let size = 1u64;
        let mtime = mtime_ms(&fs::metadata(tmp.path().join("a.png")).unwrap());
        let json = format!(
            r#"{{"version":2,"memes":[{{"id":"abc","relPath":"a.png","title":"Meu título","ext":"png","kind":"image","size":{size},"mtime":{mtime},"hash":"h","tags":["br"],"collectionIds":["c1"],"favorite":true,"addedAt":1,"lastUsedAt":null,"useCount":4}}],"collections":[{{"id":"c1","name":"Reações","createdAt":2}}]}}"#
        );
        fs::write(tmp.path().join(INDEX_FILE), json).unwrap();
        let lib = Library::open(tmp.path().to_path_buf()).unwrap();
        let m = lib.get_meme("abc").unwrap();
        assert_eq!((m.title.as_str(), m.use_count, m.favorite), ("Meu título", 4, true));
        assert_eq!(lib.snapshot().collections[0].name, "Reações");
    }

    #[test]
    fn indice_com_bom_e_aceito() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "a.png", b"a");
        fs::write(tmp.path().join(INDEX_FILE), "\u{feff}{\"version\":2,\"memes\":[],\"collections\":[{\"id\":\"c\",\"name\":\"X\",\"createdAt\":1}]}").unwrap();
        let lib = Library::open(tmp.path().to_path_buf()).unwrap();
        assert_eq!(lib.snapshot().collections.len(), 1);
    }

    #[test]
    fn indice_corrompido_gera_backup() {
        let tmp = tempfile::tempdir().unwrap();
        write(tmp.path(), "a.png", b"a");
        fs::write(tmp.path().join(INDEX_FILE), "{ quebrado").unwrap();
        let lib = Library::open(tmp.path().to_path_buf()).unwrap();
        assert_eq!(lib.snapshot().memes.len(), 1);
        let backups = fs::read_dir(tmp.path())
            .unwrap()
            .flatten()
            .filter(|e| e.file_name().to_string_lossy().starts_with(".memenagaveta.corrupt-"))
            .count();
        assert_eq!(backups, 1);
    }
}

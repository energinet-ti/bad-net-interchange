use std::collections::HashSet;
use std::fs;
use std::io::Read;
use std::path::PathBuf;
use thiserror::Error;

#[derive(Error, Debug)]
pub enum FileLoadError {
    #[error("IO error reading {path}: {source}")]
    Io {
        path: String,
        source: std::io::Error,
    },
    #[error("ZIP error for {path}: {source}")]
    Zip {
        path: String,
        source: zip::result::ZipError,
    },
    #[error("No XML file found in ZIP archive: {0}")]
    NoXmlInZip(String),
}

/// Normalize a path for Windows, converting forward slashes to backslashes.
pub fn normalize_path(raw_path: &str) -> PathBuf {
    let cleaned = raw_path.replace('/', "\\");
    PathBuf::from(cleaned)
}

/// Read a file, extracting from ZIP if needed.
/// Returns the XML content as a String.
pub fn read_file_content(raw_path: &str) -> Result<String, FileLoadError> {
    let path = normalize_path(raw_path);
    let display_path = path.to_string_lossy().to_string();

    let bytes = fs::read(&path).map_err(|e| FileLoadError::Io {
        path: display_path.clone(),
        source: e,
    })?;

    // Try as ZIP first
    if let Ok(content) = extract_xml_from_zip(&bytes, &display_path) {
        return Ok(content);
    }

    // Otherwise treat as plain XML
    String::from_utf8(bytes).map_err(|e| FileLoadError::Io {
        path: display_path,
        source: std::io::Error::new(std::io::ErrorKind::InvalidData, e),
    })
}

fn extract_xml_from_zip(bytes: &[u8], source_path: &str) -> Result<String, FileLoadError> {
    let cursor = std::io::Cursor::new(bytes);
    let mut archive = zip::ZipArchive::new(cursor).map_err(|e| FileLoadError::Zip {
        path: source_path.to_string(),
        source: e,
    })?;

    for i in 0..archive.len() {
        let mut file = archive.by_index(i).map_err(|e| FileLoadError::Zip {
            path: source_path.to_string(),
            source: e,
        })?;

        let name = file.name().to_lowercase();
        if name.ends_with(".xml") || name.ends_with(".rdf") {
            let mut content = String::new();
            file.read_to_string(&mut content)
                .map_err(|e| FileLoadError::Io {
                    path: source_path.to_string(),
                    source: e,
                })?;
            return Ok(content);
        }
    }

    Err(FileLoadError::NoXmlInZip(source_path.to_string()))
}

/// Tracks which files have already been loaded to avoid duplicates.
/// Important for EQ files which are referenced by multiple SSH entries.
#[derive(Default)]
pub struct FileDeduplicator {
    loaded: HashSet<String>,
}

impl FileDeduplicator {
    pub fn should_load(&mut self, path: &str) -> bool {
        let normalized = normalize_path(path).to_string_lossy().to_string();
        self.loaded.insert(normalized)
    }

    pub fn loaded_count(&self) -> usize {
        self.loaded.len()
    }
}

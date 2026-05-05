use reqwest::Client;
use serde::Deserialize;

use crate::retry::with_retry;

const MAX_RETRIES: u32 = 3;

#[derive(Debug, Deserialize, Clone)]
pub struct CgmaDocument {
    pub doc_mrid: String,
    pub filename: String,
    pub filepath: String,
}

pub struct CgmaClient {
    client: Client,
    host: String,
    api_key: String,
}

impl CgmaClient {
    pub fn new(host: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            host,
            api_key,
        }
    }

    /// Fetch CGMA document filepaths for a given date
    pub async fn get_filepaths(
        &self,
        date: &str, // "2026-03-08"
    ) -> Result<Vec<CgmaDocument>, reqwest::Error> {
        with_retry(MAX_RETRIES, || async {
            self.client
                .get(format!("{}/api/documents/filepath", self.host))
                .query(&[("date", date)])
                .header("X-API-KEY", &self.api_key)
                .header("Accept", "application/json")
                .send()
                .await?
                .error_for_status()?
                .json()
                .await
        })
        .await
    }
}

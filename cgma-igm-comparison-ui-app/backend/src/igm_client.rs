use reqwest::Client;
use serde::Deserialize;

use crate::retry::with_retry;

const MAX_RETRIES: u32 = 3;

#[derive(Debug, Deserialize, Clone)]
pub struct ScenarioEntry {
    #[serde(rename = "scenarioTime")]
    pub scenario_time: String,
    pub scenario: String,
    #[serde(rename = "sshVersion")]
    pub ssh_version: String,
    #[serde(rename = "sshId")]
    pub ssh_id: String,
    #[serde(rename = "sshLocation")]
    pub ssh_location: String,
    #[serde(rename = "eqId")]
    pub eq_id: String,
    #[serde(rename = "eqLocation")]
    pub eq_location: String,
}

pub struct IgmClient {
    client: Client,
    host: String,
    api_key: String,
}

impl IgmClient {
    pub fn new(host: String, api_key: String) -> Self {
        Self {
            client: Client::new(),
            host,
            api_key,
        }
    }

    /// Fetch available scenario types (e.g., "2D", "ID", "1D")
    pub async fn get_scenarios(&self) -> Result<Vec<String>, reqwest::Error> {
        with_retry(MAX_RETRIES, || async {
            self.client
                .get(format!("{}/scenario/scenario", self.host))
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

    /// Fetch file locations for a specific date and scenario
    pub async fn get_control_area_day(
        &self,
        date: &str,
        scenario: &str,
    ) -> Result<Vec<ScenarioEntry>, reqwest::Error> {
        with_retry(MAX_RETRIES, || async {
            self.client
                .get(format!(
                    "{}/scenario/controlarea/day/{}/{}",
                    self.host, date, scenario
                ))
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

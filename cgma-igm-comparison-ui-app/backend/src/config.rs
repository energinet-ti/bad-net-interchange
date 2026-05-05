use std::env;

#[derive(Clone, Debug)]
pub struct Config {
    pub igm_api_host: String,
    pub igm_api_key: String,
    pub cgma_api_host: String,
    pub cgma_api_key: String,
    pub port: u16,
}

impl Config {
    pub fn from_env() -> Self {
        Self {
            igm_api_host: env::var("IGM_API_HOST")
                .unwrap_or_else(|_| "http://localhost:5212".into()),
            igm_api_key: env::var("IGM_API_KEY").expect("IGM_API_KEY must be set"),
            cgma_api_host: env::var("CGMA_API_HOST")
                .unwrap_or_else(|_| "https://cgma-cloud-api.azurewebsites.net".into()),
            cgma_api_key: env::var("CGMA_API_KEY").expect("CGMA_API_KEY must be set"),
            port: env::var("PORT")
                .unwrap_or_else(|_| "3001".into())
                .parse()
                .expect("PORT must be a number"),
        }
    }
}

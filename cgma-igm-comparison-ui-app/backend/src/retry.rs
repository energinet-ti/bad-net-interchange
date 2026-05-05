use std::future::Future;
use std::time::Duration;

/// Retry a future up to `max_retries` times with exponential backoff.
pub async fn with_retry<F, Fut, T, E>(max_retries: u32, mut f: F) -> Result<T, E>
where
    F: FnMut() -> Fut,
    Fut: Future<Output = Result<T, E>>,
    E: std::fmt::Display,
{
    let mut attempt = 0;
    loop {
        match f().await {
            Ok(val) => return Ok(val),
            Err(e) if attempt < max_retries => {
                attempt += 1;
                let delay = Duration::from_millis(500 * 2u64.pow(attempt - 1));
                tracing::warn!("Retry {attempt}/{max_retries} after error: {e}");
                tokio::time::sleep(delay).await;
            }
            Err(e) => return Err(e),
        }
    }
}

import time
import logging
import requests
from app.config import config

logger = logging.getLogger(__name__)
MAX_RETRIES = 3


def _with_retry(fn):
    """Retry with exponential backoff."""
    for attempt in range(MAX_RETRIES + 1):
        try:
            return fn()
        except requests.RequestException as e:
            if attempt == MAX_RETRIES:
                raise
            delay = 0.5 * (2 ** attempt)
            logger.warning(f"Retry {attempt + 1}/{MAX_RETRIES} after error: {e}")
            time.sleep(delay)


def get_filepaths(date: str) -> list[dict]:
    """Fetch CGMA document filepaths for a given date."""
    def _call():
        resp = requests.get(
            f"{config.cgma_api_host}/api/documents/filepath",
            params={"date": date},
            headers={"X-API-KEY": config.cgma_api_key, "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    return _with_retry(_call)

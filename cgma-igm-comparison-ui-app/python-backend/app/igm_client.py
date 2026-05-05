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


def get_scenarios() -> list[str]:
    """Fetch available scenario types (e.g., '2D', 'ID', '1D')."""
    def _call():
        resp = requests.get(
            f"{config.igm_api_host}/scenario/scenario",
            headers={"X-API-KEY": config.igm_api_key, "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    return _with_retry(_call)


def get_control_area_day(date: str, scenario: str) -> list[dict]:
    """Fetch file locations for a specific date and scenario."""
    def _call():
        resp = requests.get(
            f"{config.igm_api_host}/scenario/controlarea/day/{date}/{scenario}",
            headers={"X-API-KEY": config.igm_api_key, "Accept": "application/json"},
        )
        resp.raise_for_status()
        return resp.json()
    return _with_retry(_call)

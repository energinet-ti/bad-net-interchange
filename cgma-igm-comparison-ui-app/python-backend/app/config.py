import os
from dotenv import load_dotenv

load_dotenv()


class Config:
    igm_api_host: str = os.getenv("IGM_API_HOST", "http://localhost:5212")
    igm_api_key: str = os.getenv("IGM_API_KEY", "")
    cgma_api_host: str = os.getenv("CGMA_API_HOST", "https://cgma-cloud-api.azurewebsites.net")
    cgma_api_key: str = os.getenv("CGMA_API_KEY", "")
    port: int = int(os.getenv("PORT", "3001"))


config = Config()

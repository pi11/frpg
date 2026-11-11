"""Application settings shared by the API and migration environment."""

from functools import lru_cache
from pathlib import Path

from pydantic_settings import BaseSettings, SettingsConfigDict

ENV_FILE = Path(__file__).resolve().parents[2] / ".env"


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=ENV_FILE, extra="ignore")

    database_url: str = "postgresql+asyncpg:///wasteland"
    public_url: str = "http://localhost:5173"
    cors_origins: list[str] = ["http://localhost:5173"]
    mail_backend: str = "console"
    mail_from: str = ""
    resend_api_key: str = ""
    jwt_secret: str = ""
    telegram_bot_token: str = ""
    telegram_bot_username: str = ""
    telegram_webhook_secret: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()

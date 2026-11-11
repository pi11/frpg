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


@lru_cache
def get_settings() -> Settings:
    return Settings()

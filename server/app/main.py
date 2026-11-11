"""FastAPI entry point."""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.api.auth import account_router
from app.api.auth import router as auth_router
from app.api.content import router as content_router
from app.api.errors import ApiError, api_error_handler
from app.api.health import router as health_router
from app.api.profile import router as profile_router
from app.api.runs import router as runs_router
from app.api.telegram import router as telegram_router
from app.config import get_settings

app = FastAPI(title="Пустошь API", version="0.0.0")
app.add_exception_handler(ApiError, api_error_handler)
app.add_middleware(
    CORSMiddleware,
    allow_origins=get_settings().cors_origins,
    allow_credentials=False,
    allow_methods=["GET", "POST", "DELETE"],
    allow_headers=[
        "Authorization", "Content-Type", "X-Poll-Secret",
        "X-Telegram-Bot-Api-Secret-Token",
    ],
)
app.include_router(health_router, prefix="/api/v1")
app.include_router(auth_router, prefix="/api/v1")
app.include_router(account_router, prefix="/api/v1")
app.include_router(telegram_router, prefix="/api/v1")
app.include_router(content_router, prefix="/api/v1")
app.include_router(profile_router, prefix="/api/v1")
app.include_router(runs_router, prefix="/api/v1")

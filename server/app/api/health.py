"""Liveness and database readiness."""

from typing import Annotated

from fastapi import APIRouter, Depends
from fastapi.responses import JSONResponse
from pydantic import BaseModel
from sqlalchemy import text
from sqlalchemy.exc import SQLAlchemyError
from sqlalchemy.ext.asyncio import AsyncSession

from app.db import get_session

router = APIRouter()


class HealthResponse(BaseModel):
    status: str
    database: str


class ErrorResponse(BaseModel):
    code: str
    message: str


@router.get(
    "/health",
    response_model=HealthResponse,
    responses={503: {"model": ErrorResponse}},
)
async def health(
    session: Annotated[AsyncSession, Depends(get_session)],
) -> HealthResponse | JSONResponse:
    try:
        await session.execute(text("SELECT 1"))
    except SQLAlchemyError:
        return JSONResponse(
            status_code=503,
            content={"code": "database_unavailable", "message": "База данных недоступна"},
        )
    return HealthResponse(status="ok", database="ok")

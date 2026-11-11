"""The public API uses one error shape."""

from enum import StrEnum

from fastapi import Request
from fastapi.responses import JSONResponse
from pydantic import BaseModel


class ErrorCode(StrEnum):
    invalid_token = "invalid_token"
    invalid_code = "invalid_code"
    expired = "expired"
    not_found = "not_found"
    rate_limited = "rate_limited"
    conflict = "conflict"
    not_configured = "not_configured"
    database_unavailable = "database_unavailable"


class ErrorResponse(BaseModel):
    code: ErrorCode
    message: str


class ApiError(Exception):
    def __init__(self, status_code: int, code: ErrorCode, message: str) -> None:
        self.status_code = status_code
        self.code = code
        self.message = message


async def api_error_handler(_request: Request, error: Exception) -> JSONResponse:
    if not isinstance(error, ApiError):
        raise error
    return JSONResponse(
        status_code=error.status_code,
        content={"code": error.code.value, "message": error.message},
    )

"""Public content bundle with a stable ETag."""

from typing import Annotated

from fastapi import APIRouter, Header
from fastapi.responses import JSONResponse, Response

from app.services.content import get_content

router = APIRouter(tags=["content"])


@router.get("/content")
async def content_bundle(
    if_none_match: Annotated[str | None, Header()] = None,
) -> Response:
    content = get_content()
    etag = f'"{content.hash}"'
    if if_none_match == etag:
        return Response(status_code=304, headers={"ETag": etag})
    return JSONResponse(
        content={"hash": content.hash, "files": content.files},
        headers={"ETag": etag},
    )

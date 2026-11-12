"""Digital Asset Links: lets the Android app open magic links (Android App Links)."""

from typing import Annotated, Any

from fastapi import APIRouter, Depends

from app.api.errors import ApiError, ErrorCode
from app.config import Settings, get_settings

router = APIRouter()


@router.get("/.well-known/assetlinks.json")
async def asset_links(settings: Annotated[Settings, Depends(get_settings)]) -> list[dict[str, Any]]:
    if not settings.android_package or not settings.android_cert_fingerprints:
        raise ApiError(404, ErrorCode.not_configured, "Android-приложение не настроено")
    return [{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": settings.android_package,
            "sha256_cert_fingerprints": [
                fingerprint.upper() for fingerprint in settings.android_cert_fingerprints
            ],
        },
    }]

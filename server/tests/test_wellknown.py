import asyncio
from collections.abc import Iterator

import httpx
import pytest
from app.config import Settings, get_settings
from app.main import app

FINGERPRINT = ":".join(["ab"] * 32)


async def get_links() -> httpx.Response:
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://testserver") as client:
        return await client.get("/.well-known/assetlinks.json")


@pytest.fixture(autouse=True)
def clear_overrides() -> Iterator[None]:
    yield
    app.dependency_overrides.clear()


def test_asset_links_list_the_release_certificate() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        android_package="com.example.wasteland", android_cert_fingerprints=[FINGERPRINT],
    )
    response = asyncio.run(get_links())
    assert response.status_code == 200
    assert response.json() == [{
        "relation": ["delegate_permission/common.handle_all_urls"],
        "target": {
            "namespace": "android_app",
            "package_name": "com.example.wasteland",
            "sha256_cert_fingerprints": [FINGERPRINT.upper()],
        },
    }]


def test_asset_links_are_404_until_configured() -> None:
    app.dependency_overrides[get_settings] = lambda: Settings(
        android_package="", android_cert_fingerprints=[],
    )
    response = asyncio.run(get_links())
    assert response.status_code == 404
    assert response.json()["code"] == "not_configured"

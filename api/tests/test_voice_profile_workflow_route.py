"""Workflow save rejects a voice profile the organization does not own."""

from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.workflow import router
from api.services.auth.depends import get_user


def _client() -> TestClient:
    app = FastAPI()
    app.include_router(router)
    app.dependency_overrides[get_user] = lambda: SimpleNamespace(
        id=1,
        provider_id="provider-1",
        selected_organization_id=11,
    )
    return TestClient(app)


def test_saving_a_foreign_voice_profile_id_is_404():
    with (
        patch("api.routes.workflow.db_client") as mock_db,
        patch(
            "api.routes.workflow.apply_external_pbx_mapping_policy",
            new=AsyncMock(side_effect=lambda configurations, **_: configurations),
        ),
    ):
        mock_db.get_voice_profile = AsyncMock(return_value=None)
        response = _client().put(
            "/workflow/33",
            json={"workflow_configurations": {"voice_profile_id": 999}},
        )

    assert response.status_code == 404
    assert "Voice profile with id 999 not found" in response.json()["detail"]
    mock_db.get_voice_profile.assert_awaited_once_with(999, organization_id=11)
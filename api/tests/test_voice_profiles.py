"""Voice profile routes, TTS payload validation, and run-time resolution order."""

from datetime import UTC, datetime
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

from fastapi import FastAPI
from fastapi.testclient import TestClient

from api.routes.organization import router as organization_router
from api.schemas.ai_model_configuration import EffectiveAIModelConfiguration
from api.schemas.voice_profile import VoiceProfileCreate, parse_voice_profile_tts
from api.services.auth.depends import get_user_with_selected_organization
from api.services.configuration.registry import (
    SARVAM_V3_VOICES,
    ServiceProviders,
)

SARVAM_TTS = {
    "provider": "sarvam",
    "api_key": "sk-real-key-1234567890",
    "model": "bulbul:v3",
    "voice": "anushka",
    "language": "hi-IN",
    "speed": 1.0,
}


class FakeVoiceProfileDB:
    """Org-scoped stand-in for VoiceProfileClient.

    Mirrors the client contract: every read filters on organization_id, so a
    route that forgets the scope can never see another organization's rows.
    """

    def __init__(self):
        self.rows = {}
        self._next_id = 1

    async def list_voice_profiles(self, organization_id):
        return [
            row
            for row in self.rows.values()
            if row.organization_id == organization_id
        ]

    async def get_voice_profile(self, profile_id, organization_id):
        row = self.rows.get(profile_id)
        if row is None or row.organization_id != organization_id:
            return None
        return row

    async def get_default_voice_profile(self, organization_id):
        for row in self.rows.values():
            if row.organization_id == organization_id and row.is_default:
                return row
        return None

    async def create_voice_profile(self, organization_id, name, tts, is_default=False):
        row = SimpleNamespace(
            id=self._next_id,
            organization_id=organization_id,
            name=name,
            tts=tts,
            is_default=is_default,
            created_at=datetime.now(UTC),
            updated_at=datetime.now(UTC),
        )
        self._next_id += 1
        self.rows[row.id] = row
        return row

    async def update_voice_profile(
        self, profile_id, organization_id, name=None, tts=None, is_default=None
    ):
        row = await self.get_voice_profile(profile_id, organization_id)
        if row is None:
            return None
        if name is not None:
            row.name = name
        if tts is not None:
            row.tts = tts
        if is_default is True:
            row.is_default = True
        elif is_default is False:
            row.is_default = False
        return row

    async def delete_voice_profile(self, profile_id, organization_id):
        row = await self.get_voice_profile(profile_id, organization_id)
        if row is None:
            return False
        self.rows.pop(profile_id)
        return True


def _make_app(organization_id: int = 11) -> FastAPI:
    app = FastAPI()
    app.include_router(organization_router)
    app.dependency_overrides[get_user_with_selected_organization] = (
        lambda: SimpleNamespace(
            id=1,
            provider_id="provider-1",
            selected_organization_id=organization_id,
        )
    )
    return app


def _create_profile(client: TestClient, name="Hindi line", is_default=False):
    response = client.post(
        "/organizations/voice-profiles",
        json={
            "name": name,
            "tts": SARVAM_TTS,
            "is_default": is_default,
        },
    )
    assert response.status_code == 200, response.text
    return response.json()


def test_create_voice_profile_masks_api_key_but_stores_the_real_one():
    db = FakeVoiceProfileDB()
    with patch("api.routes.organization.db_client", db):
        payload = _create_profile(TestClient(_make_app()), is_default=True)

    assert payload["name"] == "Hindi line"
    assert payload["is_default"] is True
    masked_key = payload["tts"]["api_key"]
    assert masked_key != SARVAM_TTS["api_key"]
    assert masked_key.endswith("7890")
    assert "***" in masked_key
    stored = list(db.rows.values())[0]
    assert stored.tts["api_key"] == SARVAM_TTS["api_key"]


def test_create_rejects_unknown_tts_provider():
    db = FakeVoiceProfileDB()
    with patch("api.routes.organization.db_client", db):
        response = TestClient(_make_app()).post(
            "/organizations/voice-profiles",
            json={
                "name": "Broken",
                "tts": {"provider": "not_a_provider", "api_key": "x"},
            },
        )
    assert response.status_code == 422
    assert "provider" in response.text
    assert db.rows == {}


def test_create_rejects_a_masked_api_key():
    db = FakeVoiceProfileDB()
    with patch("api.routes.organization.db_client", db):
        response = TestClient(_make_app()).post(
            "/organizations/voice-profiles",
            json={
                "name": "Masked",
                "tts": {**SARVAM_TTS, "api_key": "***********7890"},
            },
        )
    assert response.status_code == 422
    assert "masked" in response.text
    assert db.rows == {}


def test_update_resolves_a_masked_api_key_against_the_stored_one():
    from api.services.configuration.masking import mask_key

    db = FakeVoiceProfileDB()
    with patch("api.routes.organization.db_client", db):
        client = TestClient(_make_app())
        profile = _create_profile(client)
        response = client.put(
            f"/organizations/voice-profiles/{profile['id']}",
            json={
                "tts": {
                    **SARVAM_TTS,
                    "api_key": mask_key(SARVAM_TTS["api_key"]),
                    "voice": "karun",
                }
            },
        )
        assert response.status_code == 200, response.text
        assert response.json()["tts"]["voice"] == "karun"
        assert db.rows[profile["id"]].tts["api_key"] == SARVAM_TTS["api_key"]

        rotated = client.put(
            f"/organizations/voice-profiles/{profile['id']}",
            json={"tts": {**SARVAM_TTS, "api_key": "sk-rotated-key-0987654321"}},
        )
        assert rotated.status_code == 200, rotated.text
        assert (
            db.rows[profile["id"]].tts["api_key"] == "sk-rotated-key-0987654321"
        )


def test_org_b_cannot_read_or_touch_org_a_profile():
    org_a_db = FakeVoiceProfileDB()
    with patch("api.routes.organization.db_client", org_a_db):
        org_a_profile = _create_profile(TestClient(_make_app(organization_id=11)))

    with patch("api.routes.organization.db_client", org_a_db):
        org_b = TestClient(_make_app(organization_id=22))
        profile_id = org_a_profile["id"]

        assert org_b.get("/organizations/voice-profiles").json() == []
        assert org_b.get(f"/organizations/voice-profiles/{profile_id}").status_code == 404
        assert (
            org_b.put(
                f"/organizations/voice-profiles/{profile_id}",
                json={"name": "stolen"},
            ).status_code
            == 404
        )
        assert (
            org_b.delete(f"/organizations/voice-profiles/{profile_id}").status_code
            == 404
        )
        assert (
            org_b.get(f"/organizations/voice-profiles/{profile_id}/voices").status_code
            == 404
        )

    # The row is untouched: org B's attempts never reached it.
    assert org_a_db.rows[profile_id].name == "Hindi line"


def test_voice_profile_voices_uses_the_static_sarvam_catalog():
    db = FakeVoiceProfileDB()
    with (
        patch("api.routes.organization.db_client", db),
        patch(
            "api.routes.organization.mps_service_key_client.get_voices",
            new=AsyncMock(),
        ) as get_voices,
    ):
        client = TestClient(_make_app())
        profile = _create_profile(client)
        response = client.get(
            f"/organizations/voice-profiles/{profile['id']}/voices"
        )

    assert response.status_code == 200, response.text
    body = response.json()
    assert body["provider"] == "sarvam"
    assert [voice["voice_id"] for voice in body["voices"]] == list(SARVAM_V3_VOICES)
    get_voices.assert_not_awaited()


def test_voice_profile_voices_lists_dynamic_providers_through_the_voice_proxy():
    db = FakeVoiceProfileDB()
    proxied = {
        "provider": "cartesia",
        "voices": [{"voice_id": "voice-1", "name": "Voice One"}],
    }
    with (
        patch("api.routes.organization.db_client", db),
        patch(
            "api.routes.organization.mps_service_key_client.get_voices",
            new=AsyncMock(return_value=proxied),
        ) as get_voices,
    ):
        client = TestClient(_make_app(organization_id=11))
        profile = _create_profile(
            client,
            name="Cartesia EN",
        )
        # Swap the stored config to Cartesia; the create payload stays Sarvam.
        db.rows[profile["id"]].tts = {
            "provider": "cartesia",
            "api_key": "cartesia-key-1234",
            "model": "sonic-3.6",
            "voice": "voice-1",
        }
        response = client.get(
            f"/organizations/voice-profiles/{profile['id']}/voices"
        )

    assert response.status_code == 200, response.text
    assert response.json()["voices"][0]["voice_id"] == "voice-1"
    assert get_voices.await_args is not None
    kwargs = get_voices.await_args.kwargs
    assert kwargs["provider"] == "cartesia"
    assert kwargs["organization_id"] == 11


def test_sarvam_payload_round_trips_through_the_tts_union():
    parsed = parse_voice_profile_tts(SARVAM_TTS)
    assert parsed.provider == ServiceProviders.SARVAM
    assert parsed.model == "bulbul:v3"
    assert parsed.voice == "anushka"

    create = VoiceProfileCreate(name="line", tts=SARVAM_TTS)
    assert create.tts.language == "hi-IN"

    try:
        parse_voice_profile_tts({**SARVAM_TTS, "provider": "nope"})
    except ValueError as exc:
        assert "Invalid TTS configuration" in str(exc)
    else:
        raise AssertionError("expected an invalid provider to be rejected")


def _dograh_effective_config():
    # Parsed through the TTS union so the test uses the same class the
    # service factory sees at import time.
    return EffectiveAIModelConfiguration(
        tts=parse_voice_profile_tts({"provider": "dograh", "api_key": "dograh-key"}),
    )


def _profile(profile_id=5, is_default=False):
    return SimpleNamespace(
        id=profile_id,
        organization_id=11,
        name="Hindi line",
        tts=dict(SARVAM_TTS),
        is_default=is_default,
    )


async def test_resolution_prefers_the_workflow_voice_profile():
    from api.services.configuration import ai_model_configuration as module

    resolved = SimpleNamespace(effective=_dograh_effective_config())
    with (
        patch.object(
            module, "get_resolved_ai_model_configuration", new=AsyncMock(return_value=resolved)
        ),
        patch.object(module, "db_client") as db,
    ):
        db.get_voice_profile = AsyncMock(return_value=_profile())
        db.get_default_voice_profile = AsyncMock(return_value=None)

        effective = await module.get_effective_ai_model_configuration_for_workflow(
            organization_id=11,
            workflow_configurations={"voice_profile_id": 5},
        )

    assert effective.tts.provider == ServiceProviders.SARVAM
    assert effective.tts.api_key == SARVAM_TTS["api_key"]
    db.get_voice_profile.assert_awaited_once_with(5, organization_id=11)
    db.get_default_voice_profile.assert_not_awaited()


async def test_resolution_falls_back_to_the_org_default_voice_profile():
    from api.services.configuration import ai_model_configuration as module

    resolved = SimpleNamespace(effective=_dograh_effective_config())
    with (
        patch.object(
            module, "get_resolved_ai_model_configuration", new=AsyncMock(return_value=resolved)
        ),
        patch.object(module, "db_client") as db,
    ):
        db.get_voice_profile = AsyncMock(return_value=None)
        db.get_default_voice_profile = AsyncMock(return_value=_profile(is_default=True))

        effective = await module.get_effective_ai_model_configuration_for_workflow(
            organization_id=11,
            workflow_configurations={},
        )

    assert effective.tts.provider == ServiceProviders.SARVAM
    db.get_voice_profile.assert_not_awaited()
    db.get_default_voice_profile.assert_awaited_once_with(organization_id=11)


async def test_resolution_keeps_the_org_tts_without_any_voice_profile():
    from api.services.configuration import ai_model_configuration as module

    resolved = SimpleNamespace(effective=_dograh_effective_config())
    with (
        patch.object(
            module, "get_resolved_ai_model_configuration", new=AsyncMock(return_value=resolved)
        ),
        patch.object(module, "db_client") as db,
    ):
        db.get_voice_profile = AsyncMock(return_value=None)
        db.get_default_voice_profile = AsyncMock(return_value=None)

        effective = await module.get_effective_ai_model_configuration_for_workflow(
            organization_id=11,
            workflow_configurations={},
        )

    assert effective.tts.provider == ServiceProviders.DOGRAH
    assert effective.tts.api_key == "dograh-key"


async def test_resolution_wins_over_a_workflow_v2_model_override():
    from api.services.configuration import ai_model_configuration as module

    override = {
        "version": 2,
        "mode": "byok",
        "byok": {
            "mode": "pipeline",
            "pipeline": {
                "llm": {
                    "provider": "openai",
                    "api_key": "llm-key",
                    "model": "gpt-4o-mini",
                },
                "stt": {
                    "provider": "deepgram",
                    "api_key": "stt-key",
                    "model": "nova-3",
                    "language": "multi",
                },
                "tts": {
                    "provider": "elevenlabs",
                    "api_key": "eleven-key",
                    "model": "eleven_turbo_v2_5",
                    "voice": "voice-9",
                },
            },
        },
    }
    with patch.object(module, "db_client") as db:
        db.get_voice_profile = AsyncMock(return_value=_profile())
        db.get_default_voice_profile = AsyncMock(return_value=None)

        effective = await module.get_effective_ai_model_configuration_for_workflow(
            organization_id=11,
            workflow_configurations={
                module.WORKFLOW_MODEL_CONFIGURATION_V2_OVERRIDE_KEY: override,
                "voice_profile_id": 5,
            },
        )

    assert effective.tts is not None
    assert effective.tts.provider == ServiceProviders.SARVAM
    assert effective.tts.api_key == SARVAM_TTS["api_key"]
    db.get_voice_profile.assert_awaited_once_with(5, organization_id=11)


async def test_resolution_ignores_voice_profiles_for_realtime_agents():
    from api.services.configuration import ai_model_configuration as module

    effective_config = EffectiveAIModelConfiguration(is_realtime=True)
    resolved = SimpleNamespace(effective=effective_config)
    with (
        patch.object(
            module, "get_resolved_ai_model_configuration", new=AsyncMock(return_value=resolved)
        ),
        patch.object(module, "db_client") as db,
    ):
        db.get_voice_profile = AsyncMock(return_value=_profile())
        db.get_default_voice_profile = AsyncMock(return_value=_profile(is_default=True))

        effective = await module.get_effective_ai_model_configuration_for_workflow(
            organization_id=11,
            workflow_configurations={"voice_profile_id": 5},
        )

    assert effective.tts is None
    db.get_voice_profile.assert_not_awaited()
    db.get_default_voice_profile.assert_not_awaited()
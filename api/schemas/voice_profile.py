from __future__ import annotations

from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, Field, TypeAdapter, ValidationError

from api.services.configuration.masking import (
    SERVICE_SECRET_FIELDS,
    contains_masked_key,
    mask_key,
    resolve_masked_api_keys,
)
from api.services.configuration.registry import TTSConfig

_TTS_ADAPTER = TypeAdapter(TTSConfig)

MASKED_KEY_MESSAGE = (
    "The {field} appears to be masked. Please provide the actual value, not "
    "the masked value."
)


class VoiceProfileCreate(BaseModel):
    name: str = Field(min_length=1, max_length=64)
    tts: TTSConfig
    is_default: bool = False


class VoiceProfileUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=64)
    tts: Optional[TTSConfig] = None
    is_default: Optional[bool] = None


class VoiceProfileResponse(BaseModel):
    id: int
    organization_id: int
    name: str
    # Masked TTS configuration: secrets show only their masked tail.
    tts: dict
    is_default: bool
    created_at: datetime
    updated_at: datetime


def parse_voice_profile_tts(data: Any) -> TTSConfig:
    """Validate TTS JSON against the registry's discriminated union.

    Raises ValueError with a readable message so routes can map it to 422 and
    runtime resolution can log and fall back.
    """
    try:
        return _TTS_ADAPTER.validate_python(data)
    except ValidationError as exc:
        errors = exc.errors()
        if errors:
            first = errors[0]
            location = ".".join(str(part) for part in first["loc"])
            raise ValueError(
                f"Invalid TTS configuration at {location}: {first['msg']}"
            ) from exc
        raise ValueError(f"Invalid TTS configuration: {exc}") from exc


def mask_voice_profile_tts(tts: TTSConfig) -> dict:
    data = tts.model_dump(mode="json")
    for field in SERVICE_SECRET_FIELDS:
        raw = data.get(field)
        if not raw:
            continue
        data[field] = (
            [mask_key(item) for item in raw] if isinstance(raw, list) else mask_key(raw)
        )
    return data


def merge_voice_profile_tts(
    incoming: TTSConfig, existing_tts: Any = None
) -> TTSConfig:
    """Resolve masked secrets against the stored profile, then reject leftovers.

    A masked value only makes sense against the profile it came from, so a
    provider change skips the merge entirely.
    """
    merged = incoming
    if isinstance(existing_tts, dict) and existing_tts:
        data = incoming.model_dump(mode="json")
        same_provider = data.get("provider") == existing_tts.get("provider")
        for field in SERVICE_SECRET_FIELDS:
            existing_value = existing_tts.get(field)
            if not same_provider or not existing_value:
                continue
            if contains_masked_key(data.get(field)):
                data[field] = resolve_masked_api_keys(data[field], existing_value)
        merged = parse_voice_profile_tts(data)

    for field in SERVICE_SECRET_FIELDS:
        if contains_masked_key(getattr(merged, field, None)):
            raise ValueError(MASKED_KEY_MESSAGE.format(field=field))
    return merged
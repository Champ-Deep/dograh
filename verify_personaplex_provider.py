"""Verify the PersonaPlex realtime provider registers, validates, and discriminates.

Exercises the real consumption path (BYOKRealtimeAIModelConfiguration /
EffectiveAIModelConfiguration), not a bare Annotated alias.

Run from the repo root:  python verify_personaplex_provider.py
"""

import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).parent / "api"))

from pydantic import TypeAdapter, ValidationError  # noqa: E402

from schemas.ai_model_configuration import (  # noqa: E402
    BYOKRealtimeAIModelConfiguration,
    EffectiveAIModelConfiguration,
    OrganizationAIModelConfigurationV2,
)
from services.configuration.registry import (  # noqa: E402
    PERSONAPLEX_VOICES,
    REALTIME_PROVIDERS,
    REGISTRY,
    RealtimeConfig,
    ServiceProviders,
    ServiceType,
)

failures: list[str] = []


def check(label: str, ok: bool, detail: str = "") -> None:
    print(f"{'PASS' if ok else 'FAIL'}  {label}{('  -> ' + detail) if detail else ''}")
    if not ok:
        failures.append(label)


# --- registration -----------------------------------------------------------
check(
    "ServiceProviders.PERSONAPLEX == 'personaplex'",
    ServiceProviders.PERSONAPLEX.value == "personaplex",
)

realtime_registry = REGISTRY[ServiceType.REALTIME]
check(
    "registered in REGISTRY[ServiceType.REALTIME]",
    ServiceProviders.PERSONAPLEX in realtime_registry,
    f"{len(realtime_registry)} realtime providers",
)
check(
    "present in REALTIME_PROVIDERS",
    ServiceProviders.PERSONAPLEX.value in REALTIME_PROVIDERS,
)

cls = realtime_registry[ServiceProviders.PERSONAPLEX]

# --- the field that unblocks everything -------------------------------------
check(
    "config exposes base_url",
    "base_url" in cls.model_fields,
    f"default={cls.model_fields['base_url'].default!r}",
)
others = [
    name
    for name, c in realtime_registry.items()
    if name != ServiceProviders.PERSONAPLEX and "base_url" in c.model_fields
]
check(
    "PersonaPlex is the ONLY realtime provider with base_url",
    others == [],
    f"others: {others}",
)
check(
    "stock voice default is a real shipped preset",
    cls.model_fields["voice"].default in PERSONAPLEX_VOICES,
    str(cls.model_fields["voice"].default),
)

# --- discriminated union via TypeAdapter (how pydantic actually resolves it) --
adapter = TypeAdapter(RealtimeConfig)
cfg = adapter.validate_python({"provider": "personaplex", "api_key": None, "voice": "NATM1"})
check(
    "discriminated union resolves PersonaPlex",
    type(cfg).__name__ == "PersonaPlexRealtimeLLMConfiguration",
    type(cfg).__name__,
)
check("voice carried through", getattr(cfg, "voice", None) == "NATM1")
check("api_key may be None (self-hosted, no auth)", getattr(cfg, "api_key", "X") is None)
check(
    "voice_prompt_path defaults None (stock preset)",
    getattr(cfg, "voice_prompt_path", "M") is None,
)

cfg2 = adapter.validate_python(
    {"provider": "personaplex", "api_key": None, "base_url": "ws://10.0.0.5:8998/api/chat"}
)
check(
    "custom ws:// base_url round-trips",
    getattr(cfg2, "base_url", None) == "ws://10.0.0.5:8998/api/chat",
    str(getattr(cfg2, "base_url", None)),
)

try:
    adapter.validate_python({"provider": "not_a_real_provider", "api_key": "x"})
    check("unknown provider still rejected", False, "accepted bogus provider")
except ValidationError:
    check("unknown provider still rejected", True)

# --- the real API-facing models ---------------------------------------------
# BYOKRealtimeAIModelConfiguration also requires an `llm`: in realtime mode the
# S2S model handles voice while a text LLM follows the workflow and calls tools.
# That is the same function-calling split Salesforce documents as the reason
# Moshi-lineage models cannot be the sole engine.
byok = BYOKRealtimeAIModelConfiguration.model_validate(
    {
        "realtime": {"provider": "personaplex", "api_key": None},
        "llm": {"provider": "openai", "api_key": "sk-test-not-real", "model": "gpt-4o-mini"},
    }
)
check(
    "BYOKRealtimeAIModelConfiguration accepts personaPlex",
    type(byok.realtime).__name__ == "PersonaPlexRealtimeLLMConfiguration",
    type(byok.realtime).__name__,
)
check(
    "realtime mode still carries the tool-calling llm",
    type(byok.llm).__name__ not in ("NoneType",),
    type(byok.llm).__name__,
)

# Full organization config, the shape the UI actually submits.
org = OrganizationAIModelConfigurationV2.model_validate(
    {
        "mode": "byok",
        "byok": {
            "mode": "realtime",
            "realtime": {
                "realtime": {"provider": "personaplex", "api_key": None},
                "llm": {
                    "provider": "openai",
                    "api_key": "sk-test-not-real",
                    "model": "gpt-4o-mini",
                },
            },
        },
    }
)
check(
    "OrganizationAIModelConfigurationV2 round-trips (UI submit path)",
    org.byok is not None
    and org.byok.realtime is not None
    and type(org.byok.realtime.realtime).__name__ == "PersonaPlexRealtimeLLMConfiguration",
    type(org.byok.realtime.realtime).__name__ if org.byok and org.byok.realtime else "DROPPED",
)

# HAZARD: EffectiveAIModelConfiguration.strip_incomplete_realtime_when_disabled
# drops `realtime` when is_realtime is False and api_key is falsy. PersonaPlex
# legitimately has no api_key, so a valid config can be silently discarded.
eff_ok = EffectiveAIModelConfiguration.model_validate(
    {"is_realtime": True, "realtime": {"provider": "personaplex", "api_key": None}}
)
check(
    "survives EffectiveAIModelConfiguration when is_realtime=True",
    eff_ok.realtime is not None
    and type(eff_ok.realtime).__name__ == "PersonaPlexRealtimeLLMConfiguration",
    type(eff_ok.realtime).__name__ if eff_ok.realtime else "DROPPED",
)

eff_risk = EffectiveAIModelConfiguration.model_validate(
    {"is_realtime": False, "realtime": {"provider": "personaplex", "api_key": None}}
)
print(
    f"{'NOTE' if eff_risk.realtime is None else 'PASS'}  "
    f"is_realtime=False + no api_key -> realtime is "
    f"{'DROPPED (known upstream guard; PersonaPlex must set is_realtime=True)' if eff_risk.realtime is None else 'kept'}"
)

print()
if failures:
    print(f"{len(failures)} FAILURE(S): {failures}")
    sys.exit(1)
print("All PersonaPlex provider registration checks passed.")
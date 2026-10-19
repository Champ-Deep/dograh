import type { VoiceProfileResponse } from "@/client/types.gen";
import type { ProviderSchema } from "@/components/ServiceConfigurationForm";

/** Select value that means "no workflow profile, use the organization one". */
export const ORGANIZATION_DEFAULT_VOICE_VALUE = "org_default";

export const ORGANIZATION_DEFAULT_VOICE_LABEL = "Organization default";

export interface TtsProviderOption {
    value: string;
    label: string;
}

/** Provider options for the voice profile dialog, from the defaults endpoint. */
export function ttsProviderOptions(
    ttsSchemas: Record<string, ProviderSchema>,
): TtsProviderOption[] {
    return Object.entries(ttsSchemas ?? {}).map(([provider, schema]) => ({
        value: provider,
        label: schema?.title ?? provider,
    }));
}

/**
 * Dropdown values for one field of a provider schema: per-model voice options
 * when the registry declares them (Sarvam bulbul:v2/v3), else enum/examples.
 * Returns null when the field has no curated list (free-text input instead).
 */
export function fieldOptions(
    schema: ProviderSchema | undefined,
    field: string,
    model?: string,
): string[] | null {
    const property = schema?.properties?.[field];
    if (!property) return null;
    if (field === "voice" && model && property.model_options?.[model]) {
        return property.model_options[model];
    }
    return property.enum ?? property.examples ?? null;
}

export function voiceProfileLabel(profile: VoiceProfileResponse): string {
    return profile.is_default ? `${profile.name} (default)` : profile.name;
}

/**
 * Label for the workflow's Voice select. Mirrors runtime resolution: an unset
 * or unknown profile id falls back to the organization default voice profile,
 * so it labels as "Organization default".
 */
export function voiceSelectionLabel(
    voiceProfileId: number | null | undefined,
    profiles: VoiceProfileResponse[],
): string {
    if (!voiceProfileId) return ORGANIZATION_DEFAULT_VOICE_LABEL;
    const profile = profiles.find((candidate) => candidate.id === voiceProfileId);
    return profile ? voiceProfileLabel(profile) : ORGANIZATION_DEFAULT_VOICE_LABEL;
}

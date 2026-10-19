import { describe, expect, it } from "vitest";

import type { VoiceProfileResponse } from "@/client/types.gen";
import {
    fieldOptions,
    ORGANIZATION_DEFAULT_VOICE_LABEL,
    ttsProviderOptions,
    voiceProfileLabel,
    voiceSelectionLabel,
} from "@/lib/voiceProfiles";

const profiles = [
    { id: 1, name: "Sarvam Hindi", is_default: true },
    { id: 2, name: "Cartesia EN", is_default: false },
] as VoiceProfileResponse[];

describe("voiceSelectionLabel", () => {
    it("labels an unset profile as the organization default", () => {
        expect(voiceSelectionLabel(null, profiles)).toBe(ORGANIZATION_DEFAULT_VOICE_LABEL);
        expect(voiceSelectionLabel(undefined, profiles)).toBe(ORGANIZATION_DEFAULT_VOICE_LABEL);
    });

    it("labels a known profile by name, flagging the default one", () => {
        expect(voiceSelectionLabel(1, profiles)).toBe("Sarvam Hindi (default)");
        expect(voiceSelectionLabel(2, profiles)).toBe("Cartesia EN");
    });

    it("falls back to the organization default for a profile the org no longer has", () => {
        expect(voiceSelectionLabel(99, profiles)).toBe(ORGANIZATION_DEFAULT_VOICE_LABEL);
    });
});

describe("voiceProfileLabel", () => {
    it("only marks the default profile", () => {
        expect(voiceProfileLabel(profiles[1])).toBe("Cartesia EN");
    });
});

describe("ttsProviderOptions", () => {
    it("uses the schema title as the label and falls back to the provider key", () => {
        expect(
            ttsProviderOptions({
                sarvam: { title: "Sarvam", properties: {} },
                rime: { properties: {} },
            }),
        ).toEqual([
            { value: "sarvam", label: "Sarvam" },
            { value: "rime", label: "rime" },
        ]);
    });
});

describe("fieldOptions", () => {
    const sarvamSchema = {
        properties: {
            model: { examples: ["bulbul:v2", "bulbul:v3"] },
            voice: {
                examples: ["anushka"],
                model_options: { "bulbul:v2": ["anushka"], "bulbul:v3": ["anushka", "karun"] },
            },
            language: { examples: ["hi-IN", "en-IN"] },
        },
    };

    it("prefers per-model voice options over the generic examples", () => {
        expect(fieldOptions(sarvamSchema, "voice", "bulbul:v3")).toEqual([
            "anushka",
            "karun",
        ]);
        expect(fieldOptions(sarvamSchema, "voice", "bulbul:v2")).toEqual(["anushka"]);
    });

    it("falls back to examples and returns null for fields with no list", () => {
        expect(fieldOptions(sarvamSchema, "model")).toEqual(["bulbul:v2", "bulbul:v3"]);
        expect(fieldOptions(sarvamSchema, "voice")).toEqual(["anushka"]);
        expect(fieldOptions(sarvamSchema, "speed")).toBeNull();
        expect(fieldOptions(undefined, "model")).toBeNull();
    });
});

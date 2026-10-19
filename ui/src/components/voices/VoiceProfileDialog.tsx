"use client";

import { useEffect, useState } from "react";

import {
    createVoiceProfileApiV1OrganizationsVoiceProfilesPost,
    updateVoiceProfileApiV1OrganizationsVoiceProfilesProfileIdPut,
} from "@/client/sdk.gen";
import type { VoiceProfileCreate, VoiceProfileResponse } from "@/client/types.gen";
import type { ProviderSchema } from "@/components/ServiceConfigurationForm";
import { Button } from "@/components/ui/button";
import {
    Dialog,
    DialogContent,
    DialogDescription,
    DialogFooter,
    DialogHeader,
    DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Switch } from "@/components/ui/switch";
import { VoicePicker } from "@/components/voices/VoicePicker";
import { detailFromError } from "@/lib/apiError";
import { fieldOptions, ttsProviderOptions } from "@/lib/voiceProfiles";

interface VoiceProfileDialogProps {
    open: boolean;
    onOpenChange: (open: boolean) => void;
    /** null opens the dialog in create mode. */
    profile: VoiceProfileResponse | null;
    ttsSchemas: Record<string, ProviderSchema>;
    onSaved: () => Promise<void> | void;
}

interface FormState {
    name: string;
    provider: string;
    apiKey: string;
    model: string;
    voice: string;
    language: string;
    speed: string;
    isDefault: boolean;
}

function initialProvider(ttsSchemas: Record<string, ProviderSchema>, preferred?: string): string {
    if (preferred && ttsSchemas[preferred]) return preferred;
    return Object.keys(ttsSchemas)[0] ?? "";
}

function defaultFormState(ttsSchemas: Record<string, ProviderSchema>, profile: VoiceProfileResponse | null): FormState {
    const provider = initialProvider(ttsSchemas, profile ? String(profile.tts.provider ?? "") : undefined);
    return {
        name: profile?.name ?? "",
        provider,
        // Editing keeps the stored (masked) key in the field; the backend
        // resolves a still-masked value against the stored secret.
        apiKey: profile ? String(profile.tts.api_key ?? "") : "",
        model: String(profile?.tts.model ?? ""),
        voice: String(profile?.tts.voice ?? ""),
        language: String(profile?.tts.language ?? ""),
        speed: profile?.tts.speed === undefined ? "" : String(profile.tts.speed),
        isDefault: profile?.is_default ?? false,
    };
}

export function VoiceProfileDialog({
    open,
    onOpenChange,
    profile,
    ttsSchemas,
    onSaved,
}: VoiceProfileDialogProps) {
    const [form, setForm] = useState<FormState>(() => defaultFormState(ttsSchemas, profile));
    const [saving, setSaving] = useState(false);
    const [error, setError] = useState<string | null>(null);

    useEffect(() => {
        if (open) {
            setForm(defaultFormState(ttsSchemas, profile));
            setError(null);
        }
    }, [open, profile, ttsSchemas]);

    const schema = ttsSchemas[form.provider];
    const modelOptions = fieldOptions(schema, "model");
    const languageOptions = fieldOptions(schema, "language");
    const hasLanguage = Boolean(schema?.properties?.language);
    const hasSpeed = Boolean(schema?.properties?.speed);
    const apiKeyRequired = schema?.required?.includes("api_key") ?? true;

    const setField = (field: keyof FormState, value: string | boolean) =>
        setForm((current) => ({ ...current, [field]: value }));

    const handleProviderChange = (provider: string) => {
        const providerSchema = ttsSchemas[provider];
        const models = fieldOptions(providerSchema, "model") ?? [];
        const languages = fieldOptions(providerSchema, "language") ?? [];
        setForm((current) => ({
            ...current,
            provider,
            model: models[0] ?? "",
            language: languages[0] ?? "",
            voice: String(providerSchema?.properties?.voice?.default ?? ""),
        }));
    };

    const handleSubmit = async () => {
        const name = form.name.trim();
        if (!name) {
            setError("Name is required");
            return;
        }
        if (!form.provider) {
            setError("Provider is required");
            return;
        }
        const apiKey = form.apiKey.trim() || (profile ? String(profile.tts.api_key ?? "") : "");
        if (apiKeyRequired && !apiKey) {
            setError("API key is required for this provider");
            return;
        }

        const tts: Record<string, unknown> = {
            provider: form.provider,
            voice: form.voice,
        };
        if (apiKey) tts.api_key = apiKey;
        if (form.model) tts.model = form.model;
        if (hasLanguage && form.language) tts.language = form.language;
        if (hasSpeed && form.speed) tts.speed = Number(form.speed);

        const body = {
            name,
            tts: tts as VoiceProfileCreate["tts"],
            is_default: form.isDefault,
        };

        setSaving(true);
        setError(null);
        try {
            const response = profile
                ? await updateVoiceProfileApiV1OrganizationsVoiceProfilesProfileIdPut({
                      path: { profile_id: profile.id },
                      body: {
                          tts: body.tts,
                          name: body.name,
                          is_default: body.is_default,
                      },
                  })
                : await createVoiceProfileApiV1OrganizationsVoiceProfilesPost({ body });
            if (response.error) {
                setError(detailFromError(response.error, "Failed to save voice profile"));
                return;
            }
            await onSaved();
            onOpenChange(false);
        } catch (err) {
            setError(err instanceof Error ? err.message : "Failed to save voice profile");
        } finally {
            setSaving(false);
        }
    };

    const renderOptionsField = (
        field: "model" | "language",
        label: string,
        options: string[] | null,
        currentValue: string,
    ) => (
        <div className="space-y-2">
            <Label htmlFor={`voice-profile-${field}`} className="text-sm">
                {label}
            </Label>
            {options && options.length > 0 ? (
                <Select
                    value={currentValue || undefined}
                    onValueChange={(value) => setField(field, value)}
                >
                    <SelectTrigger id={`voice-profile-${field}`} className="w-full">
                        <SelectValue placeholder={`Select ${label.toLowerCase()}`} />
                    </SelectTrigger>
                    <SelectContent>
                        {options.map((option) => (
                            <SelectItem key={option} value={option}>
                                {option}
                            </SelectItem>
                        ))}
                    </SelectContent>
                </Select>
            ) : (
                <Input
                    id={`voice-profile-${field}`}
                    value={currentValue}
                    onChange={(event) => setField(field, event.target.value)}
                />
            )}
        </div>
    );

    return (
        <Dialog open={open} onOpenChange={onOpenChange}>
            <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
                <DialogHeader>
                    <DialogTitle>{profile ? "Edit voice profile" : "Add voice profile"}</DialogTitle>
                    <DialogDescription>
                        A named TTS configuration (provider, key, model, voice) that agents can
                        speak with.
                    </DialogDescription>
                </DialogHeader>

                {error && (
                    <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                        {error}
                    </div>
                )}

                <div className="space-y-4">
                    <div className="space-y-2">
                        <Label htmlFor="voice-profile-name" className="text-sm">
                            Name
                        </Label>
                        <Input
                            id="voice-profile-name"
                            value={form.name}
                            onChange={(event) => setField("name", event.target.value)}
                            placeholder="Hindi support line"
                        />
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="voice-profile-provider" className="text-sm">
                            Provider
                        </Label>
                        <Select value={form.provider} onValueChange={handleProviderChange}>
                            <SelectTrigger id="voice-profile-provider" className="w-full">
                                <SelectValue placeholder="Select a provider" />
                            </SelectTrigger>
                            <SelectContent>
                                {ttsProviderOptions(ttsSchemas).map((option) => (
                                    <SelectItem key={option.value} value={option.value}>
                                        {option.label}
                                    </SelectItem>
                                ))}
                            </SelectContent>
                        </Select>
                    </div>

                    <div className="space-y-2">
                        <Label htmlFor="voice-profile-api-key" className="text-sm">
                            API key
                        </Label>
                        <Input
                            id="voice-profile-api-key"
                            type="password"
                            autoComplete="off"
                            value={form.apiKey}
                            onChange={(event) => setField("apiKey", event.target.value)}
                            placeholder={profile ? "Stored key (leave as-is to keep)" : "Provider API key"}
                        />
                        <p className="text-xs text-muted-foreground">
                            Stored encrypted in the profile and never shown in full.
                        </p>
                    </div>

                    {renderOptionsField("model", "Model", modelOptions, form.model)}

                    <div className="space-y-2">
                        <Label className="text-sm">Voice</Label>
                        <VoicePicker
                            provider={form.provider}
                            model={form.model}
                            profileId={profile?.id ?? null}
                            value={form.voice}
                            onChange={(voice) => setField("voice", voice)}
                        />
                    </div>

                    {hasLanguage && renderOptionsField("language", "Language", languageOptions, form.language)}

                    {hasSpeed && (
                        <div className="space-y-2">
                            <Label htmlFor="voice-profile-speed" className="text-sm">
                                Speed
                            </Label>
                            <Input
                                id="voice-profile-speed"
                                type="number"
                                step="0.1"
                                min={String(schema?.properties?.speed?.minimum ?? 0.5)}
                                max={String(schema?.properties?.speed?.maximum ?? 2)}
                                value={form.speed}
                                onChange={(event) => setField("speed", event.target.value)}
                                placeholder="1"
                            />
                        </div>
                    )}

                    <div className="flex items-center justify-between">
                        <div className="space-y-0.5">
                            <Label htmlFor="voice-profile-default" className="text-sm">
                                Organization default
                            </Label>
                            <p className="text-xs text-muted-foreground">
                                Agents without their own voice use this profile.
                            </p>
                        </div>
                        <Switch
                            id="voice-profile-default"
                            checked={form.isDefault}
                            onCheckedChange={(checked) => setField("isDefault", checked)}
                        />
                    </div>
                </div>

                <DialogFooter>
                    <Button variant="outline" onClick={() => onOpenChange(false)} disabled={saving}>
                        Cancel
                    </Button>
                    <Button onClick={handleSubmit} disabled={saving}>
                        {saving ? "Saving..." : profile ? "Save changes" : "Add voice"}
                    </Button>
                </DialogFooter>
            </DialogContent>
        </Dialog>
    );
}

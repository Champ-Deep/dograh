"use client";

import { Volume2 } from "lucide-react";
import { useEffect, useRef, useState } from "react";

import {
    getVoiceProfileVoicesApiV1OrganizationsVoiceProfilesProfileIdVoicesGet,
    getVoicesApiV1UserConfigurationsVoicesProviderGet,
} from "@/client/sdk.gen";
import type { VoiceInfo } from "@/client/types.gen";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

// Providers the existing /user/configurations/voices endpoint can list.
const CATALOG_PROVIDERS = ["elevenlabs", "deepgram", "sarvam", "cartesia", "dograh", "rime"] as const;
type CatalogProvider = (typeof CATALOG_PROVIDERS)[number];

interface VoicePickerProps {
    provider: string;
    model?: string;
    /** Set when editing a saved profile: lists through that profile's own endpoint. */
    profileId?: number | null;
    value: string;
    onChange: (voiceId: string) => void;
}

export function VoicePicker({ provider, model, profileId, value, onChange }: VoicePickerProps) {
    const [voices, setVoices] = useState<VoiceInfo[]>([]);
    const [loading, setLoading] = useState(false);
    const [manual, setManual] = useState(false);
    const [playing, setPlaying] = useState(false);
    const audioRef = useRef<HTMLAudioElement | null>(null);

    useEffect(() => {
        let cancelled = false;

        const load = async () => {
            if (!provider) return;
            setVoices([]);
            setLoading(true);
            try {
                const response = profileId
                    ? await getVoiceProfileVoicesApiV1OrganizationsVoiceProfilesProfileIdVoicesGet({
                          path: { profile_id: profileId },
                      })
                    : CATALOG_PROVIDERS.includes(provider as CatalogProvider)
                      ? await getVoicesApiV1UserConfigurationsVoicesProviderGet({
                            path: { provider: provider as CatalogProvider },
                            query: model ? { model } : undefined,
                        })
                      : null;
                if (!cancelled && response && !response.error) {
                    setVoices(response.data?.voices ?? []);
                }
            } catch (error) {
                console.error("Failed to load voices", error);
            } finally {
                if (!cancelled) setLoading(false);
            }
        };

        void load();
        return () => {
            cancelled = true;
        };
    }, [provider, model, profileId]);

    useEffect(() => {
        return () => {
            audioRef.current?.pause();
        };
    }, []);

    const selected = voices.find((voice) => voice.voice_id === value) ?? null;
    const manualMode = manual || voices.length === 0;

    const playPreview = () => {
        if (!selected?.preview_url) return;
        audioRef.current?.pause();
        const audio = new Audio(selected.preview_url);
        audioRef.current = audio;
        setPlaying(true);
        const stop = () => {
            setPlaying(false);
            audioRef.current = null;
        };
        audio.onended = stop;
        audio.onerror = stop;
        void audio.play().catch(stop);
    };

    if (!provider) return null;

    return (
        <div className="space-y-2">
            {manualMode ? (
                <Input
                    placeholder="Enter voice ID"
                    value={value}
                    onChange={(event) => onChange(event.target.value)}
                />
            ) : (
                <div className="flex gap-2">
                    <Select value={value} onValueChange={onChange}>
                        <SelectTrigger className="flex-1" disabled={loading}>
                            <SelectValue
                                placeholder={loading ? "Loading voices..." : "Select a voice"}
                            />
                        </SelectTrigger>
                        <SelectContent>
                            {value && !selected && <SelectItem value={value}>{value}</SelectItem>}
                            {voices.map((voice) => (
                                <SelectItem key={voice.voice_id} value={voice.voice_id}>
                                    {voice.name}
                                </SelectItem>
                            ))}
                        </SelectContent>
                    </Select>
                    <Button
                        type="button"
                        variant="outline"
                        className="shrink-0 gap-1.5"
                        onClick={playPreview}
                        disabled={!selected?.preview_url}
                        title={
                            selected?.preview_url
                                ? "Play a sample of this voice"
                                : "This voice has no preview sample"
                        }
                    >
                        <Volume2 className="h-4 w-4" />
                        {playing ? "Playing..." : "Preview"}
                    </Button>
                </div>
            )}
            {voices.length > 0 && (
                <div className="flex items-center gap-2">
                    <Checkbox
                        id="voice-manual-input"
                        checked={manualMode}
                        onCheckedChange={(checked) => setManual(Boolean(checked))}
                    />
                    <Label htmlFor="voice-manual-input" className="text-sm font-normal cursor-pointer">
                        Enter voice ID manually
                    </Label>
                </div>
            )}
        </div>
    );
}

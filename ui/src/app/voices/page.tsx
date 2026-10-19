"use client";

import { Pencil, Plus, Trash2, Volume2 } from "lucide-react";
import { useCallback, useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import {
    deleteVoiceProfileApiV1OrganizationsVoiceProfilesProfileIdDelete,
    getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet,
    listVoiceProfilesApiV1OrganizationsVoiceProfilesGet,
} from "@/client/sdk.gen";
import type { VoiceProfileResponse } from "@/client/types.gen";
import type { ModelConfigurationDefaultsV2 } from "@/components/AIModelConfigurationV2Editor";
import type { ProviderSchema } from "@/components/ServiceConfigurationForm";
import {
    AlertDialog,
    AlertDialogAction,
    AlertDialogCancel,
    AlertDialogContent,
    AlertDialogDescription,
    AlertDialogFooter,
    AlertDialogHeader,
    AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
    Card,
    CardContent,
    CardDescription,
    CardHeader,
    CardTitle,
} from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { VoiceProfileDialog } from "@/components/voices/VoiceProfileDialog";
import { detailFromError } from "@/lib/apiError";
import { useAuth } from "@/lib/auth";
import { voiceProfileLabel } from "@/lib/voiceProfiles";

export default function VoicesPage() {
    const { user, loading: authLoading } = useAuth();
    const hasFetched = useRef(false);

    const [profiles, setProfiles] = useState<VoiceProfileResponse[]>([]);
    const [ttsSchemas, setTtsSchemas] = useState<Record<string, ProviderSchema>>({});
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState<string | null>(null);
    const [dialogOpen, setDialogOpen] = useState(false);
    const [editTarget, setEditTarget] = useState<VoiceProfileResponse | null>(null);
    const [deleteTarget, setDeleteTarget] = useState<VoiceProfileResponse | null>(null);

    const fetchProfiles = useCallback(async () => {
        const response = await listVoiceProfilesApiV1OrganizationsVoiceProfilesGet();
        if (response.error) {
            setError(detailFromError(response.error, "Failed to load voice profiles"));
            return;
        }
        setProfiles(response.data ?? []);
        setError(null);
    }, []);

    useEffect(() => {
        if (authLoading || !user || hasFetched.current) return;
        hasFetched.current = true;

        const load = async () => {
            setLoading(true);
            const [profilesResult, defaultsResult] = await Promise.all([
                fetchProfiles(),
                getModelConfigurationV2DefaultsApiV1OrganizationsModelConfigurationsV2DefaultsGet(),
            ]);
            void profilesResult;
            const defaults = defaultsResult.data as ModelConfigurationDefaultsV2 | undefined;
            if (!defaultsResult.error && defaults?.byok?.pipeline?.tts) {
                setTtsSchemas(defaults.byok.pipeline.tts);
            } else if (defaultsResult.error) {
                setError(
                    detailFromError(defaultsResult.error, "Failed to load TTS provider options"),
                );
            }
            setLoading(false);
        };
        load();
    }, [authLoading, user, fetchProfiles]);

    const onAdd = () => {
        setEditTarget(null);
        setDialogOpen(true);
    };

    const onEdit = (profile: VoiceProfileResponse) => {
        setEditTarget(profile);
        setDialogOpen(true);
    };

    const onDelete = async () => {
        if (!deleteTarget) return;
        const response = await deleteVoiceProfileApiV1OrganizationsVoiceProfilesProfileIdDelete({
            path: { profile_id: deleteTarget.id },
        });
        if (response.error) {
            toast.error(detailFromError(response.error, "Failed to delete voice profile"));
            return;
        }
        toast.success(`Voice profile "${deleteTarget.name}" deleted`);
        setDeleteTarget(null);
        await fetchProfiles();
    };

    if (loading) {
        return (
            <div className="min-h-screen">
                <div className="container mx-auto px-4 py-8">
                    <div className="max-w-4xl mx-auto space-y-4">
                        <Skeleton className="h-10 w-64" />
                        <Skeleton className="h-40 w-full" />
                        <Skeleton className="h-40 w-full" />
                    </div>
                </div>
            </div>
        );
    }

    return (
        <div className="min-h-screen">
            <div className="container mx-auto px-4 py-8">
                <div className="max-w-4xl mx-auto space-y-6">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
                        <div>
                            <h1 className="text-3xl font-bold">Voices</h1>
                            <p className="mt-2 text-sm text-muted-foreground">
                                Voice profiles let one organization keep several TTS providers side
                                by side, each with its own API key, and give every agent the voice it
                                speaks with.
                            </p>
                        </div>
                        <Button onClick={onAdd}>
                            <Plus className="h-4 w-4 mr-2" />
                            Add voice
                        </Button>
                    </div>

                    {error && (
                        <div className="rounded-md border border-destructive/40 bg-destructive/10 px-4 py-3 text-sm text-destructive">
                            {error}
                        </div>
                    )}

                    {profiles.length === 0 ? (
                        <Card>
                            <CardHeader>
                                <CardTitle className="text-base">No voice profiles yet</CardTitle>
                                <CardDescription>
                                    Add a provider (Sarvam, Cartesia, Deepgram Aura, ...) with its
                                    API key to pick per-agent voices. Until then agents keep using
                                    the organization model configuration.
                                </CardDescription>
                            </CardHeader>
                        </Card>
                    ) : (
                        <div className="grid gap-4 sm:grid-cols-2">
                            {profiles.map((profile) => (
                                <Card key={profile.id}>
                                    <CardHeader className="pb-3">
                                        <div className="flex items-start justify-between gap-2">
                                            <CardTitle className="text-base">
                                                {voiceProfileLabel(profile)}
                                            </CardTitle>
                                            {profile.is_default && (
                                                <Badge variant="secondary">Default</Badge>
                                            )}
                                        </div>
                                        <CardDescription className="flex items-center gap-1.5">
                                            <Volume2 className="h-3.5 w-3.5 shrink-0" />
                                            {String(profile.tts.provider ?? "unknown")} /{" "}
                                            {String(profile.tts.voice ?? profile.tts.model ?? "-")}
                                        </CardDescription>
                                    </CardHeader>
                                    <CardContent className="flex items-center justify-between gap-2">
                                        <p className="text-xs text-muted-foreground truncate">
                                            Key {String(profile.tts.api_key ?? "not set")}
                                        </p>
                                        <div className="flex gap-1 shrink-0">
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => onEdit(profile)}
                                            >
                                                <Pencil className="h-3.5 w-3.5 mr-1.5" />
                                                Edit
                                            </Button>
                                            <Button
                                                variant="outline"
                                                size="sm"
                                                onClick={() => setDeleteTarget(profile)}
                                            >
                                                <Trash2 className="h-3.5 w-3.5" />
                                            </Button>
                                        </div>
                                    </CardContent>
                                </Card>
                            ))}
                        </div>
                    )}
                </div>
            </div>

            <VoiceProfileDialog
                open={dialogOpen}
                onOpenChange={setDialogOpen}
                profile={editTarget}
                ttsSchemas={ttsSchemas}
                onSaved={fetchProfiles}
            />

            <AlertDialog
                open={Boolean(deleteTarget)}
                onOpenChange={(open) => {
                    if (!open) setDeleteTarget(null);
                }}
            >
                <AlertDialogContent>
                    <AlertDialogHeader>
                        <AlertDialogTitle>Delete voice profile?</AlertDialogTitle>
                        <AlertDialogDescription>
                            {deleteTarget?.name} will be removed. Agents using it fall back to the
                            organization default voice.
                        </AlertDialogDescription>
                    </AlertDialogHeader>
                    <AlertDialogFooter>
                        <AlertDialogCancel>Cancel</AlertDialogCancel>
                        <AlertDialogAction onClick={onDelete}>Delete</AlertDialogAction>
                    </AlertDialogFooter>
                </AlertDialogContent>
            </AlertDialog>
        </div>
    );
}

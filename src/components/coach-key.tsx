"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { KeyRoundIcon } from "lucide-react";

import { useCoachKey, removeCoachKey, saveCoachKey } from "@/lib/coach-key.ts";
import { analysisStatusQueryOptions, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { saveCoachModel } from "@/services/athlete-settings.ts";
import {
  COACH_FEATURES,
  COACH_MODELS,
  coachModelLabel,
  DEFAULT_COACH_MODELS,
  isCoachModel,
  type CoachFeature,
  type CoachModelId,
} from "@/services/coach-models.ts";
import { Alert, AlertDescription } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyContent,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { NativeSelect, NativeSelectOption } from "@/components/ui/native-select";
import { Spinner } from "@/components/ui/spinner";

const OPENROUTER_KEYS_URL = "https://openrouter.ai/settings/keys";

/**
 * Whether coach features can run here: the athlete's key is on this device, or the mock coach
 * answers (mock Strava only). Undecided until both are known, so no prompt flashes.
 */
export function useCoachAvailable() {
  const key = useCoachKey();
  const { data: status } = useQuery(analysisStatusQueryOptions);
  const decided = key.ready && status != null;
  const available = key.hasKey || status?.mocked === true;
  return {
    available,
    /** Known to have no key: show the way in rather than the feature. */
    needsKey: decided && !available,
    mocked: !key.hasKey && status?.mocked === true,
  };
}

/** Shown in place of a coach feature on a device with no key: the way in (ADR 0036). */
export function CoachKeyPrompt({ children }: { children: string }) {
  return (
    <Empty className="min-h-36 border-0 py-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>Add your OpenRouter key</EmptyTitle>
        <EmptyDescription>{children}</EmptyDescription>
      </EmptyHeader>
      <EmptyContent>
        <Button
          nativeButton={false}
          render={<Link to="/settings/$section" params={{ section: "coach" }} />}
        >
          <KeyRoundIcon data-icon="inline-start" />
          Add key
        </Button>
      </EmptyContent>
    </Empty>
  );
}

/** Adds, replaces, or removes the OpenRouter key on this device. */
export function CoachKeyField({ idPrefix }: { idPrefix: string }) {
  const key = useCoachKey();
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const save = useMutation({
    mutationFn: (next: string) => saveCoachKey(next),
    onSuccess: () => {
      setValue("");
      setReplacing(false);
    },
  });
  const remove = useMutation({ mutationFn: removeCoachKey });
  const id = `${idPrefix}-openrouter-key`;
  const editing = !key.hasKey || replacing;

  function submit() {
    if (value.trim()) save.mutate(value.trim());
  }

  return (
    <FieldSet>
      <FieldLegend>OpenRouter key</FieldLegend>
      <FieldDescription>
        Every coach feature runs on your own OpenRouter key and is billed to your OpenRouter
        account. The key stays on this device, locked with a passkey; VO2 never stores it.{" "}
        <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="underline">
          Get a key on openrouter.ai
        </a>
        .
      </FieldDescription>
      {!key.ready ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : editing ? (
        // Settings and onboarding are forms already: Enter here saves the key, not the page.
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={id}>Key</FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder="sk-or-…"
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submit();
              }}
              className="min-h-10 sm:min-h-8"
            />
            <div className="flex gap-2">
              {replacing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-10 flex-1 sm:min-h-8"
                  onClick={() => setReplacing(false)}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="button"
                onClick={submit}
                className="min-h-10 flex-1 sm:min-h-8"
                disabled={!value.trim() || save.isPending}
              >
                {save.isPending ? <Spinner data-icon="inline-start" /> : null}
                Save key
              </Button>
            </div>
          </div>
          {save.error ? (
            <Alert variant="destructive">
              <AlertDescription>
                Could not save the key: {save.error.message || "the passkey was cancelled"}.
              </AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : (
        <Field orientation="horizontal" className="flex-wrap items-center gap-2">
          <code className="bg-muted rounded px-2 py-1 text-sm">{key.masked}</code>
          <Badge variant={key.state === "set" ? "success" : "outline"}>
            {key.state === "set" ? "Unlocked" : "Locked until first use"}
          </Badge>
          <div className="ms-auto flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-10 sm:min-h-8"
              onClick={() => setReplacing(true)}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-10 sm:min-h-8"
              disabled={remove.isPending}
              onClick={() => remove.mutate()}
            >
              Remove
            </Button>
          </div>
        </Field>
      )}
      {key.ready && !key.remembered ? (
        <FieldDescription>
          This device can't lock the key with a passkey, so it's kept only until the app closes.
        </FieldDescription>
      ) : null}
    </FieldSet>
  );
}

function CoachModelField({
  feature,
  label,
  hint,
  model,
}: {
  feature: CoachFeature;
  label: string;
  hint: string;
  model: string;
}) {
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: CoachModelId) => saveCoachModel({ data: { feature, model: next } }),
    onSuccess: (coachModels) =>
      queryClient.setQueryData(settingsSnapshotQueryOptions.queryKey, (current) =>
        current ? { ...current, settings: { ...current.settings, coachModels } } : current,
      ),
  });
  const id = `settings-coach-model-${feature}`;
  const offered = isCoachModel(model);
  return (
    <Field>
      <FieldLabel htmlFor={id}>{label}</FieldLabel>
      <NativeSelect
        id={id}
        value={save.isPending ? save.variables : model}
        disabled={save.isPending}
        onChange={(event) => {
          const next = event.target.value;
          if (isCoachModel(next)) save.mutate(next);
        }}
      >
        {offered ? null : (
          <NativeSelectOption value={model} disabled>
            {coachModelLabel(model)} (no longer offered)
          </NativeSelectOption>
        )}
        {COACH_MODELS.map((option) => (
          <NativeSelectOption key={option.id} value={option.id}>
            {option.label} · {option.hint}
          </NativeSelectOption>
        ))}
      </NativeSelect>
      <FieldDescription>{save.error ? "Could not save. Pick it again." : hint}</FieldDescription>
    </Field>
  );
}

/** Settings → Coach: the key on this device and the model for each coach feature. */
export function SettingsCoachSection() {
  const { data } = useQuery(settingsSnapshotQueryOptions);
  const models = data?.settings.coachModels ?? DEFAULT_COACH_MODELS;
  return (
    <FieldGroup>
      <CoachKeyField idPrefix="settings" />
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Models</FieldLegend>
        <FieldDescription>
          The model each coach feature runs on. They're saved with your account, so every device
          uses the same ones.
        </FieldDescription>
        {COACH_FEATURES.map((feature) => (
          <CoachModelField
            key={feature.id}
            feature={feature.id}
            label={feature.label}
            hint={feature.hint}
            model={models[feature.id]}
          />
        ))}
      </FieldSet>
    </FieldGroup>
  );
}

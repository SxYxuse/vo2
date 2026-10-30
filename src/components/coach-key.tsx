"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { KeyRoundIcon } from "lucide-react";

import { coachStatusQueryOptions, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { saveCoachModel } from "@/services/athlete-settings.ts";
import { removeCoachKey, saveCoachKey } from "@/services/coach-key.ts";
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
 * Whether coach features can run: the athlete saved a key, or the mock coach answers (mock Strava
 * only). Undecided until the status loads, so no prompt flashes.
 */
export function useCoachAvailable() {
  const { data: status } = useQuery(coachStatusQueryOptions);
  const hasKey = status?.keySavedAt != null;
  const available = hasKey || status?.mocked === true;
  return {
    hasKey,
    available,
    /** Known to have no key: show the way in rather than the feature. */
    needsKey: status != null && !available,
    mocked: !hasKey && status?.mocked === true,
  };
}

/** Shown in place of a coach feature without a key: the way in (ADR 0036). */
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

/** Adds, replaces, or removes the athlete's OpenRouter key; it is never shown back. */
export function CoachKeyField({ idPrefix }: { idPrefix: string }) {
  const queryClient = useQueryClient();
  const { data: status } = useQuery(coachStatusQueryOptions);
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const refresh = () => queryClient.invalidateQueries(coachStatusQueryOptions);
  const save = useMutation({
    mutationFn: (key: string) => saveCoachKey({ data: { key } }),
    onSuccess: async () => {
      setValue("");
      setReplacing(false);
      await refresh();
    },
  });
  const remove = useMutation({ mutationFn: () => removeCoachKey(), onSuccess: refresh });
  const id = `${idPrefix}-openrouter-key`;
  const savedAt = status?.keySavedAt ?? null;
  const editing = savedAt == null || replacing;

  function submit() {
    if (value.trim()) save.mutate(value.trim());
  }

  return (
    <FieldSet>
      <FieldLegend>OpenRouter key</FieldLegend>
      <FieldDescription>
        Every coach feature runs on your own OpenRouter key and is billed to your OpenRouter
        account. VO2 saves it encrypted with your account, so it works on every device, and never
        shows it again.{" "}
        <a href={OPENROUTER_KEYS_URL} target="_blank" rel="noreferrer" className="underline">
          Get a key on openrouter.ai
        </a>
        .
      </FieldDescription>
      {!status ? (
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
              <AlertDescription>Could not save the key. Try again.</AlertDescription>
            </Alert>
          ) : null}
        </div>
      ) : (
        <Field orientation="horizontal" className="flex-wrap items-center gap-2">
          <span className="text-sm">
            Saved {formatDistanceToNow(new Date(savedAt), { addSuffix: true })}
          </span>
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

/** Settings → Coach: the athlete's key and the model for each coach feature. */
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

"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { formatDistanceToNow } from "date-fns";
import { KeyRoundIcon } from "lucide-react";

import { coachStatusQueryOptions, settingsSnapshotQueryOptions } from "@/lib/queries.ts";
import { removeCoachKey, saveCoachKey } from "@/services/coach-key.ts";
import {
  COACH_FEATURES,
  COACH_PROVIDERS,
  DEFAULT_COACH_MODELS,
  OPENROUTER,
  type CoachFeature,
  type CoachProvider,
} from "@/services/coach-models.ts";
import { CoachModelRow } from "@/components/coach-model-picker.tsx";
import { CoachSpendingSection } from "@/components/coach-spending.tsx";
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
import { Spinner } from "@/components/ui/spinner";

export function useCoachAvailable(feature: CoachFeature) {
  const { data: status } = useQuery(coachStatusQueryOptions);
  const hasKey = status?.ready[feature] === true;
  const available = hasKey || status?.mocked === true;
  return {
    hasKey,
    available,
    needsKey: status != null && !available,
    mocked: !hasKey && status?.mocked === true,
  };
}

export function CoachKeyPrompt({ children }: { children: string }) {
  return (
    <Empty className="min-h-36 border-0 py-6">
      <EmptyHeader>
        <EmptyMedia variant="icon">
          <KeyRoundIcon />
        </EmptyMedia>
        <EmptyTitle>Add your model's key</EmptyTitle>
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

export function CoachKeyField({
  idPrefix,
  provider = OPENROUTER,
  titled = true,
}: {
  idPrefix: string;
  provider?: CoachProvider;
  titled?: boolean;
}) {
  const info = COACH_PROVIDERS.find((each) => each.id === provider) ?? COACH_PROVIDERS[0];
  const queryClient = useQueryClient();
  const { data: status } = useQuery(coachStatusQueryOptions);
  const [value, setValue] = useState("");
  const [replacing, setReplacing] = useState(false);
  const refresh = () => queryClient.invalidateQueries(coachStatusQueryOptions);
  const save = useMutation({
    mutationFn: (key: string) => saveCoachKey({ data: { provider, key } }),
    onSuccess: async () => {
      setValue("");
      setReplacing(false);
      await refresh();
    },
  });
  const remove = useMutation({
    mutationFn: () => removeCoachKey({ data: { provider } }),
    onSuccess: refresh,
  });
  const id = `${idPrefix}-${provider}-key`;
  const savedAt = status?.keys[provider] ?? null;
  const editing = savedAt == null || replacing;

  function submit() {
    if (value.trim()) save.mutate(value.trim());
  }

  return (
    <FieldSet>
      <FieldLegend variant={titled ? "legend" : "label"}>{info.label} key</FieldLegend>
      <FieldDescription>
        {titled
          ? `Every coach feature runs on your own key and is billed to your ${info.label} account. VO2 saves it encrypted with your account, so it works on every device, and never shows it again. `
          : `${info.hint} `}
        <a href={info.keysUrl} target="_blank" rel="noreferrer" className="underline">
          Get a key on {info.keysSite}
        </a>
        .
      </FieldDescription>
      {!status ? (
        <div className="flex justify-center py-4">
          <Spinner />
        </div>
      ) : editing ? (
        <div className="flex flex-col gap-2">
          <FieldLabel htmlFor={id} className="sr-only">
            {info.label} key
          </FieldLabel>
          <div className="flex flex-col gap-2 sm:flex-row">
            <Input
              id={id}
              type="password"
              autoComplete="off"
              spellCheck={false}
              placeholder={info.placeholder}
              value={value}
              onChange={(event) => setValue(event.target.value)}
              onKeyDown={(event) => {
                if (event.key !== "Enter") return;
                event.preventDefault();
                submit();
              }}
            />
            <div className="flex gap-2">
              {replacing ? (
                <Button
                  type="button"
                  variant="outline"
                  className="flex-1 sm:flex-none"
                  onClick={() => setReplacing(false)}
                >
                  Cancel
                </Button>
              ) : null}
              <Button
                type="button"
                variant={value.trim() ? "default" : "outline"}
                onClick={submit}
                className="flex-1 sm:flex-none"
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

              onClick={() => setReplacing(true)}
            >
              Replace
            </Button>
            <Button
              type="button"
              variant="destructive"

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

export function SettingsCoachSection() {
  const { data } = useQuery(settingsSnapshotQueryOptions);
  const { data: status } = useQuery(coachStatusQueryOptions);
  const models = data?.settings.coachModels ?? DEFAULT_COACH_MODELS;
  return (
    <FieldGroup>
      <FieldSet>
        <FieldLegend>Keys</FieldLegend>
        <FieldDescription>
          Every coach feature runs on your own key and is billed to that provider. VO2 saves each
          key encrypted with your account, so it works on every device, and never shows it again.
        </FieldDescription>
        {COACH_PROVIDERS.map((provider) => (
          <CoachKeyField
            key={provider.id}
            idPrefix="settings"
            provider={provider.id}
            titled={false}
          />
        ))}
      </FieldSet>
      <FieldSeparator />
      <FieldSet>
        <FieldLegend>Models</FieldLegend>
        <FieldDescription>
          The model and reasoning each coach feature runs on. They're saved with your account, so
          every device uses the same ones.
        </FieldDescription>
        <div className="flex flex-col gap-2">
          {COACH_FEATURES.map((feature) => (
            <CoachModelRow
              key={feature.id}
              feature={feature}
              choice={models[feature.id]}
              keys={status?.keys}
              mocked={status?.mocked === true}
            />
          ))}
        </div>
      </FieldSet>
      <FieldSeparator />
      <CoachSpendingSection />
    </FieldGroup>
  );
}

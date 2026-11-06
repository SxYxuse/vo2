"use client";

import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { CheckIcon, ChevronRightIcon, SearchIcon } from "lucide-react";
import { cn } from "cn";

import {
  coachCatalogQueryOptions,
  coachStatusQueryOptions,
  settingsSnapshotQueryOptions,
} from "@/lib/queries.ts";
import { saveCoachModel } from "@/services/athlete-settings.ts";
import {
  COACH_PROVIDERS,
  coachModelLabel,
  coachProviderLabel,
  keptReasoning,
  REASONING_LABELS,
  type CoachFeature,
  type CoachModelChoice,
  type CoachModelOption,
  type CoachProvider,
} from "@/services/coach-models.ts";
import {
  ResponsiveDialog,
  ResponsiveDialogContent,
  ResponsiveDialogDescription,
  ResponsiveDialogHeader,
  ResponsiveDialogTitle,
} from "@/components/responsive-dialog.tsx";
import { InputGroup, InputGroupAddon, InputGroupInput } from "@/components/ui/input-group";
import { ToggleGroup, ToggleGroupItem } from "@/components/ui/toggle-group";

/** A picked toggle reads at a glance, not only as a faint muted fill. */
const PICKED =
  "aria-pressed:bg-foreground aria-pressed:text-background aria-pressed:hover:bg-foreground/90";

type Feature = { id: CoachFeature; label: string; hint: string };
type Keys = Partial<Record<CoachProvider, string>> | undefined;

function findIn(models: CoachModelOption[], { provider, model }: CoachModelChoice) {
  return models.find((each) => each.provider === provider && each.id === model);
}

function reasoningText(choice: CoachModelChoice) {
  return choice.reasoning == null ? "Auto" : REASONING_LABELS[choice.reasoning];
}

/** A coach feature's model and reasoning in Settings → Coach; opens the picker. */
export function CoachModelRow({
  feature,
  choice,
  keys,
  mocked,
}: {
  feature: Feature;
  choice: CoachModelChoice;
  keys: Keys;
  /** The mock coach answers without a key, so a missing one is no warning. */
  mocked: boolean;
}) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const save = useMutation({
    mutationFn: (next: CoachModelChoice) =>
      saveCoachModel({ data: { feature: feature.id, ...next } }),
    onSuccess: async (coachModels) => {
      queryClient.setQueryData(settingsSnapshotQueryOptions.queryKey, (current) =>
        current ? { ...current, settings: { ...current.settings, coachModels } } : current,
      );
      // Whether the feature can run depends on the new model's provider having a key.
      await queryClient.invalidateQueries(coachStatusQueryOptions);
    },
  });
  const catalog = useQuery(coachCatalogQueryOptions);
  const shown = save.isPending ? save.variables : choice;
  // Until the catalog loads, only the recommended models are known: no warning yet.
  const offered = catalog.isPlaceholderData || findIn(catalog.data ?? [], shown) != null;
  const keyMissing = keys != null && !mocked && !(shown.provider in keys);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-14 w-full items-center gap-3 rounded-lg border px-3 py-2.5 text-left transition-colors hover:bg-muted/50 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none"
      >
        <span className="flex min-w-0 flex-1 flex-col gap-0.5">
          <span className="text-xs text-muted-foreground">{feature.label}</span>
          <span className="truncate text-sm font-medium">
            {coachModelLabel(shown.model, shown.provider)}
            {offered ? null : " (no longer offered)"}
          </span>
          <span className="text-xs text-muted-foreground">
            {reasoningText(shown)} reasoning · via {coachProviderLabel(shown.provider)}
            {keyMissing ? (
              <span className="text-destructive">
                {" "}
                · Add your {coachProviderLabel(shown.provider)} key
              </span>
            ) : null}
          </span>
        </span>
        <ChevronRightIcon className="size-4 shrink-0 text-muted-foreground" />
      </button>
      {save.error ? (
        <p className="text-xs text-destructive">Could not save. Pick it again.</p>
      ) : null}
      <ResponsiveDialog open={open} onOpenChange={setOpen}>
        <ResponsiveDialogContent className="flex max-h-[92dvh] flex-col gap-0 overflow-hidden sm:max-w-lg">
          <CoachModelPicker
            feature={feature}
            choice={shown}
            keys={keys}
            mocked={mocked}
            onPick={(next) => save.mutate(next)}
          />
        </ResponsiveDialogContent>
      </ResponsiveDialog>
    </>
  );
}

function CoachModelPicker({
  feature,
  choice,
  keys,
  mocked,
  onPick,
}: {
  feature: Feature;
  choice: CoachModelChoice;
  keys: Keys;
  mocked: boolean;
  onPick: (next: CoachModelChoice) => void;
}) {
  const [query, setQuery] = useState("");
  const [provider, setProvider] = useState<CoachProvider | "all">("all");
  const catalog = useQuery(coachCatalogQueryOptions).data ?? [];
  const listed = findIn(catalog, choice);
  const needle = query.trim().toLowerCase();
  // Only providers with a key are offered: a keyless model can't run. The current pick stays so
  // the athlete sees what they're on, and the mock coach needs no key, so it offers every model.
  const keyed = (id: CoachProvider) => keys == null || mocked || id in keys;
  const offered = catalog.filter(
    (model) =>
      keyed(model.provider) || (model.provider === choice.provider && model.id === choice.model),
  );
  const providers = COACH_PROVIDERS.filter((each) =>
    offered.some((model) => model.provider === each.id),
  );
  const noKeys = !COACH_PROVIDERS.some((each) => keyed(each.id));
  const matches = offered.filter(
    (model) =>
      (provider === "all" || model.provider === provider) &&
      (!needle || `${model.label} ${model.hint} ${model.id}`.toLowerCase().includes(needle)),
  );
  const groups = providers
    .map((each) => ({
      ...each,
      recommended: matches.filter((model) => model.provider === each.id && model.recommended),
      untested: matches.filter((model) => model.provider === each.id && !model.recommended),
    }))
    .filter((group) => group.recommended.length || group.untested.length);

  function pick(model: CoachModelOption) {
    onPick({
      provider: model.provider,
      model: model.id,
      reasoning: keptReasoning(choice.reasoning, model.reasoning),
    });
  }

  return (
    <>
      <ResponsiveDialogHeader className="text-left">
        <ResponsiveDialogTitle>{feature.label}</ResponsiveDialogTitle>
        <ResponsiveDialogDescription>{feature.hint}</ResponsiveDialogDescription>
      </ResponsiveDialogHeader>
      {/* The drawer pads its header but not its body; the desktop dialog pads both. */}
      <div className="flex flex-col gap-2 px-4 pt-2 md:px-0">
        <InputGroup>
          <InputGroupAddon>
            <SearchIcon />
          </InputGroupAddon>
          <InputGroupInput
            type="search"
            aria-label="Search models"
            placeholder="Search models…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
          />
        </InputGroup>
        {providers.length > 1 ? (
          <ToggleGroup
            aria-label="Provider"
            value={[provider]}
            onValueChange={(next) => {
              const value = next[0] as CoachProvider | "all" | undefined;
              if (value) setProvider(value);
            }}
            variant="outline"
            size="sm"
            className="flex-wrap"
          >
            <ToggleGroupItem value="all" className={PICKED}>
              All
            </ToggleGroupItem>
            {providers.map((each) => (
              <ToggleGroupItem key={each.id} value={each.id} className={PICKED}>
                {each.label}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : null}
      </div>
      <div
        role="radiogroup"
        aria-label="Model"
        className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto overscroll-contain px-4 py-2 md:px-0"
      >
        {noKeys ? (
          <p className="pt-2 text-xs text-muted-foreground">
            Add a key under Keys to see its provider's models.
          </p>
        ) : null}
        {groups.length ? null : (
          <p className="py-6 text-center text-sm text-muted-foreground">No model matches.</p>
        )}
        {groups.map((group) => (
          <section key={group.id} className="flex flex-col gap-1">
            <h3 className="mt-2 flex items-baseline justify-between gap-2 text-xs font-medium tracking-wide text-muted-foreground uppercase">
              Via {group.label}
              {keys != null && !(group.id in keys) ? (
                <span className="font-normal tracking-normal normal-case">No key yet</span>
              ) : null}
            </h3>
            {group.recommended.map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                via={group.label}
                choice={choice}
                onPick={pick}
              />
            ))}
            {group.untested.length ? (
              <h4 className="mt-2 px-3 text-xs text-muted-foreground">
                Not tested with VO2: chat or plan writing may fail on some.
              </h4>
            ) : null}
            {group.untested.map((model) => (
              <ModelOption
                key={model.id}
                model={model}
                via={group.label}
                choice={choice}
                onPick={pick}
              />
            ))}
          </section>
        ))}
      </div>
      <div className="flex flex-col gap-2 border-t px-4 pt-3 pb-[max(1rem,env(safe-area-inset-bottom))] md:px-0 md:pb-0">
        <span className="text-xs font-medium" id={`reasoning-${feature.id}`}>
          Reasoning
        </span>
        {listed && listed.reasoning.length ? (
          <ToggleGroup
            aria-labelledby={`reasoning-${feature.id}`}
            value={[choice.reasoning ?? "auto"]}
            onValueChange={(next) => {
              const value = next[0];
              if (!value) return;
              const level = listed.reasoning.find((each) => each === value) ?? null;
              onPick({ ...choice, reasoning: level });
            }}
            variant="outline"
            size="sm"
            className="flex-wrap"
          >
            <ToggleGroupItem value="auto" className={PICKED}>
              Auto
            </ToggleGroupItem>
            {listed.reasoning.map((level) => (
              <ToggleGroupItem key={level} value={level} className={PICKED}>
                {REASONING_LABELS[level]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        ) : (
          <p className="text-xs text-muted-foreground">
            This model doesn't take a reasoning level.
          </p>
        )}
        <p className="text-xs text-muted-foreground">
          Auto leaves it to the model. Higher levels think longer and cost more, which helps plan
          writing most.
        </p>
      </div>
    </>
  );
}

function ModelOption({
  model,
  via,
  choice,
  onPick,
}: {
  model: CoachModelOption;
  via: string;
  choice: CoachModelChoice;
  onPick: (model: CoachModelOption) => void;
}) {
  const selected = model.provider === choice.provider && model.id === choice.model;
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      aria-label={`${model.label} via ${via}`}
      onClick={() => onPick(model)}
      className={cn(
        "flex min-h-12 items-center gap-3 rounded-lg border border-transparent px-3 py-2 text-left transition-colors hover:bg-muted/60 focus-visible:ring-3 focus-visible:ring-ring/50 focus-visible:outline-none",
        selected && "border-foreground/80 bg-muted",
      )}
    >
      <span className="flex min-w-0 flex-1 flex-col">
        <span className="truncate text-sm font-medium">{model.label}</span>
        <span className="text-xs text-muted-foreground">{model.hint}</span>
      </span>
      {selected ? <CheckIcon className="size-4 shrink-0" /> : null}
    </button>
  );
}

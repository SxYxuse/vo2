"use client";

import { useEffect } from "react";
import { zodResolver } from "@hookform/resolvers/zod";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConicalIcon } from "lucide-react";
import { Controller, useForm } from "react-hook-form";

import {
  activityDetailQueryOptions,
  assessmentsQueryOptions,
  fitnessQueryOptions,
  heartRateQueryOptions,
  homeQueryOptions,
} from "@/lib/queries.ts";
import {
  activityTestFlagFormSchema,
  flagActivityTest,
  formatAssessmentResult,
  testsForSportType,
  type ActivityTestFlagFormValues,
  type AssessmentId,
} from "@/services/assessments.ts";
import type { ActivityDetail } from "@/services/activity-detail.ts";
import { Button } from "@/components/ui/button";
import { Field, FieldDescription, FieldError, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Select,
  SelectContent,
  SelectGroup,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Spinner } from "@/components/ui/spinner";

function isAssessmentId(value: string): value is AssessmentId {
  return value === "ftp-20" || value === "beep-test" || value === "run-lthr";
}

function assessmentFormId(value: string): ActivityTestFlagFormValues["assessmentId"] {
  return isAssessmentId(value) ? value : "none";
}

function flagPayload(activityId: string, values: ActivityTestFlagFormValues) {
  const assessmentId = isAssessmentId(values.assessmentId) ? values.assessmentId : null;
  return {
    activityId,
    assessmentId,
    lastStage: assessmentId === "beep-test" ? Number(values.lastStage) : null,
  };
}

export function ActivityTestFlag({ detail }: { detail: ActivityDetail }) {
  const queryClient = useQueryClient();
  const options = testsForSportType(detail.sportType);
  const flagged = assessmentFormId(detail.fieldTest?.assessmentId ?? "none");
  const form = useForm<ActivityTestFlagFormValues>({
    resolver: zodResolver(activityTestFlagFormSchema),
    defaultValues: {
      assessmentId: flagged,
      lastStage:
        detail.fieldTest?.result.lastStage != null ? String(detail.fieldTest.result.lastStage) : "",
    },
    mode: "onSubmit",
    reValidateMode: "onChange",
  });

  useEffect(() => {
    form.reset({
      assessmentId: assessmentFormId(detail.fieldTest?.assessmentId ?? "none"),
      lastStage:
        detail.fieldTest?.result.lastStage != null ? String(detail.fieldTest.result.lastStage) : "",
    });
  }, [detail.fieldTest, form]);

  const flag = useMutation({
    mutationFn: flagActivityTest,
    onSuccess: (saved) => {
      queryClient.setQueryData(activityDetailQueryOptions(detail.id).queryKey, (current) =>
        current ? { ...current, fieldTest: saved } : current,
      );
      void queryClient.invalidateQueries({
        queryKey: activityDetailQueryOptions(detail.id).queryKey,
      });
      void queryClient.invalidateQueries({ queryKey: assessmentsQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: fitnessQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: heartRateQueryOptions.queryKey });
    },
  });

  if (!options.length) return null;

  const selected = isAssessmentId(flagged) ? flagged : null;
  const showStage = selected === "beep-test";

  return (
    <form
      noValidate
      className="contents"
      onSubmit={form.handleSubmit((values: ActivityTestFlagFormValues) => {
        flag.mutate({ data: flagPayload(detail.id, values) });
      })}
    >
      <FieldGroup className="rounded-lg border p-3">
        <Controller
          name="assessmentId"
          control={form.control}
          render={({ field, fieldState }) => (
            <Field data-invalid={fieldState.invalid}>
              <FieldLabel htmlFor={`activity-test-${detail.id}`}>Field test</FieldLabel>
              <Select
                value={field.value}
                disabled={flag.isPending}
                onValueChange={(next) => {
                  if (next == null) return;
                  field.onChange(next);
                  const assessmentId = isAssessmentId(next) ? next : null;
                  flag.mutate({
                    data: {
                      activityId: detail.id,
                      assessmentId,
                      lastStage:
                        assessmentId === "beep-test" && form.getValues("lastStage")
                          ? Number(form.getValues("lastStage"))
                          : null,
                    },
                  });
                }}
              >
                <SelectTrigger
                  id={`activity-test-${detail.id}`}
                  className="w-full sm:w-64"
                  aria-invalid={fieldState.invalid}
                >
                  {flag.isPending ? (
                    <Spinner data-icon="inline-start" />
                  ) : (
                    <FlaskConicalIcon data-icon="inline-start" />
                  )}
                  <SelectValue>
                    {selected ? options.find((test) => test.id === selected)?.title : "Not a test"}
                  </SelectValue>
                </SelectTrigger>
                <SelectContent>
                  <SelectGroup>
                    <SelectItem value="none">Not a test</SelectItem>
                    {options.map((test) => (
                      <SelectItem key={test.id} value={test.id}>
                        {test.title}
                      </SelectItem>
                    ))}
                  </SelectGroup>
                </SelectContent>
              </Select>
              <FieldDescription>
                Flag this activity as a protocol for this sport. Results are stored so you can
                compare tests over time — you do not need to rename it on Strava.
              </FieldDescription>
              {fieldState.invalid ? <FieldError errors={[fieldState.error]} /> : null}
            </Field>
          )}
        />
        {showStage ? (
          <Controller
            name="lastStage"
            control={form.control}
            render={({ field, fieldState }) => (
              <Field data-invalid={fieldState.invalid}>
                <FieldLabel htmlFor={`activity-test-stage-${detail.id}`}>
                  Last completed stage
                </FieldLabel>
                <div className="flex flex-wrap items-center gap-2">
                  <Input
                    id={`activity-test-stage-${detail.id}`}
                    type="number"
                    inputMode="decimal"
                    min={1}
                    max={21}
                    step="0.5"
                    className="w-28"
                    placeholder="11"
                    name={field.name}
                    value={field.value}
                    aria-invalid={fieldState.invalid}
                    onBlur={field.onBlur}
                    onChange={field.onChange}
                    ref={field.ref}
                  />
                  <Button type="submit" variant="outline" size="sm" disabled={flag.isPending}>
                    {flag.isPending ? <Spinner data-icon="inline-start" /> : null}
                    Save stage
                  </Button>
                </div>
                {fieldState.invalid ? (
                  <FieldError errors={[fieldState.error]} />
                ) : (
                  <FieldDescription>
                    Used to estimate VO2max. Peak HR still comes from the recording.
                  </FieldDescription>
                )}
              </Field>
            )}
          />
        ) : null}
        {selected && detail.fieldTest ? (
          <p className="text-sm">{formatAssessmentResult(selected, detail.fieldTest.result)}</p>
        ) : null}
        {flag.error ? (
          <p className="text-destructive text-xs">
            {flag.error instanceof Error ? flag.error.message : "Could not save the test flag."}
          </p>
        ) : null}
      </FieldGroup>
    </form>
  );
}

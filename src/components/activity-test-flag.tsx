"use client";

import { useEffect, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { FlaskConicalIcon } from "lucide-react";

import { assessmentsQueryOptions, activityDetailQueryOptions, heartRateQueryOptions, homeQueryOptions } from "#/lib/queries.ts";
import {
  flagActivityTest,
  formatAssessmentResult,
  testsForSportType,
  type AssessmentId,
} from "#/services/assessments.ts";
import type { ActivityDetail } from "#/services/activity-detail.ts";
import { Button } from "@/components/ui/button";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
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

export function ActivityTestFlag({ detail }: { detail: ActivityDetail }) {
  const queryClient = useQueryClient();
  const options = testsForSportType(detail.sportType);
  const flagged = detail.fieldTest?.assessmentId ?? "none";
  const [stage, setStage] = useState(
    detail.fieldTest?.result.lastStage != null ? String(detail.fieldTest.result.lastStage) : "",
  );

  useEffect(() => {
    setStage(detail.fieldTest?.result.lastStage != null ? String(detail.fieldTest.result.lastStage) : "");
  }, [detail.fieldTest]);

  const flag = useMutation({
    mutationFn: flagActivityTest,
    onSuccess: (saved) => {
      queryClient.setQueryData(activityDetailQueryOptions(detail.id).queryKey, (current) =>
        current ? { ...current, fieldTest: saved } : current,
      );
      void queryClient.invalidateQueries({ queryKey: activityDetailQueryOptions(detail.id).queryKey });
      void queryClient.invalidateQueries({ queryKey: assessmentsQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: homeQueryOptions.queryKey });
      void queryClient.invalidateQueries({ queryKey: heartRateQueryOptions.queryKey });
    },
  });

  if (!options.length) return null;

  const selected = isAssessmentId(flagged) ? flagged : null;
  const showStage = selected === "beep-test";

  return (
    <FieldGroup className="rounded-lg border p-3">
      <Field>
        <FieldLabel htmlFor={`activity-test-${detail.id}`}>Field test</FieldLabel>
        <Select
          value={flagged}
          disabled={flag.isPending}
          onValueChange={(next) => {
            if (next == null) return;
            const assessmentId = isAssessmentId(next) ? next : null;
            flag.mutate({
              data: {
                activityId: detail.id,
                assessmentId,
                lastStage: assessmentId === "beep-test" && stage ? Number(stage) : null,
              },
            });
          }}
        >
          <SelectTrigger id={`activity-test-${detail.id}`} className="w-full sm:w-64">
            {flag.isPending ? <Spinner data-icon="inline-start" /> : <FlaskConicalIcon data-icon="inline-start" />}
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
          Flag this activity as a protocol for this sport. Results are stored so you can compare
          tests over time — you do not need to rename it on Strava.
        </FieldDescription>
      </Field>
      {showStage ? (
        <Field>
          <FieldLabel htmlFor={`activity-test-stage-${detail.id}`}>Last completed stage</FieldLabel>
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
              value={stage}
              onChange={(event) => setStage(event.currentTarget.value)}
            />
            <Button
              type="button"
              variant="outline"
              size="sm"
              disabled={flag.isPending || !stage}
              onClick={() =>
                flag.mutate({
                  data: {
                    activityId: detail.id,
                    assessmentId: "beep-test",
                    lastStage: Number(stage),
                  },
                })
              }
            >
              {flag.isPending ? <Spinner data-icon="inline-start" /> : null}
              Save stage
            </Button>
          </div>
          <FieldDescription>Used to estimate VO2max. Peak HR still comes from the recording.</FieldDescription>
        </Field>
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
  );
}

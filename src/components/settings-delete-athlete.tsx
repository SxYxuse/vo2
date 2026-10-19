import { useState } from "react";
import { useMutation } from "@tanstack/react-query";

import { useSignOut } from "@/hooks/use-sign-out.ts";
import { deleteCurrentAthlete } from "@/services/athlete-deletion.ts";
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
import { Button } from "@/components/ui/button";
import { FieldDescription, FieldLegend, FieldSet } from "@/components/ui/field";
import { Spinner } from "@/components/ui/spinner";

export function SettingsDeleteAthlete() {
  const [open, setOpen] = useState(false);
  const signOut = useSignOut();
  const deletion = useMutation({
    mutationFn: () => deleteCurrentAthlete(),
    onSuccess: () => signOut({ ignoreBlocker: true }),
  });

  return (
    <FieldSet className="gap-3">
      <FieldLegend>Danger zone</FieldLegend>
      <FieldDescription>
        Permanently delete your VO2 data and disconnect VO2 from Strava. Your activities stay on
        Strava.
      </FieldDescription>
      <Button
        type="button"
        variant="destructive"
        className="self-start"
        onClick={() => setOpen(true)}
      >
        Delete my VO2 data
      </Button>
      <AlertDialog
        open={open}
        onOpenChange={(next) => {
          if (!deletion.isPending) setOpen(next);
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Delete your VO2 data?</AlertDialogTitle>
            <AlertDialogDescription>
              This removes your copied activities and streams, analyses, training plan, planned
              sessions, and settings, and disconnects VO2 from Strava. It cannot be undone.
            </AlertDialogDescription>
          </AlertDialogHeader>
          {deletion.isError ? (
            <p className="text-destructive text-xs">Could not delete your data. Try again.</p>
          ) : null}
          <AlertDialogFooter>
            <AlertDialogCancel disabled={deletion.isPending}>Cancel</AlertDialogCancel>
            <AlertDialogAction
              variant="destructive"
              disabled={deletion.isPending}
              onClick={() => deletion.mutate()}
            >
              {deletion.isPending ? <Spinner data-icon="inline-start" /> : null}
              Delete everything
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </FieldSet>
  );
}

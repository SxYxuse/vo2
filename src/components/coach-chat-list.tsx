import { useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { Link, useNavigate } from "@tanstack/react-router";
import { formatDistanceToNowStrict } from "date-fns";
import { HistoryIcon, MessagesSquareIcon, Trash2Icon } from "lucide-react";

import { useOnline } from "@/hooks/use-online.ts";
import { coachChatQueryKey, coachChatsQueryOptions } from "@/lib/queries.ts";
import { deleteCoachChat, type CoachChatSummary } from "@/services/coach-chats.ts";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
  AlertDialogTrigger,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Item, ItemActions, ItemContent, ItemDescription, ItemTitle } from "@/components/ui/item";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";

function DeleteChatButton({ chat, current }: { chat: CoachChatSummary; current: boolean }) {
  const [open, setOpen] = useState(false);
  const online = useOnline();
  const queryClient = useQueryClient();
  const navigate = useNavigate();
  const remove = useMutation({
    mutationFn: () => deleteCoachChat({ data: { id: chat.id } }),
    onSuccess: async () => {
      setOpen(false);
      queryClient.removeQueries({ queryKey: coachChatQueryKey(chat.id) });
      // The open chat is gone: start a new one in its place.
      if (current) await navigate({ to: "/coach", search: {}, replace: true });
      await queryClient.invalidateQueries({ queryKey: coachChatsQueryOptions.queryKey });
    },
  });
  return (
    <AlertDialog open={open} onOpenChange={setOpen}>
      <AlertDialogTrigger
        render={
          <Button
            variant="ghost"
            size="icon"
            className="size-11 sm:size-8"
            disabled={!online}
            aria-label={`Delete “${chat.title}”`}
          />
        }
      >
        <Trash2Icon />
      </AlertDialogTrigger>
      <AlertDialogContent>
        <AlertDialogHeader>
          <AlertDialogTitle>Delete this chat?</AlertDialogTitle>
          <AlertDialogDescription>
            “{chat.title}” is deleted on every device. It cannot be undone.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <AlertDialogFooter>
          <AlertDialogCancel>Cancel</AlertDialogCancel>
          <AlertDialogAction
            variant="destructive"
            disabled={remove.isPending}
            onClick={() => remove.mutate()}
          >
            Delete
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}

/** Every chat the athlete had with the coach, to reopen or delete. */
export function CoachChatList({ currentId }: { currentId: string }) {
  const [open, setOpen] = useState(false);
  const queryClient = useQueryClient();
  const { data: chats, isPending } = useQuery(coachChatsQueryOptions);
  return (
    <Sheet
      open={open}
      onOpenChange={(next) => {
        // Another device may have added or deleted a chat since the list was last read.
        if (next) void queryClient.invalidateQueries({ queryKey: coachChatsQueryOptions.queryKey });
        setOpen(next);
      }}
    >
      {/* Icon-only and 44px on phones, where the header is narrow. */}
      <SheetTrigger
        render={<Button variant="ghost" size="sm" className="max-sm:size-11 max-sm:px-0" />}
      >
        <HistoryIcon />
        <span className="max-sm:sr-only">Chats</span>
      </SheetTrigger>
      <SheetContent className="pb-[env(safe-area-inset-bottom)]">
        <SheetHeader className="pt-[max(1.5rem,env(safe-area-inset-top))]">
          <SheetTitle>Chats</SheetTitle>
          <SheetDescription>Your chats with the coach, on every device.</SheetDescription>
        </SheetHeader>
        <div className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto px-3 pb-3">
          {isPending ? (
            Array.from({ length: 4 }, (_, index) => (
              <Skeleton key={index} className="h-14 w-full" />
            ))
          ) : !chats?.length ? (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <MessagesSquareIcon />
                </EmptyMedia>
                <EmptyTitle>No chats yet</EmptyTitle>
                <EmptyDescription>
                  Ask the coach something and the chat shows here.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            chats.map((chat) => (
              <Item
                key={chat.id}
                size="sm"
                variant={chat.id === currentId ? "muted" : "default"}
                className="relative flex-nowrap pr-1 hover:bg-muted"
              >
                <ItemContent className="min-w-0">
                  <Link
                    to="/coach"
                    search={{ thread: chat.id }}
                    className="after:absolute after:inset-0"
                    aria-current={chat.id === currentId ? "page" : undefined}
                    onClick={() => setOpen(false)}
                  >
                    <ItemTitle className="line-clamp-2">{chat.title}</ItemTitle>
                  </Link>
                  <ItemDescription>
                    {/* A device clock behind the server's would read "in 1 minute". */}
                    {formatDistanceToNowStrict(Math.min(Date.parse(chat.updatedAt), Date.now()), {
                      addSuffix: true,
                    })}
                  </ItemDescription>
                </ItemContent>
                <ItemActions className="relative z-10">
                  <DeleteChatButton chat={chat} current={chat.id === currentId} />
                </ItemActions>
              </Item>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}

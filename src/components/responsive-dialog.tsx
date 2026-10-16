"use client";

import { createContext, use, type ComponentProps, type ReactNode } from "react";
import { cn } from "cn";

import { useIsDesktop } from "#/hooks/use-desktop-media.ts";
import {
  Dialog,
  DialogClose,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Drawer,
  DrawerClose,
  DrawerContent,
  DrawerDescription,
  DrawerFooter,
  DrawerHeader,
  DrawerTitle,
} from "@/components/ui/drawer";

export {
  DESKTOP_MQ,
  readIsDesktop,
  useDesktopMedia,
  useIsDesktop,
} from "#/hooks/use-desktop-media.ts";

const desktopOverlay = {
  Content: DialogContent,
  Header: DialogHeader,
  Footer: DialogFooter,
  Title: DialogTitle,
  Description: DialogDescription,
  Close: DialogClose,
};

const mobileOverlay = {
  Content: DrawerContent,
  Header: DrawerHeader,
  Footer: DrawerFooter,
  Title: DrawerTitle,
  Description: DrawerDescription,
  Close: DrawerClose,
};

type OverlayParts = typeof desktopOverlay | typeof mobileOverlay;

const OverlayContext = createContext<OverlayParts | null>(null);

function useOverlay() {
  const overlay = use(OverlayContext);
  if (!overlay) {
    throw new Error("ResponsiveDialog parts must be used inside ResponsiveDialog");
  }
  return overlay;
}

type OverlayRootProps = {
  open?: boolean;
  onOpenChange?: (open: boolean, details?: { cancel?: () => void }) => void;
  children?: ReactNode;
  disablePointerDismissal?: boolean;
};

export function ResponsiveDialog({
  children,
  disablePointerDismissal,
  ...props
}: OverlayRootProps) {
  const isDesktop = useIsDesktop();
  const overlay = isDesktop ? desktopOverlay : mobileOverlay;

  return (
    <OverlayContext value={overlay}>
      {isDesktop ? (
        <Dialog {...props}>{children}</Dialog>
      ) : (
        <Drawer
          showSwipeHandle
          swipeDirection="down"
          disablePointerDismissal={disablePointerDismissal}
          {...props}
        >
          {children}
        </Drawer>
      )}
    </OverlayContext>
  );
}

export function ResponsiveDialogContent({
  className,
  children,
  showCloseButton,
  ...props
}: ComponentProps<typeof DialogContent>) {
  const Overlay = useOverlay();
  if (Overlay.Content === DialogContent) {
    return (
      <DialogContent className={className} showCloseButton={showCloseButton} {...props}>
        {children}
      </DialogContent>
    );
  }
  return (
    <DrawerContent
      className={cn(
        className,
        // Shared `w-full` is for the desktop dialog. On a vertical drawer it
        // over-constrains inset-x-0 + --drawer-inset so `right` is ignored and
        // the right border clips.
        "w-auto!",
      )}
    >
      {children}
    </DrawerContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }: ComponentProps<"div">) {
  const Overlay = useOverlay();
  return <Overlay.Header className={className} {...props} />;
}

export function ResponsiveDialogFooter({
  className,
  ...props
}: ComponentProps<typeof DialogFooter>) {
  const Overlay = useOverlay();
  return (
    <Overlay.Footer
      className={cn("pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)}
      {...props}
    />
  );
}

export function ResponsiveDialogTitle({ className, ...props }: ComponentProps<typeof DialogTitle>) {
  const Overlay = useOverlay();
  return <Overlay.Title className={className} {...props} />;
}

export function ResponsiveDialogDescription({
  className,
  ...props
}: ComponentProps<typeof DialogDescription>) {
  const Overlay = useOverlay();
  return <Overlay.Description className={className} {...props} />;
}

export function ResponsiveDialogClose({ ...props }: ComponentProps<typeof DialogClose>) {
  const Overlay = useOverlay();
  return <Overlay.Close {...props} />;
}

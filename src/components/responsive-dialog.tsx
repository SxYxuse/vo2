"use client";

import * as React from "react";
import { cn } from "cn";

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

const DESKTOP_MQ = "(min-width: 768px)";

export function readIsDesktop() {
  return typeof window !== "undefined" && window.matchMedia(DESKTOP_MQ).matches;
}

export function useIsDesktop() {
  const [isDesktop, setIsDesktop] = React.useState(readIsDesktop);

  React.useEffect(() => {
    const mql = window.matchMedia(DESKTOP_MQ);
    const onChange = () => setIsDesktop(mql.matches);
    onChange();
    mql.addEventListener("change", onChange);
    return () => mql.removeEventListener("change", onChange);
  }, []);

  return isDesktop;
}

const DesktopContext = React.createContext(false);

type OverlayRootProps = {
  open?: boolean;
  onOpenChange?: (open: boolean, details?: { cancel?: () => void }) => void;
  children?: React.ReactNode;
  disablePointerDismissal?: boolean;
};

export function ResponsiveDialog({
  children,
  disablePointerDismissal,
  ...props
}: OverlayRootProps) {
  const isDesktop = useIsDesktop();

  return (
    <DesktopContext.Provider value={isDesktop}>
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
    </DesktopContext.Provider>
  );
}

export function ResponsiveDialogContent({
  className,
  children,
  showCloseButton,
  ...props
}: React.ComponentProps<typeof DialogContent>) {
  const isDesktop = React.useContext(DesktopContext);
  if (isDesktop) {
    return (
      <DialogContent className={className} showCloseButton={showCloseButton} {...props}>
        {children}
      </DialogContent>
    );
  }
  return (
    <DrawerContent
      className={cn(
        "max-h-[calc(100dvh-0.75rem)] data-[swipe-axis=y]:[--drawer-content-max-height:calc(100dvh-0.75rem)]",
        className,
      )}
    >
      {children}
    </DrawerContent>
  );
}

export function ResponsiveDialogHeader({ className, ...props }: React.ComponentProps<"div">) {
  const isDesktop = React.useContext(DesktopContext);
  const Comp = isDesktop ? DialogHeader : DrawerHeader;
  return <Comp className={className} {...props} />;
}

export function ResponsiveDialogFooter({
  className,
  ...props
}: React.ComponentProps<typeof DialogFooter>) {
  const isDesktop = React.useContext(DesktopContext);
  const Comp = isDesktop ? DialogFooter : DrawerFooter;
  return (
    <Comp className={cn("pb-[max(0.75rem,env(safe-area-inset-bottom))]", className)} {...props} />
  );
}

export function ResponsiveDialogTitle({
  className,
  ...props
}: React.ComponentProps<typeof DialogTitle>) {
  const isDesktop = React.useContext(DesktopContext);
  const Comp = isDesktop ? DialogTitle : DrawerTitle;
  return <Comp className={className} {...props} />;
}

export function ResponsiveDialogDescription({
  className,
  ...props
}: React.ComponentProps<typeof DialogDescription>) {
  const isDesktop = React.useContext(DesktopContext);
  const Comp = isDesktop ? DialogDescription : DrawerDescription;
  return <Comp className={className} {...props} />;
}

export function ResponsiveDialogClose({ ...props }: React.ComponentProps<typeof DialogClose>) {
  const isDesktop = React.useContext(DesktopContext);
  const Comp = isDesktop ? DialogClose : DrawerClose;
  return <Comp {...props} />;
}

"use client";

import * as DialogPrimitive from "@radix-ui/react-dialog";
import * as PopoverPrimitive from "@radix-ui/react-popover";
import * as TooltipPrimitive from "@radix-ui/react-tooltip";
import { forwardRef, type ComponentPropsWithoutRef, type ElementRef, type ReactNode } from "react";

export function cn(...values: (string | false | null | undefined)[]): string {
  return values.filter(Boolean).join(" ");
}

const BASE =
  "inline-flex shrink-0 items-center justify-center gap-2 whitespace-nowrap text-sm font-medium outline-none transition-[background-color,color,border-color,opacity] duration-150 ease-out focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-bg disabled:pointer-events-none disabled:opacity-45 [&_svg]:pointer-events-none [&_svg]:shrink-0";

export const button = {
  primary: `${BASE} h-9 px-4 bg-ink text-ink-fg shadow-xs hover:bg-ink/88`,
  outline: `${BASE} h-9 px-4 border border-input bg-bg shadow-xs hover:border-line-strong hover:bg-hover`,
  ghost: `${BASE} text-muted hover:bg-hover hover:text-fg`,
  /** Ghost without a text colour, for rows that set their own. */
  plain: `${BASE} hover:bg-hover`,
  icon: `${BASE} size-8`,
  primaryIcon: `${BASE} size-8 bg-ink text-ink-fg shadow-xs hover:bg-ink/88`,
  outlineIcon: `${BASE} size-8 border border-input bg-bg shadow-xs hover:border-line-strong hover:bg-hover`,
};

export function TooltipProvider({ children }: { children: ReactNode }) {
  return (
    <TooltipPrimitive.Provider delayDuration={120} skipDelayDuration={300} disableHoverableContent>
      {children}
    </TooltipPrimitive.Provider>
  );
}

/** A label that appears on hover and focus. */
export function Tip({ label, children, side }: { label: ReactNode; children: ReactNode; side?: "top" | "bottom" | "left" | "right" }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side={side}
          sideOffset={6}
          className="z-[70] border border-line bg-pop px-2 py-1 text-xs text-fg shadow-md transition-opacity duration-150 data-[state=closed]:opacity-0"
        >
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const Dialog = DialogPrimitive.Root;
export const DialogClose = DialogPrimitive.Close;
export const DialogTitle = DialogPrimitive.Title;
export const DialogDescription = DialogPrimitive.Description;

export const DialogContent = forwardRef<
  ElementRef<typeof DialogPrimitive.Content>,
  ComponentPropsWithoutRef<typeof DialogPrimitive.Content>
>(({ className, children, ...props }, ref) => (
  <DialogPrimitive.Portal>
    <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/45" />
    <DialogPrimitive.Content
      ref={ref}
      // Focus the dialog itself: opening it with the keyboard would otherwise ring a button.
      onOpenAutoFocus={(event) => { event.preventDefault(); (event.currentTarget as HTMLElement).focus(); }}
      className={cn(
        className?.includes("max-w-") ? "" : "max-w-sm",
        "fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 border border-line bg-bg p-6 text-fg shadow-lg outline-none",
        className,
      )}
      {...props}
    >
      {children}
    </DialogPrimitive.Content>
  </DialogPrimitive.Portal>
));
DialogContent.displayName = "DialogContent";

export const Popover = PopoverPrimitive.Root;
export const PopoverTrigger = PopoverPrimitive.Trigger;

export const PopoverContent = forwardRef<
  ElementRef<typeof PopoverPrimitive.Content>,
  ComponentPropsWithoutRef<typeof PopoverPrimitive.Content>
>(({ className, align = "center", sideOffset = 8, ...props }, ref) => (
  <PopoverPrimitive.Portal>
    <PopoverPrimitive.Content
      ref={ref}
      align={align}
      sideOffset={sideOffset}
      className={cn("ta-pop z-50 border border-line bg-pop p-3 text-fg shadow-lg outline-none", className)}
      {...props}
    />
  </PopoverPrimitive.Portal>
));
PopoverContent.displayName = "PopoverContent";

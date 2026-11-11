"use client";

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react";
import { ArrowUp, SmallQuestion, StopSquare } from "./icons";
import { button, Popover, PopoverContent, PopoverTrigger, Tip } from "./ui";

export interface ComposerHandle {
  focus: () => void;
  setValue: (value: string) => void;
}

export type Quota =
  | { kind: "hidden" }
  | { kind: "signed-out" }
  | { kind: "left"; left: number };

const HELP = "grid size-4 place-items-center outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring";

/** The small bordered pill above the composer: "3 free prompts left ?". */
function QuotaPill({ quota, model, onSignIn }: { quota: Quota; model: string; onSignIn: () => void }) {
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  if (quota.kind === "hidden") return null;
  const show = () => { window.clearTimeout(closing.current); setOpen(true); };
  const hide = () => { closing.current = window.setTimeout(() => setOpen(false), 150); };
  const left = quota.kind === "signed-out" ? 3 : quota.left;
  const text = left === 0 ? "Free prompts are used." : `${left} free ${left === 1 ? "prompt" : "prompts"} left`;
  return (
    <p role="status" className="absolute bottom-full right-2 mb-2 flex items-center gap-1.5 border border-line bg-bg py-1 pl-2 pr-1.5 text-xs leading-4 text-muted sm:right-3">
      {text}
      {quota.kind === "signed-out" ? (
        // The help carries a link, so it opens as a popover the pointer can reach.
        <Popover open={open} onOpenChange={setOpen}>
          <PopoverTrigger asChild>
            <button type="button" aria-label="about free prompts" onPointerEnter={show} onPointerLeave={hide} className={HELP}>
              <SmallQuestion />
            </button>
          </PopoverTrigger>
          <PopoverContent side="top" sideOffset={6} onOpenAutoFocus={(event) => event.preventDefault()} onPointerEnter={show} onPointerLeave={hide}
            className="w-auto px-2 py-1 text-xs leading-5 shadow-md">
            Runs {model}.{" "}
            <button type="button" onClick={() => { setOpen(false); onSignIn(); }} className="text-fg underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring">
              Sign in
            </button>{" "}
            with your Radian account.
          </PopoverContent>
        </Popover>
      ) : left > 0 ? (
        <Tip label={`Runs ${model}. One prompt is one design run.`}>
          <button type="button" aria-label={`Runs ${model}. One prompt is one design run.`} className={HELP}><SmallQuestion /></button>
        </Tip>
      ) : null}
    </p>
  );
}

const Composer = forwardRef<ComposerHandle, {
  busy: boolean;
  model: string;
  quota: Quota;
  onSend: (text: string) => Promise<boolean>;
  onStop: () => void;
  onSignIn: () => void;
}>(function Composer({ busy, model, quota, onSend, onStop, onSignIn }, ref) {
  const [value, setValue] = useState("");
  const area = useRef<HTMLTextAreaElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setValue: (next) => { setValue(next); requestAnimationFrame(() => area.current?.focus()); },
  }), []);

  // The prompt grows with its text, from 64px up to a third of the screen.
  useEffect(() => {
    const element = area.current;
    if (!element) return;
    element.style.height = "auto";
    element.style.height = `${Math.min(Math.max(element.scrollHeight, 64), Math.round(window.innerHeight / 3))}px`;
    element.style.overflowY = element.scrollHeight > window.innerHeight / 3 ? "auto" : "hidden";
  }, [value]);

  useEffect(() => {
    if (!window.matchMedia("(pointer: coarse)").matches) area.current?.focus({ preventScroll: true });
  }, []);

  async function submit() {
    const text = value.trim();
    if (!text || busy) return;
    // Cleared only once it is really sent; a sign-in or an error keeps the draft.
    if (await onSend(text)) setValue("");
  }

  return (
    <div className="relative border-t border-line bg-bg px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:pb-2">
      <QuotaPill quota={quota} model={model} onSignIn={onSignIn} />
      <div className="mx-auto max-w-2xl">
        <label htmlFor="prompt-input" className="sr-only">Message</label>
        <textarea
          ref={area}
          id="prompt-input"
          name="prompt"
          rows={1}
          autoComplete="off"
          value={value}
          placeholder="ask TinyAgent to design"
          onChange={(event) => setValue(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="flex min-h-16 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-5 outline-none placeholder:text-muted"
        />
        <div className="flex min-w-0 items-center gap-1 px-2 pb-2 pt-1">
          <button type="button" disabled aria-label={`Model: ${model}`} className={`${button.ghost} h-8 min-w-0 max-w-44 flex-1 justify-start px-2 font-normal`}>
            <span className="truncate">{model}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {busy && (
              <Tip label="stop">
                <button type="button" aria-label="stop the current run" onClick={onStop} className={button.outlineIcon}>
                  <StopSquare />
                </button>
              </Tip>
            )}
            <Tip label="Send message">
              <button
                type="button"
                aria-label="Send message"
                disabled={!value.trim() || busy}
                onClick={() => void submit()}
                className={button.primaryIcon}
              >
                <ArrowUp />
              </button>
            </Tip>
          </div>
        </div>
      </div>
    </div>
  );
});

export default Composer;

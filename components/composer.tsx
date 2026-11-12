"use client";

import { forwardRef, useCallback, useEffect, useImperativeHandle, useRef, useState } from "react";
import { MAX_IMAGES, normalizeImage, type AttachedImage } from "@/lib/client/images";
import { ArrowUp, Close, Paperclip, SmallQuestion, StopSquare } from "./icons";
import { ImageThumb } from "./transcript";
import { button, cn, Popover, PopoverContent, PopoverTrigger, Tip } from "./ui";

export interface ComposerHandle {
  focus: () => void;
  setDraft: (text: string, images?: AttachedImage[]) => void;
}

export type Quota =
  | { kind: "hidden" }
  | { kind: "signed-out"; free: number }
  | { kind: "left"; left: number };

const HELP = "grid size-4 place-items-center outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring";

/** The small bordered pill above the composer: "1 free prompt left ?". */
function QuotaPill({ quota, model, onSignIn }: { quota: Quota; model: string; onSignIn: () => void }) {
  const [open, setOpen] = useState(false);
  const closing = useRef<number | undefined>(undefined);
  if (quota.kind === "hidden") return null;
  const show = () => { window.clearTimeout(closing.current); setOpen(true); };
  const hide = () => { closing.current = window.setTimeout(() => setOpen(false), 150); };
  const left = quota.kind === "signed-out" ? quota.free : quota.left;
  const text = left === 0 ? "Free prompts are used." : `${left} free ${left === 1 ? "prompt" : "prompts"} left`;
  return (
    <p role="status" className="absolute bottom-full right-2 mb-2 flex items-center gap-1.5 border border-line bg-bg py-1 pl-2 pr-1.5 text-xs leading-4 text-muted sm:right-3">
      {text}
      {quota.kind === "signed-out" ? (
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
              Sign in or create
            </button>{" "}
            a Radian account.
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
  /** Another device is running this chat: nothing can be sent here until it ends. */
  locked: boolean;
  stopping: boolean;
  model: string;
  quota: Quota;
  onSend: (text: string, images: AttachedImage[]) => Promise<boolean>;
  onStop: () => void;
  onSignIn: () => void;
}>(function Composer({ busy, locked, stopping, model, quota, onSend, onStop, onSignIn }, ref) {
  const [value, setValue] = useState("");
  const [images, setImages] = useState<AttachedImage[]>([]);
  const [adding, setAdding] = useState(0);
  const [error, setError] = useState("");
  const [dropping, setDropping] = useState(false);
  const area = useRef<HTMLTextAreaElement>(null);
  const fileInput = useRef<HTMLInputElement>(null);

  useImperativeHandle(ref, () => ({
    focus: () => area.current?.focus(),
    setDraft: (text, next) => {
      setValue(text);
      if (next) setImages(next);
      requestAnimationFrame(() => area.current?.focus());
    },
  }), []);

  const addFiles = useCallback(async (files: File[]) => {
    const pictures = files.filter((file) => file.type.startsWith("image/"));
    if (!pictures.length) return;
    setError("");
    const room = MAX_IMAGES - images.length;
    if (room <= 0) return setError(`you can attach up to ${MAX_IMAGES} images.`);
    if (pictures.length > room) setError(`you can attach up to ${MAX_IMAGES} images.`);
    setAdding((count) => count + Math.min(room, pictures.length));
    const results = await Promise.allSettled(pictures.slice(0, room).map((file) => normalizeImage(file)));
    setAdding((count) => Math.max(0, count - Math.min(room, pictures.length)));
    const ready = results.flatMap((result) => result.status === "fulfilled" ? [result.value] : []);
    const failed = results.find((result) => result.status === "rejected") as PromiseRejectedResult | undefined;
    if (failed) setError(failed.reason instanceof Error ? failed.reason.message : "unable to read the image.");
    setImages((current) => [...current, ...ready].slice(0, MAX_IMAGES));
  }, [images.length]);

  const addRef = useRef(addFiles);
  addRef.current = addFiles;

  // Dropping anywhere on the page attaches.
  useEffect(() => {
    const carriesFiles = (event: DragEvent) => event.dataTransfer?.types.includes("Files") ?? false;
    const over = (event: DragEvent) => { if (carriesFiles(event)) { event.preventDefault(); setDropping(true); } };
    const leave = (event: DragEvent) => { if (!event.relatedTarget) setDropping(false); };
    const drop = (event: DragEvent) => {
      if (!carriesFiles(event)) return;
      event.preventDefault();
      setDropping(false);
      void addRef.current(Array.from(event.dataTransfer?.files ?? []));
    };
    document.addEventListener("dragover", over);
    document.addEventListener("dragleave", leave);
    document.addEventListener("drop", drop);
    return () => {
      document.removeEventListener("dragover", over);
      document.removeEventListener("dragleave", leave);
      document.removeEventListener("drop", drop);
    };
  }, []);

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

  const canSend = (value.trim().length > 0 || images.length > 0) && adding === 0 && !locked;

  async function submit() {
    if (!canSend || busy) return;
    const text = value.trim();
    const sent = images;
    // Cleared only once it is really sent; a sign-in or an error keeps the draft.
    if (await onSend(text, sent)) {
      setValue("");
      setImages([]);
      setError("");
    }
  }

  return (
    <div className={cn("relative border-t bg-bg px-2 pb-[max(0.375rem,env(safe-area-inset-bottom))] pt-2 sm:px-3 sm:pb-2", dropping ? "border-fg" : "border-line")}>
      <QuotaPill quota={quota} model={model} onSignIn={onSignIn} />
      <div className="mx-auto max-w-2xl">
        {(images.length > 0 || adding > 0) && (
          <div className="flex flex-wrap items-start gap-3 px-3 pt-3">
            {images.map((image, index) => (
              <div key={`${image.data.slice(-16)}-${index}`} className="relative">
                <ImageThumb src={image.url} alt={`Attached image ${index + 1}`} className="h-auto max-h-14 w-auto max-w-28 outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
                <button
                  type="button"
                  onClick={() => { setImages((current) => current.filter((_, at) => at !== index)); area.current?.focus(); }}
                  aria-label={`Remove attached image ${index + 1}`}
                  className="absolute -right-2 -top-2 grid size-7 place-items-center border border-line bg-pop text-muted shadow-sm outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
                >
                  <Close className="size-3" />
                </button>
              </div>
            ))}
            {Array.from({ length: adding }, (_, index) => (
              <span key={`adding-${index}`} aria-label="preparing image" className="ta-pulse block h-14 w-20 bg-hover" />
            ))}
          </div>
        )}
        <label htmlFor="prompt-input" className="sr-only">Message</label>
        <textarea
          ref={area}
          id="prompt-input"
          name="prompt"
          rows={1}
          autoComplete="off"
          value={value}
          disabled={locked}
          placeholder={locked ? "running on another device…" : "ask TinyAgent for a 3D scene"}
          onChange={(event) => setValue(event.target.value)}
          onPaste={(event) => {
            const files = Array.from(event.clipboardData?.files ?? []).filter((file) => file.type.startsWith("image/"));
            if (files.length) {
              event.preventDefault();
              void addFiles(files);
            }
          }}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              void submit();
            }
          }}
          className="flex min-h-16 w-full resize-none border-0 bg-transparent px-3 py-2.5 text-sm leading-5 outline-none placeholder:text-muted disabled:cursor-not-allowed"
        />
        <div className="flex min-w-0 items-center gap-1 px-2 pb-2 pt-1">
          <input
            ref={fileInput}
            type="file"
            accept="image/png,image/jpeg,image/webp,image/gif"
            multiple
            className="hidden"
            onChange={(event) => {
              void addFiles(Array.from(event.target.files ?? []));
              event.target.value = "";
            }}
          />
          <Tip label="attach images">
            <button
              type="button"
              aria-label="attach images"
              disabled={images.length + adding >= MAX_IMAGES || locked}
              onClick={() => fileInput.current?.click()}
              className={`${button.ghost} ${button.icon}`}
            >
              <Paperclip />
            </button>
          </Tip>
          <button type="button" disabled aria-label={`Model: ${model}`} className={`${button.ghost} h-8 min-w-0 max-w-44 flex-1 justify-start px-2 font-normal`}>
            <span className="truncate">{model}</span>
          </button>
          <div className="ml-auto flex shrink-0 items-center gap-1">
            {/* While a run is active, the send button is the stop button, in the same place. */}
            {busy ? (
              <Tip label={stopping ? "stopping…" : "stop"}>
                <button type="button" aria-label={stopping ? "stopping the run" : "stop the run"} disabled={stopping}
                  onClick={() => { onStop(); area.current?.focus(); }} className={button.primaryIcon}>
                  <StopSquare />
                </button>
              </Tip>
            ) : (
              <Tip label="Send message">
                <button type="button" aria-label="Send message" disabled={!canSend} onClick={() => void submit()} className={button.primaryIcon}>
                  <ArrowUp />
                </button>
              </Tip>
            )}
          </div>
        </div>
      </div>
      {error && <div aria-live="polite" className="min-h-4 px-2 pt-1 text-center text-xs leading-4 text-muted">{error}</div>}
    </div>
  );
});

export default Composer;

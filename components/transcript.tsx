"use client";

import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Entry, ToolRow } from "@/lib/transcript";
import { ArrowRight, Check, ChevronCircle, Copy, Pencil, Pulse } from "./icons";
import { cn, Dialog, DialogContent, DialogTitle } from "./ui";

export const SUGGESTIONS = [
  "Design a Radian starship drifting over Earth — drag it and it swings back on spring physics",
  "Create a launch page for a European cloud",
  "Design a mission control dashboard",
];

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

function formatSize(chars: number): string {
  return chars < 1000 ? `${chars} B` : `${(chars / 1000).toFixed(chars < 10_000 ? 1 : 0)} KB`;
}

const TOOLS: Record<string, { label: string; one: string; many: string }> = {
  publish_design: { label: "publish design", one: "published a design", many: "published designs" },
};
const toolLabel = (name: string) => TOOLS[name]?.label ?? name.replace(/_/g, " ");

const STATUS = {
  running: { label: "running", className: "text-fg-2", dot: "bg-fg-2 ta-pulse" },
  done: { label: "done", className: "text-muted", dot: "bg-line-strong" },
  error: { label: "failed", className: "text-fg", dot: "bg-fg" },
} as const;

function CopyButton({ text }: { text: string }) {
  const [state, setState] = useState<"idle" | "copied" | "error">("idle");
  return (
    <button
      type="button"
      onClick={async () => {
        try { await navigator.clipboard.writeText(text); setState("copied"); } catch { setState("error"); }
        window.setTimeout(() => setState("idle"), 1600);
      }}
      className="flex min-h-8 items-center gap-1.5 px-2 text-xs text-muted outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
    >
      {state === "copied" ? <Check className="size-3" /> : <Copy />}
      {state === "copied" ? "copied" : state === "error" ? "copy failed" : "copy"}
    </button>
  );
}

/** One call, collapsed to a line: status dot, icon, name, what it was called with, time, status. */
function ToolWidget({ row, count = 1 }: { row: ToolRow; count?: number }) {
  const [open, setOpen] = useState(false);
  const detailsId = useId();
  const state = STATUS[row.status];
  const summary = [row.detail, row.bytes != null ? formatSize(row.bytes) : null].filter(Boolean).join(" · ");
  const hasDetails = Boolean(row.output) || row.bytes != null;
  const header = (
    <>
      <span className={`size-1.5 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
      <span className="shrink-0 text-muted"><Pencil size={12} /></span>
      <span className="shrink-0 text-xs font-medium text-fg">{toolLabel(row.name)}{count > 1 && <span className="ml-1 font-normal text-muted">×{count}</span>}</span>
      {summary && <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3">{summary}</code>}
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted">
        {row.rerun && <span title="run again after a reload">rerun</span>}
        {row.durationMs != null && <span>{formatDuration(row.durationMs)}</span>}
        <span role="status" className={`font-medium ${state.className}`}>{state.label}</span>
        {hasDetails && <ChevronCircle open={open} />}
      </span>
    </>
  );
  return (
    <section className="my-1.5 overflow-hidden bg-hover/40">
      {hasDetails ? (
        <button type="button" aria-expanded={open} aria-controls={detailsId} onClick={() => setOpen((value) => !value)}
          className="flex min-h-7 w-full items-center gap-2 px-2 py-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          {header}
        </button>
      ) : (
        <div className="flex min-h-7 items-center gap-2 px-2 py-1">{header}</div>
      )}
      {open && hasDetails && (
        <div id={detailsId} className="border-t border-line bg-soft/70">
          {row.detail && (
            <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-0.5 px-2.5 pt-2 font-mono text-xs leading-5">
              <dt className="text-fg-3">title</dt><dd className="min-w-0 truncate text-fg-2">{row.detail}</dd>
              {row.bytes != null && <><dt className="text-fg-3">html</dt><dd className="text-fg-2">{formatSize(row.bytes)}</dd></>}
            </dl>
          )}
          {row.output && (
            <>
              <div className="flex min-h-8 items-center justify-between px-2.5">
                <span className="text-[11px] text-fg-3">output</span>
                <CopyButton text={row.output} />
              </div>
              <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words px-2.5 pb-2.5 font-mono text-xs leading-5 text-fg-2">{row.output}</pre>
            </>
          )}
        </div>
      )}
    </section>
  );
}

/** Consecutive calls of one tool show as one line; opened, each call is listed. */
function ToolGroup({ rows }: { rows: ToolRow[] }) {
  const [open, setOpen] = useState(false);
  if (rows.length === 1) return <ToolWidget row={rows[0]} />;
  const last = rows.at(-1)!;
  const status = rows.some((row) => row.status === "running") ? "running" : rows.some((row) => row.status === "error") ? "error" : "done";
  const duration = rows.reduce((total, row) => total + (row.durationMs ?? 0), 0);
  const state = STATUS[status];
  return (
    <section className="my-1.5 overflow-hidden bg-hover/40">
      <button type="button" aria-expanded={open} onClick={() => setOpen((value) => !value)}
        className="flex min-h-7 w-full items-center gap-2 px-2 py-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
        <span className={`size-1.5 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
        <span className="shrink-0 text-muted"><Pencil size={12} /></span>
        <span className="shrink-0 text-xs font-medium text-fg">{toolLabel(last.name)} <span className="font-normal text-muted">×{rows.length}</span></span>
        {last.detail && <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3">{last.detail}</code>}
        <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted">
          {duration > 0 && <span>{formatDuration(duration)}</span>}
          <span role="status" className={`font-medium ${state.className}`}>{state.label}</span>
          <ChevronCircle open={open} />
        </span>
      </button>
      {open && <div className="border-t border-line bg-soft/40 px-1 py-0.5">{rows.map((row) => <ToolWidget key={row.key} row={row} />)}</div>}
    </section>
  );
}

function groupRows(rows: ToolRow[]): ToolRow[][] {
  const groups: ToolRow[][] = [];
  for (const row of rows) {
    const last = groups.at(-1);
    if (last && last[0].name === row.name) last.push(row);
    else groups.push([row]);
  }
  return groups;
}

function summary(entry: Extract<Entry, { kind: "activity" }>): string {
  const running = entry.state === "running" || entry.tools.some((tool) => tool.status === "running");
  if (running) {
    const current = entry.tools.findLast((tool) => tool.status === "running");
    const done = [...new Set(entry.tools.filter((tool) => tool.status !== "running").map((tool) => toolLabel(tool.name)))];
    return [current ? toolLabel(current.name) : entry.writing ? "writing" : "thinking", done.join(", ")].filter(Boolean).join(" · ");
  }
  const phrases: string[] = [];
  const byTool = new Map<string, number>();
  for (const tool of entry.tools) byTool.set(tool.name, (byTool.get(tool.name) ?? 0) + 1);
  for (const [name, count] of byTool) phrases.push(count === 1 ? TOOLS[name]?.one ?? `used ${toolLabel(name)}` : TOOLS[name]?.many ?? `used ${toolLabel(name)} ×${count}`);
  if (entry.updates > 0) phrases.push(`${entry.updates} update${entry.updates === 1 ? "" : "s"}`);
  return phrases.join(", ") || "activity";
}

function Activity({ entry }: { entry: Extract<Entry, { kind: "activity" }> }) {
  const running = entry.state === "running";
  const failed = entry.tools.filter((tool) => tool.status === "error").length;
  return (
    <section className="mb-3">
      <div className="flex min-h-8 items-center gap-2 text-xs text-muted">
        <Pulse />
        <span className="min-w-0 flex-1 truncate font-medium">{summary(entry)}</span>
        {running && <span className="shrink-0 text-fg-2">running</span>}
        {entry.state === "interrupted" && <span className="shrink-0 text-fg-2">interrupted</span>}
        {!running && entry.state === "failed" && <span className="shrink-0 text-fg">failed</span>}
        {!running && entry.state !== "failed" && failed > 0 && <span className="shrink-0 text-fg">{failed} failed</span>}
      </div>
      {groupRows(entry.tools).map((rows) => <ToolGroup key={rows[0].key} rows={rows} />)}
    </section>
  );
}

function Markdown({ children }: { children: string }) {
  return (
    <div className="md">
      <ReactMarkdown remarkPlugins={[remarkGfm]} components={{ a: ({ href, children }) => <a href={href} target="_blank" rel="noopener noreferrer">{children}</a> }}>
        {children}
      </ReactMarkdown>
    </div>
  );
}

/** A thumbnail that opens the image larger. */
export function ImageThumb({ src, alt, className }: { src: string; alt: string; className: string }) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <button type="button" aria-label={`View ${alt.toLowerCase()}`} onClick={() => setOpen(true)} className="block cursor-zoom-in outline-none focus-visible:ring-2 focus-visible:ring-ring">
        {/* eslint-disable-next-line @next/next/no-img-element */}
        <img src={src} alt={alt} className={className} />
      </button>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent aria-describedby={undefined} onClick={() => setOpen(false)} className="w-auto max-w-[calc(100vw-2rem)] cursor-zoom-out border-0 bg-transparent p-0 shadow-none">
          <DialogTitle className="sr-only">{alt}</DialogTitle>
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={src} alt={alt} className="h-auto max-h-[calc(100dvh-4rem)] max-w-full object-contain" />
        </DialogContent>
      </Dialog>
    </>
  );
}

export function UserBubble({ text, images = [], pending }: { text: string; images?: string[]; pending?: boolean }) {
  return (
    <div className="mb-4 flex justify-end">
      <div className={cn("max-w-[86%] bg-bubble px-3 py-2 text-sm leading-5 text-bubble-fg sm:max-w-[80%]", pending && "opacity-65")}>
        {text && <span className="whitespace-pre-wrap break-words">{text}</span>}
        {images.length > 0 && (
          <span className={cn("flex flex-wrap gap-2", text && "mt-2")}>
            {images.map((src, index) => (
              <ImageThumb key={index} src={src} alt={`Attached image ${index + 1}`} className="h-auto max-h-20 w-auto max-w-40 outline outline-1 -outline-offset-1 outline-black/10 dark:outline-white/10" />
            ))}
          </span>
        )}
      </div>
    </div>
  );
}

function EventLine({ action, detail, children }: { action: string; detail?: string; children?: React.ReactNode }) {
  return (
    <p className="mb-3 flex items-start gap-2 text-xs leading-5">
      <span className="shrink-0 font-medium text-fg-2">{action}</span>
      {detail && <span className="min-w-0 whitespace-pre-wrap text-muted">{detail}</span>}
      {children}
    </p>
  );
}

function EntryView({ entry, viewing, onView }: { entry: Entry; viewing: string | null; onView: (executionId: string) => void }) {
  switch (entry.kind) {
    case "user":
      return <UserBubble text={entry.text} images={entry.images} />;
    case "activity":
      return <Activity entry={entry} />;
    case "text":
      return (
        <div className={cn("mb-3", entry.interrupted && "text-muted")}>
          <Markdown>{entry.text}</Markdown>
          {entry.interrupted && <p className="mt-1 text-[11px] leading-4 text-fg-3">cut off by the reload; this step runs again</p>}
        </div>
      );
    case "status":
      return <EventLine action={entry.text} detail={entry.detail} />;
    case "artifact":
      return (
        <EventLine action="design published" detail={entry.version != null ? `version ${entry.version}` : undefined}>
          <button type="button" onClick={() => onView(entry.executionId)}
            className={cn("shrink-0 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring", viewing === entry.executionId ? "text-fg" : "text-fg-2 hover:text-fg")}>
            View
          </button>
        </EventLine>
      );
    case "error":
      return <div role="alert" className="my-2 border-l border-line-strong bg-hover px-3 py-2 text-sm leading-5 text-fg">{entry.text}</div>;
    case "divider": {
      const parts = [
        entry.durationMs != null && formatDuration(entry.durationMs),
        entry.usage?.inputTokens ? `${Math.max(1, Math.round(entry.usage.inputTokens / 1000))}k in` : false,
        entry.usage?.outputTokens ? `${Math.max(1, Math.round(entry.usage.outputTokens / 1000))}k out` : false,
      ].filter(Boolean);
      return <div className="mb-6 flex min-h-4 justify-end">{parts.length > 0 && <span className="text-xs tabular-nums text-muted">{parts.join(" · ")}</span>}</div>;
    }
  }
}

/** "• thinking (12s)": what the run is doing, timed from when the run started (a reload does not reset it). */
export function ActivityLine({ label, startedAt }: { label: string; startedAt: number | null }) {
  const [mountedAt] = useState(() => Date.now());
  const since = startedAt ?? mountedAt;
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    const tick = () => setElapsed(Math.max(0, Math.floor((Date.now() - since) / 1000)));
    tick();
    const timer = setInterval(tick, 1000);
    return () => clearInterval(timer);
  }, [since]);
  return (
    <p className="my-2 flex items-center gap-1.5 font-mono text-xs leading-5 tabular-nums">
      <span aria-hidden="true" className="ta-pulse text-muted">•</span>
      <span className="text-fg-2">{label}</span>
      <span className="text-muted">({elapsed}s)</span>
    </p>
  );
}

export default function Transcript({ entries, pending, onSend, viewing, onView }: {
  entries: Entry[];
  pending: { text: string; images: { url: string }[] } | null;
  onSend: (text: string) => void;
  viewing: string | null;
  onView: (executionId: string) => void;
}) {
  if (entries.length === 0 && !pending) {
    return (
      <div className="mx-auto mt-[12vh] max-w-xl space-y-0.5">
        {SUGGESTIONS.map((suggestion) => (
          <button
            key={suggestion}
            type="button"
            onClick={() => onSend(suggestion)}
            className="group flex min-h-10 w-full items-center gap-3 px-2 py-2 text-left text-sm text-muted outline-none transition-colors hover:bg-hover hover:text-fg focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"
          >
            <span className="flex-1">{suggestion}</span>
            <ArrowRight />
          </button>
        ))}
      </div>
    );
  }
  return (
    <>
      {entries.map((entry) => <EntryView key={entry.key} entry={entry} viewing={viewing} onView={onView} />)}
      {pending && <UserBubble text={pending.text} images={pending.images.map((image) => image.url)} pending />}
    </>
  );
}

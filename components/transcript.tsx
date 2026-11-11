"use client";

import { useEffect, useId, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import type { Entry, ToolRow } from "@/lib/transcript";
import { ArrowRight, Chevron, Pencil, Pulse } from "./icons";
import { cn } from "./ui";

export const SUGGESTIONS = [
  "Design a Radian starship drifting over Earth — drag it and it swings back on spring physics",
  "Create a launch page for a European cloud",
  "Design a mission control dashboard",
];

export function formatDuration(ms: number): string {
  return ms < 1000 ? `${Math.round(ms)}ms` : `${(ms / 1000).toFixed(1)}s`;
}

const TOOL_LABEL: Record<string, string> = { publish_design: "publish design" };

const STATUS = {
  running: { label: "running", className: "text-fg-2", dot: "bg-fg-2 ta-pulse" },
  done: { label: "done", className: "text-muted", dot: "bg-line-strong" },
  error: { label: "failed", className: "text-fg", dot: "bg-fg" },
} as const;

function ToolWidget({ row }: { row: ToolRow }) {
  const [open, setOpen] = useState(false);
  const outputId = useId();
  const state = STATUS[row.status];
  const hasOutput = Boolean(row.output);
  const header = (
    <>
      <span className={`size-1.5 shrink-0 rounded-full ${state.dot}`} aria-hidden="true" />
      <span className="shrink-0 text-muted"><Pencil size={12} /></span>
      <span className="shrink-0 text-xs font-medium text-fg">{TOOL_LABEL[row.name] ?? row.name}</span>
      {row.detail && <code className="min-w-0 flex-1 truncate font-mono text-xs text-fg-3">{row.detail}</code>}
      <span className="ml-auto flex shrink-0 items-center gap-2 text-xs tabular-nums text-muted">
        {row.durationMs != null && <span>{formatDuration(row.durationMs)}</span>}
        <span role="status" className={`font-medium ${state.className}`}>{state.label}</span>
        {hasOutput && <Chevron open={open} />}
      </span>
    </>
  );
  return (
    <section className="my-1.5 overflow-hidden bg-hover/30">
      {hasOutput ? (
        <button type="button" aria-expanded={open} aria-controls={outputId} onClick={() => setOpen((value) => !value)}
          className="flex min-h-7 w-full items-center gap-2 px-2 py-1 text-left outline-none hover:bg-hover focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring">
          {header}
        </button>
      ) : (
        <div className="flex min-h-7 items-center gap-2 px-2 py-1">{header}</div>
      )}
      {open && hasOutput && (
        <div id={outputId} className="border-t border-line bg-soft/70">
          <div className="flex min-h-8 items-center px-2.5"><span className="text-[11px] text-fg-3">output</span></div>
          <pre className="max-h-72 overflow-y-auto whitespace-pre-wrap break-words px-2.5 pb-2.5 font-mono text-xs leading-5 text-fg-2">{row.output}</pre>
        </div>
      )}
    </section>
  );
}

function summary(entry: Extract<Entry, { kind: "activity" }>): string {
  const running = entry.state === "running" || entry.tools.some((tool) => tool.status === "running");
  if (running) {
    const current = entry.tools.findLast((tool) => tool.status === "running");
    const done = [...new Set(entry.tools.filter((tool) => tool.status !== "running").map((tool) => TOOL_LABEL[tool.name] ?? tool.name))];
    return [current ? TOOL_LABEL[current.name] ?? current.name : entry.writing ? "writing" : "thinking", done.join(", ")].filter(Boolean).join(" · ");
  }
  const published = entry.tools.filter((tool) => tool.name === "publish_design").length;
  const phrases = published ? [published === 1 ? "published a design" : "published designs"] : entry.tools.length ? ["used tools"] : [];
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
        {entry.state === "interrupted" && <span className="shrink-0 text-fg-2">resuming</span>}
        {!running && entry.state === "failed" && <span className="shrink-0 text-fg">failed</span>}
        {!running && entry.state !== "failed" && failed > 0 && <span className="shrink-0 text-fg">{failed} failed</span>}
      </div>
      {entry.tools.map((row) => <ToolWidget key={row.key} row={row} />)}
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

export function UserBubble({ text, pending }: { text: string; pending?: boolean }) {
  return (
    <div className="mb-4 flex justify-end">
      <div className={cn("max-w-[86%] bg-bubble px-3 py-2 text-sm leading-5 text-bubble-fg sm:max-w-[80%]", pending && "opacity-65")}>
        <span className="whitespace-pre-wrap break-words">{text}</span>
      </div>
    </div>
  );
}

function EntryView({ entry, viewing, onView }: { entry: Entry; viewing: string | null; onView: (executionId: string) => void }) {
  switch (entry.kind) {
    case "user":
      return <UserBubble text={entry.text} />;
    case "activity":
      return <Activity entry={entry} />;
    case "text":
      return <div className="mb-3"><Markdown>{entry.text}</Markdown></div>;
    case "artifact":
      return (
        <p className="mb-3 flex items-start gap-2 text-xs leading-5">
          <span className="shrink-0 font-medium text-fg-2">design published</span>
          {entry.version != null && <span className="text-muted">version {entry.version}</span>}
          <button type="button" onClick={() => onView(entry.executionId)}
            className={cn("shrink-0 underline underline-offset-2 outline-none focus-visible:ring-2 focus-visible:ring-ring", viewing === entry.executionId ? "text-fg" : "text-fg-2 hover:text-fg")}>
            View
          </button>
        </p>
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
  pending: string | null;
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
      {pending && <UserBubble text={pending} pending />}
    </>
  );
}

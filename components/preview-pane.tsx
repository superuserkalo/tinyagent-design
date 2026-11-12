"use client";

import { useEffect, useRef, useState } from "react";
import type { DesignMeta } from "@/lib/client/runtime";
import { HowItWorksPanel } from "./how-it-works";
import { Copy, Download, Share, Check } from "./icons";
import { button, Popover, PopoverContent, PopoverTrigger, Tip } from "./ui";

/**
 * One design, running. The frame loads /preview-frame in sandbox="allow-scripts"
 * without allow-same-origin: an opaque origin that cannot reach this site's cookies,
 * IndexedDB or DOM. The frame asks for its HTML once; each version gets a new frame.
 */
function DesignFrame({ design, html }: { design: DesignMeta; html: string }) {
  const frame = useRef<HTMLIFrameElement>(null);
  useEffect(() => {
    const onMessage = (event: MessageEvent) => {
      const target = frame.current?.contentWindow;
      if (!target || event.source !== target || event.data?.type !== "tinyagent-design-ready") return;
      // The frame's origin is opaque, so "*" is the only target that reaches it. Only the design is sent.
      target.postMessage({ type: "tinyagent-design", html }, "*");
    };
    window.addEventListener("message", onMessage);
    return () => window.removeEventListener("message", onMessage);
  }, [html]);
  return (
    <iframe
      ref={frame}
      src="/preview-frame"
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      title={`Design preview: ${design.title}`}
      className="absolute inset-0 h-full w-full bg-bg"
    />
  );
}

/** The page as the model writes it: a picture with scripts off until it is published. */
function DraftFrame({ html }: { html: string }) {
  const [shown, setShown] = useState(html);
  const last = useRef(0);
  useEffect(() => {
    const wait = Math.max(0, 400 - (Date.now() - last.current));
    const timer = setTimeout(() => { last.current = Date.now(); setShown(html); }, wait);
    return () => clearTimeout(timer);
  }, [html]);
  return <iframe srcDoc={shown} sandbox="" referrerPolicy="no-referrer" title="Design preview while it is written" className="absolute inset-0 h-full w-full bg-bg" />;
}

/** A body has started: before that a draft renders as a blank page. */
function renderable(html: string): boolean {
  const body = /<body[^>]*>/i.exec(html);
  return body != null && /<[a-z]/i.test(html.slice(body.index + body[0].length));
}

/** Loads a version's HTML, then runs it. */
function LoadedDesign({ design, load }: { design: DesignMeta; load: (id: string) => Promise<string> }) {
  const [html, setHtml] = useState<{ id: string; html: string } | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    let live = true;
    setFailed(false);
    load(design.id).then((value) => { if (live) setHtml({ id: design.id, html: value }); }, () => { if (live) setFailed(true); });
    return () => { live = false; };
  }, [design.id, load]);
  if (failed) return <p className="p-6 text-sm text-muted">This version could not be loaded.</p>;
  return html?.id === design.id ? <DesignFrame key={design.id} design={design} html={html.html} /> : null;
}

export default function PreviewPane({ designs, load, viewing, draft, intro, onLatest }: {
  designs: DesignMeta[];
  load: ((id: string) => Promise<string>) | null;
  viewing: string | null;
  draft: string | null;
  intro: boolean;
  onLatest: () => void;
}) {
  const latest = designs.at(-1) ?? null;
  const pinned = viewing ? designs.find((design) => design.id === viewing) ?? null : null;
  const shown = pinned ?? latest;
  const version = shown ? designs.indexOf(shown) + 1 : 0;
  const drafting = draft && renderable(draft) && !pinned ? draft : null;
  return (
    <section id="preview-pane" aria-label="preview" className="flex min-h-0 min-w-0 flex-1 flex-col bg-bg lg:border-l lg:border-line">
      {pinned && pinned !== latest && (
        <div className="flex h-9 shrink-0 items-center justify-between gap-3 border-b border-line px-4 text-xs text-muted">
          <span>version {version} of {designs.length}</span>
          <button type="button" onClick={onLatest} className="text-fg underline underline-offset-2 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring">
            show latest
          </button>
        </div>
      )}
      <div className="relative min-h-0 flex-1">
        {drafting ? (
          <DraftFrame html={drafting} />
        ) : shown && load ? (
          <LoadedDesign key={shown.id} design={shown} load={load} />
        ) : intro ? (
          <div className="h-full min-h-0 overflow-y-auto">
            <div className="flex min-h-full items-center justify-center px-6 py-10">
              <div className="w-full max-w-sm"><HowItWorksPanel /></div>
            </div>
          </div>
        ) : null}
      </div>
    </section>
  );
}

function fileName(title: string): string {
  const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 60);
  return `${slug || "design"}.html`;
}

/** Copy or download the design on screen. */
export function ExportMenu({ design, load, onNotice }: { design: DesignMeta; load: (id: string) => Promise<string>; onNotice: (text: string) => void }) {
  const [open, setOpen] = useState(false);
  const [copied, setCopied] = useState(false);
  async function copy() {
    setOpen(false);
    try {
      // Safari allows a clipboard write only inside the click: hand it the pending text.
      const text = load(design.id);
      if (typeof ClipboardItem !== "undefined" && navigator.clipboard?.write)
        await navigator.clipboard.write([new ClipboardItem({ "text/plain": text.then((value) => new Blob([value], { type: "text/plain" })) })]);
      else await navigator.clipboard.writeText(await text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      onNotice("Unable to copy the design. Try again.");
    }
  }
  async function download() {
    setOpen(false);
    let html: string;
    try { html = await load(design.id); } catch { return onNotice("Unable to download the design. Try again."); }
    // Octet-stream, so the browser saves it and never renders it on this origin.
    const url = URL.createObjectURL(new Blob([html], { type: "application/octet-stream" }));
    const link = document.createElement("a");
    link.href = url;
    link.download = fileName(design.title);
    document.body.append(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 10_000);
  }
  const item = "flex min-h-8 w-full items-center gap-2 px-2.5 text-left text-sm outline-none hover:bg-hover focus-visible:bg-hover";
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <Tip label="copy or download HTML">
        <PopoverTrigger asChild>
          <button type="button" aria-label="copy or download this design" className={`${button.ghost} ${button.icon}`}>
            {copied ? <Check /> : <Share />}
          </button>
        </PopoverTrigger>
      </Tip>
      <PopoverContent align="end" className="w-52 p-1">
        <button type="button" className={item} onClick={() => void copy()}><span className="text-muted"><Copy /></span>copy HTML</button>
        <button type="button" className={item} onClick={() => void download()}><span className="text-muted"><Download /></span>download HTML</button>
      </PopoverContent>
    </Popover>
  );
}

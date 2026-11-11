"use client";

import { useId, useState, type ReactNode } from "react";
import { FramedQuestion, Close } from "./icons";
import { button, Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle, Tip } from "./ui";

export const REPO_URL = "https://github.com/superuserkalo/tinyagent-design";
export const SDK_URL = "https://github.com/superuserkalo/tinyagent";

function External({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="text-fg underline underline-offset-4 hover:no-underline">
      {children}
    </a>
  );
}

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="mt-6">
      <h3 className="text-sm font-medium text-fg">{title}</h3>
      <div className="mt-2 space-y-2 text-sm leading-6 text-muted">{children}</div>
    </section>
  );
}

const BODY = (
  <>
    <Section title="when you send">
      <p>The agent loop runs in your browser tab on the TinyAgent SDK. Only the model call goes through our server, which pays for it.</p>
    </Section>
    <Section title="durable">
      <p>
        Each chat is a TinyAgent session, journaled step by step in your browser. Close the tab or reload mid-reply and it
        picks up from the last step.
      </p>
    </Section>
    <Section title="make it yours">
      <p>
        The instructions are in <code>lib/agent.ts</code> and the tool in <code>lib/tools.ts</code>.
      </p>
    </Section>
  </>
);

const CREDIT = (
  <p className="mt-6 text-xs leading-5 text-fg-3">
    Inspired by <External href="https://github.com/vercel-labs/fx0">fx0 (vercel-labs/fx0)</External>.
  </p>
);

/** What the preview shows before there is a design. */
export function HowItWorksPanel() {
  const [expanded, setExpanded] = useState(false);
  const bodyId = useId();
  return (
    <article aria-labelledby="ta-intro-title" className="text-sm leading-6 text-muted">
      <h2 id="ta-intro-title" className="text-base font-medium text-fg">TinyAgent</h2>
      <p className="mt-2">
        TinyAgent is an <External href={SDK_URL}>open-source agent SDK</External> built to showcase durable agents that run anywhere.
      </p>
      <p className="mt-2">Describe a page in the chat and it shows up here as one HTML file.</p>
      <div id={bodyId} hidden={!expanded}>{BODY}{CREDIT}</div>
      <div className="mt-6 flex items-center justify-between gap-4">
        <button
          type="button"
          aria-expanded={expanded}
          aria-controls={bodyId}
          onClick={() => setExpanded((value) => !value)}
          className="text-fg underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring"
        >
          {expanded ? "read less" : "read more"}
        </button>
        <External href={REPO_URL}>fork tinyagent-design</External>
      </div>
    </article>
  );
}

/** The sidebar's "?" and the dialog it opens. */
export default function HowItWorks() {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Tip label="how it works">
        <button
          type="button"
          aria-label="how it works"
          onClick={() => setOpen(true)}
          className="grid size-8 shrink-0 place-items-center text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
        >
          <FramedQuestion />
        </button>
      </Tip>
      <Dialog open={open} onOpenChange={setOpen}>
        <DialogContent className="max-h-[calc(100dvh-2rem)] max-w-lg overflow-y-auto p-7" onCloseAutoFocus={(event) => event.preventDefault()}>
          <DialogClose
            aria-label="close"
            className="absolute right-4 top-4 inline-flex size-8 items-center justify-center text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
          >
            <Close />
          </DialogClose>
          <DialogTitle className="text-lg font-medium">how it works</DialogTitle>
          <DialogDescription className="mt-3 text-sm leading-6 text-muted">
            TinyAgent Design shows what you can build with <External href={SDK_URL}>TinyAgent</External>, an agent SDK you
            can read in an afternoon. Its browser entry gives you the agent loop, streaming, tool calls and durable sessions.
          </DialogDescription>
          {BODY}
          {CREDIT}
          <a href={REPO_URL} target="_blank" rel="noopener noreferrer" className={`${button.primary} mt-6`}>
            fork tinyagent-design
          </a>
        </DialogContent>
      </Dialog>
    </>
  );
}

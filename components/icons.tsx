// Small line icons drawn for this site, plus GitHub's mark (from GitHub's Octicons, MIT).

export function FramedGitHub() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
      <rect x="0.375" y="0.375" width="19.25" height="19.25" fill="none" stroke="currentColor" strokeWidth="0.75" />
      <path
        fill="currentColor"
        transform="translate(5 5) scale(0.625)"
        d="M8 0C3.58 0 0 3.58 0 8c0 3.54 2.29 6.53 5.47 7.59.4.07.55-.17.55-.38 0-.19-.01-.82-.01-1.49-2.01.37-2.53-.49-2.69-.94-.09-.23-.48-.94-.82-1.13-.28-.15-.68-.52-.01-.53.63-.01 1.08.58 1.23.82.72 1.21 1.87.87 2.33.66.07-.52.28-.87.51-1.07-1.78-.2-3.64-.89-3.64-3.95 0-.87.31-1.59.82-2.15-.08-.2-.36-1.02.08-2.12 0 0 .67-.21 2.2.82.64-.18 1.32-.27 2-.27.68 0 1.36.09 2 .27 1.53-1.04 2.2-.82 2.2-.82.44 1.1.16 1.92.08 2.12.51.56.82 1.27.82 2.15 0 3.07-1.87 3.75-3.65 3.95.29.25.54.73.54 1.48 0 1.07-.01 1.93-.01 2.2 0 .21.15.46.55.38A8.013 8.013 0 0016 8c0-4.42-3.58-8-8-8z"
      />
    </svg>
  );
}

/** A question mark in the same square frame. */
export function FramedQuestion() {
  return (
    <svg viewBox="0 0 20 20" className="size-5" aria-hidden="true">
      <rect x="0.375" y="0.375" width="19.25" height="19.25" fill="none" stroke="currentColor" strokeWidth="0.75" />
      <QuestionGlyph transform="translate(5 4.75) scale(0.625)" />
    </svg>
  );
}

/** A question mark on a 16-unit grid: a hook and a dot. */
export function QuestionGlyph({ transform }: { transform?: string }) {
  return (
    <g transform={transform}>
      <path d="M5.5 6a2.5 2.5 0 1 1 3.6 2.25c-.7.33-1.1.8-1.1 1.55v.45" fill="none" stroke="currentColor" strokeWidth="2.1" />
      <rect x="6.95" y="11.6" width="2.1" height="2.1" fill="currentColor" />
    </g>
  );
}

export function SmallQuestion() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" aria-hidden="true">
      <QuestionGlyph transform="translate(2 1.5) scale(0.75)" />
    </svg>
  );
}

export function Plus({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 2v12M2 8h12" />
    </svg>
  );
}

export function ArrowRight() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 opacity-50 transition-transform group-hover:translate-x-0.5 motion-reduce:transition-none" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M3 8h10M9 4l4 4-4 4" />
    </svg>
  );
}

export function ArrowUp() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 13V3M4 7l4-4 4 4" />
    </svg>
  );
}

export function StopSquare() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5" fill="currentColor" aria-hidden="true">
      <rect x="3.5" y="3.5" width="9" height="9" rx="1.5" />
    </svg>
  );
}

export function Close({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M4 4l8 8M12 4l-8 8" />
    </svg>
  );
}

export function Menu() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h12" />
    </svg>
  );
}

export function PanelLeft() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" aria-hidden="true">
      <rect x="2" y="3.5" width="12" height="9" fill="none" stroke="currentColor" strokeWidth="1.5" />
      <rect x="2" y="3.5" width="4.75" height="9" fill="currentColor" />
    </svg>
  );
}

export function Pulse() {
  return (
    <svg className="size-3 shrink-0" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M1 8h3l1.75-3.5 3.5 7L11 8h4" />
    </svg>
  );
}

export function Pencil({ size = 12 }: { size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M10.5 2.5l3 3L5 14H2v-3z M9 4l3 3" />
    </svg>
  );
}

export function Chevron({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d={open ? "m4 6 4 4 4-4" : "m6 4 4 4-4 4"} />
    </svg>
  );
}

export function Share() {
  return (
    <svg viewBox="0 0 16 16" className="size-4" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 10.5V2M5 5l3-3 3 3M2.75 8.5v5.25h10.5V8.5" />
    </svg>
  );
}

export function Copy() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <rect x="5.75" y="5.75" width="8" height="8" />
      <path d="M10.25 3.25v-1h-8v8h1" />
    </svg>
  );
}

export function Download() {
  return (
    <svg viewBox="0 0 16 16" className="size-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="M8 2v8M4.5 6.5 8 10l3.5-3.5M2.5 11v2.5h11V11" />
    </svg>
  );
}

export function Check({ className = "size-4" }: { className?: string }) {
  return (
    <svg viewBox="0 0 16 16" className={className} fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
      <path d="m3 8 3 3 7-7" />
    </svg>
  );
}

/** A chevron in a circle: closed points right, open points down. */
export function ChevronCircle({ open }: { open: boolean }) {
  return (
    <svg viewBox="0 0 16 16" className="size-[13px] shrink-0" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
      <circle cx="8" cy="8" r="6.8" />
      <path d={open ? "M5.4 6.9 8 9.5l2.6-2.6" : "M6.9 5.4 9.5 8l-2.6 2.6"} />
    </svg>
  );
}

/** A paperclip: one wire, bent back on itself twice. */
export function Paperclip() {
  return (
    <svg viewBox="0 0 24 24" className="size-4" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M16.5 7.5 8.3 15.7a2.1 2.1 0 0 0 3 3l8.6-8.6a4.3 4.3 0 0 0-6.1-6.1l-8.9 8.9a6.4 6.4 0 0 0 9.1 9.1l7.3-7.3" />
    </svg>
  );
}

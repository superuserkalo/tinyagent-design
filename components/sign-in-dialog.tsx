"use client";

import type { AnyState } from "@teamhanko/hanko-frontend-sdk";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { AuthFlowError, authErrorMessage, authView, hankoConfigured, isExistingAccountError, run, startLogin, startRegistration, type AuthMode } from "@/lib/client/hanko";
import { Close } from "./icons";
import { button, cn, Dialog, DialogClose, DialogContent, DialogDescription, DialogTitle } from "./ui";

const RESEND_SECONDS = 30;
const TERMS_URL = "https://radian.sh/terms";
const PRIVACY_URL = "https://radian.sh/privacy";

/** The line radian.sh's own sign-up shows, with its links. */
function Consent() {
  const link = "text-fg underline underline-offset-4 hover:no-underline";
  return (
    <p className="mt-4 text-xs leading-5 text-muted">
      By creating an account, you accept Radian&apos;s{" "}
      <a href={TERMS_URL} target="_blank" rel="noopener noreferrer" className={link}>Terms</a> &amp;{" "}
      <a href={PRIVACY_URL} target="_blank" rel="noopener noreferrer" className={link}>Privacy</a>.
    </p>
  );
}

/**
 * The account modal: a title, one line, a black Create account, a bordered Sign in and
 * Cancel. Either continues in the same box with radian.sh's email flow: email, then the
 * code Hanko emails (or the account's password). Registration starts Hanko's registration
 * flow directly: the login flow cannot tell a new email apart, because Hanko does not reveal
 * which emails have accounts (it emails "not recognized" instead).
 */
export default function SignInDialog({ open, onOpenChange, onSignedIn, startAtFlow, freePrompts }: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onSignedIn: () => void;
  /** Skip the intro and show the email field at once (the sidebar's Sign in). */
  startAtFlow: boolean;
  freePrompts: number;
}) {
  const designs = `${freePrompts} free ${freePrompts === 1 ? "design" : "designs"}`;
  const [step, setStep] = useState<"intro" | "flow">("intro");
  const [mode, setMode] = useState<AuthMode>("signin");
  const [flow, setFlow] = useState<AnyState | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [revision, setRevision] = useState(0);
  const [resendAfter, setResendAfter] = useState(0);
  const formRef = useRef<HTMLFormElement>(null);
  const live = useRef(0);

  useEffect(() => {
    if (!open) return;
    live.current += 1;
    setStep(startAtFlow ? "flow" : "intro");
    setMode("signin");
    setFlow(null);
    setError(null);
    setBusy(false);
    setResendAfter(0);
  }, [open, startAtFlow]);

  useEffect(() => {
    if (resendAfter <= 0) return;
    const timer = window.setTimeout(() => setResendAfter((value) => value - 1), 1000);
    return () => window.clearTimeout(timer);
  }, [resendAfter]);

  useEffect(() => {
    if (step === "flow" && !busy) formRef.current?.querySelector<HTMLInputElement>("input:not(:disabled)")?.focus();
  }, [step, busy, revision]);

  async function accept(state: AnyState, epoch: number, action?: string) {
    if (live.current !== epoch) return;
    if (state.name === "passcode_confirmation" && !state.error && (flow?.name !== "passcode_confirmation" || action === "resend_passcode"))
      setResendAfter(RESEND_SECONDS);
    setFlow(state);
    setRevision((value) => value + 1);
    if (state.name === "success") {
      const response = await fetch("/api/auth/session", { cache: "no-store", credentials: "same-origin" });
      const body = response.ok ? await response.json() : null;
      const expected = state.payload?.user?.user_id;
      if (!body?.authenticated || (typeof expected === "string" && body.userId !== expected))
        throw new AuthFlowError("Your session could not be saved. Allow cookies for this site, then try again.");
      if (live.current === epoch) onSignedIn();
    }
  }

  async function perform(work: (epoch: number) => Promise<void>) {
    if (busy) return;
    const epoch = live.current;
    setBusy(true);
    setError(null);
    try {
      await work(epoch);
    } catch (cause) {
      if (live.current === epoch) setError(cause instanceof AuthFlowError ? cause.message : "Sign-in could not connect. Try again.");
    } finally {
      if (live.current === epoch) setBusy(false);
    }
  }

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    const view = authView(flow, mode);
    const values: Record<string, string> = {};
    for (const field of view.fields) {
      const value = String(data.get(field.name) ?? "");
      values[field.name] = field.type === "password" ? value : value.trim();
    }
    if (view.confirmPassword && values.new_password !== data.get("confirm_password")) {
      setError("The passwords do not match.");
      return;
    }
    if (values.email) setEmail(values.email);
    const primary = view.primary;
    if (!primary) return;
    void perform(async (epoch) => {
      // Codes and passwords live only in this submission.
      for (const input of form.querySelectorAll<HTMLInputElement>('input[type="password"], input[autocomplete="one-time-code"]')) input.value = "";
      let state = flow ?? (mode === "register" ? await startRegistration() : await startLogin());
      let next = await run(state, primary.action, values);
      // A new email on sign-in (when Hanko says so): create the radian.sh account with it instead.
      if (next.name === "login_init" && next.error?.code === "unknown_email_error" && values.email) {
        state = await startRegistration();
        next = await run(state, "register_login_identifier", { email: values.email });
      }
      // An existing email on registration: sign in with it instead.
      if (next.name === "registration_init" && isExistingAccountError(next.error?.code) && values.email) {
        if (live.current === epoch) setMode("signin");
        state = await startLogin();
        next = await run(state, "continue_with_login_identifier", { email: values.email });
      }
      await accept(next, epoch, primary.action);
    });
  }

  function choose(action: string) {
    void perform(async (epoch) => {
      if (!flow) return;
      await accept(await run(flow, action), epoch, action);
    });
  }

  const view = authView(flow, mode);
  const atStart = !flow || flow.name === "login_init" || flow.name === "registration_init";
  const switchMode = (next: AuthMode) => { live.current += 1; setMode(next); setFlow(null); setError(null); setBusy(false); setStep("flow"); };
  const fieldError = view.fields.some((field) => field.input.error);
  const flowError = flow?.error && !(flow.error.code === "form_data_invalid_error" && fieldError) ? authErrorMessage(flow.error.code) : null;
  const message = error ?? flowError ?? (view.unsupported ? "This step could not be shown here. Sign in at radian.sh, then come back." : null);
  const restartable = Boolean(error || flow?.name === "error" || flow?.error?.code === "flow_expired_error" || view.unsupported);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent aria-describedby={undefined}>
        <DialogClose
          aria-label="close"
          className="absolute right-4 top-4 inline-flex size-8 items-center justify-center text-muted outline-none transition-colors hover:text-fg focus-visible:ring-2 focus-visible:ring-ring"
        >
          <Close />
        </DialogClose>
        {step === "intro" ? (
          <>
            <DialogTitle className="text-lg font-medium">Use a Radian account</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-muted">Create one or sign in. You get {designs}.</DialogDescription>
            <div className="mt-5 flex flex-wrap gap-2">
              <button type="button" className={button.primary} disabled={!hankoConfigured()} onClick={() => switchMode("register")}>
                Create account
              </button>
              <button type="button" className={button.outline} disabled={!hankoConfigured()} onClick={() => switchMode("signin")}>
                Sign in
              </button>
            </div>
            <Consent />
            {!hankoConfigured() && <p role="alert" className="mt-3 text-sm text-muted">Sign-in is not configured on this deployment.</p>}
          </>
        ) : (
          <>
            <DialogTitle className="text-lg font-medium">{view.title ?? (mode === "register" ? "Create your Radian account" : "Sign in with your Radian account")}</DialogTitle>
            <DialogDescription className="mt-2 text-sm text-muted">
              {view.description ?? (mode === "register" ? `Your email, then a code we send you. You get ${designs}.` : "Use your radian.sh email.")}
            </DialogDescription>
            {view.primary && (
              <form ref={formRef} key={`${flow?.name ?? "init"}-${revision}`} onSubmit={submit} className="mt-4">
                <fieldset disabled={busy} className="space-y-3">
                  {view.fields.map((field) => <Field key={field.name} field={field} email={email} />)}
                  {view.confirmPassword && (
                    <Field field={{ name: "confirm_password", label: "Confirm password", type: "password", autocomplete: "new-password", input: { required: true } }} email="" />
                  )}
                </fieldset>
                <div className="mt-5 flex flex-wrap gap-2">
                  <button type="submit" className={button.primary} disabled={busy}>{busy ? "Please wait…" : view.primary.label}</button>
                  <button type="button" className={button.outline} onClick={() => onOpenChange(false)}>Cancel</button>
                </div>
              </form>
            )}
            {view.choices.length > 0 && (
              <div className={cn("flex flex-wrap gap-x-4 gap-y-2 text-sm", view.primary ? "mt-4" : "mt-5")}>
                {view.choices.map((choice) => (
                  <button
                    key={choice.action}
                    type="button"
                    disabled={busy || (choice.action === "resend_passcode" && resendAfter > 0)}
                    onClick={() => choose(choice.action)}
                    className="text-fg underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring disabled:text-fg-3 disabled:no-underline"
                  >
                    {choice.action === "resend_passcode" && resendAfter > 0 ? `Send a new code in ${resendAfter}s` : choice.label}
                  </button>
                ))}
              </div>
            )}
            {atStart && (
              <p className="mt-4 text-sm text-muted">
                {mode === "register" ? "Have an account? " : "New to Radian? "}
                <button type="button" disabled={busy} onClick={() => switchMode(mode === "register" ? "signin" : "register")}
                  className="text-fg underline underline-offset-4 outline-none hover:no-underline focus-visible:ring-2 focus-visible:ring-ring">
                  {mode === "register" ? "Sign in" : "Create an account"}
                </button>
              </p>
            )}
            {mode === "register" && atStart && <Consent />}
            {!view.primary && (
              <div className="mt-5 flex gap-2">
                <button type="button" className={button.outline} onClick={() => onOpenChange(false)}>Cancel</button>
              </div>
            )}
            <div aria-live="polite">
              {message && (
                <p role="alert" className="mt-3 text-sm text-fg-2">
                  {message}{" "}
                  {restartable && (
                    <button type="button" className="text-fg underline underline-offset-4 hover:no-underline" onClick={() => { live.current += 1; setFlow(null); setError(null); setBusy(false); }}>
                      Start again
                    </button>
                  )}
                </p>
              )}
            </div>
          </>
        )}
      </DialogContent>
    </Dialog>
  );
}

function Field({ field, email }: { field: { name: string; label: string; type: string; autocomplete: string; input: { required?: boolean; min_length?: number; max_length?: number; value?: unknown; error?: { code?: string } } }; email: string }) {
  const id = useId();
  const code = field.autocomplete === "one-time-code";
  return (
    <div>
      <label htmlFor={id} className="block text-xs text-muted">{field.label}</label>
      <input
        id={id}
        name={field.name}
        type={field.type}
        autoComplete={field.autocomplete}
        inputMode={code ? "numeric" : field.type === "email" ? "email" : undefined}
        autoCapitalize="none"
        spellCheck={false}
        required={field.input.required}
        minLength={field.input.min_length}
        maxLength={field.input.max_length}
        defaultValue={field.type === "password" || code ? "" : typeof field.input.value === "string" ? field.input.value : field.type === "email" ? email : ""}
        aria-invalid={Boolean(field.input.error)}
        className="mt-1.5 h-9 w-full border border-input bg-transparent px-3 text-sm outline-none transition-[border-color,box-shadow] placeholder:text-muted focus-visible:border-ring focus-visible:ring-2 focus-visible:ring-ring/30"
      />
      {field.input.error && <p className="mt-1 text-xs text-fg-2">{authErrorMessage(field.input.error.code)}</p>}
    </div>
  );
}

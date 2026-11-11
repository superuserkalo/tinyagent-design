// Sign-in with a radian.sh account, in a modal on this site. Adapted from radian.sh's
// lib/hanko/client.ts, auth-flow.ts and auth-view.ts: the same Hanko project, the same
// email-first flow (a passcode by email, or the account's password). Social sign-in
// is left out: it needs a redirect page this one-screen app does not have.
import type { AnyState, Action, AutoStepExclusion, Hanko, Input, StateCreateConfig } from "@teamhanko/hanko-frontend-sdk";
import { hankoApiUrl } from "../hanko-config.ts";

type AuthAction = Action<Record<string, Input<string | boolean>>>;

let clientPromise: Promise<Hanko> | null = null;

export function hankoConfigured(): boolean {
  return hankoApiUrl() !== null;
}

export function getHankoClient(): Promise<Hanko> {
  const apiUrl = hankoApiUrl();
  if (!apiUrl) return Promise.reject(new Error("NEXT_PUBLIC_HANKO_API_URL is not configured."));
  clientPromise ??= import("@teamhanko/hanko-frontend-sdk")
    .then(({ Hanko }) => new Hanko(apiUrl, { localStorageKey: "hanko", cookieSameSite: "lax", sessionTokenLocation: "cookie", lang: "en" }))
    .catch((error) => {
      clientPromise = null;
      throw error;
    });
  return clientPromise;
}

const excludeAutoSteps: AutoStepExclusion = ["thirdparty"];
const flowConfig: StateCreateConfig = { loadFromCache: false, dispatchAfterStateChangeEvent: false, excludeAutoSteps, cacheKey: "tinyagent-auth-flow" };

export class AuthFlowError extends Error {}

export function findAction(state: AnyState | null, name: string): AuthAction | undefined {
  // Hanko returns disabled proxy actions for missing keys. Only real enabled actions may run.
  const action = (Object.entries(state?.actions ?? {}) as [string, AuthAction][]).find(([key]) => key === name)?.[1];
  return action?.enabled ? action : undefined;
}

export async function startLogin(): Promise<AnyState> {
  return (await getHankoClient()).createState("login", flowConfig);
}

export async function startRegistration(): Promise<AnyState> {
  return (await getHankoClient()).createState("registration", flowConfig);
}

/** Skip optional passkey onboarding, as radian.sh does. */
export async function settle(state: AnyState): Promise<AnyState> {
  if (state.name === "onboarding_create_passkey") {
    const skip = findAction(state, "skip");
    if (skip) return skip.run({}, { dispatchAfterStateChangeEvent: false });
  }
  return state;
}

export async function run(state: AnyState, name: string, values: Record<string, string | boolean> = {}): Promise<AnyState> {
  const action = findAction(state, name);
  if (!action) throw new AuthFlowError("This step is no longer available.");
  return settle(await action.run(values, { dispatchAfterStateChangeEvent: false }));
}

export async function signOut(): Promise<void> {
  await (await getHankoClient()).logout();
}

export interface AuthField { name: string; label: string; type: string; autocomplete: string; input: Input<string | boolean> }
export interface AuthView {
  title?: string;
  description?: string;
  primary?: { action: string; label: string };
  fields: AuthField[];
  choices: { action: string; label: string }[];
  confirmPassword?: boolean;
  unsupported?: boolean;
}

const fieldInfo: Record<string, { label: string; type: string; autocomplete: string }> = {
  email: { label: "Email", type: "email", autocomplete: "email" },
  identifier: { label: "Email", type: "email", autocomplete: "username" },
  username: { label: "Username", type: "text", autocomplete: "username" },
  password: { label: "Password", type: "password", autocomplete: "current-password" },
  new_password: { label: "New password", type: "password", autocomplete: "new-password" },
  code: { label: "Code from the email", type: "text", autocomplete: "one-time-code" },
  otp_code: { label: "Authentication code", type: "text", autocomplete: "one-time-code" },
};

export function authView(state: AnyState | null): AuthView {
  const view: AuthView = { fields: [], choices: [] };
  const primary = (action: string, label: string) => { view.primary = { action, label }; };
  const choice = (action: string, label: string) => { if (findAction(state, action)) view.choices.push({ action, label }); };
  if (!state) {
    view.primary = { action: "continue_with_login_identifier", label: "Continue" };
    view.fields = [{ name: "email", ...fieldInfo.email, input: { name: "email", type: "email", required: true, max_length: 120 } }];
    return view;
  }
  switch (state.name) {
    case "login_init": primary("continue_with_login_identifier", "Continue"); break;
    case "registration_init": primary("register_login_identifier", "Create account"); break;
    case "login_method_chooser":
      view.title = "Choose how to sign in";
      choice("continue_to_passcode_confirmation", "Email me a code");
      choice("continue_to_password_login", "Use your password");
      break;
    case "login_password":
      view.title = "Enter your password";
      primary("password_login", "Sign in");
      choice("continue_to_passcode_confirmation_recovery", "Forgot your password?");
      choice("continue_to_login_method_chooser", "Use another method");
      break;
    case "passcode_confirmation":
      view.title = "Check your email";
      view.description = "Enter the code we sent you.";
      primary("verify_passcode", "Verify");
      choice("resend_passcode", "Send a new code");
      break;
    case "password_creation":
      view.title = "Create a password";
      primary("register_password", "Save password");
      view.confirmPassword = true;
      choice("skip", "Skip for now");
      break;
    case "login_password_recovery":
      view.title = "Set a new password";
      primary("password_recovery", "Reset password");
      view.confirmPassword = true;
      break;
    case "onboarding_username":
      view.title = "Choose a username";
      primary("username_create", "Continue");
      choice("skip", "Skip for now");
      break;
    case "credential_onboarding_chooser":
      view.title = "Set up your sign-in";
      choice("continue_to_password_registration", "Create a password");
      choice("skip", "Skip for now");
      break;
    case "login_otp":
      view.title = "Verify with your authenticator";
      primary("otp_code_validate", "Verify code");
      break;
    case "device_trust":
      view.title = "Trust this browser?";
      primary("trust_device", "Trust this browser");
      choice("skip", "Don't trust it");
      break;
    case "mfa_method_chooser":
      view.title = "Secure your account";
      choice("skip", "Skip for now");
      break;
    case "success": view.description = "Signing you in…"; break;
    case "error": break;
    default: view.unsupported = true;
  }
  if (view.primary) {
    const action = findAction(state, view.primary.action);
    if (!action) view.primary = undefined;
    else {
      for (const [name, input] of Object.entries(action.inputs ?? {})) {
        if (input.hidden) continue;
        if (!fieldInfo[name]) { view.unsupported = true; break; }
        view.fields.push({ name, ...fieldInfo[name], input });
      }
    }
  }
  if (!view.primary && !view.choices.length && !["error", "success"].includes(state.name)) view.unsupported = true;
  return view;
}

const errors: Record<string, string> = {
  passcode_invalid: "That code is incorrect or has expired. Use the code from the latest email, or request a new one.",
  passcode_expired: "That code has expired. Request a new code.",
  passcode_max_attempts_reached: "Too many incorrect codes. Request a new code to continue.",
  invalid_password: "That password is incorrect.",
  password_invalid: "That password is incorrect.",
  rate_limit_exceeded: "Too many attempts. Wait a moment and try again.",
  flow_expired_error: "This sign-in request expired.",
  unauthorized: "Your session expired. Sign in again.",
  value_missing_error: "Fill in this field.",
  value_invalid_error: "Check this value and try again.",
  form_data_invalid_error: "Check the field and try again.",
};

export function authErrorMessage(code?: string): string {
  return code && errors[code] ? errors[code] : "We could not complete that request.";
}

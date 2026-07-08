# onboarding

The first-run **"Get set up" guide** — a dismissible card at the top of the home shell that walks
a new user through the three per-device steps that make Todoclaw feel like an app instead of a tab:

1. **Install as a web app** — platform-specific gesture (iOS: Share → Add to Home Screen, which is
   *required* for push there; macOS Safari: File → Add to Dock; Chromium: a native install button
   via `beforeinstallprompt`, or address-bar instructions). Hidden where no gesture exists
   (e.g. Firefox desktop).
2. **Turn on daily notifications** — opens Settings scrolled to the Daily-notifications section.
3. **Try Plan My Day** — fires the same generate as the header pill.

## Design notes

- **Checklist, not wizard.** The install gesture happens *outside* the page and reopens the app in
  a fresh context (on iOS, with separate storage — the user even signs in again), so any modal
  step-by-step flow would be lost mid-stream. A persistent card with live detection survives it.
- **Every step auto-detects** (`use-setup-guide.ts`): standalone display-mode, `config.notifications
  .enabled` + `Notification.permission` (the same two halves the dispatcher requires), and today's
  plan (latched in localStorage so the midnight plan-clear doesn't regress the checkmark).
- **Per-device semantics.** Dismissal lives in localStorage (`setup-guide-store.ts`), not account
  config — reappearing on a new device is correct, since install/permission are per-device. A user
  already fully set up never sees the card (silent auto-dismiss on load).
- **Re-findable:** Settings → "Show the setup guide" (calls `resetSetupGuide()`).
- **Golden suite:** `e2e/golden/auth.setup.ts` seeds the dismissal key before sign-in so specs
  assert the established shell, not the guide.

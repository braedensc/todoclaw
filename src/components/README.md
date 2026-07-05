# Shared UI primitives

App-wide, feature-agnostic building blocks. No feature logic lives here — a component in this
folder should be usable by the grid, list, habits, done, cluster popup, etc. without importing any
of them.

## `IconButton` — `IconButton.tsx`

The single icon-only action affordance for the whole app (tooltips #10, green-done / red-delete
#12). Standardizes size, border, hover intent, and accessibility so surfaces stop hand-rolling
their own `RowAction` / `ActionButton` / `RowButton`.

- **Variants:** `neutral` (default, muted → ink), `success` (green — done/confirm), `danger`
  (red — delete/destructive). success/danger carry a matching-hue border at rest that deepens on
  hover, plus a colored glyph + faint wash on hover.
- **Required props:** `title` (native tooltip) **and** `aria-label` (screen-reader name) — an icon
  glyph has no text, so both are enforced by the type. Every other `<button>` prop is forwarded.
- **Sizing:** defaults to a 32px (`h-8 w-8`) square; pass `className` to override for a surface.

```tsx
<IconButton variant="danger" title="Delete task" aria-label="Delete task" onClick={remove}>×</IconButton>
```

## `ConfirmDialog` + `useConfirm` — `ConfirmDialog.tsx`, `use-confirm.tsx`

A promise-returning confirm that replaces bare `window.confirm()` with an app-themed modal.
`<ConfirmProvider>` is mounted once at the app root (see `src/App.tsx`); any descendant calls the
hook:

```tsx
const confirm = useConfirm()
if (await confirm({ title: `Delete "${task.text}"?` })) softDelete.mutate(task.id)
```

Options: `title`, optional `message`, `confirmLabel` / `cancelLabel`, and `tone` (`danger` by
default → red confirm button). Dismiss via Cancel, the scrim, or Escape (all resolve `false`).

Current adopters: `HabitsView`, `DoneView`. Later delete sites (grid card, list row, cluster
popup, backups) adopt these as they're reworked.

## Danger token

`danger` (`#b3392f`, a warm brick red) is defined in `tailwind.config.js` alongside `primary` /
`accent` for destructive styling — used by `IconButton`'s danger variant and `ConfirmDialog`.

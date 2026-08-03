// InstallPanels — drawn "screenshot" recreations for the setup wizard. Real screenshots would be
// binary assets someone has to capture and re-capture every OS redesign; these SVG lookalikes of
// the exact browser UI (iOS share sheet, Safari's File menu, Chrome's install icon) are shipped
// as code, follow the app theme, and can be swapped for real captures later without changing the
// wizard (each panel fills the same slot). All panels are decorative (aria-hidden) — the numbered
// instructions beside them are the accessible content. Hex literals are scene paint (depicting
// Apple/Google UI, like App.tsx's claw-swipe artwork), not theme colors.

import type { ReactNode } from 'react'

const ACCENT = '#c2693f' // the app's terracotta — circles the control to tap
const IOS_BLUE = '#3b82d0' // iOS Safari's toolbar-icon blue, muted a step to sit on warm paper

function Frame({
  children,
  viewBox,
  className,
}: {
  children: ReactNode
  viewBox: string
  className?: string
}) {
  return (
    <svg
      viewBox={viewBox}
      aria-hidden
      className={'block h-auto w-full max-w-[300px] select-none ' + (className ?? '')}
    >
      {children}
    </svg>
  )
}

/** iOS Safari's bottom toolbar with the Share button circled. */
export function IosShareToolbar() {
  return (
    <Frame viewBox="0 0 300 84">
      {/* phone-bottom chrome */}
      <rect x="6" y="26" width="288" height="46" rx="12" fill="#ffffff" stroke="#ddd4c0" />
      {/* back / forward chevrons */}
      <path
        d="M40 44 l-8 8 8 8"
        fill="none"
        stroke="#b9b2a2"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      <path
        d="M78 44 l8 8 -8 8"
        fill="none"
        stroke="#d8d2c4"
        strokeWidth="2.4"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
      {/* share: square with the arrow escaping up */}
      <g
        stroke={IOS_BLUE}
        strokeWidth="2.4"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M141 50 h-4 a4 4 0 0 0 -4 4 v8 a4 4 0 0 0 4 4 h16 a4 4 0 0 0 4 -4 v-8 a4 4 0 0 0 -4 -4 h-4" />
        <path d="M145 56 V38 M139 43.5 145 37.5 151 43.5" />
      </g>
      {/* book + tabs, faint */}
      <path
        d="M208 44 v20 M208 44 c-6 -3 -12 -3 -16 0 v20 c4 -3 10 -3 16 0 c6 -3 12 -3 16 0 v-20 c-4 -3 -10 -3 -16 0"
        fill="none"
        stroke="#d8d2c4"
        strokeWidth="2"
      />
      <rect
        x="252"
        y="46"
        width="16"
        height="16"
        rx="3"
        fill="none"
        stroke="#d8d2c4"
        strokeWidth="2"
      />
      {/* the callout: circle + label */}
      <circle cx="145" cy="52" r="19" fill="none" stroke={ACCENT} strokeWidth="2.4" />
      <path d="M145 26 v4" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
      <text x="145" y="16" textAnchor="middle" fontSize="11" fontWeight="600" fill={ACCENT}>
        tap Share
      </text>
    </Frame>
  )
}

/** The iOS share sheet scrolled to the "Add to Home Screen" row. */
export function IosShareSheet() {
  return (
    <Frame viewBox="0 0 300 108">
      <rect x="6" y="4" width="288" height="100" rx="14" fill="#ffffff" stroke="#ddd4c0" />
      {/* grab handle */}
      <rect x="134" y="10" width="32" height="4" rx="2" fill="#e2dccc" />
      {/* row: Copy (faint) */}
      <rect
        x="24"
        y="22"
        width="18"
        height="18"
        rx="4"
        fill="none"
        stroke="#c9c2b0"
        strokeWidth="1.8"
      />
      <text x="52" y="35" fontSize="11.5" fill="#a49b87">
        Copy
      </text>
      <line x1="24" y1="48" x2="276" y2="48" stroke="#efe9da" />
      {/* row: Add to Home Screen (highlighted) */}
      <rect
        x="18"
        y="53"
        width="264"
        height="26"
        rx="7"
        fill="#faf3ec"
        stroke={ACCENT}
        strokeWidth="1.8"
      />
      <g stroke="#2e2a24" strokeWidth="1.8" fill="none" strokeLinecap="round">
        <rect x="26" y="58" width="16" height="16" rx="4" />
        <path d="M34 62 v8 M30 66 h8" />
      </g>
      <text x="52" y="70" fontSize="11.5" fontWeight="600" fill="#2e2a24">
        Add to Home Screen
      </text>
      <text x="268" y="70" textAnchor="end" fontSize="11" fontWeight="600" fill={ACCENT}>
        ← this one
      </text>
      {/* row: Markup (faint) */}
      <path d="M26 90 l10 -6 3 5 -10 6 z" fill="none" stroke="#c9c2b0" strokeWidth="1.6" />
      <text x="52" y="93" fontSize="11.5" fill="#a49b87">
        Markup
      </text>
    </Frame>
  )
}

/** macOS Safari's menu bar with File → "Add to Dock…" open. */
export function SafariFileMenu() {
  return (
    <Frame viewBox="0 0 300 112">
      {/* menu bar */}
      <rect x="6" y="6" width="288" height="22" rx="6" fill="#ffffff" stroke="#ddd4c0" />
      <text x="20" y="21" fontSize="11" fontWeight="600" fill="#5f584a">
        Safari
      </text>
      {/* File, selected like a real open menu */}
      <rect x="76" y="8" width="36" height="18" rx="4" fill={IOS_BLUE} />
      <text x="94" y="21" textAnchor="middle" fontSize="11" fontWeight="600" fill="#ffffff">
        File
      </text>
      <text x="126" y="21" fontSize="11" fill="#8a8272">
        Edit
      </text>
      <text x="158" y="21" fontSize="11" fill="#8a8272">
        View
      </text>
      {/* dropdown */}
      <rect x="76" y="30" width="150" height="72" rx="8" fill="#ffffff" stroke="#ddd4c0" />
      <text x="88" y="48" fontSize="11" fill="#a49b87">
        New Window
      </text>
      <rect
        x="80"
        y="56"
        width="142"
        height="20"
        rx="5"
        fill="#faf3ec"
        stroke={ACCENT}
        strokeWidth="1.6"
      />
      <text x="88" y="70" fontSize="11" fontWeight="600" fill="#2e2a24">
        Add to Dock…
      </text>
      <text x="236" y="70" fontSize="11" fontWeight="600" fill={ACCENT}>
        ← click
      </text>
      <text x="88" y="92" fontSize="11" fill="#a49b87">
        Close Window
      </text>
    </Frame>
  )
}

/** Chrome/Edge's address bar with the install icon at its right end circled. */
export function ChromeInstallBar() {
  return (
    <Frame viewBox="0 0 300 76">
      <rect x="6" y="30" width="288" height="34" rx="17" fill="#ffffff" stroke="#ddd4c0" />
      {/* padlock + address */}
      <g stroke="#8a8272" strokeWidth="1.6" fill="none" strokeLinecap="round">
        <rect x="24" y="44" width="11" height="9" rx="2" />
        <path d="M26.5 44 v-3 a3 3 0 0 1 6 0 v3" />
      </g>
      <text x="46" y="52" fontSize="12" fill="#5f584a">
        todoclaw.app
      </text>
      {/* faint bookmark star */}
      <path
        d="M242 41 l2.6 5.3 5.9 .9 -4.3 4.1 1 5.8 -5.2 -2.7 -5.2 2.7 1 -5.8 -4.3 -4.1 5.9 -.9 z"
        fill="none"
        stroke="#d8d2c4"
        strokeWidth="1.5"
      />
      {/* install icon: a little screen with the arrow landing in it */}
      <g
        stroke="#5f584a"
        strokeWidth="1.9"
        fill="none"
        strokeLinecap="round"
        strokeLinejoin="round"
      >
        <path d="M264 41 h16 a2 2 0 0 1 2 2 v9 a2 2 0 0 1 -2 2 h-16 a2 2 0 0 1 -2 -2 v-9 a2 2 0 0 1 2 -2 Z" />
        <path d="M272 43.5 v6 M269 47 l3 3 3 -3" />
      </g>
      <circle cx="272" cy="47.5" r="14" fill="none" stroke={ACCENT} strokeWidth="2.2" />
      <path d="M272 30 v3" stroke={ACCENT} strokeWidth="2" strokeLinecap="round" />
      <text x="272" y="20" textAnchor="end" fontSize="11" fontWeight="600" fill={ACCENT}>
        click the install icon
      </text>
    </Frame>
  )
}

/** A dock strip with the TodoClaw paw icon highlighted — "open it from HERE from now on". */
export function DockScene() {
  return (
    <Frame viewBox="0 0 300 74">
      <rect x="34" y="16" width="232" height="44" rx="14" fill="#ffffff" stroke="#ddd4c0" />
      {/* neighbour apps, faint */}
      <rect x="48" y="26" width="24" height="24" rx="6" fill="#efe9da" />
      <rect x="82" y="26" width="24" height="24" rx="6" fill="#e7e0cf" />
      <rect x="116" y="26" width="24" height="24" rx="6" fill="#efe9da" />
      {/* TodoClaw: warm-paper tile with the paw */}
      <rect
        x="152"
        y="23"
        width="30"
        height="30"
        rx="8"
        fill="#f4efe6"
        stroke={ACCENT}
        strokeWidth="2"
      />
      <g fill="#2e2a24">
        <ellipse cx="167" cy="42" rx="5.4" ry="4.4" />
        <circle cx="160.5" cy="35" r="2.2" />
        <circle cx="166" cy="32.5" r="2.4" />
        <circle cx="172" cy="34.5" r="2.2" />
      </g>
      <rect x="192" y="26" width="24" height="24" rx="6" fill="#e7e0cf" />
      <rect x="226" y="26" width="24" height="24" rx="6" fill="#efe9da" />
      <text x="167" y="12" textAnchor="middle" fontSize="11" fontWeight="600" fill={ACCENT}>
        open TodoClaw here
      </text>
    </Frame>
  )
}

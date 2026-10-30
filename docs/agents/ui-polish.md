# Web UI refinement with Impeccable

This pass applies [Impeccable](https://github.com/pbakaus/impeccable) 4.8.0
to the existing conversation interface. It uses the Operate guidance and polish
playbook, retaining the established typography, reading width, translations,
and independent mode, palette, and reading-font preferences.

## Conventions

- Use semantic palette tokens for chart series, selections, focus, and input carets.
  Token activity intensity increases toward the palette's primary color.
- Keep the welcome screen quiet. Separate activity from the invitation with one
  divider, without another enclosing card.
- Give sidebar actions consistent alignment and spacing; emphasize New chat.
- `client/src/focus.css` owns keyboard focus: fields and keyboard-focused
  controls use a small soft shadow; menu rows use their selected background.
  Compound fields own the shadow, with no inner-input ring or duplicate rim. Toolbar focus does not
  highlight the composer. Forced colors retain a stronger system indicator.
  Icon-only composer actions need explicit accessible names. Preserve running,
  disabled, and stop states.
- Below 640px, settings categories become horizontally scrollable tabs with
  horizontal keyboard navigation. The body scrolls independently of the footer.
- Keep annual activity cells legible in an internal horizontal scroller on
  narrow screens. Show the latest dates when the available width changes.
- Coarse-pointer controls have a minimum 44px target. Respect the existing
  reduced-motion behavior and native Radix selection semantics.

## Verification (2026-10-30)

- `npm run build:web`: passed; existing large-chunk warning remains.
- `node scripts/run-tests.js tests/web-appearance.test.js tests/web-typography.test.js tests/web-shell-settings.test.js tests/web-light-overlay-tokens.test.js tests/token-activity.test.js tests/web-secret-settings.test.js`: 33 passed.
- An additional `tests/web-disclosure-tree.test.js` check fails at line 79 on
  the existing MessageBubble answer-fold class assertion. Neither that component
  nor that test was modified in this pass.
- Browser checks: desktop light/default, 390px dark/warm, 768px page bounds,
  390px settings tabs and form bounds, save/cancel/reload behavior, arrow-key tab
  navigation, visible keyboard focus, and latest-date activity scrolling.
  No console errors were captured. No model request was submitted.
- Impeccable's mechanical scan reported two existing suggestions in style.css:
  Geist Mono and the prism loading-dot animation. The code font remains part of
  the established system; the loading animation is outside this refinement.
  A clean detector result is not a substitute for visual review.

The skill is installed in the user's Codex skills directory rather than bundled
as an application dependency. No automatic design hooks were enabled.

Focus follow-up: removed competing global focus rules and focus-only shadows in
11 shared controls. Build and 18 appearance/typography/overlay/shell checks passed.
Browser checks confirmed the composer and settings inputs have no outline/shadow,
and keyboard navigation retains an inset indicator on toolbar buttons. The focused
field's existing border remains visible. Mechanical scan of the focus stylesheet,
shared controls and Apple styles reported no findings.

Visual follow-up: the user preferred a small shadow over stronger edges. Focus
now uses a single 0 2px 8px shadow (12% black in light mode, 32% in dark mode).
High-contrast modes retain explicit outlines. Build passed; browser inspection
confirmed one composer shadow and no inner-textarea shadow or outline.

Composer follow-up (2026-10-31): restored the existing conic colored edge and violet halo on hover/focus, while leaving the shared soft-shadow focus treatment intact. The inner textarea remains free of an extra outline/shadow; reduced-motion disables the edge animation. Build passed. Live browser review was not completed because automatic approval rejected use of the local login token.

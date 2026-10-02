# AI contributor guide

Read this file and docs/SETUP.md before changing code. This is a standalone sharing repository, not a checkout of the live deployment. Do not publish, connect cloud projects or create GitHub repositories unless the user explicitly asks.

## Start here

- Work at repository root. Require Node 24.x; use the committed package-lock with `npm ci`.
- Run `npm test`, `npm run data:check`, `npm run build`. Success means all tests pass, included data is clean, and dist/client/index.html exists. Do not infer browser or field success from a build.
- Run `npm run dev -- --host 127.0.0.1 --port 4190 --strictPort` and verify the local UI when a browser is available. Do not silently switch an occupied port; choose and document another explicit port.
- Initial mode uses included Pohang data. `npm run data:regions` is optional and requires network/disk; see docs/DATA.md. Never commit downloaded packs, raw sources, caches or build output.
- For comparisons, read docs/POLICY.md and docs/EXPERIMENTS.md. Do not silently turn unknown elevation/signals into zero or change ranking weights while presenting a generator-only comparison.
- Keep commit identity as configured. The owner's commit email is explicitly permitted. Do not rewrite it or change global Git configuration.
- Personal machine paths and live deployment identifiers do not belong in sources/docs. Preserve data attribution, object IDs and input snapshot provenance.
- Read PUBLIC-RELEASE-REVIEW.md; after staging the intended publication files run `npm run check:release`. Its pattern scan is bounded, not a claim of perfect secrecy.

## Editing boundaries

App-specific work belongs in src/Prototype.tsx, src/prototype.css and related app modules. Preserve the shared mobile runtime and its integrity check: `npm run check:runtime`. Do not weaken lock checks to make a test pass. src/mobile/, App/main/styles, device artwork, vite.config.ts and the inherited build-helper/worker files remain unchanged unless the user specifically authorizes a runtime change.

The inherited Sites helper/worker files remain solely to preserve the scaffold integrity contract. Default build does not call the helper and no cloud configuration is included. Do not execute it or recreate the prior cloud binding as a setup step. Static output and `npm run preview` are sufficient.

## Development rules

Keep scripts repository-relative and portable between machines. No credentials are needed for the base workflow. Shared metadata cleanup rules live in data/privacy-policy.json; both JS and Python preparation must use them. Save only sanitized regional packs, update their hashes/version, and publish a manifest only after every file is ready. Full regeneration needs Python separately; it is not a prerequisite for npm tests.

Document changes to policy and data version. Preserve baseline engine hashes in source-provenance.json as historical provenance; if you change an engine module, explicitly record the divergence instead of claiming it is still the unchanged baseline.

## Runtime Contract

- Preserve the mobile device runtime unless the user's task explicitly asks otherwise. Do not replace it with a standalone page. Visual fidelity applies to app-owned content inside the device screen, not to template-owned device chrome.
- Keep `App` composed around `PhoneFrame` -> `KeyboardProvider`, with `StatusBar`, app content, `HomeIndicator`, and `KeyboardDock` mounted inside the phone frame. `StatusBar` and the iOS home indicator are overlaid device chrome. When the Android keyboard is closed, the app viewport reserves the protected navigation-bar region instead of painting behind it. When the Android keyboard is open, preserve the current full-screen keyboard layout: its asset includes the IME navigation strip and the separate black navigation bar is hidden. iOS screens continue to paint behind the home-indicator area and own their safe-area content padding.
- Preserve the `iPhone` / `Pixel 10` device picker and both calibrated device presets. The Pixel screen is `427 x 952`; its `32 x 32` camera circle and `public/assets/android/navigation-bar.svg` bottom navigation bar are protected device chrome, not app content.
- Preserve the device picker's intentionally lightweight Codex styling in the top-right corner: its trigger wrapper is borderless and transparent, its trigger sizes to content, and its right-aligned menu uses the compact 3px inset plus the specified hairline and elevation shadow layers. Keep the prototype root and default app screen white.
- Preserve `StatusBar` as live device chrome, including its platform-specific typography, source status-icon assets, and spacing. Pixel 10 uses Roboto, Android indicators, and 32px top, left, and right padding. iPhone uses its iOS indicators, system typography, and calibrated spacing. Do not hardcode screenshot times like `9:41` into the status bar, replace its real-time clock, or move status bar content into app markup unless the user explicitly asks for a fixed/mock device time.
- `PhoneFrame` owns the calibrated device frame, screen portal, device picker, camera cutout, and custom cursor. Keep device assets in `public/assets/iphone/` and `public/assets/android/`; if an asset fails to load, repair the asset path or restore the asset instead of removing the frame, keyboard, or image render.
- Use `MobileScroll` directly for simple single-screen prototypes. Use `FlowStack` for conventional multi-screen flows whose routes can own their fixed header and footer; when using it, define each route as a `FlowScreen`: `{ id, header?, headerHeight?, footer?, footerHeight?, render }`, and use `flow.push(screen)`, `flow.pop()`, and `flow.replace(screen)` from `FlowStack` render callbacks or `useFlow()` instead of introducing another router.
- Use `Carousel` for a carousel, horizontal rail, swipeable cards, image or media strip, horizontally scrollable cards, chip rail, or other horizontal collection.
- For a layered app shell—such as a persistent composer, independently presented sheet, pushed/peek sidebar, or app-wide transition—compose directly in `Prototype.tsx` rather than forcing it through `FlowStack`. Keep app-owned fixed chrome as sibling layers outside `MobileScroll`.
- When using `FlowScreen`, put route-owned fixed headers or footers in `FlowScreen.header` or `FlowScreen.footer`. Set `headerHeight` to the visible app-toolbar height; `FlowStack` adds the device's top safe-area/status-bar inset automatically. Do not include `StatusBar` or its height in the header. Set `footerHeight` to the full app-footer height. `FlowScreen.footer` is an overlay, not reserved layout space; screens using it must add their own bottom content padding such as `padding-bottom: calc(var(--flow-footer-height) + var(--mobile-safe-area-height) + 24px)` so final content can scroll above the footer while still painting behind it.
- Render only scrollable content inside `MobileScroll`; it is for content that should move with scroll and rubber-band overscroll. Keep app-owned headers, nav bars, tabs, composers, and overlays outside it. This keeps scroll physics, safe areas, keyboard insets, scrollbars, and drag click suppression active without letting content paint under fixed chrome.
- Buttons, links, cards, and images inside `MobileScroll` should still allow drag scrolling when the pointer moves beyond tap slop. Use `data-scroll-drag="ignore"` only for rare controls that must own the drag gesture themselves.
- Do not add `var(--keyboard-height)` to ordinary screen/content padding inside `MobileScroll`; the scroll viewport already shrinks above the simulated keyboard. For custom fixed composers, search bars, or toast chrome, use `useKeyboardInsets().bottomInset`. It is relative to the app viewport: Android returns `0` while the closed-keyboard viewport already reserves navigation, then returns the keyboard height while open; iOS continues to clear the home indicator while closed and ride directly above the keyboard while open. Do not pin custom bottom chrome to `bottom: 0` or only `keyboardHeight`.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for every text-entry control. A raw `input` or `textarea` disconnects focus, keyboard animation, safe-area insets, and attached surfaces.
- Use `BottomSheet` for phone-scoped sheets. Its props are `open`, `onOpenChange`, `title`, optional `description`, optional `snap`, and `children`; it renders through the phone screen portal and dismisses the keyboard before opening.

## Horizontal Carousels

- Use `Carousel` for horizontally draggable cards, images, media, chips, or other horizontal collections. Do not recreate these with `overflow-x`, custom pointer handlers, or a generic div.
- `Carousel` can be nested directly inside `MobileScroll`. It owns horizontal gestures and automatically yields vertical gestures to the parent.
- Never put `data-scroll-drag="ignore"` on or around a `Carousel`; doing so prevents vertical parent scrolling when a gesture begins inside it.
- Do not add CSS scroll snapping to `Carousel`; its runtime owns momentum and release motion.
- Use `data-scroll-drag="ignore"` only when a control must prevent parent scrolling in every drag direction.

See `src/mobile/COMPONENTS.md` for the full component and gesture contract.

## Keyboard Rule

The simulated keyboard is a separate top-layer component. Before presenting anything that behaves like iOS navigation or modal UI, dismiss it first.

Call `keyboard.hide()` before:

- pushing, popping, or replacing FlowStack routes
- opening bottom sheets, action sheets, dialogs, menus, or navigation sheets
- starting transitions where the destination should not inherit text-input focus

`FlowStack` already hides the keyboard for `push`, `pop`, and `replace`. `BottomSheet` already hides it before opening. If you add new modal/sheet/navigation primitives, follow the same rule.

When a composer, search surface, or other keyboard-attached component closes, call `keyboard.hide()` in the same event before changing that component's open state. Position attached surfaces from `useKeyboardInsets()` rather than a separate timer or visibility flag so both dismiss together.

When any text-entry control loses focus, dismiss the simulated keyboard. If the control is custom or does not use the runtime's keyboard-aware fields, handle its blur event and call `keyboard.hide()` explicitly. Keep the keyboard open only when focus is moving directly to another text-entry control that should share the same keyboard session.

## Interaction Rules

- Do not trigger buttons or inputs after a pointer has become a drag. Preserve the drag suppression behavior in `MobileScroll`.
- Do not allow native browser image/file dragging inside the phone frame. Preserve the phone-level `dragstart` suppression and non-draggable image styles so scroll drags that begin on images still scroll the prototype.
- Use `KeyboardInput`, `KeyboardTextarea`, or `MobileTextField` for text entry so the simulated keyboard and safe-area insets stay connected.
- Fixed phone chrome should not animate with pushed screens. Screen content can animate; the status bar, camera cutout, and preview chrome should stay put.
- Keep the keyboard below the home indicator/safe area layer in z-index, and above ordinary app UI while visible.
- Keep the home indicator as the topmost safe-area layer in the z-index above everything else in the prototype.

## Running PoC decisions (2026-09-30 revision)

- User requested release-to-center recommendation cards. Add opt-in centered settling to Carousel gesture physics; keep the independent information-chip rail freely scrollable. Cards leave a neighboring preview on both sides where available.
- New input flows calculate routes from the confirmed start using the saved pedestrian network. Fixed case links remain reproducible examples until the user edits the start or distance, which switches to real calculation.
- Default information layers remain elevation/signals on and shops/water off. Use equal-width two-line chips with an overflow arrow so later layers are discoverable despite varying labels/counts.

- User explicitly requested a responsive runtime: viewport widths up to 600px use an edge-to-edge iPhone UI; narrow touch landscape viewports also use fullscreen. Wide screens retain the calibrated device preview and picker. This authorizes the corresponding runtime file and lock changes.
- In fullscreen mode, use actual viewport dimensions, system keyboard, and CSS safe-area insets. Do not draw a fake bezel, camera, status bar, home indicator, or keyboard over a real phone. Resizing must preserve app state.

- The result chips are independent map layer toggles: elevation, signal crossings, convenience stores, drinking-water facilities. Never replace them with informational popups.
- Give the map more screen space. Place the horizontally draggable chip rail above the map, using the shared Carousel. Use one neutral active/inactive style rather than per-category colored pills.
- The elevation number means highest minus lowest elevation, in meters, matching the flatness recommendation. It is not maximum grade or cumulative ascent.
- Default route colors combine signed grade and magnitude: uphill red, downhill blue, darker for steeper, neutral within ±3%. Height remains a separate fixed-link comparison.
- Do not render A/B/C or expression controls in the result view. The expression is chosen in the URL. A is height, B is signed grade, and the old C URL is a compatibility alias for B.
- Toggling a map layer must not change candidates, recommendation order, selection, or map viewport. Hiding elevation leaves the base route visible. Show registered drinking-water facilities without claiming current supply or drinkability.


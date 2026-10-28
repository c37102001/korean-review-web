# Test Reliability

## Run And Inspect

- Run `npm ci` before testing. Web unit tests use `npm run test:web`; real App workflows use `npm run test:app` with the local Auth and Firestore emulators.
- Run visual checks with `npm run test:visual`. Locally this starts Docker with the pinned image in `tests/visual/environment.json`; CI runs the same image directly. Docker must be available locally. Keep the CI container image and the JSON image in sync when upgrading Playwright, including its installed package version.
- `npm run test:visual:update -- tests/visual/core-surfaces.spec.js --grep 'notes|folders-overview'` updates only matching baselines in the same container. Inspect actual images and diffs before committing. A missing baseline needs review too.
- Keep one canonical `playwright-1.63-noble` baseline set. The obsolete host-specific Linux images were removed; no viewport or test was removed with them.
- Failure artifacts include screenshots and traces. Open `trace.zip` with `npx playwright show-trace <path>`. App HTML reports are in `playwright-app-report/`; visual reports are in `playwright-report/` in CI.

## Interaction Contracts

- Prefer roles and exact accessible names scoped to the relevant card, dialog or page. Use a test ID for otherwise ambiguous controls. CSS may identify an ownership boundary, but a CSS class or source expression alone cannot prove user behavior.
- Use `click`, `check`, `fill` and other normal Playwright actions. Dispatching events is reserved for controlled fault injection or low-level gestures; it must not replace a user-click test. Click the visible label for a visually hidden checkbox.
- Wait for observable outcomes, including rendered data and persisted values. Do not replace readiness with sleeps, global timeout increases or retries.
- Live fixtures use Emulator `REQUEST_TIME` for `updatedAt`, matching production writes. Keep `date` and `createdAt` fixed for deterministic scheduling and ordering. Backdated fixture updates can be invisible to an active incremental query and must not be used as ordinary UI setup.
- Use the shared `expandAllContentGroups(page, { target })` when navigating to known content. It retries expansion as new groups arrive until the target is visible. Without a target it expands only groups currently available; it does not promise future synchronization is complete.
- Keep the emulator suite at one worker while it resets a shared database and changes global security rules. Restore modified rules in `finally`.
- `prepareAppPage` collects uncaught browser errors and checks them when its returned assertion is called. Controlled error tests must declare narrow expected error patterns; do not ignore all console or runtime errors.

## Coverage And Baselines

- Keep unit tests for scheduling, parsing, selection and merging; emulator tests for persistence and rules; browser workflows for user commands; visual snapshots for layout. These layers answer different questions.
- Removed source-text checks are covered by real operations: daily review across dates by `H01 H07 P02-P03 P08`, on-demand tomorrow count by `H02`, reading tag/learned behavior by `R01 R02`, and collapsed defaults plus late-arriving content by `G04`.
- Keep architectural dependency restrictions. A feature's variable name, inline callback shape or `useState` initializer is not an architectural contract.
- `folder` is the word-card collection fixture. `folders-overview` renders the real folder overview. `notes` covers collapsed categories; `notes-expanded` covers real note cards. All run at 360px, 390px and desktop widths.
- Visual checks retain the existing pixel tolerance. An intended UI change requires reviewing its affected baselines; an unexpected failure requires diagnosis. Do not auto-accept all snapshots or delete failing coverage.

## Verification Scope

After changes, run affected cases, then the broader suite when shared behavior is touched. Repeated failures must be diagnosed using artifacts. A retry passing alone does not establish stability, and a green suite cannot guarantee every browser or external service will work.

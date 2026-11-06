# UI-08 Studio redesign specification

## Product shell

BLOCKLAB Studio should be a dark-first developer tool with five primary
destinations:

1. **Overview** — current project, health, recent runs, unresolved findings,
   and next safe action.
2. **Projects** — import/select project, inspection summary, dependency graph,
   chain/RPC references, limitations, and permission status.
3. **Attack Lab** — scenario catalogue, safety scope, preflight, configuration,
   and explicit launch.
4. **Experiments** — runs, live timeline, results, replay, comparison, and
   evidence export.
5. **History** — local evidence and optional Arkiv metadata, with provenance
   and expiry caveats.

Settings is a shell-level destination for local-agent pairing, permissions,
network configuration, and integration status. It must not expose secrets.

Desktop uses a fixed left rail plus contextual header. Tablet collapses the
rail to an accessible menu. Mobile is not the primary target but must retain
the workflow and never hide safety text behind hover.

## Navigation and state

The URL should identify the project and destination, for example:

```text
/projects/:projectId/overview
/projects/:projectId/attack-lab
/projects/:projectId/experiments/:runId
/projects/:projectId/history
/settings
```

Navigation state is presentation state only. The local agent owns project
inspection and execution state. The browser receives typed snapshots/events,
not arbitrary filesystem handles, process objects, private keys, or raw
credentials.

Every page has explicit `loading`, `ready`, `empty`, `error`, and `blocked`
states. A blocked state explains the missing permission or prerequisite and
offers the next safe action.

## Design tokens

Use CSS custom properties with semantic names:

```css
--surface-0: #0b0e13;
--surface-1: #11161e;
--surface-2: #171e28;
--surface-3: #202a37;
--border-subtle: #293545;
--text-primary: #edf2f7;
--text-secondary: #9aa8b8;
--accent-blue: #5da7ff;
--status-success: #44c58a;
--status-warning: #e6b85f;
--status-danger: #ec727d;
--status-info: #72b8d8;
```

Use one radius scale (`4px`, `8px`, `12px`), one shadow for elevated
surfaces, and a spacing scale based on 4px. Avoid gradients and decorative
glows. Status color must always be paired with text or an icon label.

Typography:

- UI: system sans or Inter-like sans, 14px base.
- Technical identifiers and JSON: a readable monospace face.
- Page title: 24–28px, semibold.
- Section title: 16–18px, semibold.
- Metadata: 12–13px with high contrast, never below accessible contrast.

## Components

Required primitives:

- App shell, rail, breadcrumbs, page header.
- Status badge with text and accessible label.
- Metric tile with value, unit, source, and limitation.
- Data table with dense/comfortable modes and responsive card fallback.
- Timeline with timestamp, event type, source, and outcome.
- Evidence/provenance banner.
- Safety scope panel.
- Confirmation drawer for writes or execution.
- Empty/error/blocked state.
- Copy-to-clipboard control that never copies secrets by default.

Components must accept validated data models and must not perform network or
filesystem operations. Actions are callbacks owned by the page/application
adapter.

## Core workflows

### Import → inspect

1. Select a local project through the local agent or a future safe GitHub/URL
   import flow.
2. Show permission mode before access.
3. Display inspection progress as agent events.
4. Render detected stacks, dependency graph, chain/RPC references, and
   limitations.
5. Require explicit acknowledgement before an experiment can use the project.

### Inspect → configure → test

1. Choose a verified scenario from Attack Lab.
2. Show target, loopback/staging mode, fault window, timeout, and resource
   limits.
3. Display preflight results and rejected conditions.
4. Require explicit launch confirmation.
5. Show actual runner events; never animate an assumed timeline.

### Run → recover → report

1. Show created/preparing/running/cancelling/terminal state.
2. Show baseline, fault, recovery, and cleanup events with timestamps.
3. Make cancellation and emergency stop available according to capability.
4. Render evaluator status, metrics, evidence digest, limitations, replay, and
   compare actions.
5. Keep detailed traces local; publishing compact metadata is a separate
   explicit action.

### History → verify → publish

1. Search local evidence and optional Arkiv metadata separately.
2. Label source, validation state, expiry uncertainty, and digest.
3. Allow publish only from a validated compact record.
4. Show exact public disclosure and require wallet approval.
5. Show receipt and read-back verification; never show “published” before both
   are known.

## Responsive and accessibility rules

- Keyboard navigation must reach every action in logical order.
- Focus must move to page-level errors and confirmation drawers.
- Tables become horizontally scrollable before they collapse into cards.
- Timeline entries preserve timestamp and event type in the collapsed layout.
- Do not rely on color alone for status, route, privacy limitation, or error.
- Respect reduced-motion preferences; animation is limited to state transitions.
- Destructive or signing actions require visible text confirmation.

## Out of scope for the redesign phase

This specification does not implement a local agent, hosted authentication,
new attack scenarios, or new Arkiv protocol behavior. It defines the UI
contract that those adapters must satisfy.

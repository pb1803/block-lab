# UI-10 Projects workflow

UI-10 connects the UI-09 Studio shell to the inspect-only Local Agent.

## User flow

1. Start the agent with an explicit project directory.
2. Open Studio → Projects.
3. Enter the printed agent URL and pairing code.
4. Studio lists the explicitly authorized project.
5. Select **Inspect project**.
6. Studio renders the detected stack, package managers, chains, networks, RPC
   references, and inspector limitations.
7. Reinspection is explicit. Disconnect/revoke clears the browser session.

The browser never chooses arbitrary filesystem paths, receives environment-file
contents, runs scripts, installs dependencies, or starts an experiment.

## State truthfulness

Overview and Projects use actual Local Agent state:

- disconnected: no agent session exists;
- pairing: a user-triggered pairing request is in flight;
- connected: health, session, and project listing succeeded;
- error: the latest request failed and its message is shown.

No project counts, inspection results, or connection state are fabricated.
Unimplemented GitHub import and experiment execution remain unavailable.

## Integration boundary

`apps/local-agent` owns loopback HTTP, Origin validation, session credentials,
authorization, and calls to `@blocklab/inspector`. `apps/studio` owns the
typed browser client and presentation. The CLI continues to call the
inspector directly. No execution engine or blockchain transaction behavior was
changed.

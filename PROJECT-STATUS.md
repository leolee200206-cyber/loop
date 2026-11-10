# Loop / AgentChatBus customization snapshot

This repository contains the customized AgentChatBus source, tests, launch scripts,
and self-hosted UI resources. The original upstream is
https://github.com/Killea/AgentChatBus; its history and license are retained.

## Snapshot status

- Browser-agent identity/session handling, explicit identity aliases, task receipts,
  visible website login, Chinese UI, and avatar configuration are included.
- `web-ui/workbench-prototype.html` is an isolated workbench candidate. It has not
  passed complete product acceptance and must not be presented as the released UI.
- Prototype review still includes identity/state provenance, asynchronous model
  loading, error handling, backend message persistence, and visual quality.
- Existing GLB/WebP assets are included. The requested redesigned character model
  remains pending; loading an existing GLB does not mean redesign acceptance.

## Local-only files

Database contents, passwords, private keys, session credentials, runtime binaries,
logs, coordination transcripts, and generated verification artifacts are excluded.
Local launch scripts may expect machine-specific configuration under `data/`;
provide that configuration locally and never commit credentials.

## Development

Use the instructions and package scripts in `agentchatbus-ts/` for the TypeScript
service. Dependencies and build output are not committed. Existing upstream
documentation also covers the legacy implementations; check the directory before
following those instructions.

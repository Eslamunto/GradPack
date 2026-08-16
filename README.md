# GradPack

> Pack your courses. Keep your knowledge.

GradPack is an open-source Chrome extension for students who want to preserve
their accessible Canvas course materials as a useful local archive.

The project is currently in its product-definition and feasibility phase.

## License

Licensed under the [Apache License 2.0](LICENSE).

## Development

Prerequisites: Node.js 22.22.2 and pnpm 11.17.0.

```bash
pnpm install --frozen-lockfile
pnpm verify
pnpm build
```

To inspect the local build, open `chrome://extensions`, enable Developer mode,
select **Load unpacked**, and choose this repository's `dist/` directory. Keep a
signed-in Frankfurt School Canvas tab open while GradPack is running.

Contributors can use the development-only [live Canvas smoke-test
workflow](docs/development/live-canvas-smoke-test.md) to verify an authorized
local session. It is not an end-user feature.

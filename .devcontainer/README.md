# Dev Container Setup

This project uses a Dev Container configuration for consistent development environments.

## Features

- **Bun Runtime**: Installs bun
- **VS Code Extensions**: Pre-installed essential extensions for:
  - Bun development
  - ESLint
  - Prettier
  - TypeScript
  - Tailwind CSS

## Getting Started

1. Open this repository in VS Code
2. When prompted, click "Reopen in Container"
3. Wait for the container to build and dependencies to install

## Manual Setup (if needed)

If you need to build:

```bash
# Clean and reinstall
bun run clean
bun install

# Run production mode
bun run build

# Run tests
bun test

# Run example
(cd examples/web && bun run preview)
```

## Useful Development Commands

```bash
# Watch all packages (run in separate terminal)
bun run watch

# Watch examples (run in separate terminal)
bun run dev

# Run tests (run in separate terminal)
bun test --watch
```

# `@workglow/util/debug`

Debug utilities for Workglow AI task pipelines.

## Overview

The `@workglow/util/debug` subpath provides debugging tools for Workglow, including Chrome DevTools custom formatters that enable rich console output for task graphs, workflows, tasks, and dataflows.

This module is **browser-oriented** (it uses `window` and the DevTools formatter API). Import it only from browser or Bun front-end bundles.

## Features

- **Chrome DevTools Custom Formatters**: Rich, colored console output for Workglow objects
  - **Dark Mode Support**: Automatically adapts colors based on browser theme
  - **DAG Visualization**: Visual graph rendering for directed acyclic graphs
  - **React Element Formatting**: Pretty-print React elements in the console

## Installation

The debug helpers ship with `@workglow/util`. You also need `@workglow/task-graph` installed (peer dependency) for types and runtime classes used by the formatters.

```bash
npm install @workglow/util @workglow/task-graph
# or
bun add @workglow/util @workglow/task-graph
```

## Usage

### Installing DevTools Formatters

Call `installDevToolsFormatters()` early in your application to enable rich console output:

```typescript
import { installDevToolsFormatters } from "@workglow/util/debug";

// Call once during app initialization
installDevToolsFormatters();
```

### Enabling Custom Formatters in Chrome DevTools

1. Open Chrome DevTools (F12 or Cmd+Option+I)
2. Go to Settings (gear icon or F1)
3. Under "Console", check "Enable custom formatters"
4. Refresh the page

### Viewing Rich Output

Once formatters are installed and enabled, simply `console.log` any Workglow object:

```typescript
import { Workflow } from "@workglow/task-graph";
import { installDevToolsFormatters } from "@workglow/util/debug";

installDevToolsFormatters();

const workflow = new Workflow();
// ... add tasks ...

// Rich formatted output in DevTools
console.log(workflow);
```

## Supported Objects

The following Workglow objects will display with rich formatting:

- **Workflow**: Shows task count, error state, and expandable task list
- **TaskGraph**: Displays all tasks and dataflows with DAG visualization
- **Task**: Shows input/output data, configuration, and status with color coding
- **Dataflow**: Displays source and target connections with values
- **DirectedAcyclicGraph**: Renders a visual canvas representation
- **React Elements**: Pretty-prints React components with props

## API

### `installDevToolsFormatters()`

Registers custom formatters with Chrome DevTools. Call once during application startup.

```typescript
import { installDevToolsFormatters } from "@workglow/util/debug";

installDevToolsFormatters();
```

### `isDarkMode()`

Returns whether the browser is currently in dark mode.

```typescript
import { isDarkMode } from "@workglow/util/debug";

if (isDarkMode()) {
  console.log("Using dark theme colors");
}
```

## Color Coding

The formatters use consistent color coding:

| Color     | Meaning                        |
| --------- | ------------------------------ |
| Green     | Input parameters               |
| Red/Brown | Output values                  |
| Yellow    | Highlighted names/keywords     |
| Grey      | Punctuation and secondary text |

Colors automatically adjust for dark/light mode.

## License

Apache 2.0 - See [LICENSE](../../LICENSE) for details.

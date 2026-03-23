# Chrome DevTools formatters (`ConsoleFormatters`)

Debug utilities for Workglow task graphs and workflows.

## Overview

`ConsoleFormatters.ts` is re-exported from the main **`@workglow/task-graph`** entry when using the **browser** build (`dist/browser.js`). It provides Chrome DevTools custom formatters for rich console output for task graphs, workflows, tasks, and dataflows.

This code is **browser-oriented** (it uses `window` and the DevTools formatter API). Do not call it from Node-only bundles.

## Features

- **Chrome DevTools Custom Formatters**: Rich, colored console output for Workglow objects
  - **Dark Mode Support**: Automatically adapts colors based on browser theme
  - **DAG Visualization**: Visual graph rendering for directed acyclic graphs
  - **React Element Formatting**: Pretty-print React elements in the console

## Installation

`@workglow/util` is a peer dependency of `@workglow/task-graph` (graph and schema types used by the formatters).

```bash
npm install @workglow/task-graph @workglow/util
# or
bun add @workglow/task-graph @workglow/util
```

## Usage

### Installing DevTools Formatters

Call `installDevToolsFormatters()` early in your application to enable rich console output:

```typescript
import { installDevToolsFormatters } from "@workglow/task-graph";

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
import { installDevToolsFormatters } from "@workglow/task-graph";

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
import { installDevToolsFormatters } from "@workglow/task-graph";

installDevToolsFormatters();
```

### `isDarkMode()`

Returns whether the browser is currently in dark mode.

```typescript
import { isDarkMode } from "@workglow/task-graph";

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

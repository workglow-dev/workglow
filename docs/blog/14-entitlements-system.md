<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Taming the Wild West: Entitlements and Security in Workglow

You have built a beautiful data pipeline. Tasks fetch URLs, run AI models, execute JavaScript,
call MCP tools, and read files. Everything works perfectly in development. Then someone loads a
pipeline from a JSON file they found on the internet, and suddenly your application is making
network requests to places you never intended, spawning local processes through MCP stdio
transports, and executing arbitrary JavaScript. Welcome to the security problem of task-based
architectures.

Workglow's entitlement system is the answer. It is a declarative, hierarchical permission model
that lets tasks announce what they need, lets hosts declare what they allow, and lets the engine
refuse to run anything that does not match. Think of it as the principle of least privilege,
applied to data pipelines.

---

## The Problem: Tasks Can Do Anything

A `FetchUrlTask` makes HTTP requests. A `JavaScriptTask` runs user-provided code. An
`McpToolCallTask` reaches out to external servers and invokes tools with arbitrary arguments. An
`AiTask` sends your data to a cloud inference endpoint. Each of these capabilities is powerful
and each is a potential attack vector.

The fundamental challenge is that task graphs are data. They can be serialized to JSON, stored in
databases, shared between users, loaded from untrusted sources. A task graph is, in essence, a
program -- and running untrusted programs without guardrails is how security incidents happen.

What we need is a system where:

1. Every task declares exactly what capabilities it requires and why.
2. Every host environment declares exactly what capabilities it permits.
3. The engine checks the two against each other before any task executes.
4. Denied capabilities produce clear, actionable errors -- not silent failures.

That is what Workglow's entitlement system provides.

---

## Hierarchical Entitlement IDs

At the core of the system is a simple but powerful idea: entitlement identifiers are
colon-separated hierarchical strings.

```
network
network:http
network:websocket
network:private
```

The hierarchy matters because a grant of `"network"` implicitly covers `"network:http"`,
`"network:websocket"`, and `"network:private"`. This lets you be as broad or as precise as you
want. Need to allow all network access? Grant `"network"`. Only want HTTP? Grant
`"network:http"`. The matching logic is straightforward:

```ts
function entitlementCovers(granted: EntitlementId, required: EntitlementId): boolean {
  return required === granted || required.startsWith(granted + ":");
}
```

One line of logic, but it gives you a full tree of permissions. The `"ai"` grant covers
`"ai:model"` and `"ai:inference"`. The `"mcp"` grant covers `"mcp:tool-call"`,
`"mcp:resource-read"`, `"mcp:prompt-get"`, and `"mcp:stdio"`. You never have to enumerate every
leaf permission if you want the whole branch.

---

## Well-Known Entitlements

Workglow ships with a set of well-known entitlement constants that cover the major capability
categories. These are defined in the `Entitlements` object and used throughout the codebase:

| Category | Entitlement IDs | What It Covers |
|---|---|---|
| **Network** | `network`, `network:http`, `network:websocket`, `network:private` | HTTP fetches, WebSocket connections, access to private/internal networks |
| **File System** | `filesystem`, `filesystem:read`, `filesystem:write` | Reading and writing files on the host system |
| **Code Execution** | `code-execution`, `code-execution:javascript` | Running user-provided code in interpreters or sandboxes |
| **AI** | `ai:model`, `ai:inference` | Using specific AI models, running inference calls |
| **MCP** | `mcp`, `mcp:tool-call`, `mcp:resource-read`, `mcp:prompt-get`, `mcp:stdio` | Calling MCP tools, reading MCP resources, getting prompts, spawning stdio processes |
| **Storage** | `storage`, `storage:read`, `storage:write` | Accessing storage backends (KV, tabular, vector, queue) |
| **Credentials** | `credential` | Accessing credential stores for API keys and tokens |

These are not an exhaustive list. Tasks can declare custom entitlement IDs beyond these -- the
system is open-ended. But the well-known constants give you a shared vocabulary so that enforcers
and tasks speak the same language.

---

## Resource Scoping with Glob Patterns

Saying "this task needs network access" is useful but coarse. Saying "this task needs to call
`api.openai.com`" is much better. That is where resource scoping comes in.

Every entitlement can carry an optional `resources` array -- specific resources that the
entitlement applies to. On the declaration side, a task says which resources it needs:

```ts
{
  id: "ai:model",
  reason: "Uses model claude-3-opus",
  resources: ["claude-3-opus"]
}
```

On the grant side, the host says which resources it allows, using glob-style patterns:

```ts
const enforcer = createScopedEnforcer([
  { id: "network:http" },                               // broad: all HTTP
  { id: "filesystem:read", resources: ["/tmp/*"] },      // scoped: only /tmp
  { id: "ai:model", resources: ["claude-*", "gpt-4o"] }, // scoped: Claude family + GPT-4o
  { id: "code-execution" },                              // broad: all code execution
]);
```

The glob matching supports a single `*` wildcard that can appear anywhere in the pattern:

- `"/tmp/*"` matches `"/tmp/data.json"` and `"/tmp/subdir/file.txt"`
- `"claude-*"` matches `"claude-3-opus"`, `"claude-3-sonnet"`, `"claude-3-haiku"`
- `"*.example.com"` matches `"api.example.com"` and `"cdn.example.com"`
- `"api.*.example.com"` matches `"api.v2.example.com"`

The matching rules are intuitive:

1. A **broad grant** (no resources) covers any resource requirement.
2. A **broad requirement** (no resources) can only be satisfied by a broad grant.
3. When both sides specify resources, every required resource must match at least one grant
   pattern.

This means you can lock down an AI pipeline to only use specific models, restrict network access
to particular domains, or limit filesystem operations to a sandbox directory -- all without
changing any task code.

---

## How Tasks Declare Entitlements

Every task class has a static `entitlements()` method that declares what the task type needs in
general. Here is `FetchUrlTask`:

```ts
public static override entitlements(): TaskEntitlements {
  return {
    entitlements: [
      { id: Entitlements.NETWORK_HTTP, reason: "Fetches data from URLs via HTTP/HTTPS" },
      { id: Entitlements.CREDENTIAL, reason: "May use Bearer token authentication", optional: true },
    ],
  };
}
```

Notice two things. First, every entitlement has a human-readable `reason`. This is not just
documentation -- it shows up in error messages and audit logs, telling operators exactly why a
task needs a particular capability. Second, the `credential` entitlement is marked `optional:
true`. The task can degrade gracefully without credentials (it just will not send an
Authorization header). Optional entitlements are never denied by the enforcer -- they are purely
informational.

`JavaScriptTask` declares code execution:

```ts
public static override entitlements(): TaskEntitlements {
  return {
    entitlements: [
      {
        id: Entitlements.CODE_EXECUTION_JS,
        reason: "Executes user-provided JavaScript code in a sandboxed interpreter",
      },
    ],
  };
}
```

MCP tasks show a richer pattern. `McpToolCallTask` declares three entitlements at the class
level -- tool calling, optional network access, and optional credentials -- and then the instance
method adds a fourth when the task is configured for stdio transport:

```ts
public override entitlements(): TaskEntitlements {
  const base = McpToolCallTask.entitlements();
  const server = this.config?.server as Record<string, unknown> | undefined;
  if (server?.transport === "stdio") {
    return mergeEntitlements(base, {
      entitlements: [
        { id: Entitlements.MCP_STDIO, reason: "Uses stdio transport to spawn local process" },
      ],
    });
  }
  return base;
}
```

This is the static-versus-instance distinction. The static method tells you what the task type
needs in the general case. The instance method tells you what this particular task instance needs
based on its actual configuration. This matters for enforcers that want to be precise about what
they allow.

---

## Dynamic Entitlements and Graph Aggregation

Here is where things get interesting. A `GraphAsTask` is a task that contains an entire subgraph
of other tasks. What entitlements does it need? The answer is: whatever its children need.

`GraphAsTask` sets `hasDynamicEntitlements = true` and overrides the instance `entitlements()`
method to aggregate from all child tasks:

```ts
public override entitlements(): TaskEntitlements {
  if (!this.hasChildren()) {
    return (this.constructor as typeof Task).entitlements();
  }
  return computeGraphEntitlements(this.subGraph);
}
```

The `computeGraphEntitlements` function walks every task in the graph, collects their
entitlements, and merges them into a union. When the same entitlement ID appears in multiple
tasks, the merge is conservative: `optional` is `false` if either task requires it, and resources
are unioned (the combined set of all resources any child needs).

This aggregation is recursive. If a `GraphAsTask` contains another `GraphAsTask`, the inner
graph's entitlements bubble up through `computeGraphEntitlements` automatically. The root graph
ends up with the complete picture of what the entire pipeline requires.

The system even handles `ConditionalTask` branches. By default, the aggregation includes
entitlements from all branches (the conservative choice for pre-execution analysis). At runtime,
you can switch to `"active"` mode to only include branches that will actually execute, skipping
disabled tasks.

When tasks with dynamic entitlements change their configuration -- say an `AiTask` switches from
one model to another -- they call `emitEntitlementChange()`, which fires an `entitlementChange`
event. Parent graphs and UIs can listen for this event to update their entitlement displays in
real time.

---

## Enforcement: Grants Meet Requirements

Entitlement declarations are one half of the story. The other half is enforcement. The
`IEntitlementEnforcer` interface has a single method:

```ts
interface IEntitlementEnforcer {
  check(required: TaskEntitlements): readonly TaskEntitlement[];
}
```

It takes the full set of required entitlements and returns the ones that were denied. An empty
array means everything is granted. The system ships with three ways to create an enforcer:

**Permissive enforcer** -- grants everything, useful for development:

```ts
const PERMISSIVE_ENFORCER: IEntitlementEnforcer = { check: () => [] };
```

**Grant list enforcer** -- takes an array of entitlement ID strings (broad grants):

```ts
const enforcer = createGrantListEnforcer(["network:http", "ai", "code-execution"]);
```

**Scoped enforcer** -- the full-featured version with resource-level grants:

```ts
const enforcer = createScopedEnforcer([
  { id: "network:http" },
  { id: "ai:model", resources: ["claude-*"] },
  { id: "filesystem:read", resources: ["/data/*"] },
]);
```

Enforcement is opt-in. When you call `graph.run()` with `{ enforceEntitlements: true }`, the
`TaskGraphRunner` resolves the enforcer from the service registry (or falls back to the
permissive enforcer), computes the graph's aggregated entitlements, and checks them. If any
non-optional entitlement is denied, the run throws a `TaskEntitlementError` with a message
listing exactly which entitlements were refused.

This happens before any task executes. The entire graph is validated upfront, so you get a clear
error instead of a partial execution that fails halfway through.

---

## Runtime Profiles

To make common configurations easy, Workglow provides pre-built entitlement profiles for
different runtime environments:

**Browser profile** -- no filesystem, no code execution, no stdio MCP:

```ts
const enforcer = createProfileEnforcer("browser");
```

**Desktop profile** -- everything in browser plus filesystem, code execution, and stdio MCP:

```ts
const enforcer = createProfileEnforcer("desktop");
```

**Server profile** -- currently the same as desktop, with room for resource scoping in the
future:

```ts
const enforcer = createProfileEnforcer("server");
```

These profiles are just convenience wrappers around `createScopedEnforcer`. You can inspect their
grants with `getProfileGrants("browser")`, combine them with additional grants, or ignore them
entirely and build your own enforcer from scratch.

---

## Why This Matters

The entitlement system is not about preventing developers from using capabilities. It is about
giving operators control over what untrusted pipelines can do. Consider these scenarios:

**Multi-tenant SaaS.** Users upload pipeline definitions that run on your infrastructure. Without
entitlements, a malicious pipeline could exfiltrate data through network requests, read sensitive
files, or abuse your AI credits. With entitlements, you scope each tenant's pipeline to exactly
the capabilities they need.

**Plugin marketplace.** Community-contributed task graphs extend your application. The entitlement
system lets you show users a permission dialog ("This pipeline requires network access to
api.example.com and uses the claude-3-sonnet model") before execution, similar to mobile app
permission prompts.

**Audit trails.** Because every task declares its entitlements with human-readable reasons, you
get a complete audit trail of what capabilities a pipeline requested and whether they were
granted. The `TrackedTaskEntitlements` variant even tracks which specific tasks in a graph
required each entitlement.

**Defense in depth.** `FetchUrlTask` already blocks private IP ranges at the job level. The
entitlement system adds a second layer: even if a task tries to be clever about accessing
internal networks, the `network:private` entitlement can be withheld at the enforcer level.

**Progressive trust.** Start with a restrictive profile, see what the pipeline asks for, then
expand grants as trust is established. The hierarchical IDs make this ergonomic -- you can grant
`"network:http"` without granting `"network:websocket"` or `"network:private"`.

The design follows a principle that shows up in operating systems, mobile platforms, and browser
APIs: capabilities should be declared, inspectable, and revocable. Workglow brings that principle
to data pipelines and AI workflows. Your tasks say what they need. Your host says what it allows.
And when those two do not align, the engine stops things before they start.

That is how you run untrusted pipelines safely.

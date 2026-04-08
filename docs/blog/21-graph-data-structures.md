<!--
@license
Copyright 2025 Steven Roussey <sroussey@gmail.com>
SPDX-License-Identifier: Apache-2.0
-->

# Graph Data Structures in Workglow: From Adjacency Matrices to Pipeline Execution

*How a three-layer graph hierarchy -- generic, directed, and acyclic -- powers Workglow's task pipeline engine with type safety, event-driven reactivity, and O(1) edge lookups.*

---

## Why Build Your Own Graph Library?

Every computer science student learns about graphs. They show up in the first semester of an algorithms class, right between sorting and hash tables. So why would a pipeline framework roll its own graph implementation instead of reaching for one of the dozens of packages on npm?

Three reasons, and they compound.

**Type-safe generics.** Workglow's graphs are parameterized over four type variables: `Node`, `Edge`, `NodeId`, and `EdgeId`. This is not academic generality for its own sake. The task graph needs nodes that are `ITask` instances, edges that are `Dataflow` objects carrying port metadata, node IDs that are `TaskIdType` strings, and edge IDs that are structured dataflow identifiers like `taskA[output] ==> taskB[input]`. A generic graph library would force everything through `string` or `any`, losing the type information that makes TypeScript useful. Here, when you call `dag.getNode(taskId)`, you get back an `ITask` or `undefined` -- not a shapeless blob you need to cast.

**Event-driven mutation.** When a node gets added to a task graph, downstream systems need to know. The UI might need to render a new node. A scheduler might need to recalculate dependencies. An entitlement system might need to recompute permissions. Workglow's graph classes emit events -- `node-added`, `node-removed`, `edge-added`, `edge-removed`, and their `replaced` variants -- on every structural mutation. This is baked into the base class, not bolted on after the fact.

**Pipeline-specific semantics.** The graph is not just a data structure; it is the execution model. It needs to enforce acyclicity (a pipeline that loops forever is not useful), provide topological sort (tasks must execute in dependency order), detect cycles before they happen (not after the pipeline deadlocks), and do all of this with caching so repeated queries are essentially free. These are not features you find in a general-purpose graph library -- and when you do, they are usually afterthoughts.

The implementation traces its lineage to the open-source [typescript-graph](https://github.com/SegFaultx64/typescript-graph) library, forked and substantially reworked to meet these requirements. What started as a simple port grew into a purpose-built foundation for pipeline orchestration.

## The Three Layers

The graph system is a clean inheritance hierarchy, each layer adding semantics on top of the last:

```
Graph<Node, Edge, NodeId, EdgeId>        -- undirected, generic
  └── DirectedGraph                      -- adds direction, cycle detection
        └── DirectedAcyclicGraph         -- enforces acyclicity, topological sort
```

Let us walk through each one.

---

## Layer 1: The Base Graph

The `Graph` class is the foundation. It handles the mechanics of storing nodes and edges without imposing any directional semantics:

```typescript
export class Graph<Node, Edge = true, NodeId = unknown, EdgeId = unknown> {
  protected nodes: Map<NodeId, Node>;
  protected adjacency: AdjacencyMatrix<Edge>;
  protected nodeIdentity: (t: Node) => NodeId;
  protected edgeIdentity: (t: Edge, n1: NodeId, n2: NodeId) => EdgeId;
  protected nodeIndexMap: Map<NodeId, number> = new Map();
  // ...
}
```

Four type parameters, four degrees of freedom. `Node` can be anything -- a string, an object, a full task instance. `Edge` defaults to `true` (a simple "these are connected") but can carry arbitrary data. `NodeId` and `EdgeId` control how nodes and edges are identified.

The constructor takes two identity functions: one that extracts a unique ID from a node, and one that does the same for an edge given its two endpoints. This is the key design decision that makes the graph both generic and useful. You do not need to pre-process your domain objects into some graph-specific format. The graph adapts to your data, not the other way around.

### The Adjacency Matrix Choice

Here is where things get interesting from a CS-fundamentals perspective. The `Graph` stores edges in an **adjacency matrix** -- a 2D array where `adjacency[i][j]` holds the edge data (or `null` for no edge) between node `i` and node `j`:

```typescript
export type AdjacencyValue<Edge> = null | Array<Edge>;
export type AdjacencyMatrix<Edge> = Array<Array<AdjacencyValue<Edge>>>;
```

This is a deliberate trade-off. An adjacency list (the textbook alternative) uses less memory -- O(V + E) versus O(V^2) -- but an adjacency matrix gives you **O(1) edge existence checks**. When you call `addEdge(a, b)`, checking whether the edge already exists is a single array lookup. When the `DirectedGraph` layer needs to check reachability for cycle detection, it can probe `adjacency[i][j]` in constant time rather than scanning a list.

For pipeline graphs, this trade-off is almost always worth it. Task graphs are relatively small (tens to hundreds of nodes, not millions), so the O(V^2) memory cost is negligible. But edge queries happen constantly -- during cycle detection, topological sort, dependency resolution, and every graph traversal the scheduler performs. Making those queries O(1) pays for itself many times over.

There is a subtle detail worth noting: each cell in the matrix holds an _array_ of edges, not a single edge. This means multi-edges are first-class citizens. Two tasks can be connected by multiple dataflows (one per output-to-input port mapping), and the graph handles this naturally without any special-casing.

A `nodeIndexMap` provides O(1) translation from a node's identity to its position in the adjacency matrix. Without this, every edge operation would require a linear scan to find the right row and column.

### Events from the Ground Up

The base `Graph` integrates an `EventEmitter` directly:

```typescript
events = new EventEmitter<GraphEventListeners<NodeId, EdgeId>>();
```

Every mutation -- `insert`, `replace`, `upsert`, `addEdge`, `remove`, `removeEdge` -- emits the appropriate event. This is not an optional plugin. It is part of the contract. When `TaskGraph` wraps the DAG and maps `node-added` to `task_added`, it is building on a guarantee, not a convention.

The event types themselves are strongly typed through a listeners map:

```typescript
export type GraphEventListeners<NodeId, EdgeId> = {
  "node-added": (node: NodeId) => void;
  "node-removed": (node: NodeId) => void;
  "node-replaced": (node: NodeId) => void;
  "edge-added": (edge: EdgeId) => void;
  "edge-removed": (edge: EdgeId) => void;
  "edge-replaced": (edge: EdgeId) => void;
};
```

Subscribe to `"node-added"` and you get the `NodeId`. Not `any`. Not `unknown`. The actual identity type you parameterized the graph with. This is the kind of detail that separates a library you fight with from a library that works with you.

---

## Layer 2: The DirectedGraph

The `DirectedGraph` extends `Graph` without changing the storage model. The adjacency matrix already supports direction -- `adjacency[i][j]` and `adjacency[j][i]` are independent cells. What the directed graph adds is **semantic awareness of direction** and **cycle detection**.

### Indegree and Reachability

The `indegreeOfNode` method counts how many edges point _into_ a node by scanning its column in the adjacency matrix:

```typescript
indegreeOfNode(nodeID: NodeId): number {
  const indexOfNode = this.getNodeIndex(nodeID);
  return this.adjacency.reduce<number>((carry, row) => {
    return carry + (row[indexOfNode] == null ? 0 : 1);
  }, 0);
}
```

This is the building block for both cycle detection and topological sort. A node with indegree zero has no dependencies -- it can execute immediately.

The `canReachFrom` method performs a depth-first search through the directed edges. It is recursive and elegant: check if the target is a direct neighbor; if not, recurse into each neighbor and ask the same question. The O(1) adjacency check at each step keeps the constant factor low even though the worst-case traversal is O(V + E).

### Cycle Detection: Kahn's Algorithm

The `isAcyclic()` method implements Kahn's algorithm, a classic approach that works by repeatedly removing nodes with indegree zero:

1. Compute the indegree of every node.
2. Collect all nodes with indegree zero into a queue.
3. While the queue is not empty, pop a node, increment a counter, and decrement the indegree of all its neighbors. If any neighbor's indegree drops to zero, add it to the queue.
4. If the counter equals the total node count, the graph is acyclic. Otherwise, the remaining nodes form a cycle.

This runs in O(V + E) time and is performed lazily -- the `DirectedGraph` caches whether the graph contains a cycle in a `hasCycle` field.

### Smart Cache Invalidation

This is where the design gets clever. Adding an edge _might_ create a cycle, but removing an edge or a node _never_ creates one. The `DirectedGraph` handles these cases differently:

- **Adding an edge**: If the graph is known to be acyclic (`hasCycle === false`), it does not re-run Kahn's algorithm. Instead, it calls `wouldAddingEdgeCreateCycle`, which uses DFS to check whether the target node can already reach the source. If you can get from B back to A, then adding an edge from A to B closes a loop. This check is typically much cheaper than a full Kahn's traversal because it only examines the subgraph reachable from one node.
- **Removing an edge or node**: The cache is simply invalidated (`hasCycle = undefined`). The next call to `isAcyclic()` will recompute from scratch if needed.
- **Skip updating cyclicality**: When the caller knows the edge is safe (e.g., during bulk construction from a known-acyclic source), it can pass `skipUpdatingCyclicality: true` to bypass the check entirely -- though this also invalidates the cache as a safety measure.

This layered strategy means that the common case -- adding edges one at a time to a growing pipeline -- gets incrementally checked without ever paying for a full graph traversal.

---

## Layer 3: The DirectedAcyclicGraph

The `DirectedAcyclicGraph` is the layer that says "no" -- and means it. While the `DirectedGraph` _detects_ cycles, the DAG _prevents_ them:

```typescript
override addEdge(sourceNodeIdentity: NodeId, targetNodeIdentity: NodeId, edge?: Edge): EdgeId {
  if (this.wouldAddingEdgeCreateCycle(sourceNodeIdentity, targetNodeIdentity)) {
    throw new CycleError(
      `Can't add edge from ${String(sourceNodeIdentity)} to ${String(
        targetNodeIdentity
      )} it would create a cycle`
    );
  }
  this._topologicallySortedNodes = undefined;
  return super.addEdge(sourceNodeIdentity, targetNodeIdentity, edge, true);
}
```

Every `addEdge` call goes through the cycle check. If it would create a cycle, a `CycleError` is thrown. There is no "force" flag. There is no "allow cycles temporarily" mode. The invariant is absolute: if you have a `DirectedAcyclicGraph`, it is acyclic. Period.

This strictness simplifies everything downstream. The `topologicallySortedNodes()` method does not need to handle cycles because they cannot exist. The scheduler does not need cycle-breaking heuristics. The execution engine does not need deadlock detection. The invariant is enforced at the data structure level, so every consumer gets to assume it.

### Topological Sort with Caching

The DAG's signature method is `topologicallySortedNodes()`, which returns every node in an order where all dependencies come before their dependents. The implementation is again Kahn's algorithm, but this time it collects the removed nodes in order rather than just counting them:

```typescript
topologicallySortedNodes(): Node[] {
  if (this._topologicallySortedNodes !== undefined) {
    return this._topologicallySortedNodes;
  }
  // ... Kahn's algorithm, collecting nodes into toReturn ...
  this._topologicallySortedNodes = toReturn;
  return toReturn;
}
```

The result is cached in `_topologicallySortedNodes`. Repeated calls return the cached array in O(1). The cache is invalidated when edges are added or removed, or when nodes are removed -- any structural change that could alter the sort order.

There is one optimization for insertions: when a new node is added (with no edges yet), it has indegree zero and can be prepended to the existing sorted order without recomputation:

```typescript
override insert(node: Node): NodeId {
  if (this._topologicallySortedNodes !== undefined) {
    this._topologicallySortedNodes = [node, ...this._topologicallySortedNodes];
  }
  return super.insert(node);
}
```

This matters during graph construction. You typically add all nodes first, then add edges. With this optimization, the topological sort cache survives the entire node-insertion phase and only gets invalidated when edges start changing the structure.

---

## How TaskGraph Uses It All

The `TaskGraph` class -- the heart of Workglow's pipeline engine -- does not inherit from the DAG. It **composes** it:

```typescript
class TaskGraphDAG extends DirectedAcyclicGraph<
  ITask<any, any, any>,
  Dataflow,
  TaskIdType,
  DataflowIdType
> {
  constructor() {
    super(
      (task: ITask<any, any, any>) => task.id,
      (dataflow: Dataflow) => dataflow.id
    );
  }
}
```

In this instantiation, the four generic parameters finally resolve to concrete domain types. Nodes are tasks. Edges are dataflows. Node IDs are task UUIDs. Edge IDs are structured strings like `task-abc[text] ==> task-def[input]`.

The identity functions are dead simple: a task's ID is `task.id`, and a dataflow's ID is `dataflow.id`. No hashing, no serialization. The domain objects already know who they are.

### Topological Execution

When the graph runs, the scheduler needs to know the correct execution order. The `TopologicalScheduler` gets it in a single call:

```typescript
export class TopologicalScheduler implements ITaskGraphScheduler {
  reset(): void {
    this.sortedNodes = this.dag.topologicallySortedNodes();
    this.currentIndex = 0;
  }
  async *tasks(): AsyncIterableIterator<ITask> {
    while (this.currentIndex < this.sortedNodes.length) {
      yield this.sortedNodes[this.currentIndex++];
    }
  }
}
```

The more sophisticated `DependencyBasedScheduler` also starts from the topologically sorted set but uses it as a pool of pending tasks, releasing them as their dependencies complete. It checks readiness by querying the graph's `getSourceDataflows()` -- which in turn queries the DAG's `inEdges()` -- and comparing against a set of completed task IDs.

### Event Bridging

The `TaskGraph` maps the DAG's generic graph events to domain-specific task events:

```typescript
export const EventTaskGraphToDagMapping = {
  task_added: "node-added",
  task_removed: "node-removed",
  task_replaced: "node-replaced",
  dataflow_added: "edge-added",
  dataflow_removed: "edge-removed",
  dataflow_replaced: "edge-replaced",
} as const;
```

When you call `taskGraph.on("task_added", callback)`, the listener is registered on the underlying DAG's `node-added` event. The callback receives a `TaskIdType` because that is what the DAG was parameterized with. No casting, no runtime type checks. The types flow through the entire stack -- from the generic `Graph` through the `DirectedAcyclicGraph` to the `TaskGraph` -- and the compiler enforces consistency at every boundary.

This event bridging enables powerful reactive patterns. The `subscribeToTaskStatus` method listens for `task_added` events and automatically wires up status listeners on new tasks. The `subscribeToTaskEntitlements` method does the same for entitlement changes. The graph becomes a living, reactive structure -- not a static data container that you query and forget.

---

## The Trade-offs, Honestly

No design is without costs. The adjacency matrix uses O(V^2) memory. For a graph with 1000 tasks, that is a million cells. For a graph with 10,000 tasks, it is a hundred million. In practice, Workglow's graphs are small enough that this does not matter, but it is worth acknowledging the ceiling.

Node removal is O(V) because it requires splicing a row and a column out of the matrix and updating the index map. This is fine for occasional edits but would be painful for algorithms that repeatedly add and remove nodes.

The cycle detection DFS in `canReachFrom` is recursive without a visited-node set, which means it could revisit nodes in dense graphs. For DAGs, where cycles are impossible, this is a non-issue -- but it is a quirk of the implementation that trades simplicity for theoretical efficiency.

These are acceptable trade-offs for the domain. Pipeline graphs are built once (or edited incrementally by a user), executed many times, and queried constantly during execution. The adjacency matrix optimizes for exactly that access pattern.

## The Bigger Picture

What makes this graph implementation interesting is not any single feature. It is how the layers compose. The base `Graph` gives you type-safe storage and events. The `DirectedGraph` gives you direction awareness and cycle detection. The `DirectedAcyclicGraph` gives you acyclicity enforcement and topological sort. And the `TaskGraph` maps all of this onto the pipeline domain with zero abstraction leakage.

Each layer trusts the guarantees of the layer below it. The scheduler does not check for cycles because the DAG made them impossible. The runner does not validate execution order because topological sort already produced it. The event system does not need adapters because the types were correct from the start.

That is the payoff of building your own graph library: not novelty, but **fit**. Every method, every type parameter, every cached result exists because the pipeline engine needs it -- and nothing exists that it does not. When your data structure and your domain are designed together, the code that uses them gets to be simple. And simple code is code that works.

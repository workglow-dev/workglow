<!--
  @license
  Copyright 2025 Steven Roussey <sroussey@gmail.com>
  SPDX-License-Identifier: Apache-2.0
-->

# Graph Data Structures

## Overview

The `@workglow/util/graph` package provides a layered hierarchy of generic graph data structures that form the structural backbone of the Workglow framework. The three classes -- `Graph`, `DirectedGraph`, and `DirectedAcyclicGraph` -- build on each other through inheritance, each adding constraints and algorithms appropriate to its level of specialization.

The most important consumer of these data structures is `TaskGraph` in `@workglow/task-graph`, which extends `DirectedAcyclicGraph` to model task execution pipelines as directed acyclic graphs (DAGs). Understanding the graph layer is therefore essential for anyone working on the core pipeline engine, implementing custom task runners, or building tooling that inspects or manipulates workflows.

All three classes are fully generic over four type parameters: the node value type, the edge value type, the node identity type, and the edge identity type. This design allows the same graph infrastructure to be used with any domain objects, from simple string-keyed graphs to the complex `ITask`/`Dataflow` pairings used in `TaskGraph`.

The graph module originated as a fork of the `typescript-graph` library (MIT-licensed) and has been substantially extended with an event system, an adjacency index map for O(1) node lookups, bulk operations, edge removal, and cache invalidation strategies.

## Base Graph Class

### Generic Type Parameters

The `Graph` class accepts four type parameters:

```typescript
class Graph<Node, Edge = true, NodeId = unknown, EdgeId = unknown>
```

| Parameter | Default   | Purpose |
|-----------|-----------|---------|
| `Node`    | --        | The type of values stored at each vertex. |
| `Edge`    | `true`    | The type of values stored on edges. Defaults to a boolean `true`, meaning edges carry no data beyond their existence. |
| `NodeId`  | `unknown` | The type returned by the node identity function. Typically `string` or `number`. |
| `EdgeId`  | `unknown` | The type returned by the edge identity function. |

### Adjacency Matrix Representation

Internally, the graph stores connectivity in an adjacency matrix rather than adjacency lists. Each cell in the matrix holds either `null` (no edges) or an `Array<Edge>` (one or more edges between the two nodes):

```typescript
type AdjacencyValue<Edge> = null | Array<Edge>;
type AdjacencyMatrix<Edge> = Array<Array<AdjacencyValue<Edge>>>;
```

This representation supports multigraphs -- multiple edges can exist between the same pair of nodes -- and allows O(1) edge existence checks between any two nodes once their matrix indices are known.

A `nodeIndexMap` (`Map<NodeId, number>`) provides O(1) translation from a node's identity to its index in the adjacency matrix. Without this map, every node lookup would require a linear scan of the `nodes` map keys.

### Constructor and Identity Functions

The constructor requires two identity functions:

```typescript
constructor(
  nodeIdentity: (node: Node) => NodeId,
  edgeIdentity: (edge: Edge, node1Identity: NodeId, node2Identity: NodeId) => EdgeId
)
```

The `nodeIdentity` function determines how nodes are uniquely identified within the graph. Two nodes that produce the same identity are considered duplicates. The `edgeIdentity` function creates a unique identifier for edges, receiving the edge value and the identities of both endpoint nodes.

### Node Operations

**`insert(node: Node): NodeId`** -- Adds a node to the graph. Throws `NodeAlreadyExistsError` if a node with the same identity already exists. Grows the adjacency matrix by adding a new row and column. Emits `"node-added"`.

**`replace(node: Node): void`** -- Replaces an existing node with an updated value. The new node must produce the same identity as the old one. Throws `NodeDoesntExistError` if the node is not found. Emits `"node-replaced"`.

**`upsert(node: Node): NodeId`** -- Combines `insert` and `replace`. If the node exists, it is updated; if not, it is created. Emits either `"node-added"` or `"node-replaced"`.

**`remove(nodeIdentity: NodeId): void`** -- Deletes a node and all associated edges. Removes the corresponding row and column from the adjacency matrix and decrements indices for nodes that followed the removed one. Emits `"node-removed"`.

**`getNode(nodeIdentity: NodeId): Node | undefined`** -- Retrieves a node by identity.

**`hasNode(nodeIdentity: NodeId): boolean`** -- Checks for the existence of a node.

**`getNodes(compareFunc?): Node[]`** -- Returns all nodes, optionally sorted by a comparison function.

**`addNode(node: Node): NodeId`** -- Alias for `insert`.

**`addNodes(nodes: Node[]): NodeId[]`** -- Bulk insert. Returns an array of node identities.

### Edge Operations

**`addEdge(node1Identity: NodeId, node2Identity: NodeId, edge?: Edge): EdgeId`** -- Creates an edge between two existing nodes. The edge value defaults to `true`. In the base `Graph` class edges are undirected. Throws `NodeDoesntExistError` if either node is missing. Emits `"edge-added"`.

**`removeEdge(node1Identity: NodeId, node2Identity: NodeId, edgeIdentity?: EdgeId): void`** -- Removes an edge. If `edgeIdentity` is omitted, all edges between the two nodes are removed. Emits `"edge-removed"`.

**`getEdges(): Array<[NodeId, NodeId, Edge]>`** -- Returns all edges as tuples of `[sourceId, targetId, edgeValue]`.

**`outEdges(nodeIdentity: NodeId): Array<[NodeId, NodeId, Edge]>`** -- Returns edges originating from a node.

**`inEdges(nodeIdentity: NodeId): Array<[NodeId, NodeId, Edge]>`** -- Returns edges terminating at a node.

**`nodeEdges(nodeIdentity: NodeId): Array<[NodeId, NodeId, Edge]>`** -- Returns all edges (both in and out) incident on a node.

**`addEdges(edges: Array<[NodeId, NodeId, Edge?]>): EdgeId[]`** -- Bulk edge insert.

## DirectedGraph

`DirectedGraph` extends `Graph` and adds directed-edge semantics along with cycle-detection capabilities. In a directed graph, the order of arguments to `addEdge` matters: the first argument is the source node and the second is the target node.

### Cycle Detection

The `DirectedGraph` maintains a cached boolean `hasCycle` that tracks whether the graph is known to contain a cycle. This cache has three states:

- `false`: The graph is confirmed acyclic.
- `true`: The graph is confirmed to contain a cycle.
- `undefined`: The cyclicality is unknown and must be recomputed.

**`isAcyclic(): boolean`** -- Returns `true` if the graph contains no cycles. On the first call (or after cache invalidation), this runs Kahn's algorithm with time complexity O(|V| + |E|). Subsequent calls return the cached result in O(1).

**`wouldAddingEdgeCreateCycle(sourceNodeIdentity: NodeId, targetNodeIdentity: NodeId): boolean`** -- Checks whether adding an edge between the two nodes would introduce a cycle. Returns `true` immediately in O(1) if a cycle already exists or if the source and target are the same node. Otherwise, performs a depth-first reachability check from the target to the source.

**`canReachFrom(startNode: NodeId, endNode: NodeId): boolean`** -- Depth-first search to determine if `endNode` is reachable from `startNode` following directed edges. Returns `false` if start and end are the same node and there is no self-loop.

### Cache Invalidation

The `hasCycle` cache is invalidated (set to `undefined`) whenever the graph structure changes in a way that could affect cyclicality:

- `addEdge()`: If the graph was previously known to be acyclic, the method performs a targeted cycle check for the new edge and updates the cache accordingly. If `skipUpdatingCyclicality` is `true`, the cache is invalidated instead.
- `removeEdge()`: Invalidates the cache since removing an edge could break an existing cycle.
- `remove()` (node deletion): Invalidates the cache.

### Indegree Computation

**`indegreeOfNode(nodeID: NodeId): number`** -- Counts the number of edges pointing to a node by scanning the node's column in the adjacency matrix. Used internally by Kahn's algorithm.

### Subgraph Extraction

**`getSubGraphStartingFrom(startNodeIdentity: NodeId): DirectedGraph`** -- Returns a new `DirectedGraph` containing only the nodes reachable from the given start node, preserving all edges between those nodes. Uses a recursive depth-first traversal to collect reachable nodes.

## DirectedAcyclicGraph

`DirectedAcyclicGraph` extends `DirectedGraph` and enforces acyclicality as a structural invariant. Any attempt to add an edge that would create a cycle throws a `CycleError`.

### Acyclicity Enforcement

**`addEdge(sourceNodeIdentity: NodeId, targetNodeIdentity: NodeId, edge?: Edge): EdgeId`** -- Before adding the edge, calls `wouldAddingEdgeCreateCycle`. If the check returns `true`, throws a `CycleError` with a descriptive message. This guarantee means that consumers of `DirectedAcyclicGraph` never need to check for cycles themselves.

### Topological Sort

**`topologicallySortedNodes(): Node[]`** -- Returns all nodes in a valid topological ordering using Kahn's algorithm. The result is cached in `_topologicallySortedNodes` and reused on subsequent calls (O(1) after the first call). Non-cached calls run in O(|V| + |E|).

The cache is managed as follows:

- **`insert()`**: Prepends the new node to the cached array (valid because newly inserted nodes always have an indegree of zero, so they can appear at the front of any topological ordering).
- **`addEdge()`**: Invalidates the cache entirely since the edge may change the valid ordering.
- **`removeEdge()`**: Invalidates the cache.
- **`remove()`** (node deletion): Invalidates the cache.

There may be more than one valid topological sort order for a given graph, so two structurally identical DAGs are not guaranteed to produce the same ordering.

### Static Conversion

**`DirectedAcyclicGraph.fromDirectedGraph(graph: DirectedGraph): DirectedAcyclicGraph`** -- Static factory method that converts an existing `DirectedGraph` into a `DirectedAcyclicGraph`. Throws a `CycleError` if the source graph contains any cycles. This is useful for constructing a graph incrementally as a `DirectedGraph` (where cycle checks are optional) and then "promoting" it to a DAG once construction is complete.

### Subgraph Override

**`getSubGraphStartingFrom(startNodeIdentity: NodeId): DirectedAcyclicGraph`** -- Overrides the parent method to return a `DirectedAcyclicGraph` instead of a `DirectedGraph`, using `fromDirectedGraph` for the conversion.

## Error Types

The graph module defines three error classes, all extending `BaseError`:

| Error | Thrown When |
|-------|------------|
| `NodeAlreadyExistsError<T>` | `insert()` is called with a node whose identity matches an existing node. Carries `newNode`, `oldNode`, and `identity` properties. |
| `NodeDoesntExistError` | Any operation references a node identity that is not in the graph. Carries the `identity` property. |
| `CycleError` | `DirectedAcyclicGraph.addEdge()` would create a cycle, or `fromDirectedGraph()` receives a cyclic graph. |

## Event System

All graph classes expose an event system via the `events` property (an `EventEmitter`) and convenience `on`, `off`, and `emit` methods:

```typescript
type GraphEventListeners<NodeId, EdgeId> = {
  "node-added": (node: NodeId) => void;
  "node-removed": (node: NodeId) => void;
  "node-replaced": (node: NodeId) => void;
  "edge-added": (edge: EdgeId) => void;
  "edge-removed": (edge: EdgeId) => void;
  "edge-replaced": (edge: EdgeId) => void;
};
```

These events are emitted at the end of each mutating operation after the internal data structures have been updated. They enable external observers to react to structural changes without polling -- for example, `TaskGraph` maps these events to its own higher-level event system for UI reactivity.

## Performance Characteristics

| Operation | Graph | DirectedGraph | DirectedAcyclicGraph |
|-----------|-------|---------------|---------------------|
| `insert` / `addNode` | O(V) amortized (matrix row/column extension) | Same | Same + O(1) cache prepend |
| `getNode` / `hasNode` | O(1) via Map | Same | Same |
| `addEdge` | O(1) via index map | O(1) best case, O(V+E) if cycle check needed | O(V+E) worst case for cycle check |
| `removeEdge` | O(1) without edgeId, O(V*E) with edgeId | Same + cache invalidation | Same + cache invalidation |
| `remove` (node) | O(V) for matrix splicing | Same + cache invalidation | Same + cache invalidation |
| `isAcyclic` | N/A | O(V+E) first call, O(1) cached | Always true by construction |
| `topologicallySortedNodes` | N/A | N/A | O(V+E) first call, O(1) cached |
| `canReachFrom` | N/A | O(V+E) DFS | Same |
| `getEdges` | O(V^2) matrix scan | Same | Same |
| `indegreeOfNode` | N/A | O(V) column scan | Same |

Where V = number of vertices (nodes) and E = number of edges.

## Usage in TaskGraph

The `TaskGraph` class in `@workglow/task-graph` is the primary consumer of `DirectedAcyclicGraph`. It defines a private subclass that specializes the generic parameters:

```typescript
class TaskGraphDAG extends DirectedAcyclicGraph<
  ITask<any, any, any>,  // Node type: tasks
  Dataflow,               // Edge type: dataflows connecting task ports
  TaskIdType,             // Node identity: task IDs
  DataflowIdType          // Edge identity: dataflow IDs
> {
  // ...
}
```

This means:
- **Nodes** are task instances (`ITask`) identified by their `TaskIdType`.
- **Edges** are `Dataflow` objects that describe how output ports of one task connect to input ports of another.
- **Acyclicity** is enforced at the graph level, preventing circular dependencies in task pipelines.
- **Topological sort** determines execution order: tasks with no unresolved dependencies execute first.

The DAG's event system is mapped to `TaskGraph`'s own events, enabling UI frameworks to observe when tasks or dataflows are added, removed, or modified.

## API Reference

### Graph<Node, Edge, NodeId, EdgeId>

| Member | Signature | Description |
|--------|-----------|-------------|
| `constructor` | `(nodeIdentity: (node: Node) => NodeId, edgeIdentity: (edge: Edge, n1: NodeId, n2: NodeId) => EdgeId)` | Create a new graph with identity functions. |
| `insert` | `(node: Node) => NodeId` | Add a node; throws if duplicate. |
| `replace` | `(node: Node) => void` | Replace an existing node by identity. |
| `upsert` | `(node: Node) => NodeId` | Insert or replace a node. |
| `remove` | `(nodeIdentity: NodeId) => void` | Remove a node and its edges. |
| `removeNode` | `(nodeIdentity: NodeId) => void` | Alias for `remove`. |
| `addNode` | `(node: Node) => NodeId` | Alias for `insert`. |
| `addNodes` | `(nodes: Node[]) => NodeId[]` | Bulk insert nodes. |
| `getNode` | `(nodeIdentity: NodeId) => Node \| undefined` | Look up a node. |
| `hasNode` | `(nodeIdentity: NodeId) => boolean` | Check node existence. |
| `getNodes` | `(compareFunc?) => Node[]` | All nodes, optionally sorted. |
| `addEdge` | `(n1: NodeId, n2: NodeId, edge?: Edge) => EdgeId` | Add an edge. |
| `addEdges` | `(edges: [NodeId, NodeId, Edge?][]) => EdgeId[]` | Bulk add edges. |
| `removeEdge` | `(n1: NodeId, n2: NodeId, edgeId?: EdgeId) => void` | Remove edge(s). |
| `getEdges` | `() => [NodeId, NodeId, Edge][]` | All edges as tuples. |
| `outEdges` | `(nodeId: NodeId) => [NodeId, NodeId, Edge][]` | Outgoing edges. |
| `inEdges` | `(nodeId: NodeId) => [NodeId, NodeId, Edge][]` | Incoming edges. |
| `nodeEdges` | `(nodeId: NodeId) => [NodeId, NodeId, Edge][]` | All incident edges. |
| `on` | `(event, fn) => void` | Subscribe to graph events. |
| `off` | `(event, fn) => void` | Unsubscribe from graph events. |
| `emit` | `(event, ...args) => void` | Emit a graph event. |

### DirectedGraph<Node, Edge, NodeId, EdgeId> extends Graph

| Member | Signature | Description |
|--------|-----------|-------------|
| `isAcyclic` | `() => boolean` | Cached cycle detection (Kahn's algorithm). |
| `indegreeOfNode` | `(nodeID: NodeId) => number` | Count of edges targeting a node. |
| `canReachFrom` | `(start: NodeId, end: NodeId) => boolean` | DFS reachability check. |
| `wouldAddingEdgeCreateCycle` | `(source: NodeId, target: NodeId) => boolean` | Prospective cycle check. |
| `getSubGraphStartingFrom` | `(startId: NodeId) => DirectedGraph` | Reachable subgraph extraction. |

### DirectedAcyclicGraph<Node, Edge, NodeId, EdgeId> extends DirectedGraph

| Member | Signature | Description |
|--------|-----------|-------------|
| `topologicallySortedNodes` | `() => Node[]` | Cached topological sort (Kahn's algorithm). |
| `getSubGraphStartingFrom` | `(startId: NodeId) => DirectedAcyclicGraph` | Returns a DAG (not just DirectedGraph). |
| `fromDirectedGraph` (static) | `(graph: DirectedGraph) => DirectedAcyclicGraph` | Convert a DirectedGraph to a DAG; throws CycleError if cyclic. |

### Error Classes

| Class | Properties | Description |
|-------|-----------|-------------|
| `NodeAlreadyExistsError<T>` | `newNode: T`, `oldNode: T`, `identity: unknown` | Duplicate node identity on insert. |
| `NodeDoesntExistError` | `identity: unknown` | Referenced node not found. |
| `CycleError` | (message only) | Edge would create a cycle in a DAG. |

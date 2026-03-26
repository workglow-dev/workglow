/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration options for the polling subscription manager
 */
export interface PollingManagerOptions {
  /** Default polling interval in milliseconds */
  readonly defaultIntervalMs?: number;
}

/**
 * A callback function that is called when changes are detected
 */
export type ChangeCallback<T> = (change: T) => void;

/**
 * A function that fetches the current state for comparison
 */
export type StateFetcher<Item, Key> = () => Promise<Map<Key, Item>>;

/**
 * A function that compares two items for equality
 */
export type ItemComparator<Item> = (a: Item, b: Item) => boolean;

/**
 * A factory function that creates change payloads
 */
export interface ChangePayloadFactory<Item, ChangePayload> {
  /** Create an INSERT change payload */
  readonly insert: (item: Item) => ChangePayload;
  /** Create an UPDATE change payload */
  readonly update: (oldItem: Item, newItem: Item) => ChangePayload;
  /** Create a DELETE change payload */
  readonly delete: (item: Item) => ChangePayload;
}

/**
 * Options for subscribing to changes
 */
export interface PollingSubscriptionOptions {
  /** Polling interval in milliseconds */
  readonly intervalMs?: number;
}

/**
 * Internal subscription record
 */
interface Subscription<ChangePayload> {
  readonly callback: ChangeCallback<ChangePayload>;
  readonly intervalMs: number;
}

/**
 * Manages polling-based subscriptions efficiently by consolidating multiple
 * subscribers into a single polling loop per interval tier.
 *
 * Instead of each subscription creating its own polling interval, this manager
 * groups subscriptions by their requested polling interval and runs a single
 * poll for each group, broadcasting changes to all subscribers in that group.
 *
 * @template Item - The type of items being tracked
 * @template Key - The type of key used to identify items
 * @template ChangePayload - The type of change payload sent to subscribers
 */
export class PollingSubscriptionManager<Item, Key, ChangePayload> {
  /** Map of interval (ms) to interval ID and subscriber list */
  private readonly intervals = new Map<
    number,
    {
      intervalId: ReturnType<typeof setInterval>;
      subscribers: Set<Subscription<ChangePayload>>;
    }
  >();

  /** Current known state from last poll */
  private lastKnownState = new Map<Key, Item>();

  /** Whether the manager has been initialized with a state fetch */
  private initialized = false;

  /** Whether initialization is currently in progress (guards against poll/init race) */
  private initializing = false;

  /** Function to fetch current state */
  private readonly fetchState: StateFetcher<Item, Key>;

  /** Function to compare items for equality */
  private readonly compareItems: ItemComparator<Item>;

  /** Factory for creating change payloads */
  private readonly payloadFactory: ChangePayloadFactory<Item, ChangePayload>;

  /** Default polling interval */
  private readonly defaultIntervalMs: number;

  /**
   * Creates a new PollingSubscriptionManager
   *
   * @param fetchState - Function that returns the current state as a Map
   * @param compareItems - Function that compares two items for equality
   * @param payloadFactory - Factory for creating INSERT/UPDATE/DELETE payloads
   * @param options - Configuration options
   */
  constructor(
    fetchState: StateFetcher<Item, Key>,
    compareItems: ItemComparator<Item>,
    payloadFactory: ChangePayloadFactory<Item, ChangePayload>,
    options?: PollingManagerOptions
  ) {
    this.fetchState = fetchState;
    this.compareItems = compareItems;
    this.payloadFactory = payloadFactory;
    this.defaultIntervalMs = options?.defaultIntervalMs ?? 1000;
  }

  /**
   * Subscribe to changes with a specific polling interval
   *
   * @param callback - Function called when changes are detected
   * @param options - Subscription options including interval
   * @returns Unsubscribe function
   */
  subscribe(
    callback: ChangeCallback<ChangePayload>,
    options?: PollingSubscriptionOptions
  ): () => void {
    const interval = options?.intervalMs ?? this.defaultIntervalMs;
    const subscription: Subscription<ChangePayload> = {
      callback,
      intervalMs: interval,
    };

    // Get or create interval group
    let intervalGroup = this.intervals.get(interval);
    if (!intervalGroup) {
      // First subscriber for this interval - create the polling loop
      const subscribers = new Set<Subscription<ChangePayload>>();
      const intervalId = setInterval(() => this.poll(subscribers), interval);

      intervalGroup = { intervalId, subscribers };
      this.intervals.set(interval, intervalGroup);

      // Run initial poll if this is the first subscriber ever
      if (!this.initialized) {
        this.initialized = true;
        this.initializing = true;
        this.initAndPoll(subscription);
      } else {
        // Run immediate poll for new subscriber
        this.pollForNewSubscriber(subscription);
      }
    } else {
      // New subscriber joining existing interval - send them current state
      this.pollForNewSubscriber(subscription);
    }

    intervalGroup.subscribers.add(subscription);

    // Return unsubscribe function
    return () => {
      const group = this.intervals.get(interval);
      if (group) {
        group.subscribers.delete(subscription);

        // If no more subscribers for this interval, clean up
        if (group.subscribers.size === 0) {
          clearInterval(group.intervalId);
          this.intervals.delete(interval);
        }
      }
    };
  }

  /**
   * Initialize state and run first poll
   */
  private async initAndPoll(newSubscription: Subscription<ChangePayload>): Promise<void> {
    try {
      this.lastKnownState = await this.fetchState();
      // Notify the new subscriber of initial state as INSERTs
      for (const [, item] of this.lastKnownState) {
        const payload = this.payloadFactory.insert(item);
        try {
          newSubscription.callback(payload);
        } catch {
          // Ignore callback errors
        }
      }
    } catch {
      // Ignore fetch errors during initialization
    } finally {
      this.initializing = false;
    }
  }

  /**
   * Send current state to a new subscriber
   */
  private pollForNewSubscriber(subscription: Subscription<ChangePayload>): void {
    // Send current state as INSERTs to the new subscriber
    for (const [, item] of this.lastKnownState) {
      const payload = this.payloadFactory.insert(item);
      try {
        subscription.callback(payload);
      } catch {
        // Ignore callback errors
      }
    }
  }

  /**
   * Poll for changes and notify all subscribers in the given set
   */
  private async poll(subscribers: Set<Subscription<ChangePayload>>): Promise<void> {
    if (subscribers.size === 0) return;
    // Skip polling while initAndPoll is still running to avoid racing on lastKnownState
    if (this.initializing) return;

    try {
      const currentState = await this.fetchState();
      const changes: ChangePayload[] = [];

      // Detect new and updated items
      for (const [key, item] of currentState) {
        const oldItem = this.lastKnownState.get(key);
        if (!oldItem) {
          changes.push(this.payloadFactory.insert(item));
        } else if (!this.compareItems(oldItem, item)) {
          changes.push(this.payloadFactory.update(oldItem, item));
        }
      }

      // Detect deleted items
      for (const [key, item] of this.lastKnownState) {
        if (!currentState.has(key)) {
          changes.push(this.payloadFactory.delete(item));
        }
      }

      // Update state
      this.lastKnownState = currentState;

      // Broadcast changes to all subscribers
      for (const change of changes) {
        for (const sub of subscribers) {
          try {
            sub.callback(change);
          } catch {
            // Ignore callback errors
          }
        }
      }
    } catch {
      // Ignore polling errors
    }
  }

  /**
   * Get the number of active subscriptions across all intervals
   */
  get subscriptionCount(): number {
    let count = 0;
    for (const group of this.intervals.values()) {
      count += group.subscribers.size;
    }
    return count;
  }

  /**
   * Check if there are any active subscriptions
   */
  get hasSubscriptions(): boolean {
    return this.intervals.size > 0;
  }

  /**
   * Destroy the manager and clean up all intervals
   */
  destroy(): void {
    for (const group of this.intervals.values()) {
      clearInterval(group.intervalId);
    }
    this.intervals.clear();
    this.lastKnownState.clear();
    this.initialized = false;
    this.initializing = false;
  }
}

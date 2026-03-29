/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Configuration options for the hybrid subscription manager
 */
export interface HybridManagerOptions {
  /** Default polling interval in milliseconds for backup polling */
  readonly defaultIntervalMs?: number;
  /** Backup polling interval in milliseconds (0 to disable, default: 5000) */
  readonly backupPollingIntervalMs?: number;
  /** Enable BroadcastChannel notifications (default: true) */
  readonly useBroadcastChannel?: boolean;
  /** BroadcastChannel name for cross-tab communication */
  readonly broadcastChannelName?: string;
}

// Re-use types from PollingSubscriptionManager to avoid duplication
import type {
  ChangeCallback,
  ChangePayloadFactory,
  ItemComparator,
  StateFetcher,
} from "./PollingSubscriptionManager";

/**
 * Options for subscribing to changes
 */
export interface HybridSubscriptionOptions {
  /** Polling interval in milliseconds (not used if BroadcastChannel is active) */
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
 * BroadcastChannel message types
 */
type BroadcastMessage =
  | { readonly type: "CHANGE" }
  | { readonly type: "HEARTBEAT"; readonly tabId: string; readonly timestamp: number };

/**
 * Manages hybrid event + polling subscriptions efficiently by using BroadcastChannel
 * for instant cross-tab change notifications with optional backup polling for reliability.
 *
 * This manager combines three notification mechanisms:
 * 1. Local event notifications for same-tab changes (instant)
 * 2. BroadcastChannel for cross-tab change notifications (near-instant)
 * 3. Optional backup polling for reliability (infrequent, 5-10s)
 *
 * When BroadcastChannel is not available, falls back to local events only (assumes single tab).
 *
 * @template Item - The type of items being tracked
 * @template Key - The type of key used to identify items
 * @template ChangePayload - The type of change payload sent to subscribers
 */
export class HybridSubscriptionManager<Item, Key, ChangePayload> {
  /** Map of interval (ms) to interval ID and subscriber list */
  private readonly subscribers = new Set<Subscription<ChangePayload>>();

  /** Current known state from last fetch */
  private lastKnownState = new Map<Key, Item>();

  /** Whether the manager has been initialized with a state fetch */
  private initialized = false;

  /** BroadcastChannel for cross-tab communication */
  private channel: BroadcastChannel | null = null;

  /** Backup polling interval ID */
  private backupPollingIntervalId: ReturnType<typeof setInterval> | null = null;

  /** Function to fetch current state */
  private readonly fetchState: StateFetcher<Item, Key>;

  /** Function to compare items for equality */
  private readonly compareItems: ItemComparator<Item>;

  /** Factory for creating change payloads */
  private readonly payloadFactory: ChangePayloadFactory<Item, ChangePayload>;

  /** Configuration options */
  private readonly options: Required<HybridManagerOptions>;

  /** Whether BroadcastChannel is available */
  private readonly hasBroadcastChannel: boolean;

  /**
   * Creates a new HybridSubscriptionManager
   *
   * @param channelName - Name for the BroadcastChannel (should be unique per storage instance)
   * @param fetchState - Function that returns the current state as a Map
   * @param compareItems - Function that compares two items for equality
   * @param payloadFactory - Factory for creating INSERT/UPDATE/DELETE payloads
   * @param options - Configuration options
   */
  constructor(
    channelName: string,
    fetchState: StateFetcher<Item, Key>,
    compareItems: ItemComparator<Item>,
    payloadFactory: ChangePayloadFactory<Item, ChangePayload>,
    options?: HybridManagerOptions
  ) {
    this.fetchState = fetchState;
    this.compareItems = compareItems;
    this.payloadFactory = payloadFactory;

    this.options = {
      defaultIntervalMs: options?.defaultIntervalMs ?? 1000,
      backupPollingIntervalMs: options?.backupPollingIntervalMs ?? 5000,
      useBroadcastChannel: options?.useBroadcastChannel ?? true,
      broadcastChannelName: options?.broadcastChannelName ?? channelName,
    };

    this.hasBroadcastChannel =
      this.options.useBroadcastChannel && typeof BroadcastChannel !== "undefined";

    if (this.hasBroadcastChannel) {
      this.initializeBroadcastChannel();
    }
  }

  /**
   * Initializes the BroadcastChannel and sets up message handlers
   */
  private initializeBroadcastChannel(): void {
    try {
      this.channel = new BroadcastChannel(this.options.broadcastChannelName);
      this.channel.onmessage = (event: MessageEvent<BroadcastMessage>) => {
        this.handleBroadcastMessage(event.data);
      };
    } catch (error) {
      console.error("Failed to initialize BroadcastChannel:", error);
      this.channel = null;
    }
  }

  /**
   * Handles incoming BroadcastChannel messages
   */
  private async handleBroadcastMessage(message: BroadcastMessage): Promise<void> {
    if (message.type === "CHANGE") {
      // Another tab made a change - poll for updates
      await this.pollAndNotify();
    }
    // HEARTBEAT messages could be used for tab detection in future
  }

  /**
   * Notifies other tabs that a local change occurred
   * Should be called after any local mutation
   */
  notifyLocalChange(): void {
    // Immediately poll and notify local subscribers
    this.pollAndNotify();

    // Broadcast change notification to other tabs
    if (this.channel) {
      try {
        this.channel.postMessage({ type: "CHANGE" } as BroadcastMessage);
      } catch (error) {
        // Ignore broadcast errors
      }
    }
  }

  /**
   * Subscribe to changes
   *
   * @param callback - Function called when changes are detected
   * @param options - Subscription options
   * @returns Unsubscribe function
   */
  subscribe(
    callback: ChangeCallback<ChangePayload>,
    options?: HybridSubscriptionOptions
  ): () => void {
    const interval = options?.intervalMs ?? this.options.defaultIntervalMs;
    const subscription: Subscription<ChangePayload> = {
      callback,
      intervalMs: interval,
    };

    const isFirstSubscriber = this.subscribers.size === 0;
    this.subscribers.add(subscription);

    if (isFirstSubscriber) {
      // First subscriber - initialize and set up backup polling
      if (!this.initialized) {
        this.initialized = true;
        // Don't await - let it run async to avoid blocking
        void this.initAndNotify(subscription);
      } else {
        // Send current state to new subscriber
        this.notifySubscriberOfCurrentState(subscription);
      }

      // Start backup polling if configured
      // When BroadcastChannel is active, use backup polling for reliability
      // When BroadcastChannel is not available/disabled, use polling as the primary mechanism
      if (this.options.backupPollingIntervalMs > 0) {
        this.startBackupPolling();
      }
    } else {
      this.notifySubscriberOfCurrentState(subscription);
    }

    return () => {
      this.subscribers.delete(subscription);

      // If no more subscribers, stop backup polling
      if (this.subscribers.size === 0) {
        this.stopBackupPolling();
      }
    };
  }

  /**
   * Initialize state and notify first subscriber
   */
  private async initAndNotify(subscription: Subscription<ChangePayload>): Promise<void> {
    try {
      this.lastKnownState = await this.fetchState();
      // Notify the new subscriber of initial state as INSERTs
      for (const [, item] of this.lastKnownState) {
        const payload = this.payloadFactory.insert(item);
        try {
          subscription.callback(payload);
        } catch {
          // Ignore callback errors
        }
      }
    } catch {
      // Ignore fetch errors during initialization
    }
  }

  /**
   * Send current state to a subscriber
   */
  private notifySubscriberOfCurrentState(subscription: Subscription<ChangePayload>): void {
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
   * Poll for changes and notify all subscribers
   */
  private async pollAndNotify(): Promise<void> {
    if (this.subscribers.size === 0) return;

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
        for (const sub of this.subscribers) {
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
   * Start backup polling
   */
  private startBackupPolling(): void {
    if (this.backupPollingIntervalId) return;

    this.backupPollingIntervalId = setInterval(
      () => this.pollAndNotify(),
      this.options.backupPollingIntervalMs
    );
  }

  /**
   * Stop backup polling
   */
  private stopBackupPolling(): void {
    if (this.backupPollingIntervalId) {
      clearInterval(this.backupPollingIntervalId);
      this.backupPollingIntervalId = null;
    }
  }

  /**
   * Get the number of active subscriptions
   */
  get subscriptionCount(): number {
    return this.subscribers.size;
  }

  /**
   * Check if there are any active subscriptions
   */
  get hasSubscriptions(): boolean {
    return this.subscribers.size > 0;
  }

  /**
   * Check if BroadcastChannel is available and active
   */
  get isBroadcastChannelActive(): boolean {
    return this.channel !== null;
  }

  /**
   * Destroy the manager and clean up all resources
   */
  destroy(): void {
    this.stopBackupPolling();
    if (this.channel) {
      this.channel.close();
      this.channel = null;
    }
    this.subscribers.clear();
    this.lastKnownState.clear();
    this.initialized = false;
  }
}

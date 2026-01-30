/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * A type that represents a listener function for an event.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
type EventListener<Events, EventType extends keyof Events> = Events[EventType];

/**
 * A type that represents a list of listener functions for an event.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
type EventListeners<Events, EventType extends keyof Events> = Array<{
  listener: EventListener<Events, EventType>;
  once?: boolean;
}>;

/**
 * A type that represents the parameters of an event.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
export type EventParameters<Events, EventType extends keyof Events> = {
  [Event in EventType]: EventListener<Events, EventType> extends (...args: infer P) => any
    ? P
    : never;
}[EventType];

/**
 * A type that represents the return type of the emitted method.
 * @template Events - A record of event names and their corresponding listener functions
 * @template EventType - The name of the event
 */
export type EmittedReturnType<Events, EventType extends keyof Events> = EventParameters<
  Events,
  EventType
>;

/**
 * A class that implements an event emitter pattern.
 * @template EventListenerTypes - A record of event names and their corresponding listener functions
 */
export class EventEmitter<EventListenerTypes extends Record<string, (...args: any) => any>> {
  private listeners: {
    [Event in keyof EventListenerTypes]?: EventListeners<EventListenerTypes, Event>;
  } = {};

  /**
   * Remove all listeners for a specific event or all events
   * @param event - Optional event name. If not provided, removes all listeners for all events
   * @returns this, so that calls can be chained
   */
  removeAllListeners<Event extends keyof EventListenerTypes>(event?: Event): this {
    if (event) {
      delete this.listeners[event];
    } else {
      this.listeners = {};
    }
    return this;
  }

  /**
   * Adds a listener function for the event
   * @param event - The event name to listen for
   * @param listener - The listener function to add
   * @returns this, so that calls can be chained
   */
  on<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): this {
    const listeners: EventListeners<EventListenerTypes, Event> =
      this.listeners[event] || (this.listeners[event] = []);
    listeners.push({ listener });
    return this;
  }

  /**
   * Removes a listener function for the event
   * @param event - The event name to remove the listener from
   * @param listener - The listener function to remove
   * @returns this, so that calls can be chained
   */
  off<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): this {
    const listeners = this.listeners[event];
    if (!listeners) return this;

    const index = listeners.findIndex((l) => l.listener === listener);
    if (index >= 0) {
      listeners.splice(index, 1);
    }
    return this;
  }

  /**
   * Adds a listener function for the event that will be called only once
   * @param event - The event name to listen for
   * @param listener - The listener function to add
   * @returns this, so that calls can be chained
   */
  once<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): this {
    const listeners: EventListeners<EventListenerTypes, Event> =
      this.listeners[event] || (this.listeners[event] = []);
    listeners.push({ listener, once: true });
    return this;
  }

  /**
   * Returns a promise that resolves when the event is emitted
   * @param event - The event name to listen for
   * @returns a promise that resolves to an array of all parameters of the event (empty array for events with no parameters)
   */
  waitOn<Event extends keyof EventListenerTypes>(
    event: Event
  ): Promise<EmittedReturnType<EventListenerTypes, Event>> {
    return new Promise((resolve) => {
      // Create an anonymous function that captures all arguments and passes them to resolve
      const listener = ((...args: any[]) => {
        // Always resolve with the array of arguments (which may be empty)
        resolve(args as any);
      }) as EventListener<EventListenerTypes, Event>;

      this.once(event, listener);
    });
  }

  /**
   * Emits an event with the specified name and arguments
   * @param event - The event name to emit
   * @param args - Arguments to pass to the event listeners
   */
  public emit<Event extends keyof EventListenerTypes>(
    this: EventEmitter<EventListenerTypes>,
    event: Event,
    ...args: EventParameters<EventListenerTypes, Event>
  ) {
    const listeners: EventListeners<EventListenerTypes, Event> | undefined = this.listeners[event];
    if (listeners) {
      listeners.forEach(({ listener }) => {
        listener(...args);
      });
      // Remove once listeners we just called
      this.listeners[event] = listeners.filter((l) => !l.once);
    }
  }

  /**
   * Subscribes to an event and returns a function to unsubscribe
   * @param event - The event name to subscribe to
   * @param listener - The listener function to add
   * @returns a function to unsubscribe from the event
   */
  public subscribe<Event extends keyof EventListenerTypes>(
    event: Event,
    listener: EventListener<EventListenerTypes, Event>
  ): () => void {
    this.on(event, listener);
    return () => this.off(event, listener);
  }
}

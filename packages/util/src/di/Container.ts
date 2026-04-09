/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Simple dependency injection container for managing service instances and dependencies
 */
export class Container {
  private services: Map<string, any> = new Map();
  private factories: Map<string, () => any> = new Map();
  private singletons: Set<string> = new Set();

  /**
   * Register a service factory
   * @param token The identifier token for the service
   * @param factory A factory function that creates the service
   * @param singleton Whether the service should be a singleton (created once)
   */
  register<T>(token: string, factory: () => T, singleton = true): void {
    this.factories.set(token, factory);
    if (singleton) {
      this.singletons.add(token);
    }
  }

  /**
   * Register an instance as a service
   * @param token The identifier token for the service
   * @param instance The instance to register
   */
  registerInstance<T>(token: string, instance: T): void {
    this.services.set(token, instance);
    this.singletons.add(token);
  }

  /**
   * Get a service by its token
   * @param token The identifier token for the service
   * @returns The service instance
   */
  get<T>(token: string): T {
    if (this.services.has(token)) {
      return this.services.get(token) as T;
    }

    const factory = this.factories.get(token);
    if (!factory) {
      throw new Error(`Service not registered: ${String(token)}`);
    }

    const instance = factory();

    if (this.singletons.has(token)) {
      this.services.set(token, instance);
    }

    return instance as T;
  }

  /**
   * Check if a service is registered
   * @param token The identifier token for the service
   * @returns True if the service is registered
   */
  has(token: string): boolean {
    return this.services.has(token) || this.factories.has(token);
  }

  /**
   * Remove a service registration
   * @param token The identifier token for the service
   */
  remove(token: string): void {
    this.services.delete(token);
    this.factories.delete(token);
    this.singletons.delete(token);
  }

  /**
   * Dispose all instantiated singleton services and clear registrations.
   * Services implementing dispose(), Symbol.asyncDispose, or Symbol.dispose will be cleaned up.
   */
  async dispose(): Promise<void> {
    const errors: unknown[] = [];
    try {
      for (const service of this.services.values()) {
        if (service == null) continue;
        try {
          if (typeof service[Symbol.asyncDispose] === "function") {
            await service[Symbol.asyncDispose]();
          } else if (typeof service[Symbol.dispose] === "function") {
            service[Symbol.dispose]();
          } else if (typeof service.dispose === "function") {
            await service.dispose();
          }
        } catch (err) {
          errors.push(err);
        }
      }
    } finally {
      this.services.clear();
      this.factories.clear();
      this.singletons.clear();
    }
    if (errors.length > 0) {
      throw new AggregateError(errors, "One or more services failed to dispose");
    }
  }

  async [Symbol.asyncDispose](): Promise<void> {
    await this.dispose();
  }

  /**
   * Create a child container that inherits registrations from the parent
   * @returns A new child container
   */
  createChildContainer(): Container {
    const child = new Container();

    // Copy all registrations to the child
    this.factories.forEach((factory, token) => {
      child.factories.set(token, factory);
      if (this.singletons.has(token)) {
        child.singletons.add(token);
      }
    });

    // Copy all singleton instances to the child
    this.services.forEach((service, token) => {
      if (this.singletons.has(token)) {
        child.services.set(token, service);
        child.singletons.add(token);
      }
    });

    return child;
  }
}

/**
 * Global container instance
 */
export const globalContainer = new Container();

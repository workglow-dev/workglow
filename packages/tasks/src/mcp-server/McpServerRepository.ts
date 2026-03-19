/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

import { ITabularStorage } from "@workglow/storage";
import { EventEmitter, EventParameters } from "@workglow/util";

import {
  McpServerPrimaryKeyNames,
  McpServerRecord,
  McpServerRecordSchema,
} from "./McpServerSchema";

/**
 * Events that can be emitted by the McpServerRepository
 */
export type McpServerEventListeners = {
  server_added: (server: McpServerRecord) => void;
  server_removed: (server: McpServerRecord) => void;
  server_updated: (server: McpServerRecord) => void;
};

export type McpServerEvents = keyof McpServerEventListeners;

export type McpServerEventListener<Event extends McpServerEvents> = McpServerEventListeners[Event];

export type McpServerEventParameters<Event extends McpServerEvents> = EventParameters<
  McpServerEventListeners,
  Event
>;

/**
 * Base class for managing MCP server configurations.
 * Provides functionality for storing, retrieving, and managing the lifecycle
 * of registered MCP server records.
 */
export class McpServerRepository {
  protected readonly serverTabularRepository: ITabularStorage<
    typeof McpServerRecordSchema,
    typeof McpServerPrimaryKeyNames
  >;

  constructor(
    serverTabularRepository: ITabularStorage<
      typeof McpServerRecordSchema,
      typeof McpServerPrimaryKeyNames,
      McpServerRecord
    >
  ) {
    this.serverTabularRepository = serverTabularRepository;
  }

  /** Event emitter for repository events */
  protected events = new EventEmitter<McpServerEventListeners>();

  /**
   * Sets up the database for the repository.
   * Must be called before using any other methods.
   */
  async setupDatabase(): Promise<void> {
    await this.serverTabularRepository.setupDatabase?.();
  }

  on<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.on(name, fn);
  }

  off<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.off(name, fn);
  }

  once<Event extends McpServerEvents>(name: Event, fn: McpServerEventListener<Event>) {
    this.events.once(name, fn);
  }

  waitOn<Event extends McpServerEvents>(name: Event) {
    return this.events.waitOn(name);
  }

  /**
   * Adds a new server to the repository.
   * Emits `server_added` for new records or `server_updated` when overwriting an existing one.
   */
  async addServer(server: McpServerRecord) {
    const existing = await this.serverTabularRepository.get({ server_id: server.server_id });
    await this.serverTabularRepository.put(server);
    if (existing) {
      this.events.emit("server_updated", server);
    } else {
      this.events.emit("server_added", server);
    }
    return server;
  }

  /**
   * Updates an existing server in the repository.
   * Throws if the server does not exist.
   */
  async updateServer(server: McpServerRecord): Promise<McpServerRecord> {
    const existing = await this.serverTabularRepository.get({ server_id: server.server_id });
    if (!existing) {
      throw new Error(`MCP server with id "${server.server_id}" not found`);
    }
    await this.serverTabularRepository.put(server);
    this.events.emit("server_updated", server);
    return server;
  }

  /**
   * Removes a server from the repository
   */
  async removeServer(server_id: string): Promise<void> {
    const server = await this.serverTabularRepository.get({ server_id });
    if (!server) {
      throw new Error(`MCP server with id "${server_id}" not found`);
    }
    await this.serverTabularRepository.delete({ server_id });
    this.events.emit("server_removed", server);
  }

  /**
   * Retrieves a server by its identifier
   */
  async findByName(server_id: string): Promise<McpServerRecord | undefined> {
    if (typeof server_id != "string") return undefined;
    const server = await this.serverTabularRepository.get({ server_id });
    return server ?? undefined;
  }

  /**
   * Enumerates all servers in the repository
   */
  async enumerateAllServers(): Promise<McpServerRecord[] | undefined> {
    const servers = await this.serverTabularRepository.getAll();
    if (!servers || servers.length === 0) return undefined;
    return servers;
  }

  /**
   * Gets the total number of servers in the repository
   */
  async size(): Promise<number> {
    return await this.serverTabularRepository.size();
  }
}

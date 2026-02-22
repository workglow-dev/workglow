/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Represents an HTTP cookie
 */
export interface Cookie {
  readonly name: string;
  readonly value: string;
  readonly domain: string;
  readonly path: string;
  readonly expires?: number;
  readonly httpOnly?: boolean;
  readonly secure?: boolean;
  readonly sameSite?: "Strict" | "Lax" | "None";
}

/**
 * Store for managing HTTP cookies
 * 
 * Provides cookie management with domain/path scoping and serialization
 * for persistence across browser sessions.
 */
export class CookieStore {
  private cookies: Map<string, Cookie> = new Map();

  /**
   * Generate a key for cookie lookup
   */
  private getKey(name: string, domain: string, path: string = "/"): string {
    return `${domain}:${path}:${name}`;
  }

  /**
   * Get a cookie by name and optional domain
   * 
   * @param name - Cookie name
   * @param domain - Cookie domain (if not specified, returns first match)
   * @returns The cookie or undefined
   */
  get(name: string, domain?: string): Cookie | undefined {
    if (domain) {
      // Try exact domain match with default path
      const key = this.getKey(name, domain, "/");
      const cookie = this.cookies.get(key);
      if (cookie) {
        return cookie;
      }

      // Try to find any cookie with this name and domain
      for (const cookie of this.cookies.values()) {
        if (cookie.name === name && cookie.domain === domain) {
          return cookie;
        }
      }
    }

    // Find first cookie with this name
    for (const cookie of this.cookies.values()) {
      if (cookie.name === name) {
        return cookie;
      }
    }

    return undefined;
  }

  /**
   * Get all cookies
   * 
   * @returns Array of all cookies
   */
  getAll(): readonly Cookie[] {
    // Filter out expired cookies
    const now = Date.now();
    const validCookies: Cookie[] = [];

    for (const cookie of this.cookies.values()) {
      if (!cookie.expires || cookie.expires > now) {
        validCookies.push(cookie);
      }
    }

    return validCookies;
  }

  /**
   * Get all cookies for a specific domain
   * 
   * @param domain - Domain to filter by (includes subdomains)
   * @returns Array of matching cookies
   */
  getForDomain(domain: string): readonly Cookie[] {
    const now = Date.now();
    const validCookies: Cookie[] = [];

    for (const cookie of this.cookies.values()) {
      // Check if cookie is expired
      if (cookie.expires && cookie.expires <= now) {
        continue;
      }

      // Check if domain matches (including subdomain matching)
      if (this.domainMatches(domain, cookie.domain)) {
        validCookies.push(cookie);
      }
    }

    return validCookies;
  }

  /**
   * Check if a request domain matches a cookie domain
   * Implements cookie domain matching rules
   */
  private domainMatches(requestDomain: string, cookieDomain: string): boolean {
    // Exact match
    if (requestDomain === cookieDomain) {
      return true;
    }

    // Cookie domain starts with . (allows subdomains)
    if (cookieDomain.startsWith(".")) {
      const suffix = cookieDomain.slice(1);
      if (requestDomain === suffix || requestDomain.endsWith("." + suffix)) {
        return true;
      }
    } else {
      // Cookie domain doesn't start with ., check if request is subdomain
      if (requestDomain.endsWith("." + cookieDomain)) {
        return true;
      }
    }

    return false;
  }

  /**
   * Set a cookie
   * 
   * @param cookie - Cookie to set
   */
  set(cookie: Cookie): void {
    const key = this.getKey(cookie.name, cookie.domain, cookie.path);
    this.cookies.set(key, cookie);
  }

  /**
   * Set multiple cookies
   * 
   * @param cookies - Cookies to set
   */
  setMany(cookies: readonly Cookie[]): void {
    for (const cookie of cookies) {
      this.set(cookie);
    }
  }

  /**
   * Delete a cookie by name and optional domain/path
   * 
   * @param name - Cookie name
   * @param domain - Cookie domain (if not specified, deletes all with name)
   * @param path - Cookie path (defaults to "/")
   */
  delete(name: string, domain?: string, path: string = "/"): void {
    if (domain) {
      const key = this.getKey(name, domain, path);
      this.cookies.delete(key);
    } else {
      // Delete all cookies with this name
      const keysToDelete: string[] = [];
      for (const [key, cookie] of this.cookies.entries()) {
        if (cookie.name === name) {
          keysToDelete.push(key);
        }
      }
      for (const key of keysToDelete) {
        this.cookies.delete(key);
      }
    }
  }

  /**
   * Clear all cookies
   */
  clear(): void {
    this.cookies.clear();
  }

  /**
   * Serialize cookies to JSON array
   * 
   * @returns Array of cookies
   */
  toJSON(): Cookie[] {
    return Array.from(this.cookies.values());
  }

  /**
   * Load cookies from JSON array
   * 
   * @param cookies - Array of cookies to load
   */
  fromJSON(cookies: readonly Cookie[]): void {
    this.clear();
    this.setMany(cookies);
  }

  /**
   * Create a new CookieStore from JSON
   * 
   * @param cookies - Array of cookies
   * @returns New CookieStore instance
   */
  static fromJSON(cookies: readonly Cookie[]): CookieStore {
    const store = new CookieStore();
    store.fromJSON(cookies);
    return store;
  }

  /**
   * Clone this cookie store
   */
  clone(): CookieStore {
    const store = new CookieStore();
    store.fromJSON(this.toJSON());
    return store;
  }
}

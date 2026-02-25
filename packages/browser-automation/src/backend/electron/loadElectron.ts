/**
 * @license
 * Copyright 2025 Steven Roussey <sroussey@gmail.com>
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * Lazily loads the Electron module.
 * Only works when running inside Electron's main process.
 * Returns `any` since Electron is an optional peer dependency.
 */
export async function loadElectron(): Promise<unknown> {
  try {
    const electron = await import("electron");
    if (!(electron as any).BrowserWindow) {
      throw new Error("BrowserWindow not available - are you in Electron's main process?");
    }
    return electron;
  } catch (err) {
    if (err instanceof Error && err.message.includes("BrowserWindow")) {
      throw err;
    }
    throw new Error(
      "Electron is required for the electron browser backend but was not found. " +
        "This adapter only works inside an Electron main process."
    );
  }
}

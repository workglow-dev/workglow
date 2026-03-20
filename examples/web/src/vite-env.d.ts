/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

/// <reference types="vite/client" />

/** Plain CSS side-effect imports — duplicated here so `tsgo`/CI sees them even if `vite/client` types resolution differs from `tsc`. */
declare module "*.css" {}

/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */
import { registerInputResolver } from "../di/InputResolverRegistry";
import { GpuImage as GpuImageFactory } from "./gpuImage";
import type { ServiceRegistry } from "../di/ServiceRegistry";

// String-only resolver: invoked when a property's schema has format:"image"
// (or format:"image:..."), and the dataflow value is a string. Non-string
// shapes (Blob, ImageBitmap, ImageBinary) are passed through unchanged by
// the InputResolver — consumers convert them at the call site if needed
// (e.g. useGpuImage in the builder app).
async function resolveImageString(
  id: string,
  _format: string,
  _registry: ServiceRegistry,
): Promise<unknown> {
  if (typeof id !== "string") return id;
  if (id.startsWith("data:")) {
    return GpuImageFactory.fromDataUri(id);
  }
  // Fail loudly for unrecognized string schemes — silently passing the raw
  // string through would crash the consuming task with a confusing TypeError
  // when it called .materialize() on a string. Other URL schemes (http, file,
  // s3, etc.) need their own resolver under a sub-prefix:
  //   registerInputResolver("image:http", httpFetcher)
  const preview = id.length > 32 ? `${id.slice(0, 32)}...` : id;
  throw new Error(
    `format:"image" resolver received an unsupported string "${preview}". ` +
      `Only data: URIs are handled. For other schemes register a sub-resolver, ` +
      `e.g. registerInputResolver("image:http", fn).`,
  );
}

registerInputResolver("image", resolveImageString);

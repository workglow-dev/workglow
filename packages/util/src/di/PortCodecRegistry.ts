/**
 * @copyright
 * Copyright 2026 Steven Roussey
 * All Rights Reserved
 */

export interface PortCodec<Live = unknown, Wire = unknown> {
  serialize(value: Live): Promise<Wire>;
  deserialize(value: Wire): Promise<Live>;
}

const codecs = new Map<string, PortCodec>();

export function registerPortCodec<Live = unknown, Wire = unknown>(
  formatPrefix: string,
  codec: PortCodec<Live, Wire>,
): void {
  codecs.set(formatPrefix, codec as PortCodec);
}

export function getPortCodec(format: string): PortCodec | undefined {
  if (codecs.has(format)) return codecs.get(format);
  const colon = format.indexOf(":");
  if (colon > 0) {
    const prefix = format.slice(0, colon);
    return codecs.get(prefix);
  }
  return undefined;
}

/** @internal — test affordance only. */
export function _resetPortCodecsForTests(): void {
  codecs.clear();
}

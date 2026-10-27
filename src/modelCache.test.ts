import { describe, expect, it } from 'vitest';
import { maybeDecompressModel, needsModelFetch } from './modelCache.js';

describe('needsModelFetch', () => {
  it.each([
    ['nothing is cached', undefined, 'v1', true],
    ['the cached id differs', 'https://x/English?v0', 'v1', true],
    ['the cached entry has no id', 'https://x/English', 'v1', true],
    ['the cached id matches', 'https://x/English?v1', 'v1', false],
  ])('is %s -> %s', (_, cachedUrl, id, expected) => {
    expect(needsModelFetch(cachedUrl, id)).toBe(expected);
  });
});

describe('maybeDecompressModel', () => {
  const tar = new Uint8Array(70_000).map((_, i) => (i * 37) & 0xff);
  // CompressionStream instead of node:zlib: tsconfig.json has no node types, same as upstream tests.
  let gz: Uint8Array | undefined;
  const gzipped = async () => (gz ??= new Uint8Array(await new Response(
    new Blob([tar]).stream().pipeThrough(new CompressionStream('gzip')),
  ).arrayBuffer()));

  const chunkedBody = (bytes: Uint8Array, chunk: number) => {
    let i = 0;
    return new ReadableStream<Uint8Array>({
      pull(controller) {
        if (i >= bytes.length) return controller.close();
        controller.enqueue(bytes.slice(i, i + chunk));
        i += chunk;
      },
    });
  };
  const decoded = async (bytes: Uint8Array, chunk: number) =>
    new Uint8Array(await (await maybeDecompressModel(new Response(chunkedBody(bytes, chunk)))).arrayBuffer());

  it.each([65536, 4096, 1])('decompresses a real gzip body split into %i-byte chunks', async chunk => {
    expect(await decoded(await gzipped(), chunk)).toEqual(tar);
  });

  it.each([65536, 1])('passes an already-decoded body through untouched, %i-byte chunks', async chunk => {
    expect(await decoded(tar, chunk)).toEqual(tar);
  });

  it('returns an empty body as empty instead of throwing', async () => {
    expect(await decoded(new Uint8Array(0), 64)).toEqual(new Uint8Array(0));
  });

  it('control: the old unconditional pipe throws on an already-decoded body', async () => {
    // Same cast as the implementation: DOM types declare the writable side as BufferSource.
    const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
    const old = new Response(chunkedBody(tar, 64).pipeThrough(gunzip));
    await expect(old.arrayBuffer()).rejects.toThrow();
  });
});

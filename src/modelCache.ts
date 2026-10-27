export const MODEL_CACHE = 'voskletto';

/** Models are stored under `path?id`, so a missing entry or a different id means the model must be fetched */
export const needsModelFetch = (cachedUrl: string | undefined, id: string): boolean =>
  cachedUrl === undefined || cachedUrl.split('?')[1] !== id;

const GZIP_0 = 0x1f;
const GZIP_1 = 0x8b;

/**
 * Decompress a model response only when the body really is gzip.
 *
 * A response fetched with `Content-Encoding: gzip` arrives already decoded: the header
 * still says gzip, the bytes are a plain tar. Piping that through a DecompressionStream
 * throws, so the magic bytes decide, not the header.
 */
export const maybeDecompressModel = async (res: Response): Promise<Response> => {
  const body = res.body;
  if (!body) return res;

  const reader = body.getReader();
  let peek = new Uint8Array(0);
  let exhausted = false;

  // Read just far enough to see the magic bytes; everything read is replayed below.
  while (peek.length < 2 && !exhausted) {
    const { done, value } = await reader.read();
    if (done) { exhausted = true; break; }
    if (!value || !value.length) continue;
    const next = new Uint8Array(peek.length + value.length);
    next.set(peek);
    next.set(value, peek.length);
    peek = next;
  }

  const source = new ReadableStream<Uint8Array>({
    start(controller) {
      if (peek.length) controller.enqueue(peek);
      if (exhausted) controller.close();
    },
    async pull(controller) {
      if (exhausted) return controller.close();
      const { done, value } = await reader.read();
      if (done) { exhausted = true; controller.close(); }
      else if (value && value.length) controller.enqueue(value);
    },
    cancel(reason) { return reader.cancel(reason); },
  });

  const gzipped = peek.length > 1 && peek[0] === GZIP_0 && peek[1] === GZIP_1;
  // DOM types declare DecompressionStream's writable side as WritableStream<BufferSource>,
  // which TypeScript will not accept as a transform for ReadableStream<Uint8Array>.
  const gunzip = new DecompressionStream('gzip') as unknown as ReadableWritablePair<Uint8Array, Uint8Array>;
  return new Response(gzipped ? source.pipeThrough(gunzip) : source);
};

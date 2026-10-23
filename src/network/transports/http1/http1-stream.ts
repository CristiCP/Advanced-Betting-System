import type { Dispatcher } from "undici";
import type { Http1StreamOptions } from "../../model/http1-stream.interfaces.js";
import type { TransportStream } from "../../model/transport.interfaces.js";

/**
 * @file Delivers raw HTTP/1.1 response chunks with independent flow control.
 */

// Open one response with a deadline covering pool queueing and headers.
export async function openHttp1Stream(
  options: Http1StreamOptions,
): Promise<TransportStream> {
  const { pool, request } = options;
  const signal = request.signal;

  if (
    !Number.isInteger(request.headersTimeoutMs) ||
    request.headersTimeoutMs <= 0 ||
    request.headersTimeoutMs > 2_147_483_647
  ) {
    throw new Error("Invalid HTTP/1.1 stream headers timeout.");
  }

  signal?.throwIfAborted();

  const abort = new AbortController();
  let cancelled = false;
  let finished = false;
  let failed = false;
  let failure: unknown;

  // Cancel only this response, allowing the pool to replace its socket.
  function cancel(): void {
    if (finished || failed || cancelled) {
      return;
    }

    cancelled = true;
    abort.abort(signal?.reason ?? new Error("HTTP/1.1 stream cancelled."));
  }

  signal?.addEventListener("abort", cancel, { once: true });

  const timer = setTimeout(() => {
    abort.abort(
      new Error(
        `HTTP/1.1 response headers timed out after ${request.headersTimeoutMs} ms.`,
      ),
    );
  }, request.headersTimeoutMs);

  try {
    const response = await new Promise<Dispatcher.ResponseData>(
      (resolve, reject) => {
        // Undici may defer queued abort callbacks until a connection is free.
        const onAbort = (): void => {
          reject(abort.signal.reason);
        };

        abort.signal.addEventListener("abort", onAbort, { once: true });

        void pool
          .request({
            path: request.path,
            method: request.method,
            headers: request.headers ?? {},
            body: request.body ?? null,
            signal: abort.signal,
            headersTimeout: request.headersTimeoutMs,
            bodyTimeout: 0,
          })
          .then(
            (received) => {
              abort.signal.removeEventListener("abort", onAbort);

              if (abort.signal.aborted) {
                // Release a response arriving after the caller stopped waiting.
                received.body.on("error", () => {}).destroy();
                return;
              }

              resolve(received);
            },
            (error: unknown) => {
              abort.signal.removeEventListener("abort", onAbort);
              reject(error);
            },
          );
      },
    );

    // Publish metadata while keeping the raw body paused for the caller.
    clearTimeout(timer);
    const body = response.body;
    body.pause();

    let resolveClosed!: () => void;
    let rejectClosed!: (error: unknown) => void;
    const closed = new Promise<void>((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    });

    // Observe failures even if they precede delivery of the stream handle.
    void closed.catch(() => {});

    function fail(error: unknown): void {
      if (finished || failed || cancelled) {
        return;
      }

      failed = true;
      failure = error;
      abort.abort(error);
    }

    // Copy borrowed buffers into memory safe to transfer to another worker.
    body.on("data", (chunk: Uint8Array) => {
      if (finished || failed || cancelled) {
        return;
      }

      try {
        const bytes = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(bytes).set(chunk);

        if (request.onChunk(bytes) === false) {
          body.pause();
        }
      } catch (error) {
        fail(error);
      }
    });

    body.on("error", fail);

    // Resolve cancellation and clean EOF; preserve transport or callback errors.
    body.once("close", () => {
      finished = true;
      signal?.removeEventListener("abort", cancel);

      if (failed) {
        rejectClosed(failure);
      } else if (cancelled || body.readableEnded) {
        resolveClosed();
      } else {
        rejectClosed(
          new Error("HTTP/1.1 response stream closed unexpectedly."),
        );
      }
    });

    // Handle cancellation racing with receipt of the response headers.
    if (abort.signal.aborted) {
      body.destroy();
      throw abort.signal.reason;
    }

    return {
      response: { statusCode: response.statusCode, headers: response.headers },
      closed,
      pause(): void {
        if (!finished && !failed && !cancelled) {
          body.pause();
        }
      },
      resume(): void {
        if (!finished && !failed && !cancelled) {
          body.resume();
        }
      },
      close(): Promise<void> {
        cancel();
        return closed;
      },
    };
  } catch (error) {
    signal?.removeEventListener("abort", cancel);
    throw error;
  } finally {
    clearTimeout(timer);
  }
}

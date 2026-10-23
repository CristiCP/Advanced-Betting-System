import { constants } from "node:http2";
import type { Http2StreamOptions } from "../../model/http2-stream.interfaces.js";
import type {
  TransportStream,
  TransportStreamResponse,
} from "../../model/transport.interfaces.js";

/**
 * @file Delivers raw HTTP/2 response chunks with independent flow control.
 */

// Open one stream and return its controls after response headers arrive.
export async function openHttp2Stream(
  options: Http2StreamOptions,
): Promise<TransportStream> {
  const { session, headers, request } = options;
  const signal = request.signal;

  // Apply a deadline to opening only, including HTTP/2 stream queueing.
  if (
    !Number.isInteger(request.headersTimeoutMs) ||
    request.headersTimeoutMs <= 0 ||
    request.headersTimeoutMs > 2_147_483_647
  ) {
    throw new Error("Invalid HTTP/2 stream headers timeout.");
  }

  signal?.throwIfAborted();

  const stream = session.request(headers, {
    endStream: request.body === undefined,
  });

  // Keep body delivery paused until the caller has received the metadata.
  stream.pause();

  return new Promise<TransportStream>((resolveOpen, rejectOpen) => {
    let resolveClosed!: () => void;
    let rejectClosed!: (error: unknown) => void;

    const closed = new Promise<void>((resolve, reject) => {
      resolveClosed = resolve;
      rejectClosed = reject;
    });

    // Observe failures that may happen before the caller receives the handle.
    void closed.catch(() => {});

    let openingSettled = false;
    let receivedResponse = false;
    let responseEnded = false;
    let cancelled = false;
    let failed = false;
    let failure: unknown;
    let finished = false;

    const timer = setTimeout(() => {
      fail(
        new Error(
          `HTTP/2 response headers timed out after ${request.headersTimeoutMs} ms.`,
        ),
      );
    }, request.headersTimeoutMs);

    // Reject opening once while preserving the final close notification.
    function rejectOpening(error: unknown): void {
      if (!openingSettled) {
        openingSettled = true;
        clearTimeout(timer);
        rejectOpen(error);
      }
    }

    // Cancel only this HTTP/2 stream and leave the session reusable.
    function closeNativeStream(): void {
      if (!stream.destroyed) {
        if (!stream.closed) {
          stream.close(constants.NGHTTP2_CANCEL);
        }
        // Discard unread bytes even when the peer already closed its side.
        stream.destroy();
      }
    }

    // Preserve the first failure and wait for native stream cleanup.
    function fail(error: unknown): void {
      if (finished || failed || cancelled) {
        return;
      }

      failed = true;
      failure = error;
      rejectOpening(error);
      closeNativeStream();
    }

    // Treat explicit cancellation as normal termination after opening.
    function cancel(): void {
      if (finished || failed || cancelled) {
        return;
      }

      cancelled = true;
      rejectOpening(signal?.reason ?? new Error("HTTP/2 stream cancelled."));
      closeNativeStream();
    }

    // Publish metadata before allowing any response body callbacks.
    stream.once("response", (received) => {
      if (openingSettled) {
        return;
      }

      const statusCode = received[":status"];

      if (statusCode === undefined) {
        fail(new Error("HTTP/2 response is missing its status code."));
        return;
      }

      const response: TransportStreamResponse = { statusCode, headers: {} };

      for (const [name, value] of Object.entries(received)) {
        if (
          !name.startsWith(":") &&
          (typeof value === "string" || Array.isArray(value))
        ) {
          response.headers[name] = value;
        }
      }

      receivedResponse = true;
      openingSettled = true;
      clearTimeout(timer);

      resolveOpen({
        response,
        closed,
        pause(): void {
          if (!finished && !failed && !cancelled) {
            stream.pause();
          }
        },
        resume(): void {
          if (!finished && !failed && !cancelled) {
            stream.resume();
          }
        },
        close(): Promise<void> {
          cancel();
          return closed;
        },
      });
    });

    // Give each callback its own transferable bytes without retaining a body.
    stream.on("data", (chunk: Uint8Array) => {
      if (finished || failed || cancelled) {
        return;
      }

      try {
        const body = new ArrayBuffer(chunk.byteLength);
        new Uint8Array(body).set(chunk);

        if (request.onChunk(body) === false) {
          stream.pause();
        }
      } catch (error) {
        fail(error);
      }
    });

    stream.once("end", () => {
      responseEnded = true;
    });

    // Distinguish clean EOF and local cancellation from remote failures.
    stream.once("close", () => {
      finished = true;
      clearTimeout(timer);
      signal?.removeEventListener("abort", cancel);

      if (failed) {
        rejectClosed(failure);
      } else if (cancelled) {
        resolveClosed();
      } else if (
        receivedResponse &&
        responseEnded &&
        stream.rstCode === constants.NGHTTP2_NO_ERROR
      ) {
        resolveClosed();
      } else {
        const error = new Error("HTTP/2 response stream closed unexpectedly.");
        rejectOpening(error);
        rejectClosed(error);
      }
    });

    stream.on("error", fail);
    stream.once("aborted", () => {
      fail(new Error("HTTP/2 response stream was aborted."));
    });

    // Cancel opening or an active subscription through the caller's signal.
    signal?.addEventListener("abort", cancel, { once: true });

    if (signal?.aborted) {
      cancel();
    }

    // Send the optional request body after lifecycle handlers are installed.
    options.onStream?.(stream);

    if (!cancelled) {
      try {
        stream.end(request.body);
      } catch (error) {
        fail(error);
      }
    }
  });
}

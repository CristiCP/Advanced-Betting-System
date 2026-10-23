import { isIP } from "node:net";
import { connect } from "node:tls";
import type { TlsConnection, TlsConnectionOptions } from "../model/tls.interfaces.js";

/**
 * @file Establishes a TLS connection and negotiates its HTTP protocol.
 */

export async function connectTls(
  options: TlsConnectionOptions,
): Promise<TlsConnection> {
  const { origin, connectTimeoutMs, signal } = options;
  const url = new URL(origin);

  // Require an HTTPS origin without credentials, path, query, or fragment.
  if (
    url.protocol !== "https:" ||
    url.username !== "" ||
    url.password !== "" ||
    url.pathname !== "/" ||
    url.search !== "" ||
    url.hash !== ""
  ) {
    throw new Error("Expected an HTTPS origin, such as https://example.com.");
  }

  // Keep the timeout within the supported timer range.
  if (
    !Number.isInteger(connectTimeoutMs) ||
    connectTimeoutMs <= 0 ||
    connectTimeoutMs > 2_147_483_647
  ) {
    throw new Error("Invalid TLS connection timeout.");
  }

  // Avoid opening a connection if cancellation was already requested.
  signal?.throwIfAborted();

  // Remove URL brackets from IPv6 addresses.
  const hostname = url.hostname.startsWith("[")
    ? url.hostname.slice(1, -1)
    : url.hostname;

  return new Promise<TlsConnection>((resolve, reject) => {
    // Open the connection and offer HTTP/2 followed by HTTP/1.1.
    const socket = connect({
      host: hostname,
      port: Number(url.port || 443),
      servername: isIP(hostname) === 0 ? hostname : undefined,
      ALPNProtocols: ["h2", "http/1.1"],
      rejectUnauthorized: true,
    });

    // Limit the total connection time, including DNS, TCP, and TLS.
    const timer = setTimeout(() => {
      fail(new Error(`TLS connection timed out after ${connectTimeoutMs} ms.`));
    }, connectTimeoutMs);

    // Remove handlers and the timer used during connection establishment.
    function cleanup(): void {
      clearTimeout(timer);
      socket.off("secureConnect", onSecureConnect);
      socket.off("error", onError);
      socket.off("close", onClose);
      signal?.removeEventListener("abort", onAbort);
    }

    // Release the failed connection and reject the operation.
    function fail(error: unknown): void {
      cleanup();
      socket.destroy();
      reject(error);
    }

    // Return the established connection with its selected HTTP protocol.
    function onSecureConnect(): void {
      const protocol =
        socket.alpnProtocol === false ? "http/1.1" : socket.alpnProtocol;

      if (protocol !== "h2" && protocol !== "http/1.1") {
        fail(new Error("The server selected an unsupported HTTP protocol."));
        return;
      }

      cleanup();
      resolve({ socket, protocol });
    }

    // Forward connection and certificate validation errors.
    function onError(error: Error): void {
      fail(error);
    }

    // Reject connections closed before the TLS handshake completes.
    function onClose(): void {
      fail(new Error("Connection closed before the TLS handshake completed."));
    }

    // Cancel the pending connection using the caller's reason.
    function onAbort(): void {
      fail(signal?.reason ?? new Error("TLS connection aborted."));
    }

    // Register connection and cancellation handlers.
    socket.once("secureConnect", onSecureConnect);
    socket.once("error", onError);
    socket.once("close", onClose);
    signal?.addEventListener("abort", onAbort, { once: true });

    // Handle cancellation that occurred during setup.
    if (signal?.aborted) {
      onAbort();
    }
  });
}

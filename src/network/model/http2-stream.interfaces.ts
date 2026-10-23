import type {
  ClientHttp2Session,
  ClientHttp2Stream,
  OutgoingHttpHeaders,
} from "node:http2";
import type { TransportStreamOptions } from "./transport.interfaces.js";

// Supply the session and request settings for one HTTP/2 response stream.
export interface Http2StreamOptions {
  session: ClientHttp2Session;
  headers: OutgoingHttpHeaders;
  request: TransportStreamOptions;
  // Register the native stream before sending its request body.
  onStream?(stream: ClientHttp2Stream): void;
}

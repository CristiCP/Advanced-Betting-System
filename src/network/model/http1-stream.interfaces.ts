import type { Pool } from "undici";
import type { TransportStreamOptions } from "./transport.interfaces.js";

// Supply the shared connection pool and one streaming request.
export interface Http1StreamOptions {
  pool: Pool;
  request: TransportStreamOptions;
}

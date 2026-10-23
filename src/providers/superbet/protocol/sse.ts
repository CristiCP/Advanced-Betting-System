import { createGunzip, gunzip, inflate, brotliDecompress } from "node:zlib";
import { promisify } from "node:util";
import type { Gunzip } from "node:zlib";
import type { SuperbetSseHandlers } from "../model/sse.interfaces.js";
import type { TransportResponse } from "../../../network/model/transport.interfaces.js";

/**
 * @file Decodes compressed SSE and bounded HTTP JSON in the processing worker.
 */

export class SseParser {
  private readonly decoder = new TextDecoder("utf-8", { fatal: true });
  private line = "";
  private data: string[] = [];
  private bytes = 0;
  private skipLf = false;

  constructor(
    private readonly limit: number,
    private readonly handlers: SuperbetSseHandlers,
  ) {}

  push(chunk: Uint8Array): void {
    const text = this.decoder.decode(chunk, { stream: true });
    let start = 0;
    for (let i = 0; i < text.length; i++) {
      const character = text[i];
      if (this.skipLf) {
        this.skipLf = false;
        if (character === "\n") {
          start = i + 1;
          continue;
        }
      }
      if (character !== "\r" && character !== "\n") continue;
      this.append(text.slice(start, i));
      this.consumeLine();
      this.skipLf = character === "\r";
      start = i + 1;
    }
    this.append(text.slice(start));
  }

  private append(text: string): void {
    this.bytes += Buffer.byteLength(text);
    if (this.bytes > this.limit)
      throw new Error("Superbet SSE event exceeds the decoded byte limit.");
    this.line += text;
  }

  private consumeLine(): void {
    const line = this.line;
    this.line = "";
    if (line === "") {
      const data = this.data.join("\n");
      this.data = [];
      this.bytes = 0;
      if (data) this.handlers.onData(data);
    } else if (line === "data") this.data.push("");
    else if (line.startsWith("data:")) {
      const value = line.slice(5);
      this.data.push(value.startsWith(" ") ? value.slice(1) : value);
      // Count line separators too, including empty data lines.
      if (++this.bytes > this.limit)
        throw new Error("Superbet SSE event exceeds the decoded byte limit.");
    }
  }
}

export class SuperbetSseDecoder {
  private readonly parser: SseParser;
  private readonly gzip: Gunzip | null;
  private failure: Error | null = null;
  private closed = false;

  constructor(
    encoding: string | undefined,
    limit: number,
    handlers: SuperbetSseHandlers,
  ) {
    this.parser = new SseParser(limit, handlers);
    const name = encoding?.trim().toLowerCase();
    if (name && name !== "gzip" && name !== "identity")
      throw new Error(`Unsupported Superbet SSE encoding: ${name}`);
    this.gzip = name === "gzip" ? createGunzip() : null;
    this.gzip?.on("error", (error: Error) => {
      this.failure ??= error;
    });
    this.gzip?.on("data", (chunk: Buffer) => {
      if (this.closed) return;
      try {
        this.parser.push(chunk);
      } catch (error) {
        this.gzip!.destroy(
          error instanceof Error ? error : new Error(String(error)),
        );
      }
    });
  }

  // Await decompression before releasing this raw chunk's network credit.
  async write(chunk: ArrayBuffer): Promise<void> {
    if (this.closed) return;
    if (this.failure) throw this.failure;
    if (this.gzip === null) this.parser.push(new Uint8Array(chunk));
    else
      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error | null): void => {
          this.gzip!.off("close", closed);
          this.gzip!.off("error", done);
          if (error && !this.closed) reject(error);
          else resolve();
        };
        const closed = (): void =>
          done(
            this.failure ??
              (this.closed
                ? null
                : new Error("Superbet gzip closed prematurely.")),
          );
        this.gzip!.once("close", closed);
        this.gzip!.once("error", done);
        this.gzip!.write(new Uint8Array(chunk), done);
      });
    if (this.failure && !this.closed) throw this.failure;
  }

  async end(): Promise<void> {
    if (this.closed) return;
    if (this.failure) throw this.failure;
    if (this.gzip)
      await new Promise<void>((resolve, reject) => {
        const done = (error?: Error): void => {
          this.gzip!.off("error", fail);
          this.gzip!.off("end", ended);
          this.gzip!.off("close", closed);
          if (error && !this.closed) reject(error);
          else resolve();
        };
        const fail = (error: Error): void => done(error);
        const ended = (): void => done();
        const closed = (): void =>
          done(
            this.failure ??
              (this.closed
                ? undefined
                : new Error("Superbet gzip closed prematurely.")),
          );
        this.gzip!.once("end", ended);
        this.gzip!.once("close", closed);
        this.gzip!.once("error", fail);
        this.gzip!.end();
      });
    this.close();
  }

  close(): void {
    this.closed = true;
    this.gzip?.destroy();
  }
}

export async function decodeJson(
  response: TransportResponse,
  limit: number,
): Promise<unknown> {
  if (response.body.byteLength > limit)
    throw new Error("Superbet HTTP body exceeds the byte limit.");
  let body: Uint8Array = new Uint8Array(response.body);
  const encoding = response.headers["content-encoding"];
  const options = { maxOutputLength: limit };
  if (encoding === "gzip") body = await promisify(gunzip)(body, options);
  else if (encoding === "deflate")
    body = await promisify(inflate)(body, options);
  else if (encoding === "br")
    body = await promisify(brotliDecompress)(body, options);
  else if (encoding && encoding !== "identity")
    throw new Error(`Unsupported HTTP encoding: ${String(encoding)}`);
  return JSON.parse(new TextDecoder("utf-8", { fatal: true }).decode(body));
}

import { createWriteStream } from "node:fs";
import type { WriteStream } from "node:fs";

/**
 * @file Appends reports as JSON lines without ever blocking detection on disk speed.
 */

export class JsonlRecorder {
  private stream: WriteStream | null = null;
  private readonly queue: string[] = [];
  private waiting = false;
  private dropped = 0;
  private written = 0;
  private failed = false;

  constructor(
    path: string | null,
    private readonly limit: number,
    private readonly onError: (error: string) => void,
  ) {
    if (path === null) return;
    this.stream = createWriteStream(path, { flags: "a" });
    this.stream.on("error", (error) => {
      if (this.failed) return;
      this.failed = true;
      this.onError(`Recorder failed: ${error.message}`);
    });
    this.stream.on("drain", () => {
      this.waiting = false;
      this.drain();
    });
  }

  getStats(): { written: number; queued: number; dropped: number } {
    return { written: this.written, queued: this.queue.length, dropped: this.dropped };
  }

  // While the stream asks to wait, keep a bounded queue and drop the oldest records beyond it.
  write(record: unknown): void {
    if (this.stream === null || this.failed) return;
    this.queue.push(JSON.stringify(record) + "\n");
    if (this.queue.length > this.limit) {
      this.queue.shift();
      this.dropped++;
    }
    if (!this.waiting) this.drain();
  }

  close(): Promise<void> {
    const stream = this.stream;
    this.stream = null;
    if (stream === null) return Promise.resolve();
    if (!this.failed) stream.write(this.queue.splice(0).join(""));
    return new Promise((resolve) => stream.end(() => resolve()));
  }

  private drain(): void {
    while (this.queue.length && !this.waiting && this.stream !== null) {
      const line = this.queue.shift()!;
      this.written++;
      if (!this.stream.write(line)) this.waiting = true;
    }
  }
}

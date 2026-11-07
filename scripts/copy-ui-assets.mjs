import { copyFile, mkdir } from "node:fs/promises";

// Keep the compiled dashboard self-contained without a browser build tool.
const target = new URL("../dist/ui/browser/", import.meta.url);
await mkdir(target, { recursive: true });
await Promise.all(
  ["index.html", "style.css"].map((name) =>
    copyFile(
      new URL(`../src/ui/browser/${name}`, import.meta.url),
      new URL(name, target),
    ),
  ),
);

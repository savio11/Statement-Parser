// Polyfill DOMMatrix for pdfjs-dist 4.x in Node.js (no DOM available)
if (typeof (globalThis as any).DOMMatrix === "undefined") {
  (globalThis as any).DOMMatrix = class DOMMatrix {
    a = 1; b = 0; c = 0; d = 1; e = 0; f = 0;
    m11 = 1; m12 = 0; m13 = 0; m14 = 0;
    m21 = 0; m22 = 1; m23 = 0; m24 = 0;
    m31 = 0; m32 = 0; m33 = 1; m34 = 0;
    m41 = 0; m42 = 0; m43 = 0; m44 = 1;
    is2D = true; isIdentity = true;
    translate() { return new (globalThis as any).DOMMatrix(); }
    scale() { return new (globalThis as any).DOMMatrix(); }
    rotate() { return new (globalThis as any).DOMMatrix(); }
    multiply() { return new (globalThis as any).DOMMatrix(); }
    inverse() { return new (globalThis as any).DOMMatrix(); }
    transformPoint(p: any) { return p ?? { x: 0, y: 0 }; }
    static fromFloat64Array() { return new (globalThis as any).DOMMatrix(); }
    static fromFloat32Array() { return new (globalThis as any).DOMMatrix(); }
    static fromMatrix() { return new (globalThis as any).DOMMatrix(); }
  };
}

import app from "./app";
import { logger } from "./lib/logger";

const rawPort = process.env["PORT"];

if (!rawPort) {
  throw new Error(
    "PORT environment variable is required but was not provided.",
  );
}

const port = Number(rawPort);

if (Number.isNaN(port) || port <= 0) {
  throw new Error(`Invalid PORT value: "${rawPort}"`);
}

app.listen(port, (err) => {
  if (err) {
    logger.error({ err }, "Error listening on port");
    process.exit(1);
  }

  logger.info({ port }, "Server listening");
});

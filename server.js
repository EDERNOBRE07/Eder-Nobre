// server.js
// This file serves as the main entry point for platforms like Hostinger (Passenger)
// which expect a standard "server.js" or "app.js" in the project root.
// Since package.json has "type": "module", this file is executed as an ES Module.

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const prodServerPath = path.join(__dirname, "dist", "server.cjs");

console.log("[Hostinger Boot] Starting server.js launcher...");

if (fs.existsSync(prodServerPath)) {
  console.log(`[Hostinger Boot] Found compiled bundle at ${prodServerPath}. Loading...`);
  // Import the CommonJS bundle dynamically
  import("./dist/server.cjs");
} else {
  console.warn("[Hostinger Boot] Production bundle dist/server.cjs not found!");
  console.log("[Hostinger Boot] Falling back to server.ts directly via tsx...");
  
  // Try to load tsx to execute server.ts directly (mainly for dev or fallback purposes)
  try {
    import("tsx/preprocessor").then(() => {
      import("./server.ts");
    });
  } catch (err) {
    console.error("[Hostinger Boot] Critical Error: Production bundle is missing and tsx loader fallback failed.", err);
    process.exit(1);
  }
}

// server.js
// This file serves as the main entry point for platforms like Hostinger (Passenger)
// which expect a standard "server.js" or "app.js" in the project root.
// Since package.json has "type": "module", this file is executed as an ES Module.

import path from "path";
import fs from "fs";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const logPath = path.join(__dirname, "passenger_error.log");

// Helper function to append logs to a file so we can debug Hostinger 503 errors
function logToFile(message) {
  const timestamp = new Date().toISOString();
  const formattedMessage = `[${timestamp}] ${message}\n`;
  try {
    fs.appendFileSync(logPath, formattedMessage, "utf-8");
  } catch (err) {
    // Fallback to console if file write fails
    console.warn("Failed to write to passenger_error.log", err);
  }
}

// Redirect uncaught exceptions and unhandled rejections to the log file
process.on("uncaughtException", (err) => {
  logToFile(`CRITICAL UNCAUGHT EXCEPTION: ${err?.stack || err}`);
  process.exit(1);
});

process.on("unhandledRejection", (reason, promise) => {
  logToFile(`CRITICAL UNHANDLED REJECTION: ${reason?.stack || reason}`);
});

logToFile("[Hostinger Boot] Starting server.js launcher...");
logToFile(`[Hostinger Boot] Current Working Directory: ${process.cwd()}`);
logToFile(`[Hostinger Boot] Node Version: ${process.version}`);
logToFile(`[Hostinger Boot] PORT Env: ${process.env.PORT}`);

const prodServerPath = path.join(__dirname, "dist", "server.cjs");

if (fs.existsSync(prodServerPath)) {
  logToFile(`[Hostinger Boot] Found compiled bundle at ${prodServerPath}. Loading...`);
  // Import the CommonJS bundle dynamically
  import("./dist/server.cjs").catch((err) => {
    logToFile(`[Hostinger Boot] Failed to dynamically import bundle: ${err?.stack || err}`);
  });
} else {
  logToFile("[Hostinger Boot] Production bundle dist/server.cjs not found!");
  logToFile("[Hostinger Boot] Falling back to server.ts directly via tsx...");
  
  // Try to load tsx to execute server.ts directly (mainly for dev or fallback purposes)
  try {
    import("tsx/preprocessor").then(() => {
      import("./server.ts").catch((err) => {
        logToFile(`[Hostinger Boot] Failed to import server.ts with tsx: ${err?.stack || err}`);
      });
    }).catch((err) => {
      logToFile(`[Hostinger Boot] Failed to load tsx preprocessor: ${err?.stack || err}`);
    });
  } catch (err) {
    logToFile(`[Hostinger Boot] Critical Error: Production bundle is missing and tsx loader fallback failed: ${err?.stack || err}`);
    process.exit(1);
  }
}


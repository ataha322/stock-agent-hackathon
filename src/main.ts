// Initialize logger first to capture all console output
import "./utils/logger";
import { logger } from "./utils/logger";
import { App } from "./app";

// Log application startup
logger.info("Starting Stock Watchlist Monitor application");

try {
    new App();
} catch (error) {
    logger.error("Failed to start application:", error);
    process.exit(1);
}

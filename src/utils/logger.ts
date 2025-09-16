import winston from "winston";
import path from "path";
import fs from "fs";

// Create logs directory if it doesn't exist
const logsDir = path.join(process.cwd(), "logs");
if (!fs.existsSync(logsDir)) {
    fs.mkdirSync(logsDir, { recursive: true });
}

// Create logger instance
export const logger = winston.createLogger({
    level: "info",
    format: winston.format.combine(
        winston.format.timestamp({
            format: "YYYY-MM-DD HH:mm:ss",
        }),
        winston.format.errors({ stack: true }),
        winston.format.printf(({ timestamp, level, message, stack }) => {
            return `${timestamp} [${level.toUpperCase()}]: ${stack || message}`;
        })
    ),
    transports: [
        // Write all logs to app.log
        new winston.transports.File({
            filename: path.join(logsDir, "app.log"),
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
        // Write errors to error.log
        new winston.transports.File({
            filename: path.join(logsDir, "error.log"),
            level: "error",
            maxsize: 5242880, // 5MB
            maxFiles: 5,
        }),
    ],
});

// Override console methods to redirect to logger
const originalConsoleError = console.error;
const originalConsoleWarn = console.warn;
const originalConsoleLog = console.log;

console.error = (...args: any[]) => {
    logger.error(args.join(" "));
};

console.warn = (...args: any[]) => {
    logger.warn(args.join(" "));
};

// Only redirect console.log in production, keep it for development
if (process.env.NODE_ENV === "production") {
    console.log = (...args: any[]) => {
        logger.info(args.join(" "));
    };
}

// Export original methods in case we need them
export const originalConsole = {
    error: originalConsoleError,
    warn: originalConsoleWarn,
    log: originalConsoleLog,
};
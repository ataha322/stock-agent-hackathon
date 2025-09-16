import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

export interface WatchlistItem {
    id?: number;
    ticker: string;
    addedAt: string;
}

export class WatchlistDatabase {
    private db: Database;

    constructor(dbPath?: string) {
        const defaultPath = path.join(process.cwd(), "data", "watchlist.db");
        
        // Create data directory if it doesn't exist
        const dataDir = path.dirname(dbPath || defaultPath);
        if (!fs.existsSync(dataDir)) {
            fs.mkdirSync(dataDir, { recursive: true });
        }
        
        this.db = new Database(dbPath || defaultPath);
        this.init();
    }

    private init() {
        // Create watchlist table
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS watchlist (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT UNIQUE NOT NULL,
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `);

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_ticker ON watchlist(ticker);
            CREATE INDEX IF NOT EXISTS idx_added_at ON watchlist(added_at);
        `);
    }

    addStock(ticker: string): boolean {
        try {
            const stmt = this.db.prepare("INSERT INTO watchlist (ticker) VALUES (?)");
            stmt.run(ticker.toUpperCase());
            return true;
        } catch (error) {
            // Stock already exists (UNIQUE constraint)
            return false;
        }
    }

    removeStock(ticker: string): boolean {
        const stmt = this.db.prepare("DELETE FROM watchlist WHERE ticker = ?");
        const result = stmt.run(ticker.toUpperCase());
        return result.changes > 0;
    }

    getAllStocks(): WatchlistItem[] {
        const stmt = this.db.prepare(`
            SELECT id, ticker, added_at as addedAt 
            FROM watchlist 
            ORDER BY added_at DESC
        `);
        return stmt.all() as WatchlistItem[];
    }

    hasStock(ticker: string): boolean {
        const stmt = this.db.prepare("SELECT 1 FROM watchlist WHERE ticker = ?");
        return !!stmt.get(ticker.toUpperCase());
    }

    getStockCount(): number {
        const stmt = this.db.prepare("SELECT COUNT(*) as count FROM watchlist");
        const result = stmt.get() as { count: number };
        return result.count;
    }

    close() {
        this.db.close();
    }
}
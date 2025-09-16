import { Database } from "bun:sqlite";
import path from "path";
import fs from "fs";

export interface WatchlistItem {
    id?: number;
    ticker: string;
    addedAt: string;
    price?: number;
    change?: number;
    changePercent?: number;
    lastUpdated?: string;
}

export interface CacheItem {
    id?: number;
    ticker: string;
    cacheType: string;
    data: string;
    cachedAt: string;
    expiresAt: string;
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
                added_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                price REAL,
                change_amount REAL,
                change_percent REAL,
                last_updated DATETIME
            )
        `);

        // Create cache table for Alpha Vantage API responses
        this.db.exec(`
            CREATE TABLE IF NOT EXISTS alpha_vantage_cache (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                ticker TEXT NOT NULL,
                cache_type TEXT NOT NULL,
                data TEXT NOT NULL,
                cached_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                expires_at DATETIME NOT NULL,
                UNIQUE(ticker, cache_type)
            )
        `);

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_ticker ON watchlist(ticker);
            CREATE INDEX IF NOT EXISTS idx_added_at ON watchlist(added_at);
            CREATE INDEX IF NOT EXISTS idx_cache_ticker_type ON alpha_vantage_cache(ticker, cache_type);
            CREATE INDEX IF NOT EXISTS idx_cache_expires ON alpha_vantage_cache(expires_at);
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
            SELECT 
                id, 
                ticker, 
                added_at as addedAt,
                price,
                change_amount as change,
                change_percent as changePercent,
                last_updated as lastUpdated
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

    updateStockPrice(ticker: string, price: number, change: number, changePercent: number): boolean {
        try {
            const stmt = this.db.prepare(`
                UPDATE watchlist 
                SET price = ?, change_amount = ?, change_percent = ?, last_updated = CURRENT_TIMESTAMP 
                WHERE ticker = ?
            `);
            const result = stmt.run(price, change, changePercent, ticker.toUpperCase());
            return result.changes > 0;
        } catch (error) {
            return false;
        }
    }

    // Cache management methods
    setCacheData(ticker: string, cacheType: string, data: any, expiresInHours: number = 24): boolean {
        try {
            const expiresAt = new Date(Date.now() + expiresInHours * 60 * 60 * 1000).toISOString();
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO alpha_vantage_cache 
                (ticker, cache_type, data, expires_at) 
                VALUES (?, ?, ?, ?)
            `);
            stmt.run(ticker.toUpperCase(), cacheType, JSON.stringify(data), expiresAt);
            return true;
        } catch (error) {
            return false;
        }
    }

    getCacheData(ticker: string, cacheType: string): any | null {
        try {
            const stmt = this.db.prepare(`
                SELECT data, expires_at 
                FROM alpha_vantage_cache 
                WHERE ticker = ? AND cache_type = ? AND expires_at > CURRENT_TIMESTAMP
            `);
            const result = stmt.get(ticker.toUpperCase(), cacheType) as { data: string; expires_at: string } | undefined;
            
            if (result) {
                return JSON.parse(result.data);
            }
            return null;
        } catch (error) {
            return null;
        }
    }

    isCacheValid(ticker: string, cacheType: string): boolean {
        const stmt = this.db.prepare(`
            SELECT 1 FROM alpha_vantage_cache 
            WHERE ticker = ? AND cache_type = ? AND expires_at > CURRENT_TIMESTAMP
        `);
        return !!stmt.get(ticker.toUpperCase(), cacheType);
    }

    clearExpiredCache(): number {
        const stmt = this.db.prepare(`
            DELETE FROM alpha_vantage_cache 
            WHERE expires_at <= CURRENT_TIMESTAMP
        `);
        const result = stmt.run();
        return result.changes;
    }

    getCacheStats(): { total: number; expired: number } {
        const totalStmt = this.db.prepare("SELECT COUNT(*) as count FROM alpha_vantage_cache");
        const expiredStmt = this.db.prepare("SELECT COUNT(*) as count FROM alpha_vantage_cache WHERE expires_at <= CURRENT_TIMESTAMP");
        
        const total = (totalStmt.get() as { count: number }).count;
        const expired = (expiredStmt.get() as { count: number }).count;
        
        return { total, expired };
    }

    clearSpecificCache(ticker: string, cacheType: string): boolean {
        try {
            const stmt = this.db.prepare(`
                DELETE FROM alpha_vantage_cache 
                WHERE ticker = ? AND cache_type = ?
            `);
            const result = stmt.run(ticker.toUpperCase(), cacheType);
            return result.changes > 0;
        } catch (error) {
            return false;
        }
    }

    close() {
        this.db.close();
    }
}
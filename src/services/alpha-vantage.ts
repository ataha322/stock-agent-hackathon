import { logger } from "../utils/logger";
import { WatchlistDatabase } from "../database/watchlist";

export interface StockQuote {
    symbol: string;
    price: number;
    change: number;
    changePercent: number;
    previousClose: number;
    volume: number;
    lastUpdated: string;
}

export interface GlobalQuoteResponse {
    "Global Quote": {
        "01. symbol": string;
        "02. open": string;
        "03. high": string;
        "04. low": string;
        "05. price": string;
        "06. volume": string;
        "07. latest trading day": string;
        "08. previous close": string;
        "09. change": string;
        "10. change percent": string;
    };
}

export interface SearchResult {
    "1. symbol": string;
    "2. name": string;
    "3. type": string;
    "4. region": string;
    "5. marketOpen": string;
    "6. marketClose": string;
    "7. timezone": string;
    "8. currency": string;
    "9. matchScore": string;
}

export interface SearchResponse {
    bestMatches: SearchResult[];
}

export interface TimeSeriesData {
    [date: string]: {
        "1. open": string;
        "2. high": string;
        "3. low": string;
        "4. close": string;
        "5. volume": string;
    };
}

export interface TimeSeriesResponse {
    "Meta Data": {
        "1. Information": string;
        "2. Symbol": string;
        "3. Last Refreshed": string;
        "4. Output Size": string;
        "5. Time Zone": string;
    };
    [key: string]: TimeSeriesData | any;
}

export interface ChartDataPoint {
    date: string;
    price: number;
}

export type TimeRange = "1m" | "3m" | "1y" | "5y";

export class AlphaVantageService {
    private readonly baseUrl = "https://www.alphavantage.co/query";
    private readonly apiKey: string;
    private cache = new Map<string, { data: StockQuote; timestamp: number }>();
    private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes (for in-memory cache)
    private database: WatchlistDatabase | null = null;

    constructor(apiKey?: string, database?: WatchlistDatabase) {
        this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || "";
        this.database = database || null;
        if (!this.apiKey) {
            throw new Error("Alpha Vantage API key is required. Please set ALPHA_VANTAGE_API_KEY environment variable.");
        }
    }

    setDatabase(database: WatchlistDatabase) {
        this.database = database;
    }

    async getStockQuote(symbol: string): Promise<StockQuote | null> {
        try {
            const upperSymbol = symbol.toUpperCase();
            
            // Check database cache first (24-hour cache)
            if (this.database) {
                const cachedData = this.database.getCacheData(upperSymbol, "quote");
                if (cachedData) {
                    logger.info(`Using cached quote data for ${upperSymbol}`);
                    return cachedData as StockQuote;
                }
            }
            
            // Check in-memory cache (5-minute cache for current session)
            const cached = this.cache.get(upperSymbol);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }

            logger.info(`Making API call for quote: ${upperSymbol}`);
            const url = `${this.baseUrl}?function=GLOBAL_QUOTE&symbol=${upperSymbol}&apikey=${this.apiKey}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as GlobalQuoteResponse;

            // Check for API error responses
            if ("Error Message" in data) {
                throw new Error(`Invalid symbol: ${upperSymbol}`);
            }

            if ("Note" in data) {
                throw new Error("API rate limit exceeded. Please try again later.");
            }

            if ("Information" in data) {
                throw new Error("API rate limit exceeded. Free tier allows 25 requests per day.");
            }

            if (!data["Global Quote"] || !data["Global Quote"]["01. symbol"]) {
                throw new Error(`No data available for symbol: ${upperSymbol}`);
            }

            const quote = data["Global Quote"];
            const stockQuote: StockQuote = {
                symbol: quote["01. symbol"],
                price: parseFloat(quote["05. price"]),
                change: parseFloat(quote["09. change"]),
                changePercent: parseFloat(quote["10. change percent"].replace("%", "")),
                previousClose: parseFloat(quote["08. previous close"]),
                volume: parseInt(quote["06. volume"]),
                lastUpdated: quote["07. latest trading day"],
            };

            // Cache in memory for current session
            this.cache.set(upperSymbol, {
                data: stockQuote,
                timestamp: Date.now(),
            });

            // Cache in database for 24 hours
            if (this.database) {
                this.database.setCacheData(upperSymbol, "quote", stockQuote, 24);
                logger.info(`Cached quote data for ${upperSymbol} for 24 hours`);
            }

            return stockQuote;
        } catch (error) {
            logger.error(`Error fetching quote for ${symbol}:`, error);
            throw error;
        }
    }

    async validateSymbol(symbol: string): Promise<boolean> {
        try {
            const upperSymbol = symbol.toUpperCase();

            // Check database cache first (24-hour cache)
            if (this.database) {
                const cachedData = this.database.getCacheData(upperSymbol, "validation");
                if (cachedData !== null) {
                    logger.info(`Using cached validation data for ${upperSymbol}`);
                    return cachedData as boolean;
                }
            }

            logger.info(`Making API call for validation: ${upperSymbol}`);
            const url = `${this.baseUrl}?function=SYMBOL_SEARCH&keywords=${upperSymbol}&apikey=${this.apiKey}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as SearchResponse;

            if ("Error Message" in data) {
                // Cache negative result for 24 hours
                if (this.database) {
                    this.database.setCacheData(upperSymbol, "validation", false, 24);
                }
                return false;
            }

            if ("Note" in data) {
                throw new Error("API rate limit exceeded. Please try again later.");
            }

            if ("Information" in data) {
                throw new Error("API rate limit exceeded. Free tier allows 25 requests per day.");
            }

            // Check if we have exact match for the symbol
            const exactMatch = data.bestMatches?.find(
                (match) => match["1. symbol"].toUpperCase() === upperSymbol
            );

            const isValid = !!exactMatch;
            
            // Cache validation result for 24 hours
            if (this.database) {
                this.database.setCacheData(upperSymbol, "validation", isValid, 24);
                logger.info(`Cached validation result for ${upperSymbol}: ${isValid}`);
            }

            return isValid;
        } catch (error) {
            logger.error(`Error validating symbol ${symbol}:`, error);
            throw error;
        }
    }



    clearCache(): void {
        this.cache.clear();
    }

    async getHistoricalData(symbol: string, timeRange: TimeRange): Promise<ChartDataPoint[]> {
        try {
            const upperSymbol = symbol.toUpperCase();
            const cacheKey = `historical_${timeRange}`;
            
            // Check database cache first (24-hour cache)
            if (this.database) {
                const cachedData = this.database.getCacheData(upperSymbol, cacheKey);
                if (cachedData) {
                    logger.info(`Using cached historical data for ${upperSymbol} (${timeRange})`);
                    return cachedData as ChartDataPoint[];
                }
            }
            
            // Determine the function and outputsize based on time range
            let func = "TIME_SERIES_DAILY";
            let outputsize = "compact";
            let timeSeriesKey = "Time Series (Daily)";
            
            switch (timeRange) {
                case "1m":
                case "3m":
                    func = "TIME_SERIES_DAILY";
                    outputsize = "compact";
                    timeSeriesKey = "Time Series (Daily)";
                    break;
                case "1y":
                case "5y":
                    func = "TIME_SERIES_DAILY";
                    outputsize = "full";
                    timeSeriesKey = "Time Series (Daily)";
                    break;
            }

            const url = `${this.baseUrl}?function=${func}&symbol=${upperSymbol}&outputsize=${outputsize}&apikey=${this.apiKey}`;

            logger.info(`Making API call for historical data: ${upperSymbol} (${timeRange})`);
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as TimeSeriesResponse;

            // Check for API error responses
            if ("Error Message" in data) {
                throw new Error(`Invalid symbol: ${upperSymbol}`);
            }

            if ("Note" in data) {
                throw new Error("API rate limit exceeded. Please try again later.");
            }

            if ("Information" in data) {
                throw new Error("API rate limit exceeded. Free tier allows 25 requests per day.");
            }

            const timeSeries = data[timeSeriesKey] as TimeSeriesData;
            if (!timeSeries) {
                throw new Error(`No time series data available for ${upperSymbol}`);
            }

            // Convert to chart data points
            const chartData: ChartDataPoint[] = Object.entries(timeSeries)
                .map(([date, values]) => ({
                    date,
                    price: parseFloat(values["4. close"])
                }))
                .sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());

            // Filter by time range
            const filteredData = this.filterByTimeRange(chartData, timeRange);

            // Cache the result for 24 hours
            if (this.database) {
                this.database.setCacheData(upperSymbol, cacheKey, filteredData, 24);
                logger.info(`Cached historical data for ${upperSymbol} (${timeRange}) for 24 hours`);
            }

            return filteredData;

        } catch (error) {
            logger.error(`Error fetching historical data for ${symbol}:`, error);
            throw error;
        }
    }



    private filterByTimeRange(data: ChartDataPoint[], timeRange: TimeRange): ChartDataPoint[] {
        const now = new Date();
        let cutoffDate: Date;

        switch (timeRange) {
            case "1m":
                cutoffDate = new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
                break;
            case "3m":
                cutoffDate = new Date(now.getTime() - 90 * 24 * 60 * 60 * 1000);
                break;
            case "1y":
                cutoffDate = new Date(now.getTime() - 365 * 24 * 60 * 60 * 1000);
                break;
            case "5y":
                cutoffDate = new Date(now.getTime() - 5 * 365 * 24 * 60 * 60 * 1000);
                break;
        }

        return data.filter(point => new Date(point.date) >= cutoffDate);
    }

    getCacheSize(): number {
        return this.cache.size;
    }

    // Clean up expired cache entries
    cleanupExpiredCache(): number {
        if (this.database) {
            const deletedCount = this.database.clearExpiredCache();
            logger.info(`Cleaned up ${deletedCount} expired cache entries`);
            return deletedCount;
        }
        return 0;
    }

    // Get cache statistics
    getCacheStats(): { memory: number; database?: { total: number; expired: number } } {
        const stats: { memory: number; database?: { total: number; expired: number } } = {
            memory: this.cache.size
        };
        
        if (this.database) {
            stats.database = this.database.getCacheStats();
        }
        
        return stats;
    }
}
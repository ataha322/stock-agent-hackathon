import { logger } from "../utils/logger";

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

export class AlphaVantageService {
    private readonly baseUrl = "https://www.alphavantage.co/query";
    private readonly apiKey: string;
    private cache = new Map<string, { data: StockQuote; timestamp: number }>();
    private readonly cacheTimeout = 5 * 60 * 1000; // 5 minutes

    constructor(apiKey?: string) {
        this.apiKey = apiKey || process.env.ALPHA_VANTAGE_API_KEY || "";
        if (!this.apiKey) {
            throw new Error("Alpha Vantage API key is required. Please set ALPHA_VANTAGE_API_KEY environment variable.");
        }
    }

    async getStockQuote(symbol: string): Promise<StockQuote | null> {
        try {
            const upperSymbol = symbol.toUpperCase();
            
            // Check cache first
            const cached = this.cache.get(upperSymbol);
            if (cached && Date.now() - cached.timestamp < this.cacheTimeout) {
                return cached.data;
            }

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

            // Cache the result
            this.cache.set(upperSymbol, {
                data: stockQuote,
                timestamp: Date.now(),
            });

            return stockQuote;
        } catch (error) {
            logger.error(`Error fetching quote for ${symbol}:`, error);
            throw error;
        }
    }

    async validateSymbol(symbol: string): Promise<boolean> {
        try {
            const upperSymbol = symbol.toUpperCase();

            const url = `${this.baseUrl}?function=SYMBOL_SEARCH&keywords=${upperSymbol}&apikey=${this.apiKey}`;
            const response = await fetch(url);
            
            if (!response.ok) {
                throw new Error(`HTTP error! status: ${response.status}`);
            }

            const data = await response.json() as SearchResponse;

            if ("Error Message" in data) {
                return false;
            }

            if ("Note" in data) {
                throw new Error("API rate limit exceeded. Please try again later.");
            }

            // Check if we have exact match for the symbol
            const exactMatch = data.bestMatches?.find(
                (match) => match["1. symbol"].toUpperCase() === upperSymbol
            );

            return !!exactMatch;
        } catch (error) {
            logger.error(`Error validating symbol ${symbol}:`, error);
            throw error;
        }
    }



    clearCache(): void {
        this.cache.clear();
    }

    getCacheSize(): number {
        return this.cache.size;
    }
}
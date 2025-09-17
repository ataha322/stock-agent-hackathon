import { logger } from "../utils/logger";
import { WatchlistDatabase } from "../database/watchlist";
import { sendPaidSignal, NEWS_SIGNAL, FINANCIAL_EVENT_SIGNAL } from "./paid";

export interface FinancialEvent {
    date: string; // YYYY-MM-DD format
    description: string;
    impact: 'positive' | 'negative' | 'neutral';
}

export interface StockAnalysis {
    ticker: string;
    recentNews: string[];
    majorEvents: string[];
    valuationAssessment: string[];
    events: FinancialEvent[];
    lastUpdated: string;
}

export interface PerplexityResponse {
    id: string;
    model: string;
    object: string;
    created: number;
    choices: Array<{
        index: number;
        finish_reason: string;
        message: {
            role: string;
            content: string;
        };
        delta: {
            role: string;
            content: string;
        };
    }>;
    usage: {
        prompt_tokens: number;
        completion_tokens: number;
        total_tokens: number;
        search_context_size: string;
        cost: {
            input_tokens_cost: number;
            output_tokens_cost: number;
            request_cost: number;
            total_cost: number;
        }
    };
}

export class PerplexityService {
    private readonly baseUrl = "https://api.perplexity.ai/chat/completions";
    private readonly apiKey: string;
    private database: WatchlistDatabase | null = null;

    constructor(apiKey?: string, database?: WatchlistDatabase) {
        this.apiKey = apiKey || process.env.PERPLEXITY_API_KEY || "";
        this.database = database || null;
        if (!this.apiKey) {
            throw new Error("Perplexity API key is required. Please set PERPLEXITY_API_KEY environment variable.");
        }
    }

    setDatabase(database: WatchlistDatabase) {
        this.database = database;
    }

    async getStockAnalysis(ticker: string): Promise<StockAnalysis | null> {
        try {
            const upperTicker = ticker.toUpperCase();
            
            // Check database cache first (24-hour cache)
            if (this.database) {
                const cachedData = this.database.getCacheData(upperTicker, "analysis");
                if (cachedData) {
                    logger.info(`Using cached analysis data for ${upperTicker}`);
                    return cachedData as StockAnalysis;
                }
            }

            logger.info(`Making Perplexity API call for analysis: ${upperTicker}`);
            logger.info(`API Key configured: ${this.apiKey ? 'Yes' : 'No'}`);
            
            const query = `Analyze ${upperTicker} stock with exactly these sections:
1. Most recent news (past 7 days) - factual news, no stock analysis yet.
2. Major events in past 12 months related to the stock or the company.
3. Current valuation assessment - undervalued/fairly valued/overvalued with brief reasoning`;

            const response = await fetch(this.baseUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "sonar-pro",
                    messages: [
                        {
                            role: "user",
                            content: query
                        }
                    ],
                    max_tokens: 3000,
                    temperature: 0.2,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`Perplexity API error details: Status ${response.status}, Response: ${errorText}`);
                throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
            }

            const data = await response.json() as PerplexityResponse;

            if (!data.choices || data.choices.length === 0) {
                throw new Error("No response from Perplexity API");
            }

            const content = data.choices[0]?.message?.content;
            if (!content) {
                throw new Error("Empty response from Perplexity API");
            }
            const analysis = this.parseAnalysis(upperTicker, content);
            
            // Also fetch financial events
            const events = await this.getFinancialEvents(upperTicker);
            analysis.events = events;

            // Cache the result for 24 hours
            if (this.database) {
                this.database.setCacheData(upperTicker, "analysis", analysis, 24);
                logger.info(`Cached analysis data for ${upperTicker} for 24 hours`);
            }

            logger.info(`Sending usage cost for news analysis to Paid: ${data.usage.cost.total_cost}`);
            sendPaidSignal(NEWS_SIGNAL, {
                costData: {
                    vendor: "perplexity", // can be anything
                    cost: {
                        amount: data.usage.cost.total_cost,
                        currency: "USD",
                    },
                },
            });

            return analysis;

        } catch (error) {
            logger.error(`Error fetching analysis for ${ticker}:`, error);
            throw error;
        }
    }

    async getFinancialEvents(ticker: string): Promise<FinancialEvent[]> {
        try {
            const upperTicker = ticker.toUpperCase();
            
            // Check database cache first (24-hour cache)
            if (this.database) {
                const cachedData = this.database.getCacheData(upperTicker, "events");
                if (cachedData) {
                    logger.info(`Using cached events data for ${upperTicker}`);
                    return cachedData as FinancialEvent[];
                }
            }

            logger.info(`Making Perplexity API call for events: ${upperTicker}`);
            
            const eventsQuery = `Find specific financial events for ${upperTicker} stock in the past 12 months with EXACT dates:
- Earnings releases and surprises
- Major news announcements 
- Analyst upgrades/downgrades
- Leadership changes
- Product launches or recalls
- Regulatory issues

For each event, provide:
1. Exact date (YYYY-MM-DD format)
2. Brief description (max 10 words)
3. Impact type (positive/negative/neutral)

Format as: DATE | DESCRIPTION | IMPACT`;

            const response = await fetch(this.baseUrl, {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.apiKey}`,
                    "Content-Type": "application/json",
                },
                body: JSON.stringify({
                    model: "sonar-pro",
                    messages: [
                        {
                            role: "user",
                            content: eventsQuery
                        }
                    ],
                    max_tokens: 2000,
                    temperature: 0.1,
                    stream: false
                })
            });

            if (!response.ok) {
                const errorText = await response.text();
                logger.error(`Perplexity API error for events: Status ${response.status}, Response: ${errorText}`);
                throw new Error(`Perplexity API error (${response.status}): ${errorText}`);
            }

            const data = await response.json() as PerplexityResponse;

            if (!data.choices || data.choices.length === 0) {
                throw new Error("No events response from Perplexity API");
            }

            const content = data.choices[0]?.message?.content;
            if (!content) {
                throw new Error("Empty events response from Perplexity API");
            }

            const events = this.parseFinancialEvents(content);

            // Cache the result for 24 hours
            if (this.database) {
                this.database.setCacheData(upperTicker, "events", events, 24);
                logger.info(`Cached events data for ${upperTicker} for 24 hours`);
            }

            logger.info(`Sending usage cost for financial events to Paid: ${data.usage.cost.total_cost}`);
            sendPaidSignal(FINANCIAL_EVENT_SIGNAL, {
                costData: {
                    vendor: "perplexity", // can be anything
                    cost: {
                        amount: data.usage.cost.total_cost,
                        currency: "USD",
                    },
                },
            });

            return events;

        } catch (error) {
            logger.error(`Error fetching events for ${ticker}:`, error);
            return []; // Return empty array on error
        }
    }

    private parseFinancialEvents(content: string): FinancialEvent[] {
        const events: FinancialEvent[] = [];
        
        try {
            const lines = content.split('\n').filter(line => line.trim());
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                
                // Look for lines that match the format: DATE | DESCRIPTION | IMPACT
                const match = trimmedLine.match(/(\d{4}-\d{2}-\d{2})\s*\|\s*([^|]+)\s*\|\s*(positive|negative|neutral)/i);
                
                if (match && match[1] && match[2] && match[3]) {
                    const [, date, description, impact] = match;
                    events.push({
                        date: date.trim(),
                        description: description.trim().substring(0, 50), // Limit description length
                        impact: impact.trim().toLowerCase() as 'positive' | 'negative' | 'neutral'
                    });
                }
            }
            
            // Sort events by date (oldest first)
            events.sort((a, b) => new Date(a.date).getTime() - new Date(b.date).getTime());
            
        } catch (error) {
            logger.warn(`Error parsing financial events: ${error}`);
        }
        
        return events.slice(0, 10); // Limit to 10 most recent events
    }

    private parseAnalysis(ticker: string, content: string): StockAnalysis {
        
        // Initialize with empty arrays
        let recentNews: string[] = [];
        let majorEvents: string[] = [];
        let valuationAssessment: string[] = [];

        try {
            // Extract sections based on content patterns
            const lines = content.split('\n').filter(line => line.trim());
            
            let currentSection = '';
            let sectionContent: string[] = [];
            
            for (const line of lines) {
                const trimmedLine = line.trim();
                
                if (trimmedLine.toLowerCase().includes('recent news') || 
                    trimmedLine.toLowerCase().includes('1.')) {
                    if (currentSection && sectionContent.length > 0) {
                        this.assignToSection(currentSection, sectionContent, recentNews, majorEvents, valuationAssessment);
                    }
                    currentSection = 'recent';
                    sectionContent = [];
                } else if (trimmedLine.toLowerCase().includes('major events') || 
                          trimmedLine.toLowerCase().includes('2.')) {
                    if (currentSection && sectionContent.length > 0) {
                        this.assignToSection(currentSection, sectionContent, recentNews, majorEvents, valuationAssessment);
                    }
                    currentSection = 'events';
                    sectionContent = [];
                } else if (trimmedLine.toLowerCase().includes('valuation') || 
                          trimmedLine.toLowerCase().includes('3.')) {
                    if (currentSection && sectionContent.length > 0) {
                        this.assignToSection(currentSection, sectionContent, recentNews, majorEvents, valuationAssessment);
                    }
                    currentSection = 'valuation';
                    sectionContent = [];
                } else if (trimmedLine.startsWith('•') || trimmedLine.startsWith('-') || trimmedLine.startsWith('*')) {
                    // This is a bullet point
                    sectionContent.push(trimmedLine.replace(/^[•\-*]\s*/, ''));
                } else if (trimmedLine.length > 10 && currentSection) {
                    // This might be content without bullet points
                    sectionContent.push(trimmedLine);
                }
            }
            
            // Don't forget the last section
            if (currentSection && sectionContent.length > 0) {
                this.assignToSection(currentSection, sectionContent, recentNews, majorEvents, valuationAssessment);
            }
            
        } catch (error) {
            logger.warn(`Error parsing analysis content for ${ticker}, using fallback`);
            // Fallback: split content into 3 roughly equal parts
            const allLines = content.split('\n').filter(line => line.trim());
            const third = Math.ceil(allLines.length / 3);
            recentNews = allLines.slice(0, third).map(line => line.trim()).filter(line => line);
            majorEvents = allLines.slice(third, third * 2).map(line => line.trim()).filter(line => line);
            valuationAssessment = allLines.slice(third * 2).map(line => line.trim()).filter(line => line);
        }

        // Ensure we have at least something in each section
        if (recentNews.length === 0) recentNews = ["No recent news available"];
        if (majorEvents.length === 0) majorEvents = ["No major events identified"];
        if (valuationAssessment.length === 0) valuationAssessment = ["Valuation assessment unavailable"];

        return {
            ticker,
            recentNews,
            majorEvents,
            valuationAssessment,
            events: [], // Will be populated by getStockAnalysis
            lastUpdated: new Date().toISOString()
        };
    }

    private assignToSection(
        section: string, 
        content: string[], 
        recentNews: string[], 
        majorEvents: string[], 
        valuationAssessment: string[]
    ) {
        const cleanContent = content.filter(item => item.trim().length > 0);
        
        switch (section) {
            case 'recent':
                recentNews.push(...cleanContent);
                break;
            case 'events':
                majorEvents.push(...cleanContent);
                break;
            case 'valuation':
                valuationAssessment.push(...cleanContent);
                break;
        }
    }

    // Clean up expired cache entries
    cleanupExpiredCache(): number {
        if (this.database) {
            const deletedCount = this.database.clearExpiredCache();
            logger.info(`Cleaned up ${deletedCount} expired analysis cache entries`);
            return deletedCount;
        }
        return 0;
    }
}

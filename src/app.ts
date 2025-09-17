import blessed from "blessed";
import contrib from "blessed-contrib";
import { WatchlistDatabase, type WatchlistItem } from "./database/watchlist";
import { AlphaVantageService, type TimeRange } from "./services/alpha-vantage";
import { PerplexityService, type StockAnalysis, type FinancialEvent } from "./services/perplexity";
import { logger } from "./utils/logger";

export class App {
    private screen: blessed.Widgets.Screen;
    private stockScreenContainer!: blessed.Widgets.BoxElement;
    private watchlistWidget!: blessed.Widgets.ListElement;
    private controlsList!: blessed.Widgets.ListElement;
    private chartContainer!: blessed.Widgets.BoxElement;
    private chart!: any; // blessed-contrib line chart
    private timeRangeSelector!: blessed.Widgets.BoxElement;
    private newsContainer!: blessed.Widgets.BoxElement;
    private recentNewsWidget!: blessed.Widgets.BoxElement;
    private majorEventsWidget!: blessed.Widgets.BoxElement;
    private valuationWidget!: blessed.Widgets.BoxElement;
    private eventsWidget!: blessed.Widgets.BoxElement;
    private currentTimeRange: TimeRange = "1y";
    private selectedStock: string | null = null;
    private currentView: "chart" | "news" = "chart";
    private currentFocus: "stock" | "recent" | "major" | "valuation" | "events" = "stock";
    private ongoingNewsCalls: Set<string> = new Set();
    private ongoingEventsCalls: Set<string> = new Set();

    private database!: WatchlistDatabase;
    private alphaVantage!: AlphaVantageService;
    private perplexity!: PerplexityService;
    private activePopup: blessed.Widgets.BlessedElement | null = null;

    constructor() {
        this.database = new WatchlistDatabase();
        this.alphaVantage = new AlphaVantageService();
        this.alphaVantage.setDatabase(this.database); // Connect database to API service
        this.perplexity = new PerplexityService();
        this.perplexity.setDatabase(this.database); // Connect database to Perplexity service
        this.screen = blessed.screen({
            smartCSR: true,
            title: "Stock Watchlist Monitor",
            autoPadding: true,
        });

        this.setupScreens();
        this.setupKeyBindings();
        this.loadWatchlist().catch((error) => logger.error("Failed to load watchlist:", error));
        
        // Clean up expired cache on startup
        this.alphaVantage.cleanupExpiredCache();
        this.perplexity.cleanupExpiredCache();
        
        this.screen.render();
    }

    private setupScreens() {
        // Main container for layout
        const mainContainer = blessed.box({
            top: "center",
            left: "center", 
            width: "95%",
            height: "95%",
        });

        // Left panel - Stock watchlist
        this.stockScreenContainer = blessed.box({
            parent: mainContainer,
            label: " {red-fg}[S]{/red-fg}tock Watchlist ",
            top: 0,
            left: 0,
            width: "22%",
            height: "100%",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "green",
                },
                focus: {
                    border: {
                        fg: "lightyellow",
                    },
                },
            },
            focusable: true,
            tags: true,
        });

        // Watchlist widget (inside the left container)
        this.watchlistWidget = blessed.list({
            parent: this.stockScreenContainer,
            top: 1,
            left: 1,
            width: "90%",
            height: "60%",
            items: ["Loading..."],
            keys: true,
            vi: true,
            mouse: true,
            tags: true,
            style: {
                selected: {
                    bg: "lightcyan",
                    fg: "white",
                },
            },
            scrollbar: {
                ch: " ",
                style: {
                    bg: "lightcyan",
                },
            },
        });

        // Controls list for instructions (left panel)
        const controlItems = [
            "a: Add Stock",
            "d: Delete Stock", 
            "r: Refresh",
            "j/k: Navigate/Scroll",
            "s: Focus Stock List",
            "n: Focus Recent News",
            "m: Focus Major Events", 
            "v: Focus Valuation",
            "f: Focus Financial Events",
            "Tab: Chart/News",
            "1-4: Time Range",
            "q: Quit"
        ];
        
        this.controlsList = blessed.list({
            parent: this.stockScreenContainer,
            label: " Controls ",
            bottom: 0,
            left: 1,
            width: "90%",
            height: controlItems.length + 2, // +2 for top/bottom borders
            border: {
                type: "line",
            },
            style: {
                fg: "cyan",
                border: {
                    fg: "cyan",
                },
                item: {
                    fg: "white",
                },
            },
            items: controlItems,
            interactive: false,
            mouse: false,
        });

        // Right panel - Chart container
        this.chartContainer = blessed.box({
            parent: mainContainer,
            top: 0,
            left: "22%",
            width: "78%",
            height: "100%",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "green",
                },
            },
        });

        // View selector (chart/news) 
        this.timeRangeSelector = blessed.box({
            parent: this.chartContainer,
            top: 1,
            left: 1,
            width: "100%-6",
            height: 1,
            content: "Tab: Switch to News | 1=1m 2=3m 3=1y 4=5y",
            tags: false,
            style: {
                fg: "cyan",
            },
        });

        // Create the line chart (reduced height to make room for events)
        this.chart = contrib.line({
            parent: this.chartContainer,
            top: 4,
            left: 1,
            width: "100%-3",
            height: "70%",
            style: {
                line: "cyan",
                text: "white",
                baseline: "cyan"
            },
            xLabelPadding: 3,
            xPadding: 5,
            showLegend: false,
            wholeNumbersOnly: false,
        });

        // Events widget (below chart)
        this.eventsWidget = blessed.box({
            parent: this.chartContainer,
            label: " {red-fg}[F]{/red-fg}inancial Events ",
            top: "75%",
            left: 1,
            width: "100%-3",
            height: "25%-1",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "green",
                },
                focus: {
                    border: {
                        fg: "lightyellow",
                    },
                },
            },
            content: "Select a stock to view events",
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: " ",
                style: {
                    bg: "lightcyan",
                },
            },
        });

        // News analysis container (initially hidden)
        this.newsContainer = blessed.box({
            parent: this.chartContainer,
            top: 3,
            left: 1,
            width: "100%-5",
            height: "100%-5",
            hidden: true,
        });

        // Recent News section
        this.recentNewsWidget = blessed.box({
            parent: this.newsContainer,
            label: " Recent {red-fg}[N]{/red-fg}ews (7 days) ",
            top: 0,
            left: 0,
            width: "100%",
            height: "33%",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "green",
                },
                focus: {
                    border: {
                        fg: "lightyellow",
                    },
                },
            },
            content: "Loading recent news...",
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: " ",
                style: {
                    bg: "lightcyan",
                },
            },
            focusable: true,
            keys: true,
            vi: true,
            mouse: true,
        });

        // Major Events section
        this.majorEventsWidget = blessed.box({
            parent: this.newsContainer,
            label: " {red-fg}[M]{/red-fg}ajor Events (12 months) ",
            top: "33%",
            left: 0,
            width: "100%",
            height: "33%",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "green",
                },
                focus: {
                    border: {
                        fg: "lightyellow",
                    },
                },
            },
            content: "Loading major events...",
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: " ",
                style: {
                    bg: "lightcyan",
                },
            },
            focusable: true,
            keys: true,
            vi: true,
            mouse: true,
        });

        // Valuation Assessment section
        this.valuationWidget = blessed.box({
            parent: this.newsContainer,
            label: " {red-fg}[V]{/red-fg}aluation Assessment ",
            top: "66%",
            left: 0,
            width: "100%",
            height: "34%",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "green",
                },
                focus: {
                    border: {
                        fg: "lightyellow",
                    },
                },
            },
            content: "Loading valuation assessment...",
            tags: true,
            scrollable: true,
            alwaysScroll: true,
            scrollbar: {
                ch: " ",
                style: {
                    bg: "lightcyan",
                },
            },
            focusable: true,
            keys: true,
            vi: true,
            mouse: true,
        });

        // Handle watchlist selection to update chart/news
        this.watchlistWidget.on('select', (item: any, index: number) => {
            logger.info(`Selected stock at index ${index}: ${item}`);
            // Load both news and events asynchronously
            this.loadNewsForSelectedStock();
            this.loadEventsForSelectedStock();
            this.updateChartForSelectedStock();
        });
        
        // Also handle key events for navigation
        this.watchlistWidget.key(['enter', 'space'], () => {
            // Load both news and events asynchronously
            this.loadNewsForSelectedStock();
            this.loadEventsForSelectedStock();
            this.updateChartForSelectedStock();
        });

        this.screen.append(mainContainer);
        
        // Initialize chart with sample data
        this.chart.setData([{
            title: "No Stock Selected",
            x: ["1", "2", "3", "4", "5"],
            y: [0, 0, 0, 0, 0],
            style: { line: "gray" }
        }]);

        // Focus the watchlist initially
        this.stockScreenContainer.focus();
    }

    private async loadWatchlist() {
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0) {
            this.watchlistWidget.setItems(["No stocks in watchlist. Press 'a' to add one."]);
            this.screen.render();
            return;
        }

        // Format stock items with price data
        const items = stocks.map(stock => this.formatStockItem(stock));
        this.watchlistWidget.setItems(items);
        this.screen.render();

        // Trigger chart update and load news/events for first item if we have stocks
        if (stocks.length > 0) {
            this.updateChartForSelectedStock();
            // Load both news and events asynchronously for the first stock
            this.loadNewsForSelectedStock();
            this.loadEventsForSelectedStock();
        }

        // Refresh stock prices in background
        this.refreshStockPrices();
    }

    private formatStockItem(stock: WatchlistItem): string {
        if (!stock.price) {
            return `{bold}${stock.ticker}{/bold} - Loading price...`;
        }

        const changeColor = stock.change! >= 0 ? "green" : "red";
        const changeSign = stock.change! >= 0 ? "+" : "";
        const changePercent = stock.changePercent?.toFixed(2) || "0.00";
        const change = stock.change?.toFixed(2) || "0.00";
        const price = stock.price.toFixed(2);

        return `{bold}${stock.ticker}{/bold} $${price} {${changeColor}-fg}${changeSign}$${change} (${changeSign}${changePercent}%){/}`;
    }

    private async refreshStockPrices() {
        const stocks = this.database.getAllStocks();
        let successCount = 0;
        let errorCount = 0;

        const updatePromises = stocks.map(async (stock) => {
            try {
                const quote = await this.alphaVantage.getStockQuote(stock.ticker);
                if (quote) {
                    this.database.updateStockPrice(
                        stock.ticker,
                        quote.price,
                        quote.change,
                        quote.changePercent
                    );
                    successCount++;
                } else {
                    errorCount++;
                }
            } catch (error) {
                logger.error(`Failed to update ${stock.ticker}:`, error);
                errorCount++;
            }
        });

        await Promise.all(updatePromises);
        
        // Reload the watchlist with updated prices
        const updatedStocks = this.database.getAllStocks();
        const items = updatedStocks.map(stock => this.formatStockItem(stock));
        this.watchlistWidget.setItems(items);
        
        // Update chart for selected stock after price refresh
        if (updatedStocks.length > 0) {
            this.updateChartForSelectedStock();
        }
        
        this.screen.render();

        // Show summary message
        if (errorCount === 0) {
            this.showMessage(`Updated ${successCount} stock prices`, "success");
        } else if (successCount === 0) {
            this.showMessage(`Failed to update stock prices`, "error");
        } else {
            this.showMessage(`Updated ${successCount}/${stocks.length} prices`, "warning");
        }
    }

    private showAddStockDialog() {
        const prompt = blessed.prompt({
            parent: this.screen,
            top: "center",
            left: "center",
            width: 50,
            height: 7,
            label: " Add Stock ",
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: "cyan",
                },
            },
        });

        // Track active popup
        this.activePopup = prompt;

        prompt.input("Enter stock ticker (e.g., AAPL):", "", async (err, value) => {
            // Clear active popup
            this.activePopup = null;
            
            if (err || !value) {
                this.stockScreenContainer.focus();
                this.screen.render();
                return;
            }

            const ticker = value.trim().toUpperCase();
            if (!ticker || ticker.length > 10) {
                this.showMessage("Invalid ticker symbol", "error");
                this.stockScreenContainer.focus();
                this.screen.render();
                return;
            }

            if (this.database.hasStock(ticker)) {
                this.showMessage(`${ticker} is already in watchlist`, "warning");
                this.stockScreenContainer.focus();
                this.screen.render();
                return;
            }

            // Show validating message
            this.showMessage(`Validating ${ticker}...`, "warning");

            // Validate ticker with Alpha Vantage
            try {
                const isValid = await this.alphaVantage.validateSymbol(ticker);
                if (!isValid) {
                    this.showMessage(`${ticker} is not a valid stock symbol`, "error");
                    this.stockScreenContainer.focus();
                    this.screen.render();
                    return;
                }
            } catch (error) {
                this.showMessage(`Error validating ${ticker}: ${error instanceof Error ? error.message : 'Unknown error'}`, "error");
                this.stockScreenContainer.focus();
                this.screen.render();
                return;
            }

            if (this.database.addStock(ticker)) {
                this.loadWatchlist();
                this.showMessage(`Added ${ticker} to watchlist`, "success");
            } else {
                this.showMessage("Failed to add stock", "error");
            }
            
            // Ensure focus returns to main screen
            this.stockScreenContainer.focus();
            this.screen.render();
        });
    }

    private deleteSelectedStock() {
        const selectedIndex = (this.watchlistWidget as any).selected || 0;
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0 || selectedIndex >= stocks.length) {
            this.showMessage("No stock selected", "warning");
            return;
        }

        const stock = stocks[selectedIndex];
        if (stock && this.database.removeStock(stock.ticker)) {
            this.loadWatchlist();
            this.showMessage(`Removed ${stock.ticker} from watchlist`, "success");
        } else {
            this.showMessage("Failed to remove stock", "error");
        }
    }

    private showMessage(text: string, type: "success" | "error" | "warning") {
        const colors = {
            success: "green",
            error: "red",
            warning: "yellow",
        };

        const message = blessed.message({
            parent: this.screen,
            top: 1,
            right: 1,
            width: 40,
            height: "shrink",
            border: {
                type: "line",
            },
            align: "center",
            valign: "middle",
            style: {
                border: {
                    fg: colors[type],
                },
            },
        });

        message.display(text, 2, () => {
            // Only restore focus if no popup is currently active
            // Also check if the current focused element is a popup/dialog
            const focused = this.screen.focused;
            const isPopup = focused && (
                this.activePopup === focused ||
                focused.constructor.name.includes('Prompt') ||
                focused.constructor.name.includes('Message') ||
                focused.constructor.name.includes('Question')
            );
            
            if (!this.activePopup && !isPopup) {
                this.stockScreenContainer.focus();
                this.screen.render();
            }
        });
    }



    private setupKeyBindings() {
        // Quit commands
        this.screen.key(["q", "C-c"], () => {
            this.database.close();
            process.exit(0);
        });



        // Stock management shortcuts
        this.screen.key(["a", "enter"], () => {
            this.showAddStockDialog();
        });

        this.screen.key(["d", "backspace"], () => {
            this.deleteSelectedStock();
        });

        this.screen.key(["r"], () => {
            if (this.currentView === "news") {
                this.showMessage("Refreshing news analysis...", "warning");
                this.refreshNewsAnalysis();
            } else {
                this.showMessage("Refreshing stock prices and events...", "warning");
                this.refreshStockPrices(); // Refresh stock prices only (don't trigger event loading)
                this.refreshEventsAnalysis(); // Only refresh events in chart view
            }
        });

        // Tab switching between chart and news
        this.screen.key(["tab"], () => {
            this.toggleView();
        });

        // Focus switching key bindings
        this.screen.key(["s", "S"], () => {
            this.setFocus("stock");
        });

        this.screen.key(["n", "N"], () => {
            if (this.currentView === "news") {
                this.setFocus("recent");
            }
        });

        this.screen.key(["m", "M"], () => {
            if (this.currentView === "news") {
                this.setFocus("major");
            }
        });

        this.screen.key(["v", "V"], () => {
            if (this.currentView === "news") {
                this.setFocus("valuation");
            }
        });

        this.screen.key(["f", "F"], () => {
            if (this.currentView === "chart") {
                this.setFocus("events");
            }
        });

        // Time range selection (1-4 keys) - only work in chart view
        this.screen.key(["1"], () => {
            if (this.currentView === "chart") {
                this.setTimeRange("1m");
            }
        });

        this.screen.key(["2"], () => {
            if (this.currentView === "chart") {
                this.setTimeRange("3m");
            }
        });

        this.screen.key(["3"], () => {
            if (this.currentView === "chart") {
                this.setTimeRange("1y");
            }
        });

        this.screen.key(["4"], () => {
            if (this.currentView === "chart") {
                this.setTimeRange("5y");
            }
        });

        // Manual chart update trigger
        this.screen.key(["c"], () => {
            this.updateChartForSelectedStock();
        });

        // J/K navigation (vi-style) - respects current focus
        this.screen.key(["up", "k"], () => {
            this.handleFocusedNavigation("up");
        });

        this.screen.key(["down", "j"], () => {
            this.handleFocusedNavigation("down");
        });
    }

    private async updateChartForSelectedStock() {
        const selectedIndex = (this.watchlistWidget as any).selected || 0;
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0 || selectedIndex >= stocks.length) {
            // Show empty chart
            this.chart.setLabel("Select a stock to view chart");
            this.chart.setData([{
                title: "No Stock Selected",
                x: [""],
                y: [0],
                style: { line: "gray" }
            }]);
            this.eventsWidget.setContent("Select a stock to view events");
            this.screen.render();
            return;
        }

        const stock = stocks[selectedIndex];
        if (!stock) return;

        this.selectedStock = stock.ticker;
        this.chart.setLabel(`${stock.ticker} - ${this.currentTimeRange.toUpperCase()}`);
        
        try {
            const chartData = await this.alphaVantage.getHistoricalData(stock.ticker, this.currentTimeRange);
            
            if (chartData.length === 0) {
                this.chart.setData([{
                    title: stock.ticker,
                    x: ["No Data"],
                    y: [0],
                    style: { line: "red" }
                }]);
                this.showMessage(`No chart data available for ${stock.ticker}`, "warning");
            } else {
                // Ensure we have valid data and limit points for better display
                const maxPoints = 50;
                const step = Math.max(1, Math.floor(chartData.length / maxPoints));
                const limitedData = chartData.filter((_, index) => index % step === 0);
                
                // Format data for blessed-contrib - ensure no null values
                const xLabels = limitedData.map(point => this.formatDateForChart(point.date)).filter(x => x && x !== "null");
                const yValues = limitedData.map(point => point.price).filter(y => y !== null && !isNaN(y));
                
                if (xLabels.length === 0 || yValues.length === 0) {
                    throw new Error("No valid data points after filtering");
                }
                
                const formattedData = {
                    title: stock.ticker,
                    x: xLabels,
                    y: yValues,
                    style: { line: "cyan" }
                };
                
                logger.info(`Chart data for ${stock.ticker}: ${yValues.length} points, range: $${yValues[0]} - $${yValues[yValues.length-1]}`);
                
                this.chart.setData([formattedData]);
            }
            
            this.screen.render();
        } catch (error) {
            logger.error(`Failed to load chart data for ${stock.ticker}:`, error);
            
            let errorMessage = `Failed to load chart for ${stock.ticker}`;
            if (error instanceof Error) {
                if (error.message.includes("rate limit") || error.message.includes("25 requests per day")) {
                    errorMessage = "API rate limit exceeded (25/day). Please wait until tomorrow.";
                } else if (error.message.includes("No data available")) {
                    errorMessage = `No historical data available for ${stock.ticker}`;
                } else if (error.message.includes("Invalid symbol")) {
                    errorMessage = `${stock.ticker} is not a valid symbol`;
                }
            }
            
            this.showMessage(errorMessage, "error");
            
            // Show informative error chart
            this.chart.setData([{
                title: "API Error",
                x: ["Error"],
                y: [0],
                style: { line: "red" }
            }]);
            this.chart.setLabel(`${stock.ticker} - Error Loading Data`);
            this.screen.render();
        }
    }

    private displayEventsForSelectedStock(events?: FinancialEvent[]) {
        if (!events || events.length === 0) {
            this.eventsWidget.setContent("No financial events found for this stock");
        } else {
            // Format events with numbering
            const eventsText = events.map((event, index) => {
                const impactColor = event.impact === 'positive' ? 'green' : 
                                   event.impact === 'negative' ? 'red' : 'yellow';
                return `{bold}[${index + 1}]{/bold} ${event.date} - ${event.description} {${impactColor}-fg}(${event.impact}){/}`;
            }).join('\n\n');
            
            this.eventsWidget.setContent(eventsText);
        }
        
        this.screen.render();
    }

    private displayNewsForSelectedStock(analysis?: StockAnalysis) {
        if (!analysis) {
            this.recentNewsWidget.setContent("No analysis available");
            this.majorEventsWidget.setContent("No analysis available");
            this.valuationWidget.setContent("No analysis available");
        } else {
            this.updateNewsWidgets(analysis);
        }
        
        this.screen.render();
    }

    private formatDateForChart(dateString: string): string {
        if (!dateString) return "";
        
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return "";
            
            switch (this.currentTimeRange) {
                case "1m":
                case "3m":
                    return `${date.getMonth() + 1}/${date.getDate()}`;
                case "1y":
                case "5y":
                    return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
                default:
                    return dateString.substring(0, 10); // Just the date part
            }
        } catch (error) {
            logger.error(`Error formatting date ${dateString}:`, error);
            return "";
        }
    }

    private setTimeRange(range: TimeRange) {
        this.currentTimeRange = range;
        
        // Update the time range display with simple text
        const content = `Time Range: [${range.toUpperCase()}] | Press: 1=1m 2=3m 3=1y 4=5y`;
        this.timeRangeSelector.setContent(content);
        
        // Update chart if a stock is selected
        if (this.selectedStock) {
            this.updateChartForSelectedStock();
        } else {
            // Try to update chart for current selection
            this.updateChartForSelectedStock();
        }
        
        this.screen.render();
    }

    private toggleView() {
        if (this.currentView === "chart") {
            this.currentView = "news";
            this.chart.hide();
            this.eventsWidget.hide();
            this.newsContainer.show();
            this.timeRangeSelector.setContent("Tab: Switch to Chart | s/n/m/v: Focus | j/k: Navigate/Scroll");
            // Set focus back to stock list by default when switching to news
            this.setFocus("stock");
        } else {
            this.currentView = "chart";
            this.newsContainer.hide();
            this.chart.show();
            this.eventsWidget.show();
            this.timeRangeSelector.setContent(`Tab: Switch to News | 1=1m 2=3m 3=1y 4=5y`);
            this.updateChartForSelectedStock();
            // Ensure stock list is focused in chart view
            this.setFocus("stock");
        }
        this.screen.render();
    }

    private setFocus(focusElement: "stock" | "recent" | "major" | "valuation" | "events") {
        this.currentFocus = focusElement;
        
        switch (focusElement) {
            case "stock":
                this.stockScreenContainer.focus();
                break;
            case "recent":
                if (this.currentView === "news") {
                    this.recentNewsWidget.focus();
                }
                break;
            case "major":
                if (this.currentView === "news") {
                    this.majorEventsWidget.focus();
                }
                break;
            case "valuation":
                if (this.currentView === "news") {
                    this.valuationWidget.focus();
                }
                break;
            case "events":
                if (this.currentView === "chart") {
                    this.eventsWidget.focus();
                }
                break;
        }
        
        this.screen.render();
    }



    private handleFocusedNavigation(direction: "up" | "down") {
        switch (this.currentFocus) {
            case "stock":
                // Navigate stock list and update appropriate view
                if (direction === "up") {
                    this.watchlistWidget.up(1);
                } else {
                    this.watchlistWidget.down(1);
                }
                this.screen.render();
                // Load both news and events asynchronously, then update displays
                this.loadNewsForSelectedStock();
                this.loadEventsForSelectedStock();
                this.updateChartForSelectedStock();
                break;
            case "recent":
                // Scroll the recent news widget
                if (this.currentView === "news") {
                    if (direction === "up") {
                        this.recentNewsWidget.scroll(-1);
                    } else {
                        this.recentNewsWidget.scroll(1);
                    }
                    this.screen.render();
                }
                break;
            case "major":
                // Scroll the major events widget
                if (this.currentView === "news") {
                    if (direction === "up") {
                        this.majorEventsWidget.scroll(-1);
                    } else {
                        this.majorEventsWidget.scroll(1);
                    }
                    this.screen.render();
                }
                break;
            case "valuation":
                // Scroll the valuation widget
                if (this.currentView === "news") {
                    if (direction === "up") {
                        this.valuationWidget.scroll(-1);
                    } else {
                        this.valuationWidget.scroll(1);
                    }
                    this.screen.render();
                }
                break;
            case "events":
                // Scroll the valuation widget
                if (this.currentView === "chart") {
                    if (direction === "up") {
                        this.eventsWidget.scroll(-1);
                    } else {
                        this.eventsWidget.scroll(1);
                    }
                    this.screen.render();
                }
                break;
        }
    }

    private async loadNewsForSelectedStock() {
        const selectedIndex = (this.watchlistWidget as any).selected || 0;
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0 || selectedIndex >= stocks.length) {
            this.recentNewsWidget.setContent("No stock selected for news analysis");
            this.majorEventsWidget.setContent("No stock selected for news analysis");
            this.valuationWidget.setContent("No stock selected for news analysis");
            this.screen.render();
            return;
        }

        const stock = stocks[selectedIndex];
        if (!stock) return;

        this.selectedStock = stock.ticker;
        
        // Check if there's already an ongoing call for this stock
        if (this.ongoingNewsCalls.has(stock.ticker)) {
            logger.info(`Skipping duplicate news call for ${stock.ticker} - already in progress`);
            this.recentNewsWidget.setContent("Refreshing recent news...");
            this.majorEventsWidget.setContent("Refreshing major events...");
            this.valuationWidget.setContent("Refreshing valuation assessment...");
            this.screen.render();
            return;
        }
        
        // Mark this stock as having an ongoing call
        logger.info(`Starting news analysis for ${stock.ticker}`);
        this.ongoingNewsCalls.add(stock.ticker);
        
        this.recentNewsWidget.setContent("Loading recent news...");
        this.majorEventsWidget.setContent("Loading major events...");
        this.valuationWidget.setContent("Loading valuation assessment...");
        this.screen.render();
        
        try {
            // Get news analysis without events
            const analysis = await this.getNewsAnalysisOnly(stock.ticker);
            
            if (!analysis) {
                this.recentNewsWidget.setContent(`No analysis available for ${stock.ticker}`);
                this.majorEventsWidget.setContent(`No analysis available for ${stock.ticker}`);
                this.valuationWidget.setContent(`No analysis available for ${stock.ticker}`);
                this.screen.render();
                return;
            }

            this.updateNewsWidgets(analysis);
            this.screen.render();
            
        } catch (error) {
            logger.error(`Failed to load news analysis for ${stock.ticker}:`, error);
            
            let errorMessage = `Failed to load news analysis for ${stock.ticker}`;
            if (error instanceof Error) {
                if (error.message.includes("rate limit") || error.message.includes("quota")) {
                    errorMessage = "API rate limit exceeded. Please try again later.";
                } else if (error.message.includes("API key")) {
                    errorMessage = "Perplexity API key not configured. Check environment variables.";
                }
            }
            
            this.recentNewsWidget.setContent(errorMessage);
            this.majorEventsWidget.setContent(errorMessage);
            this.valuationWidget.setContent(errorMessage);
            this.screen.render();
        } finally {
            // Remove the stock from ongoing calls set
            logger.info(`Completed news analysis for ${stock.ticker}`);
            this.ongoingNewsCalls.delete(stock.ticker);
        }
    }

    private async loadEventsForSelectedStock() {
        const selectedIndex = (this.watchlistWidget as any).selected || 0;
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0 || selectedIndex >= stocks.length) {
            this.eventsWidget.setContent("Select a stock to view events");
            this.screen.render();
            return;
        }

        const stock = stocks[selectedIndex];
        if (!stock) return;

        this.selectedStock = stock.ticker;
        
        // Check if there's already an ongoing call for this stock
        if (this.ongoingEventsCalls.has(stock.ticker)) {
            logger.info(`Skipping duplicate events call for ${stock.ticker} - already in progress`);
            this.eventsWidget.setContent("Refreshing financial events...");
            this.screen.render();
            return;
        }
        
        // Mark this stock as having an ongoing call
        logger.info(`Starting events loading for ${stock.ticker}`);
        this.ongoingEventsCalls.add(stock.ticker);
        
        this.eventsWidget.setContent("Loading financial events...");
        this.screen.render();
        
        try {
            const events = await this.perplexity.getFinancialEvents(stock.ticker);
            this.displayEventsForSelectedStock(events);
            this.screen.render();
            
        } catch (error) {
            logger.error(`Failed to load events for ${stock.ticker}:`, error);
            this.eventsWidget.setContent(`Failed to load events for ${stock.ticker}`);
            this.screen.render();
        } finally {
            // Remove the stock from ongoing calls set
            logger.info(`Completed events loading for ${stock.ticker}`);
            this.ongoingEventsCalls.delete(stock.ticker);
        }
    }

    private async getNewsAnalysisOnly(ticker: string): Promise<StockAnalysis | null> {
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

            logger.info(`Making Perplexity API call for news analysis: ${upperTicker}`);
            
            const query = `Analyze ${upperTicker} stock with exactly these sections:
1. Most recent news (past 7 days) - factual news, no stock analysis yet.
2. Major events in past 12 months related to the stock or the company.
3. Current valuation assessment - undervalued/fairly valued/overvalued with brief reasoning`;

            const response = await fetch(this.perplexity['baseUrl'], {
                method: "POST",
                headers: {
                    "Authorization": `Bearer ${this.perplexity['apiKey']}`,
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

            const data = await response.json() as any;

            if (!data.choices || data.choices.length === 0) {
                throw new Error("No response from Perplexity API");
            }

            const content = data.choices[0]?.message?.content;
            if (!content) {
                throw new Error("Empty response from Perplexity API");
            }
            
            const analysis = this.parseAnalysis(upperTicker, content);

            // Cache the result for 24 hours
            if (this.database) {
                this.database.setCacheData(upperTicker, "analysis", analysis, 24);
                logger.info(`Cached analysis data for ${upperTicker} for 24 hours`);
            }

            return analysis;

        } catch (error) {
            logger.error(`Error fetching analysis for ${ticker}:`, error);
            throw error;
        }
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
            events: [], // Not used in news-only analysis
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

    private updateNewsWidgets(analysis: StockAnalysis) {
        // Update Recent News widget
        const recentNewsContent = analysis.recentNews.length > 0 
            ? analysis.recentNews.map(item => `• ${item}`).join('\n\n')
            : "No recent news available";
        this.recentNewsWidget.setContent(recentNewsContent);

        // Update Major Events widget
        const majorEventsContent = analysis.majorEvents.length > 0
            ? analysis.majorEvents.map(item => `• ${item}`).join('\n\n')
            : "No major events identified";
        this.majorEventsWidget.setContent(majorEventsContent);

        // Update Valuation Assessment widget
        const valuationContent = analysis.valuationAssessment.length > 0
            ? analysis.valuationAssessment.map(item => `• ${item}`).join('\n\n')
            : "Valuation assessment unavailable";
        this.valuationWidget.setContent(valuationContent);
    }

    private async refreshNewsAnalysis() {
        const selectedIndex = (this.watchlistWidget as any).selected || 0;
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0 || selectedIndex >= stocks.length) {
            this.showMessage("No stock selected for refresh", "warning");
            return;
        }

        const stock = stocks[selectedIndex];
        if (!stock) return;

        this.selectedStock = stock.ticker;
        
        // Check if there's already an ongoing call for this stock
        if (this.ongoingNewsCalls.has(stock.ticker)) {
            logger.info(`Skipping duplicate refresh for ${stock.ticker} - already in progress`);
            this.showMessage("Analysis refresh already in progress", "warning");
            return;
        }
        
        // Clear cache for this stock's analysis only (not events) to force fresh API calls
        if (this.database) {
            const analysisCleared = this.database.clearSpecificCache(stock.ticker, 'analysis');
            if (analysisCleared) {
                logger.info(`Cleared cached analysis data for ${stock.ticker}`);
            }
        }

        // Mark this stock as having an ongoing call
        logger.info(`Starting manual refresh for ${stock.ticker}`);
        this.ongoingNewsCalls.add(stock.ticker);

        // Show loading state
        this.recentNewsWidget.setContent("Refreshing recent news...");
        this.majorEventsWidget.setContent("Refreshing major events...");
        this.valuationWidget.setContent("Refreshing valuation assessment...");
        this.screen.render();
        
        try {
            const analysis = await this.getNewsAnalysisOnly(stock.ticker);
            
            if (!analysis) {
                this.recentNewsWidget.setContent(`No analysis available for ${stock.ticker}`);
                this.majorEventsWidget.setContent(`No analysis available for ${stock.ticker}`);
                this.valuationWidget.setContent(`No analysis available for ${stock.ticker}`);
                this.showMessage("Failed to refresh analysis", "error");
                this.screen.render();
                return;
            }

            this.updateNewsWidgets(analysis);
            this.timeRangeSelector.setContent(`Tab: Switch to Chart | ${stock.ticker} Analysis (Refreshed)`);
            this.showMessage("News analysis refreshed", "success");
            this.screen.render();
            
        } catch (error) {
            logger.error(`Failed to refresh news analysis for ${stock.ticker}:`, error);
            
            let errorMessage = `Failed to refresh analysis for ${stock.ticker}`;
            if (error instanceof Error) {
                if (error.message.includes("rate limit") || error.message.includes("quota")) {
                    errorMessage = "API rate limit exceeded. Please try again later.";
                } else if (error.message.includes("API key")) {
                    errorMessage = "Perplexity API key not configured. Check environment variables.";
                }
            }
            
            this.recentNewsWidget.setContent(errorMessage);
            this.majorEventsWidget.setContent(errorMessage);
            this.valuationWidget.setContent(errorMessage);
            this.showMessage("Failed to refresh analysis", "error");
            this.screen.render();
        } finally {
            // Remove the stock from ongoing calls set
            this.ongoingNewsCalls.delete(stock.ticker);
        }
    }

    private async refreshEventsAnalysis() {
        const selectedIndex = (this.watchlistWidget as any).selected || 0;
        const stocks = this.database.getAllStocks();
        
        if (stocks.length === 0 || selectedIndex >= stocks.length) {
            this.showMessage("No stock selected for refresh", "warning");
            return;
        }

        const stock = stocks[selectedIndex];
        if (!stock) return;

        this.selectedStock = stock.ticker;
        
        // Check if there's already an ongoing call for this stock
        if (this.ongoingEventsCalls.has(stock.ticker)) {
            logger.info(`Skipping duplicate events refresh for ${stock.ticker} - already in progress`);
            this.showMessage("Events refresh already in progress", "warning");
            return;
        }
        
        // Clear cache for this stock's events to force fresh API calls
        if (this.database) {
            const eventsCleared = this.database.clearSpecificCache(stock.ticker, 'events');
            logger.info(`Cache clear for ${stock.ticker} events: ${eventsCleared ? 'SUCCESS' : 'NO_CACHE_TO_CLEAR'}`);
        }

        // Mark this stock as having an ongoing call
        logger.info(`Starting manual events refresh for ${stock.ticker}`);
        this.ongoingEventsCalls.add(stock.ticker);

        // Show loading state
        this.eventsWidget.setContent("Refreshing financial events...");
        this.screen.render();
        
        try {
            const events = await this.perplexity.getFinancialEvents(stock.ticker);
            this.displayEventsForSelectedStock(events);
            this.showMessage("Financial events refreshed", "success");
            this.screen.render();
            
        } catch (error) {
            logger.error(`Failed to refresh events for ${stock.ticker}:`, error);
            
            let errorMessage = `Failed to refresh events for ${stock.ticker}`;
            if (error instanceof Error) {
                if (error.message.includes("rate limit") || error.message.includes("quota")) {
                    errorMessage = "API rate limit exceeded. Please try again later.";
                } else if (error.message.includes("API key")) {
                    errorMessage = "Perplexity API key not configured. Check environment variables.";
                }
            }
            
            this.eventsWidget.setContent(errorMessage);
            this.showMessage("Failed to refresh events", "error");
            this.screen.render();
        } finally {
            // Remove the stock from ongoing calls set
            this.ongoingEventsCalls.delete(stock.ticker);
        }
    }
}

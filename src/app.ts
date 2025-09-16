import blessed from "blessed";
import contrib from "blessed-contrib";
import { WatchlistDatabase, type WatchlistItem } from "./database/watchlist";
import { AlphaVantageService, type StockQuote, type TimeRange, type ChartDataPoint } from "./services/alpha-vantage";
import { logger } from "./utils/logger";

export class App {
    private screen: blessed.Widgets.Screen;
    private stockScreenContainer!: blessed.Widgets.BoxElement;
    private watchlistWidget!: blessed.Widgets.ListElement;
    private statusLine!: blessed.Widgets.BoxElement;
    private chartContainer!: blessed.Widgets.BoxElement;
    private chart!: any; // blessed-contrib line chart
    private timeRangeSelector!: blessed.Widgets.BoxElement;
    private currentTimeRange: TimeRange = "1m";
    private selectedStock: string | null = null;

    private database!: WatchlistDatabase;
    private alphaVantage!: AlphaVantageService;
    private activePopup: blessed.Widgets.BlessedElement | null = null;

    constructor() {
        this.database = new WatchlistDatabase();
        this.alphaVantage = new AlphaVantageService();
        this.alphaVantage.setDatabase(this.database); // Connect database to API service
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
            label: " Stock Watchlist ",
            top: 0,
            left: 0,
            width: "25%",
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
                        fg: "yellow",
                    },
                },
            },
            focusable: true,
        });

        // Watchlist widget (inside the left container)
        this.watchlistWidget = blessed.list({
            parent: this.stockScreenContainer,
            top: 1,
            left: 1,
            width: "100%-2",
            height: "100%-4",
            items: ["Loading..."],
            keys: true,
            vi: true,
            mouse: true,
            tags: true,
            style: {
                selected: {
                    bg: "blue",
                    fg: "white",
                },
                focus: {
                    bg: "yellow",
                    fg: "black",
                },
            },
            scrollbar: {
                ch: " ",
                style: {
                    bg: "yellow",
                },
            },
        });

        // Status line for instructions (left panel)
        this.statusLine = blessed.box({
            parent: this.stockScreenContainer,
            bottom: 0,
            left: 1,
            width: "100%-2",
            height: 1,
            content: "a:Add | d:Delete | j/k:Navigate | c:Chart | r:Refresh | 1-5:TimeRange | q:Quit",
            style: {
                fg: "cyan",
            },
        });

        // Right panel - Chart container
        this.chartContainer = blessed.box({
            parent: mainContainer,
            label: " Stock Chart ",
            top: 0,
            left: "25%",
            width: "70%",
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

        // Time range selector
        this.timeRangeSelector = blessed.box({
            parent: this.chartContainer,
            top: 1,
            left: 1,
            width: "100%-2",
            height: 3,
            content: "Time Range: [1m] | Press: 1=1m 2=3m 3=1y 4=5y",
            tags: false,
            style: {
                fg: "cyan",
            },
        });

        // Create the line chart
        this.chart = contrib.line({
            parent: this.chartContainer,
            top: 4,
            left: 1,
            width: "100%-2",
            height: "100%-5",
            style: {
                line: "cyan",
                text: "white",
                baseline: "white"
            },
            xLabelPadding: 3,
            xPadding: 5,
            showLegend: false,
            wholeNumbersOnly: false,
            label: "Select a stock to view chart"
        });

        // Handle watchlist selection to update chart
        this.watchlistWidget.on('select', (item: any, index: number) => {
            logger.info(`Selected stock at index ${index}: ${item}`);
            this.updateChartForSelectedStock();
        });
        
        // Also handle key events for navigation
        this.watchlistWidget.key(['enter', 'space'], () => {
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
            label: ` ${type.toUpperCase()} `,
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
            this.showMessage("Refreshing stock prices...", "warning");
            this.loadWatchlist();
        });

        // Time range selection (1-4 keys)
        this.screen.key(["1"], () => {
            this.setTimeRange("1m");
        });

        this.screen.key(["2"], () => {
            this.setTimeRange("3m");
        });

        this.screen.key(["3"], () => {
            this.setTimeRange("1y");
        });

        this.screen.key(["4"], () => {
            this.setTimeRange("5y");
        });

        // Manual chart update trigger
        this.screen.key(["c"], () => {
            this.updateChartForSelectedStock();
        });

        // J/K navigation (vi-style) - blessed list already handles this with vi: true
        // But we can add up/down arrow support explicitly and trigger chart updates
        this.screen.key(["up", "k"], () => {
            this.watchlistWidget.up(1);
            this.screen.render();
            // Trigger chart update after a short delay
            setTimeout(() => this.updateChartForSelectedStock(), 100);
        });

        this.screen.key(["down", "j"], () => {
            this.watchlistWidget.down(1);
            this.screen.render();
            // Trigger chart update after a short delay
            setTimeout(() => this.updateChartForSelectedStock(), 100);
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
            this.screen.render();
            return;
        }

        const stock = stocks[selectedIndex];
        if (!stock) return;

        this.selectedStock = stock.ticker;
        this.chart.setLabel(`${stock.ticker} - ${this.currentTimeRange.toUpperCase()}`);
        
        try {
            this.showMessage(`Loading ${stock.ticker} chart...`, "warning");
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
                this.showMessage(`Loaded ${stock.ticker} chart (${yValues.length} points)`, "success");
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

    private formatDateForChart(dateString: string): string {
        if (!dateString) return "";
        
        try {
            const date = new Date(dateString);
            if (isNaN(date.getTime())) return "";
            
            switch (this.currentTimeRange) {
                case "1d":
                    return `${String(date.getHours()).padStart(2, '0')}:${String(date.getMinutes()).padStart(2, '0')}`;
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
}

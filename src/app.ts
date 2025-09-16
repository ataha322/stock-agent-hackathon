import blessed from "blessed";
import { WatchlistDatabase, type WatchlistItem } from "./database/watchlist";
import { AlphaVantageService, type StockQuote } from "./services/alpha-vantage";
import { logger } from "./utils/logger";

export class App {
    private screen: blessed.Widgets.Screen;
    private stockScreenContainer!: blessed.Widgets.BoxElement;
    private watchlistWidget!: blessed.Widgets.ListElement;
    private statusLine!: blessed.Widgets.BoxElement;

    private database!: WatchlistDatabase;
    private alphaVantage!: AlphaVantageService;
    private activePopup: blessed.Widgets.BlessedElement | null = null;

    constructor() {
        this.database = new WatchlistDatabase();
        this.alphaVantage = new AlphaVantageService();
        this.screen = blessed.screen({
            smartCSR: true,
            title: "Stock Watchlist Monitor",
            autoPadding: true,
        });

        this.setupScreens();
        this.setupKeyBindings();
        this.loadWatchlist().catch((error) => logger.error("Failed to load watchlist:", error));
        this.screen.render();
    }

    private setupScreens() {
        // Stock screen container
        this.stockScreenContainer = blessed.box({
            label: " Stock Watchlist ",
            top: "center",
            left: "center",
            width: "95%",
            height: "95%",
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

        // Watchlist widget (inside the container)
        this.watchlistWidget = blessed.list({
            parent: this.stockScreenContainer,
            top: "center",
            left: "center",
            width: "94%",
            height: "94%",
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

        // Status line for instructions
        this.statusLine = blessed.box({
            parent: this.stockScreenContainer,
            bottom: 0,
            left: 1,
            width: "95%",
            height: 1,
            content: "a:Add | d:Delete | j/k:Navigate | r:Refresh | q:Quit",
            style: {
                fg: "cyan",
            },
        });

        this.screen.append(this.stockScreenContainer);
        
        // Focus the initial screen
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

        // J/K navigation (vi-style) - blessed list already handles this with vi: true
        // But we can add up/down arrow support explicitly
        this.screen.key(["up", "k"], () => {
            this.watchlistWidget.up(1);
            this.screen.render();
        });

        this.screen.key(["down", "j"], () => {
            this.watchlistWidget.down(1);
            this.screen.render();
        });
    }
}

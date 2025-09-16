import blessed from "blessed";
import { WatchlistDatabase, type WatchlistItem } from "./database/watchlist";

export class App {
    private screen: blessed.Widgets.Screen;
    private stockScreenContainer!: blessed.Widgets.BoxElement;
    private watchlistWidget!: blessed.Widgets.ListElement;
    private statusLine!: blessed.Widgets.BoxElement;
    private newsScreen!: blessed.Widgets.BoxElement;
    private currentScreen: number = 0; // 0 = stock, 1 = news
    private leaderPressed: boolean = false;
    private database!: WatchlistDatabase;

    constructor() {
        this.database = new WatchlistDatabase();
        this.screen = blessed.screen({
            smartCSR: true,
            title: "Stock News Monitor",
            autoPadding: true,
        });

        this.setupScreens();
        this.setupKeyBindings();
        this.loadWatchlist();
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
            content: "a:Add | d:Delete | j/k:Navigate | Tab:Switch | q:Quit",
            style: {
                fg: "cyan",
            },
        });

        // News screen
        this.newsScreen = blessed.box({
            label: " News Analysis ",
            hidden: true,
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
            content: "News Analysis Screen\n\nNews summaries will appear here\nPress Tab to switch to Stock screen",
            tags: true,
            focusable: true,
        });

        this.screen.append(this.stockScreenContainer);
        this.screen.append(this.newsScreen);
        
        // Focus the initial screen
        this.stockScreenContainer.focus();
    }

    private loadWatchlist() {
        const stocks = this.database.getAllStocks();
        const items = stocks.length > 0 
            ? stocks.map(stock => `${stock.ticker} (added: ${new Date(stock.addedAt).toLocaleDateString()})`)
            : ["No stocks in watchlist. Press 'a' to add one."];
        
        this.watchlistWidget.setItems(items);
        this.screen.render();
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

        prompt.input("Enter stock ticker (e.g., AAPL):", "", (err, value) => {
            if (err || !value) {
                this.stockScreenContainer.focus();
                this.screen.render();
                return;
            }

            const ticker = value.trim().toUpperCase();
            if (!ticker || ticker.length > 10) {
                this.showMessage("Invalid ticker symbol", "error");
                return;
            }

            if (this.database.hasStock(ticker)) {
                this.showMessage(`${ticker} is already in watchlist`, "warning");
                return;
            }

            if (this.database.addStock(ticker)) {
                this.loadWatchlist();
                this.showMessage(`Added ${ticker} to watchlist`, "success");
            } else {
                this.showMessage("Failed to add stock", "error");
            }
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
            width: "shrink",
            height: "shrink",
            label: ` ${type.toUpperCase()} `,
            border: {
                type: "line",
            },
            style: {
                border: {
                    fg: colors[type],
                },
            },
        });

        message.display(text, 2, () => {
            this.stockScreenContainer.focus();
            this.screen.render();
        });
    }

    private switchToScreen(screenIndex: number) {
        if (screenIndex === this.currentScreen) return;

        if (screenIndex === 0) {
            // Switch to stock screen
            this.newsScreen.hide();
            this.stockScreenContainer.show();
            this.stockScreenContainer.focus();
            this.currentScreen = 0;
        } else if (screenIndex === 1) {
            // Switch to news screen
            this.stockScreenContainer.hide();
            this.newsScreen.show();
            this.newsScreen.focus();
            this.currentScreen = 1;
        }
        
        this.screen.render();
    }

    private setupKeyBindings() {
        // Quit commands
        this.screen.key(["q", "C-c"], () => {
            this.database.close();
            process.exit(0);
        });

        // Tab navigation
        this.screen.key(["tab"], () => {
            const nextScreen = this.currentScreen === 0 ? 1 : 0;
            this.switchToScreen(nextScreen);
        });

        this.screen.key(["S-tab"], () => {
            const prevScreen = this.currentScreen === 0 ? 1 : 0;
            this.switchToScreen(prevScreen);
        });

        // Leader key (ctrl+x) handling
        this.screen.key(["C-x"], () => {
            this.leaderPressed = true;
            // Reset leader state after 2 seconds if no follow-up key
            setTimeout(() => {
                this.leaderPressed = false;
            }, 2000);
        });

        // Leader + number shortcuts
        this.screen.key(["1"], () => {
            if (this.leaderPressed) {
                this.switchToScreen(0);
                this.leaderPressed = false;
            }
        });

        this.screen.key(["2"], () => {
            if (this.leaderPressed) {
                this.switchToScreen(1);
                this.leaderPressed = false;
            }
        });

        // Stock management shortcuts (only when on stock screen)
        this.screen.key(["a", "enter"], () => {
            if (this.currentScreen === 0) {
                this.showAddStockDialog();
            }
        });

        this.screen.key(["d", "backspace"], () => {
            if (this.currentScreen === 0) {
                this.deleteSelectedStock();
            }
        });

        this.screen.key(["r"], () => {
            if (this.currentScreen === 0) {
                this.loadWatchlist();
                this.showMessage("Watchlist refreshed", "success");
            } else {
                // TODO: Refresh news
                this.showMessage("News refresh not implemented yet", "warning");
            }
        });

        // J/K navigation (vi-style) - blessed list already handles this with vi: true
        // But we can add up/down arrow support explicitly
        this.screen.key(["up", "k"], () => {
            if (this.currentScreen === 0) {
                this.watchlistWidget.up(1);
                this.screen.render();
            }
        });

        this.screen.key(["down", "j"], () => {
            if (this.currentScreen === 0) {
                this.watchlistWidget.down(1);
                this.screen.render();
            }
        });
    }
}

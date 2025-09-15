import blessed from "blessed";

export class App {
    private screen: blessed.Widgets.Screen;
    private stockScreen!: blessed.Widgets.BoxElement;
    private newsScreen!: blessed.Widgets.BoxElement;
    private currentScreen: number = 0; // 0 = stock, 1 = news
    private leaderPressed: boolean = false;

    constructor() {
        this.screen = blessed.screen({
            smartCSR: true,
            title: "Stock News Monitor",
            autoPadding: true,
        });

        this.setupScreens();
        this.setupKeyBindings();
        this.screen.render();
    }

    private setupScreens() {
        this.stockScreen = blessed.box({
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
            },
            content: "Stock Watchlist Screen\n\nPress 'a' to add stocks\nPress 'd' to delete stocks\nPress Tab to switch to News screen",
            tags: true,
            focusable: true,
        });

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
            },
            content: "News Analysis Screen\n\nNews summaries will appear here\nPress Tab to switch to Stock screen",
            tags: true,
            focusable: true,
        });

        this.screen.append(this.stockScreen);
        this.screen.append(this.newsScreen);
        
        // Focus the initial screen
        this.stockScreen.focus();
    }

    private switchToScreen(screenIndex: number) {
        if (screenIndex === this.currentScreen) return;

        if (screenIndex === 0) {
            // Switch to stock screen
            this.newsScreen.hide();
            this.stockScreen.show();
            this.stockScreen.focus();
            this.currentScreen = 0;
        } else if (screenIndex === 1) {
            // Switch to news screen
            this.stockScreen.hide();
            this.newsScreen.show();
            this.newsScreen.focus();
            this.currentScreen = 1;
        }
        
        this.screen.render();
    }

    private setupKeyBindings() {
        // Quit commands
        this.screen.key(["q", "C-c"], () => {
            process.exit(0);
        });

        // Tab navigation
        this.screen.key(["tab"], () => {
            const nextScreen = this.currentScreen === 0 ? 1 : 0;
            this.switchToScreen(nextScreen);
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

        // Future keyboard shortcuts (as per PLAN.md)
        this.screen.key(["a", "enter"], () => {
            // TODO: Add stock to watchlist
            if (this.currentScreen === 0) {
                // Show placeholder message
                this.stockScreen.setContent(this.stockScreen.getContent() + "\n[ADD STOCK - Not implemented yet]");
                this.screen.render();
            }
        });

        this.screen.key(["d", "backspace"], () => {
            // TODO: Delete selected stock
            if (this.currentScreen === 0) {
                // Show placeholder message
                this.stockScreen.setContent(this.stockScreen.getContent() + "\n[DELETE STOCK - Not implemented yet]");
                this.screen.render();
            }
        });

        this.screen.key(["r"], () => {
            // TODO: Refresh all data
            const currentScreenRef = this.currentScreen === 0 ? this.stockScreen : this.newsScreen;
            currentScreenRef.setContent(currentScreenRef.getContent() + "\n[REFRESH - Not implemented yet]");
            this.screen.render();
        });
    }
}

# Implementation Plan

## Project Overview
A TUI-based stock monitoring terminal that uses Perplexity AI for intelligent news analysis of user-selected stocks.

## Tech Stack
- **Runtime**: Bun
- **Language**: Typescript
- **TUI**: blessed.js
- **Database**: SQLite
- **APIs**: Perplexity AI, Alpha Vantage (free tier)

## Hour-by-Hour Implementation Plan

### 1
- [x] Basic TUI layout with blessed.js (single screen)
- [x] Watchlist CRUD operations (add/remove stocks)

### 2
- [x] Alpha Vantage API integration for stock prices
- [x] Stock price display in TUI with color coding
- [x] Real-time price updates with API validation
- [x] Interactive stock charts with blessed-contrib
- [x] Multiple time ranges (1d, 1m, 3m, 1y, 5y)
- [x] Chart updates based on watchlist selection

### 3
- [ ] Automated Perplexity queries for watchlist stocks
- [ ] Parse and store news summaries in SQLite
- [ ] Display news analysis in TUI
- [ ] Implement 30-minute refresh cycle
- [ ] Add sentiment color coding (green/red)

### 4
- [ ] Keyboard shortcuts and navigation
- [ ] Error handling and loading states
- [ ] Auto-refresh functionality
- [ ] Clean up UI styling
- [ ] Add sample data for demo
- [ ] Test full workflow

## Key Features to Implement

### Core Functionality
1. **Dynamic Watchlist Management**
   - Add stocks by ticker symbol
   - Remove stocks from watchlist
   - Persist watchlist in SQLite

2. **Stock Price Display**
   - Current price, change, % change
   - Basic price history (daily)
   - Color coding (green/red for gains/losses)

3. **AI-Powered News Analysis**
   - Perplexity queries: "Latest financial news and market sentiment for [TICKER] stock today. Include any significant developments, analyst opinions, and overall bullish/bearish sentiment."
   - Sentiment classification (Bullish/Bearish/Neutral)
   - News summary caching to avoid API limits

4. **TUI Interface**
   - Single stock watchlist screen with real-time price display
   - Add/remove functionality with API validation

### Keyboard Shortcuts
- `a`, `Enter` - Add stock to watchlist
- `d`, `Backspace` - Delete selected stock
- `r` - Refresh stock prices
- `1-5` - Change chart time range (1d, 1m, 3m, 1y, 5y)
- `q`, `ctrl+c` - Quit application
- `↑/↓`, `k/j` - Navigate watchlist

## API Configuration

### Environment Variables
```bash
# .env
PERPLEXITY_API_KEY=your_perplexity_api_key
ALPHA_VANTAGE_API_KEY=your_alpha_vantage_key
REFRESH_INTERVAL=1800000  # 30 minutes in ms
```

### Perplexity Query Template
```javascript
const query = `Latest financial news and market sentiment for ${ticker} stock today. 
Include:
- Major news developments
- Analyst opinions or price targets
- Overall market sentiment (bullish/bearish/neutral)
- Any significant events affecting the stock
Please provide a concise summary with clear sentiment indication.`;
```

## Success Criteria
- [ ] User can add/remove stocks dynamically
- [ ] Stock prices display correctly
- [ ] Perplexity provides meaningful news summaries
- [ ] Sentiment analysis shows clear bullish/bearish signals
- [ ] TUI is responsive and intuitive
- [ ] Data persists between sessions

## Potential Issues & Solutions
- **API Rate Limits**: Cache aggressively, limit refresh frequency
- **TUI Complexity**: Start with basic layout, add features incrementally  
- **Perplexity Parsing**: Use consistent query format, handle edge cases
- **Stock Symbol Validation**: Basic validation, graceful error handling

## Extensions (if time permits)
- ASCII candlestick charts
- More detailed news filtering
- Alert system for significant sentiment changes
- Export watchlist functionality
- Basic portfolio tracking

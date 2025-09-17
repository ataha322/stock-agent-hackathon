# Stock Monitor TUI

AI-powered terminal-based stock monitoring application with real-time data and intelligent analysis.

## Features

- **Real-time stock tracking** with Alpha Vantage integration
- **AI-powered analysis** using Perplexity for news, events, and valuation insights
- **Interactive charts** with multiple time ranges (1m, 3m, 1y, 5y)
- **Financial events timeline** with chronological progression
- **Intelligent caching** (24hr) for optimal performance
- **Keyboard navigation** with vi-style controls

## Quick Start

### Prerequisites

- [Bun](https://bun.sh) runtime
- Alpha Vantage API key (free tier available)
- Perplexity API key

### Installation

```bash
# Clone repository
git clone <your-repo-url>
cd trading-agent-hackathon

# Install dependencies
bun install

# Setup environment
cp .env.example .env
# Edit .env with your API keys:
# ALPHA_VANTAGE_API_KEY=your_key_here
# PERPLEXITY_API_KEY=your_key_here

# Run application
bun run src/main.ts
```

## Usage

### Basic Navigation
- **a** - Add stock to watchlist
- **d** - Delete selected stock
- **j/k** - Navigate/scroll (vi-style)
- **Tab** - Switch between Chart and News views
- **r** - Refresh data
- **q** - Quit

### Focus Controls
- **s** - Focus stock list
- **n** - Focus recent news (news view only)
- **m** - Focus major events (news view only)  
- **v** - Focus valuation assessment (news view only)

### Chart View
- **1-4** - Change time range (1m/3m/1y/5y)
- Price charts with historical data
- Financial events timeline below chart

### News View
- Recent news (past 7 days)
- Major events (past 12 months)
- AI valuation assessment

## Architecture

- **Frontend**: blessed.js TUI framework
- **Backend**: Bun with TypeScript
- **Database**: SQLite for caching and watchlist storage
- **APIs**: Alpha Vantage (market data) + Perplexity AI (analysis)

## Key Technical Features

- **Async data loading** - News and events load independently
- **Race condition protection** - Prevents duplicate API calls
- **Smart caching** - 24hr cache with override capability
- **View-specific refresh** - Chart refreshes events, News refreshes analysis
- **Error resilience** - Graceful handling of API limits and failures

## API Rate Limits

- **Alpha Vantage**: 25 requests/day (free tier)
- **Perplexity**: Varies by plan
- Application uses intelligent caching to minimize API usage

## License

MIT License - see [LICENSE](./LICENSE) file for details.

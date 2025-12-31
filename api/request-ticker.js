import { supabase, jsonResponse, corsHeaders, detectMarket } from './_utils.js';

export const config = { runtime: 'edge' };

const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;

// Helper to delay execution
const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const ticker = (body.ticker || '').toUpperCase().trim();

        if (!ticker) {
            return jsonResponse({ error: 'Ticker required' }, 400);
        }

        const market = detectMarket(ticker);
        let stockData;

        if (market === 'IN') {
            // Call Python yfinance function for Indian stocks
            const url = new URL(request.url);
            const baseUrl = url.origin;

            const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${ticker}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || `Failed to fetch ${ticker}`);
            }
            stockData = await res.json();
        } else {
            // Fetch US stock from Alpha Vantage
            stockData = await fetchUSStock(ticker);
        }

        // Store in database
        await supabase
            .from('stock_data')
            .upsert(
                { ticker, data: stockData, last_updated: new Date().toISOString() },
                { onConflict: 'ticker' }
            );

        // Add to tickers if not exists
        await supabase
            .from('tickers')
            .upsert(
                { symbol: ticker, market },
                { onConflict: 'symbol' }
            );

        return jsonResponse({ success: true, ticker, market });
    } catch (error) {
        console.error('Request ticker error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}

async function fetchUSStock(ticker) {
    const baseUrl = 'https://www.alphavantage.co/query';

    console.log(`[US Stock] Fetching ${ticker}...`);

    const overview = await fetchWithDelay(
        `${baseUrl}?function=OVERVIEW&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`
    );

    await delay(1500);

    const quote = await fetchWithDelay(
        `${baseUrl}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`
    );

    await delay(1500);

    const income = await fetchWithDelay(
        `${baseUrl}?function=INCOME_STATEMENT&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`
    );

    await delay(1500);

    const balance_sheet = await fetchWithDelay(
        `${baseUrl}?function=BALANCE_SHEET&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`
    );

    await delay(1500);

    const history = await fetchWithDelay(
        `${baseUrl}?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`
    );

    if (overview.Note || quote.Note) {
        throw new Error('Alpha Vantage API limit reached');
    }

    return {
        overview: overview.Information ? {} : overview,
        quote,
        income: income.Information ? { annualReports: [] } : income,
        balance_sheet: balance_sheet.Information ? { annualReports: [] } : balance_sheet,
        history: history.Information ? { 'Monthly Adjusted Time Series': {} } : history,
        market: 'US',
        currency: 'USD',
        last_updated: new Date().toISOString()
    };
}

async function fetchWithDelay(url) {
    const res = await fetch(url);
    return res.json();
}

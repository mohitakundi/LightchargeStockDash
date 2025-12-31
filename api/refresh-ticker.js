import { supabase, jsonResponse, corsHeaders, detectMarket } from './_utils.js';

export const config = { runtime: 'edge' };

const ALPHA_VANTAGE_KEY = process.env.ALPHA_VANTAGE_KEY;
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

        // Check if ticker was already updated today (smart refresh)
        const { data: existing } = await supabase
            .from('stock_data')
            .select('last_updated')
            .eq('ticker', ticker)
            .single();

        if (existing) {
            const lastUpdated = new Date(existing.last_updated);
            const today = new Date();
            today.setHours(0, 0, 0, 0);

            if (lastUpdated >= today) {
                return jsonResponse({
                    message: `${ticker} is already up to date (last updated: ${lastUpdated.toLocaleString()})`,
                    skipped: true
                });
            }
        }

        // Fetch new data
        const market = detectMarket(ticker);
        let stockData;

        if (market === 'IN') {
            const url = new URL(request.url);
            const baseUrl = url.origin;
            const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${ticker}`);
            if (!res.ok) {
                const err = await res.json().catch(() => ({}));
                throw new Error(err.error || 'Failed to fetch Indian stock');
            }
            stockData = await res.json();
        } else {
            stockData = await fetchUSStock(ticker);
        }

        // Store in database
        await supabase
            .from('stock_data')
            .upsert(
                { ticker, data: stockData, last_updated: new Date().toISOString() },
                { onConflict: 'ticker' }
            );

        return jsonResponse({
            message: `${ticker} refreshed successfully!`,
            success: true
        });
    } catch (error) {
        console.error('Refresh error:', error);
        return jsonResponse({ error: error.message }, 500);
    }
}

async function fetchUSStock(ticker) {
    const baseUrl = 'https://www.alphavantage.co/query';

    const overview = await fetch(`${baseUrl}?function=OVERVIEW&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`).then(r => r.json());
    await delay(1500);
    const quote = await fetch(`${baseUrl}?function=GLOBAL_QUOTE&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`).then(r => r.json());
    await delay(1500);
    const income = await fetch(`${baseUrl}?function=INCOME_STATEMENT&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`).then(r => r.json());
    await delay(1500);
    const balance_sheet = await fetch(`${baseUrl}?function=BALANCE_SHEET&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`).then(r => r.json());
    await delay(1500);
    const history = await fetch(`${baseUrl}?function=TIME_SERIES_MONTHLY_ADJUSTED&symbol=${ticker}&apikey=${ALPHA_VANTAGE_KEY}`).then(r => r.json());

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

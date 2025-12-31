import { supabase, jsonResponse, corsHeaders, verifyAdmin, detectMarket } from './_utils.js';

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

    const authHeader = request.headers.get('authorization');
    if (!verifyAdmin(authHeader)) {
        return jsonResponse({ error: 'Unauthorized' }, 401);
    }

    try {
        const body = await request.json();
        const tickers = body.tickers || [];
        const refreshType = body.type || 'smart';

        if (!tickers.length) {
            return jsonResponse({ error: 'No tickers provided' }, 400);
        }

        const results = [];

        for (const ticker of tickers) {
            try {
                // For smart refresh, check if already updated today
                if (refreshType === 'smart') {
                    const { data: existing } = await supabase
                        .from('stock_data')
                        .select('last_updated')
                        .eq('ticker', ticker.toUpperCase())
                        .single();

                    if (existing) {
                        const lastUpdated = new Date(existing.last_updated);
                        const today = new Date();
                        today.setHours(0, 0, 0, 0);

                        if (lastUpdated >= today) {
                            results.push({ ticker, status: 'skipped', reason: 'Already up to date' });
                            continue;
                        }
                    }
                }

                const market = detectMarket(ticker);
                let stockData;

                if (market === 'IN') {
                    // Call Python function - use request URL origin
                    const url = new URL(request.url);
                    const baseUrl = url.origin;
                    const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${ticker}`);
                    if (!res.ok) {
                        const errData = await res.json().catch(() => ({}));
                        throw new Error(errData.error || 'Python function failed');
                    }
                    stockData = await res.json();
                } else {
                    stockData = await fetchUSStock(ticker);
                }

                await supabase
                    .from('stock_data')
                    .upsert(
                        { ticker: ticker.toUpperCase(), data: stockData, last_updated: new Date().toISOString() },
                        { onConflict: 'ticker' }
                    );

                results.push({ ticker, status: 'success' });
            } catch (err) {
                results.push({ ticker, status: 'error', error: err.message });
            }
        }

        return jsonResponse({ success: true, results });
    } catch (error) {
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

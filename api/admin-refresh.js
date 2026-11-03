import { supabase, jsonResponse, corsHeaders, verifyAdmin, detectMarket, fetchUSStockWithFallback, verifyStockData } from './_utils.js';

export const config = { runtime: 'edge' };

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
        const url = new URL(request.url);
        const baseUrl = url.origin;

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
                    const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${encodeURIComponent(ticker)}&market=IN`);
                    if (!res.ok) {
                        const errData = await res.json().catch(() => ({}));
                        throw new Error(errData.error || 'Python function failed');
                    }
                    stockData = await res.json();
                    verifyStockData(ticker, stockData);
                } else {
                    stockData = await fetchUSStockWithFallback(ticker, baseUrl);
                }

                const { error: saveErr } = await supabase
                    .from('stock_data')
                    .upsert(
                        { ticker: ticker.toUpperCase(), data: stockData, last_updated: new Date().toISOString() },
                        { onConflict: 'ticker' }
                    );

                if (saveErr) {
                    throw new Error(`Database error: ${saveErr.message}`);
                }

                results.push({ ticker, status: 'success' });
            } catch (err) {
                console.error(`Error refreshing ${ticker}:`, err);
                results.push({ ticker, status: 'error', error: err.message });
            }
        }

        return jsonResponse({ success: true, results });
    } catch (error) {
        return jsonResponse({ error: error.message }, 500);
    }
}

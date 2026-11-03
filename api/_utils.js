import { createClient } from '@supabase/supabase-js';

// Initialize Supabase client
const supabaseUrl = process.env.SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_KEY;

export const supabase = createClient(supabaseUrl, supabaseServiceKey, {
    auth: {
        autoRefreshToken: false,
        persistSession: false
    }
});

// CORS headers for all responses
export const corsHeaders = {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    'Access-Control-Allow-Methods': 'GET, POST, OPTIONS'
};

// Helper to create JSON response
export function jsonResponse(data, status = 200) {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            'Content-Type': 'application/json',
            ...corsHeaders
        }
    });
}

// Helper to verify admin password
export function verifyAdmin(authHeader) {
    if (!authHeader) return false;
    const adminPassword = process.env.ADMIN_PASSWORD;
    if (!adminPassword) return false;
    const token = authHeader.replace('Bearer ', '');
    return token === adminPassword;
}

// Detect market from ticker
export function detectMarket(ticker) {
    const t = ticker.toUpperCase();
    if (t.endsWith('.NS') || t.endsWith('.BO')) {
        return 'IN';
    }
    return 'US';
}

// Verification check: ensures stock data is complete and valid before writing to Supabase
export function verifyStockData(ticker, data) {
    if (!data || typeof data !== 'object') {
        throw new Error(`Data verification failed for ${ticker}: response is empty`);
    }
    const ov = data.overview;
    if (!ov || typeof ov !== 'object' || Object.keys(ov).length < 5 || (!ov.Name && !ov.Symbol)) {
        throw new Error(`Data verification failed for ${ticker}: company overview data is missing or incomplete`);
    }
    const q = data.quote && data.quote['Global Quote'];
    if (!q || !q['05. price']) {
        throw new Error(`Data verification failed for ${ticker}: price quote is missing`);
    }
    return true;
}

const delay = (ms) => new Promise(resolve => setTimeout(resolve, ms));

/**
 * Fetches US stock data with automatic fallback to yfinance for any missing/premium features.
 * Validates the result before returning so incomplete data never overwrites Supabase.
 */
export async function fetchUSStockWithFallback(ticker, baseUrl, apiKey = process.env.ALPHA_VANTAGE_KEY) {
    let alphaData = null;
    let yfinanceData = null;

    // Helper to fetch from internal yfinance Python endpoint
    async function getYFinanceData() {
        if (!yfinanceData) {
            try {
                const res = await fetch(`${baseUrl}/api/fetch-indian-stock?ticker=${encodeURIComponent(ticker)}&market=US`);
                if (res.ok) {
                    yfinanceData = await res.json();
                } else {
                    console.warn(`[yfinance fallback] Request returned status ${res.status} for ${ticker}`);
                }
            } catch (err) {
                console.warn(`[yfinance fallback] Request failed for ${ticker}:`, err.message);
            }
        }
        return yfinanceData;
    }

    // Try Alpha Vantage first if an API key is provided
    if (apiKey) {
        try {
            const avBase = 'https://www.alphavantage.co/query';
            const fetchAv = async (fn) => {
                const res = await fetch(`${avBase}?function=${fn}&symbol=${ticker}&apikey=${apiKey}`);
                return res.json().catch(() => null);
            };

            const overviewRes = await fetchAv('OVERVIEW');
            await delay(1200);
            const quoteRes = await fetchAv('GLOBAL_QUOTE');
            await delay(1200);
            const incomeRes = await fetchAv('INCOME_STATEMENT');
            await delay(1200);
            const balanceRes = await fetchAv('BALANCE_SHEET');
            await delay(1200);
            const cashflowRes = await fetchAv('CASH_FLOW');
            await delay(1200);
            const historyRes = await fetchAv('TIME_SERIES_MONTHLY_ADJUSTED');

            // Check if sections are valid
            const isOverviewValid = overviewRes && !overviewRes.Information && !overviewRes.Note && (overviewRes.Name || overviewRes.Symbol);
            const isQuoteValid = quoteRes && !quoteRes.Information && !quoteRes.Note && quoteRes['Global Quote'] && quoteRes['Global Quote']['05. price'];
            const isIncomeValid = incomeRes && !incomeRes.Information && !incomeRes.Note && Array.isArray(incomeRes.annualReports) && incomeRes.annualReports.length > 0;
            const isBalanceValid = balanceRes && !balanceRes.Information && !balanceRes.Note && Array.isArray(balanceRes.annualReports) && balanceRes.annualReports.length > 0;
            const isCashflowValid = cashflowRes && !cashflowRes.Information && !cashflowRes.Note && Array.isArray(cashflowRes.annualReports) && cashflowRes.annualReports.length > 0;
            const isHistoryValid = historyRes && !historyRes.Information && !historyRes.Note && historyRes['Monthly Adjusted Time Series'] && Object.keys(historyRes['Monthly Adjusted Time Series']).length > 0;

            // If ANY section failed or is premium-blocked, fetch yfinance fallback
            if (!isOverviewValid || !isQuoteValid || !isIncomeValid || !isBalanceValid || !isCashflowValid || !isHistoryValid) {
                console.log(`[Fallback] Alpha Vantage missing sections for ${ticker}. Fetching yfinance fallback...`);
                await getYFinanceData();
            }

            // Merge valid parts with yfinance fallback
            const overview = isOverviewValid ? overviewRes : (yfinanceData?.overview || {});
            const quote = isQuoteValid ? quoteRes : (yfinanceData?.quote || {});
            const income = isIncomeValid ? incomeRes : (yfinanceData?.income || { annualReports: [], quarterlyReports: [] });
            const balance_sheet = isBalanceValid ? balanceRes : (yfinanceData?.balance_sheet || { annualReports: [], quarterlyReports: [] });
            const cashflow = isCashflowValid ? cashflowRes : (yfinanceData?.cashflow || { annualReports: [], quarterlyReports: [] });
            const history = isHistoryValid ? historyRes : (yfinanceData?.history || { 'Monthly Adjusted Time Series': {} });
            const analyst_yf = yfinanceData?.analyst_yf || null;

            alphaData = {
                overview,
                quote,
                income,
                balance_sheet,
                cashflow,
                history,
                analyst_yf,
                market: 'US',
                currency: 'USD',
                last_updated: new Date().toISOString()
            };
        } catch (e) {
            console.error(`[AlphaVantage Exception for ${ticker}]:`, e.message);
            await getYFinanceData();
        }
    } else {
        await getYFinanceData();
    }

    const finalData = alphaData || yfinanceData;

    // Strict verification check before returning
    verifyStockData(ticker, finalData);

    return finalData;
}

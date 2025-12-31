import { supabase, jsonResponse, corsHeaders } from './_utils.js';
import { GoogleGenAI } from '@google/genai';

export const config = { runtime: 'edge' };

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

const AI_SYSTEM_PROMPT = `You are a stock analysis assistant for a financial dashboard. Your job is to:
1. Answer questions about the company - use your general knowledge for industry info, competitors, business model, history, etc.
2. For FINANCIAL METRICS (PE, price, revenue, EPS, etc.) - use ONLY the provided data
3. Suggest forward projections (Revenue Growth %, PAT Growth %, Target PE) when asked
4. Always provide Bull, Base, and Bear case scenarios for projections

IMPORTANT: When suggesting projections, USE THE ACTUAL STOCK DATA:
- Look at the current PE, Forward PE, and PEG ratio to guide Target PE suggestions
- Use historical revenue/earnings growth rates as a baseline
- Consider sector benchmarks (Tech stocks often trade at 25-50x PE, Consumer staples at 15-25x)
- High-growth stocks may warrant higher PE multiples (50-100x+)
- Value stocks may warrant lower PE (10-20x)

Target PE Guidelines based on growth:
- High growth (20%+ revenue growth): PE can be 40-100x
- Moderate growth (10-20% revenue growth): PE typically 20-40x
- Low growth (<10% revenue growth): PE typically 10-25x
- Loss-making but growing revenue: Use P/S multiples instead, avoid PE

For SIMPLE projections (same growth rate each year), respond with:
{
  "projections": {
    "bull": { "revenueGrowth": 15, "patGrowth": 18, "targetPE": 35 },
    "base": { "revenueGrowth": 10, "patGrowth": 12, "targetPE": 28 },
    "bear": { "revenueGrowth": 5, "patGrowth": 6, "targetPE": 22 }
  },
  "reasoning": "Brief explanation"
}

For YEAR-BY-YEAR projections (when user asks for detailed/complex/yearly projections), respond with:
{
  "projections": {
    "years": [
      { "year": 1, "revenue": { "bull": 20, "base": 15, "bear": 10 }, "pat": { "bull": 25, "base": 18, "bear": 12 } },
      { "year": 2, "revenue": { "bull": 18, "base": 14, "bear": 8 }, "pat": { "bull": 22, "base": 16, "bear": 10 } },
      { "year": 3, "revenue": { "bull": 15, "base": 12, "bear": 6 }, "pat": { "bull": 18, "base": 14, "bear": 8 } }
    ],
    "target_pe": { "bull": 35, "base": 28, "bear": 22 }
  },
  "reasoning": "Brief explanation of year-by-year assumptions"
}

Keywords that indicate year-by-year: "year by year", "yearly", "complex", "detailed projections", "each year", "per year".

For general questions, respond in markdown format with clear sections.`;

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
        const question = body.question || body.message || '';  // Accept both
        const history = body.history || [];

        if (!ticker || !question) {
            return jsonResponse({ error: 'Ticker and question required' }, 400);
        }

        // Get stock data for context
        const { data: stockRecord } = await supabase
            .from('stock_data')
            .select('data')
            .eq('ticker', ticker)
            .single();

        let stockContext = 'No stock data available.';
        if (stockRecord?.data) {
            const d = stockRecord.data;
            const ov = d.overview || {};
            const quote = d.quote?.['Global Quote'] || {};

            // Helper to format decimal as percentage
            const toPercent = (val) => {
                if (!val || val === 'None') return 'N/A';
                const num = parseFloat(val);
                if (isNaN(num)) return 'N/A';
                return `${(num * 100).toFixed(1)}%`;
            };

            stockContext = `
STOCK DATA FOR ${ticker}:
- Company: ${ov.Name || 'N/A'}
- Sector: ${ov.Sector || 'N/A'}
- Industry: ${ov.Industry || 'N/A'}
- Current Price: ${quote['05. price'] || 'N/A'}
- Trailing PE: ${ov.TrailingPE || ov.PERatio || 'N/A'}
- Forward PE: ${ov.ForwardPE || 'N/A'}
- PEG Ratio: ${ov.PEGRatio || 'N/A'}
- Market Cap: ${ov.MarketCapitalization || 'N/A'}
- Revenue TTM: ${ov.RevenueTTM || 'N/A'}
- EPS: ${ov.EPS || 'N/A'}
- EPS Growth (YoY): ${toPercent(ov.QuarterlyEarningsGrowthYOY)}
- Revenue Growth (YoY): ${toPercent(ov.QuarterlyRevenueGrowthYOY)}
- Profit Margin: ${toPercent(ov.ProfitMargin)}
- ROE: ${toPercent(ov.ReturnOnEquityTTM)}
- 52W High: ${ov['52WeekHigh'] || 'N/A'}
- 52W Low: ${ov['52WeekLow'] || 'N/A'}
- Analyst Target: ${ov.AnalystTargetPrice || 'N/A'}


USE THESE METRICS to suggest appropriate projections. If current PE is 80+, target PE should reflect this (e.g., 60-100 range). If PE is 15, target PE should be in 12-25 range.
`;
        }

        const prompt = `${AI_SYSTEM_PROMPT}

${stockContext}

USER QUESTION: ${question}`;

        // Use the new @google/genai SDK with gemma-3-27b-it model
        const response = await ai.models.generateContent({
            model: 'gemma-3-27b-it',
            contents: prompt
        });

        let responseText = response.text || '';

        // Try to parse as JSON for projections
        let projections = null;
        try {
            if (responseText.includes('"projections"')) {
                const jsonMatch = responseText.match(/\{[\s\S]*"projections"[\s\S]*\}/);
                if (jsonMatch) {
                    projections = JSON.parse(jsonMatch[0]);
                }
            }
        } catch (e) {
            // Not JSON, that's fine
        }

        return jsonResponse({
            response: responseText,
            projections: projections?.projections || null
        });
    } catch (error) {
        console.error('AI chat error:', error);
        return jsonResponse({ error: `AI error: ${error.message}` }, 500);
    }
}

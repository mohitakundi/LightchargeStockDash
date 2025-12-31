import { supabase, jsonResponse, corsHeaders } from './_utils.js';
import { GoogleGenAI } from '@google/genai';

export const config = { runtime: 'edge' };

const ai = new GoogleGenAI({ apiKey: process.env.GEMINI_API_KEY });

export default async function handler(request) {
    if (request.method === 'OPTIONS') {
        return new Response(null, { status: 204, headers: corsHeaders });
    }

    if (request.method !== 'POST') {
        return jsonResponse({ error: 'Method not allowed' }, 405);
    }

    try {
        const body = await request.json();
        const tickers = body.tickers || [];
        const question = body.question || 'Which stock should I invest in?';

        if (!tickers || tickers.length < 2) {
            return jsonResponse({ error: 'At least 2 tickers required' }, 400);
        }

        // Get stock data for all tickers
        const { data: stockRecords } = await supabase
            .from('stock_data')
            .select('ticker, data')
            .in('ticker', tickers);

        if (!stockRecords || stockRecords.length < 2) {
            return jsonResponse({ error: 'Could not fetch data for comparison' }, 404);
        }

        // Build comparison context
        let stocksContext = 'STOCKS TO COMPARE:\n\n';
        for (const record of stockRecords) {
            const d = record.data;
            const ov = d?.overview || {};
            const quote = d?.quote?.['Global Quote'] || {};

            stocksContext += `--- ${record.ticker} ---
Company: ${ov.Name || 'N/A'}
Sector: ${ov.Sector || 'N/A'}
Industry: ${ov.Industry || 'N/A'}
Current Price: ${quote['05. price'] || 'N/A'}
PE Ratio: ${ov.PERatio || ov.TrailingPE || 'N/A'}
Forward PE: ${ov.ForwardPE || 'N/A'}
Market Cap: ${ov.MarketCapitalization || 'N/A'}
Revenue TTM: ${ov.RevenueTTM || 'N/A'}
EPS: ${ov.EPS || 'N/A'}
Profit Margin: ${ov.ProfitMargin || 'N/A'}
Revenue Growth: ${ov.QuarterlyRevenueGrowthYOY || 'N/A'}
52W High: ${ov['52WeekHigh'] || 'N/A'}
52W Low: ${ov['52WeekLow'] || 'N/A'}

`;
        }

        const prompt = `You are a stock analysis assistant helping compare multiple stocks.

${stocksContext}

USER QUESTION: ${question}

Provide a detailed comparison addressing the user's question. Use markdown formatting with headers, bullet points, and bold text for key insights. Be specific about which stock is better for what use case.`;

        // Use the new @google/genai SDK with gemma-3-27b-it model
        const response = await ai.models.generateContent({
            model: 'gemma-3-27b-it',
            contents: prompt
        });

        let responseText = response.text || '';

        return jsonResponse({
            response: responseText,
            tickers: tickers
        });
    } catch (error) {
        console.error('AI compare error:', error);
        return jsonResponse({ error: `AI error: ${error.message}` }, 500);
    }
}

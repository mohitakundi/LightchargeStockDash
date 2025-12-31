import { supabase, jsonResponse, corsHeaders } from './_utils.js';
import { GoogleGenerativeAI } from '@google/generative-ai';

export const config = { runtime: 'edge' };

const genAI = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const AI_SYSTEM_PROMPT = `You are a stock analysis assistant for a financial dashboard. Your job is to:
1. Answer questions about the company - use your general knowledge for industry info, competitors, business model, history, etc.
2. For FINANCIAL METRICS (PE, price, revenue, EPS, etc.) - use ONLY the provided data
3. Suggest forward projections (Revenue Growth %, PAT Growth %, Target PE) when asked
4. Always provide Bull, Base, and Bear case scenarios for projections

When asked for projections, respond with ONLY valid JSON in this exact format:
{
  "projections": {
    "bull": { "revenueGrowth": 15, "patGrowth": 18, "targetPE": 35 },
    "base": { "revenueGrowth": 10, "patGrowth": 12, "targetPE": 28 },
    "bear": { "revenueGrowth": 5, "patGrowth": 6, "targetPE": 22 }
  },
  "reasoning": "Brief explanation of your projections"
}

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
        const question = body.question || '';
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

            stockContext = `
STOCK DATA FOR ${ticker}:
- Company: ${ov.Name || 'N/A'}
- Sector: ${ov.Sector || 'N/A'}
- Industry: ${ov.Industry || 'N/A'}
- Current Price: ${quote['05. price'] || 'N/A'}
- PE Ratio: ${ov.PERatio || ov.TrailingPE || 'N/A'}
- Market Cap: ${ov.MarketCapitalization || 'N/A'}
- Revenue TTM: ${ov.RevenueTTM || 'N/A'}
- EPS: ${ov.EPS || 'N/A'}
- Profit Margin: ${ov.ProfitMargin || 'N/A'}
- 52W High: ${ov['52WeekHigh'] || 'N/A'}
- 52W Low: ${ov['52WeekLow'] || 'N/A'}
`;
        }

        const prompt = `${AI_SYSTEM_PROMPT}

${stockContext}

USER QUESTION: ${question}`;

        const model = genAI.getGenerativeModel({ model: 'gemini-pro' });

        // Build chat history
        const chatHistory = history.map(msg => ({
            role: msg.role === 'assistant' ? 'model' : 'user',
            parts: [{ text: msg.content }]
        }));

        const chat = model.startChat({ history: chatHistory });
        const result = await chat.sendMessage(prompt);
        const response = await result.response;
        let responseText = response.text().trim();

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

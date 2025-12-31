from http.server import BaseHTTPRequestHandler
import json
import os
from datetime import datetime

class handler(BaseHTTPRequestHandler):
    def do_GET(self):
        """Daily refresh endpoint - updates prices and chart data for all stocks."""
        try:
            import yfinance as yf
            from supabase import create_client
            
            # Initialize Supabase inside handler
            supabase_url = os.environ.get('SUPABASE_URL', '')
            supabase_key = os.environ.get('SUPABASE_SERVICE_KEY', os.environ.get('SUPABASE_KEY', ''))
            
            if not supabase_url or not supabase_key:
                return self.send_json({'error': 'Supabase credentials not configured'}, 500)
            
            supabase = create_client(supabase_url, supabase_key)
            
            # Get all tickers from database
            result = supabase.table('stock_data').select('ticker, data').execute()
            stocks = result.data if result.data else []
            
            if not stocks:
                return self.send_json({'message': 'No stocks to update', 'updated': 0})
            
            updated = []
            errors = []
            today = datetime.now().strftime('%Y-%m-%d')
            
            for stock in stocks:
                ticker = stock['ticker']
                existing_data = stock['data']
                
                try:
                    # Encode special characters for yfinance (e.g., M&M.NS -> M%26M.NS)
                    yf_ticker_symbol = ticker.replace('&', '%26')
                    
                    # Fetch latest data from yfinance
                    yf_ticker = yf.Ticker(yf_ticker_symbol)
                    info = yf_ticker.info
                    
                    # Get current price
                    current_price = info.get('currentPrice') or info.get('regularMarketPrice')
                    if not current_price:
                        errors.append(f"{ticker}: No price data")
                        continue
                    
                    # Get today's OHLC for chart
                    hist = yf_ticker.history(period='5d')  # Last 5 days to ensure we get latest
                    if hist.empty:
                        errors.append(f"{ticker}: No history data")
                        continue
                    
                    latest = hist.iloc[-1]
                    latest_date = hist.index[-1].strftime('%Y-%m-%d')
                    
                    # Update quote price
                    if 'quote' not in existing_data:
                        existing_data['quote'] = {'Global Quote': {}}
                    existing_data['quote']['Global Quote']['05. price'] = str(current_price)
                    existing_data['quote']['Global Quote']['08. previous close'] = str(info.get('previousClose', current_price))
                    
                    # Update chart history
                    history_key = 'Monthly Adjusted Time Series'
                    if 'history' not in existing_data:
                        existing_data['history'] = {history_key: {}}
                    
                    if history_key not in existing_data['history']:
                        existing_data['history'][history_key] = {}
                    
                    # Add/update today's data point
                    existing_data['history'][history_key][latest_date] = {
                        '1. open': str(latest.get('Open', current_price)),
                        '2. high': str(latest.get('High', current_price)),
                        '3. low': str(latest.get('Low', current_price)),
                        '4. close': str(latest.get('Close', current_price)),
                        '5. adjusted close': str(latest.get('Close', current_price)),
                        '6. volume': str(int(latest.get('Volume', 0))),
                    }
                    
                    # Update last_updated timestamp
                    existing_data['last_updated'] = datetime.now().isoformat()
                    
                    # Save to Supabase (only update the data column)
                    supabase.table('stock_data').update({
                        'data': existing_data
                    }).eq('ticker', ticker).execute()
                    
                    updated.append({
                        'ticker': ticker,
                        'price': current_price,
                        'date': latest_date
                    })
                    
                except Exception as e:
                    errors.append(f"{ticker}: {str(e)}")
            
            return self.send_json({
                'message': f'Daily refresh complete',
                'updated': len(updated),
                'stocks': updated,
                'errors': errors,
                'timestamp': datetime.now().isoformat()
            })
            
        except Exception as e:
            return self.send_json({'error': str(e)}, 500)
    
    def do_OPTIONS(self):
        self.send_response(204)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()
    
    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

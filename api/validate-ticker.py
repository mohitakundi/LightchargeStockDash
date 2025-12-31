"""
Python API route to validate if a stock ticker exists using yfinance.
Returns basic info (name, price) if valid, or error if not found.
Used before Alpha Vantage calls to avoid wasting API quota.
"""
from http.server import BaseHTTPRequestHandler
import json
import yfinance as yf
from urllib.parse import parse_qs, urlparse


class handler(BaseHTTPRequestHandler):
    def do_OPTIONS(self):
        self.send_response(200)
        self.send_header('Access-Control-Allow-Origin', '*')
        self.send_header('Access-Control-Allow-Methods', 'GET, POST, OPTIONS')
        self.send_header('Access-Control-Allow-Headers', 'Content-Type')
        self.end_headers()

    def do_GET(self):
        try:
            query = parse_qs(urlparse(self.path).query)
            ticker = query.get('ticker', [''])[0].upper().strip()
            
            if not ticker:
                self.send_json({'valid': False, 'error': 'Ticker required'}, 400)
                return
            
            print(f"[validate] Checking if {ticker} exists...")
            stock = yf.Ticker(ticker)
            info = stock.info
            
            # Check if we got valid data with an actual price
            price = info.get('regularMarketPrice') or info.get('currentPrice')
            if not info or not price or price == 0:
                # yfinance returns empty info or 0 price for invalid tickers
                self.send_json({
                    'valid': False, 
                    'error': f'Ticker "{ticker}" not found or has no price data'
                })
                return
            
            # Return basic validation info
            self.send_json({
                'valid': True,
                'ticker': ticker,
                'name': info.get('longName') or info.get('shortName') or ticker,
                'price': info.get('regularMarketPrice') or info.get('currentPrice'),
                'currency': info.get('currency', 'USD'),
                'exchange': info.get('exchange', 'Unknown')
            })
            
        except Exception as e:
            print(f"[validate] Error: {str(e)}")
            self.send_json({'valid': False, 'error': str(e)}, 500)

    def send_json(self, data, status=200):
        self.send_response(status)
        self.send_header('Content-Type', 'application/json')
        self.send_header('Access-Control-Allow-Origin', '*')
        self.end_headers()
        self.wfile.write(json.dumps(data).encode())

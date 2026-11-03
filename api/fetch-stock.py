"""
Universal Python API route for fetching stock data (US and Indian) using yfinance.
"""
from http.server import BaseHTTPRequestHandler
import sys
import os

# Import handler from fetch-indian-stock
sys.path.append(os.path.dirname(__file__))
from importlib import import_module
fetch_module = import_module('fetch-indian-stock')
handler = fetch_module.handler

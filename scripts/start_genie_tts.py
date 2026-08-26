"""
Start the Genie-TTS API server for OpenGal.

Usage:
  pip install genie-tts
  python scripts/start_genie_tts.py [--port 9880]

The server will be available at http://127.0.0.1:9880
"""

import sys
import os
import argparse

GENIE_SRC = os.path.join(os.path.dirname(__file__), '..', 'ref', '文本转语音方案', 'Genie-TTS-master', 'src')
sys.path.insert(0, os.path.abspath(GENIE_SRC))

import genie_tts as genie
from genie_tts.Server import app

import uvicorn

if __name__ == '__main__':
    parser = argparse.ArgumentParser(description='Start Genie-TTS API server')
    parser.add_argument('--host', default='127.0.0.1')
    parser.add_argument('--port', type=int, default=9880)
    args = parser.parse_args()

    print(f"Starting Genie-TTS server on http://{args.host}:{args.port}")
    uvicorn.run(app, host=args.host, port=args.port, workers=1)

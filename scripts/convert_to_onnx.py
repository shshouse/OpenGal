"""
Convert GPT-SoVITS PyTorch models to Genie-TTS ONNX format.

Usage:
  pip install genie-tts torch
  python scripts/convert_to_onnx.py

By default converts the models in mods/Role/neuro/voice/gpt-sovits/.
Output goes to mods/Role/neuro/voice/genie-onnx/.
"""

import sys
import os

# Add Genie-TTS source to path
GENIE_SRC = os.path.join(os.path.dirname(__file__), '..', 'ref', 'Genie-TTS-master', 'src')
sys.path.insert(0, os.path.abspath(GENIE_SRC))

import genie_tts as genie

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..'))
VOICE_DIR = os.path.join(PROJECT_ROOT, 'mods', 'Role', 'neuro', 'voice', 'gpt-sovits')
OUTPUT_DIR = os.path.join(PROJECT_ROOT, 'mods', 'Role', 'neuro', 'voice', 'genie-onnx')

PTH_PATH = os.path.join(VOICE_DIR, 'SoVITS', 'Neuro_e8_s7056.pth')
CKPT_PATH = os.path.join(VOICE_DIR, 'GPT', 'Neuro-e24.ckpt')

if __name__ == '__main__':
    for p in [PTH_PATH, CKPT_PATH]:
        if not os.path.isfile(p):
            print(f"ERROR: Model file not found: {p}")
            sys.exit(1)

    os.makedirs(OUTPUT_DIR, exist_ok=True)

    print(f"Converting models to ONNX...")
    print(f"  .pth  : {PTH_PATH}")
    print(f"  .ckpt : {CKPT_PATH}")
    print(f"  output: {OUTPUT_DIR}")

    genie.convert_to_onnx(
        torch_pth_path=PTH_PATH,
        torch_ckpt_path=CKPT_PATH,
        output_dir=OUTPUT_DIR,
    )

    print(f"\nConversion complete! ONNX models saved to:\n  {OUTPUT_DIR}")

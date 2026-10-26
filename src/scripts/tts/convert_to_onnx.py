"""把 GPT-SoVITS 的 PyTorch 权重转成 Genie-TTS 需要的 ONNX。

用法：
  python src/scripts/tts/convert_to_onnx.py --role neuro
  python src/scripts/tts/convert_to_onnx.py --role neuro --gpt Neuro-e8.ckpt --sovits Neuro_e8_s7056.pth

默认读取 <mods>/Role/<role>/voice/gpt-sovits/，输出到 <mods>/Role/<role>/voice/genie-onnx/。
依赖：pip install genie-tts torch
"""

import argparse
import os
import sys

PROJECT_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), '..', '..', '..'))
DEFAULT_MOD_ROOT = os.path.join(PROJECT_ROOT, 'mods')
GENIE_DATA_CANDIDATES = [
    os.path.join(DEFAULT_MOD_ROOT, 'TTS', 'genie', 'GenieData'),
    os.path.join(DEFAULT_MOD_ROOT, 'TTS', 'Genie-TTS GUI', 'GenieData'),
]


def resolve_genie_data() -> str:
    for candidate in GENIE_DATA_CANDIDATES:
        if os.path.isdir(candidate):
            return candidate
    return ''


def main() -> int:
    parser = argparse.ArgumentParser(description='Convert GPT-SoVITS weights to Genie-TTS ONNX')
    parser.add_argument('--role', default='neuro', help='角色包目录名，默认 neuro')
    parser.add_argument('--mod-root', default=os.environ.get('OPENGAL_MOD_ROOT', DEFAULT_MOD_ROOT))
    parser.add_argument('--gpt', default='Neuro-e24.ckpt', help='GPT 权重文件名（相对 GPT/）')
    parser.add_argument('--sovits', default='Neuro_e8_s7056.pth', help='SoVITS 权重文件名（相对 SoVITS/）')
    parser.add_argument('--output', default='', help='输出目录，默认 voice/genie-onnx')
    args = parser.parse_args()

    genie_data = resolve_genie_data()
    if not genie_data:
        print('ERROR: 未找到 GenieData，请先放置 mods/TTS/genie/GenieData')
        return 1
    os.environ.setdefault('GENIE_DATA_DIR', genie_data)

    import genie_tts as genie

    voice_dir = os.path.join(args.mod_root, 'Role', args.role, 'voice', 'gpt-sovits')
    output_dir = args.output or os.path.join(args.mod_root, 'Role', args.role, 'voice', 'genie-onnx')
    pth_path = os.path.join(voice_dir, 'SoVITS', args.sovits)
    ckpt_path = os.path.join(voice_dir, 'GPT', args.gpt)

    for path in (pth_path, ckpt_path):
        if not os.path.isfile(path):
            print(f'ERROR: 权重不存在: {path}')
            return 1

    os.makedirs(output_dir, exist_ok=True)
    print(f'GENIE_DATA_DIR : {genie_data}')
    print(f'  .pth   : {pth_path} ({os.path.getsize(pth_path) / 1048576:.1f} MB)')
    print(f'  .ckpt  : {ckpt_path} ({os.path.getsize(ckpt_path) / 1048576:.1f} MB)')
    print(f'  output : {output_dir}')

    genie.convert_to_onnx(torch_ckpt_path=ckpt_path, torch_pth_path=pth_path, output_dir=output_dir)

    print('转换完成，产物:', sorted(os.listdir(output_dir)))
    return 0


if __name__ == '__main__':
    sys.exit(main())

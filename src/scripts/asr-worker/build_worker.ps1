param(
    [string]$Python = "py -3.12"
)
$ErrorActionPreference = "Stop"
$repo = Split-Path -Parent (Split-Path -Parent (Split-Path -Parent $PSScriptRoot))
$pyCmd = $Python.Split(" ")
$pyExe = $pyCmd[0]
$pyArgs = @()
if ($pyCmd.Length -gt 1) { $pyArgs = $pyCmd[1..($pyCmd.Length - 1)] }

# contrib hooks 会顺带收集环境里已装的 torch/pandas 等无关大件；worker 只依赖 sherpa_onnx + numpy
$excludeArgs = @()
foreach ($m in @(
    "torch", "torchvision", "transformers", "sudachidict_core", "hf_xet",
    "nltk", "sklearn", "pandas", "matplotlib", "scipy"
)) {
    $excludeArgs += "--exclude-module"
    $excludeArgs += $m
}

Push-Location $repo
try {
    & $pyExe @($pyArgs + @("-m", "pip", "install", "pyinstaller"))
    if ($LASTEXITCODE -ne 0) { throw "pip install pyinstaller failed" }

    & $pyExe @($pyArgs + @(
        "-m", "PyInstaller",
        "--noconfirm", "--clean", "--onedir", "--name", "ASRWorker2",
        "--collect-all", "sherpa_onnx",
        "--collect-all", "onnxruntime"
    ) + $excludeArgs + @("src/main/services/asr/sherpa_worker.py"))
    if ($LASTEXITCODE -ne 0) { throw "pyinstaller failed" }

    $dest = Join-Path $repo "mods/STT/ASRWorker2"
    if (Test-Path $dest) { Remove-Item -Recurse -Force $dest }
    Copy-Item -Recurse (Join-Path $repo "dist/ASRWorker2") $dest
    Write-Host "done: $dest"
} finally {
    Pop-Location
}

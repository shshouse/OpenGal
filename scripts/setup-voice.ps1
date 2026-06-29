$ErrorActionPreference = 'Stop'
$root = Resolve-Path (Join-Path $PSScriptRoot '..')
$src = Join-Path $root 'mod\role-card\neuro\Neuro-V2'
$base = Join-Path $root 'mod\role-card\neuro\voice\gpt-sovits'

New-Item -ItemType Directory -Force -Path (Join-Path $base 'GPT') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $base 'SoVITS') | Out-Null
New-Item -ItemType Directory -Force -Path (Join-Path $base 'reference') | Out-Null

$copies = @(
  @{ From = Join-Path $src 'GPT\Neuro-e24.ckpt'; To = Join-Path $base 'GPT\Neuro-e24.ckpt' },
  @{ From = Join-Path $src 'GPT\Neuro-e16.ckpt'; To = Join-Path $base 'GPT\Neuro-e16.ckpt' },
  @{ From = Join-Path $src 'SoVITS\Neuro_e8_s7056.pth'; To = Join-Path $base 'SoVITS\Neuro_e8_s7056.pth' },
  @{ From = Join-Path $src 'SoVITS\Neuro_e12_s10584.pth'; To = Join-Path $base 'SoVITS\Neuro_e12_s10584.pth' }
)

foreach ($c in $copies) {
  if (Test-Path $c.To) {
    Write-Host "[skip] $($c.To) already exists"
  } else {
    Write-Host "[copy] $($c.From) -> $($c.To)"
    Copy-Item $c.From $c.To -Force
  }
}

Get-ChildItem -Recurse $base | Format-Table Mode, Length, FullName

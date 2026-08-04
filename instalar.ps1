param(
  [switch]$Uninstall
)

$ErrorActionPreference = 'Stop'
$source = Split-Path -Parent $MyInvocation.MyCommand.Path
$extensionsRoot = Join-Path $env:APPDATA 'Adobe\CEP\extensions'
$destination = Join-Path $extensionsRoot 'com.iksnicor.subtitulador'

if ($Uninstall) {
  if (Test-Path -LiteralPath $destination) {
    Remove-Item -LiteralPath $destination -Recurse -Force
    Write-Host "Extensión eliminada de $destination"
  }
  exit 0
}

New-Item -ItemType Directory -Path $extensionsRoot -Force | Out-Null
New-Item -ItemType Directory -Path $destination -Force | Out-Null

Get-ChildItem -LiteralPath $source -Force |
  Where-Object { $_.Name -notin @(
    '.git', '.gitignore', 'test', 'instalar.ps1',
    'INSTALAR.cmd', 'DESINSTALAR.cmd', 'LICENSE', 'README.md'
  ) } |
  Copy-Item -Destination $destination -Recurse -Force

$debugRoots = @('CSXS.11', 'CSXS.12')
foreach ($debugRoot in $debugRoots) {
  $registryPath = "HKCU:\Software\Adobe\$debugRoot"
  New-Item -Path $registryPath -Force | Out-Null
  New-ItemProperty -Path $registryPath -Name 'PlayerDebugMode' -Value '1' -PropertyType String -Force | Out-Null
}

Write-Host "Extensión instalada en $destination"
Write-Host 'Reiniciá Premiere Pro y abrí Ventana > Extensiones (heredado) > Subtitulador.'

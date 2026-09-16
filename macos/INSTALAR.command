#!/bin/bash
set -euo pipefail
SCRIPT_DIR="$(cd -- "$(dirname -- "$0")" && pwd -P)"
if /bin/bash "$SCRIPT_DIR/instalar-macos.sh"; then
  printf '\nPodés cerrar esta ventana y abrir Premiere.\n'
else
  printf '\nLa instalación no terminó. Enviá a Nico el mensaje de esta ventana.\n'
  if [ -t 0 ]; then read -r -p 'Presioná Enter para cerrar.' ignored; fi
  exit 1
fi
if [ -t 0 ]; then read -r -p 'Presioná Enter para cerrar.' ignored; fi

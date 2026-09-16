#!/bin/bash
# Compatible con /bin/bash 3.2 incluido en macOS. Sin sudo ni descargas.
set -euo pipefail
fail() { printf 'ERROR: %s\n' "$*" >&2; exit 1; }

[ "$(/usr/bin/uname -s)" = "Darwin" ] || fail 'Este instalador es para macOS.'
[ -n "${HOME:-}" ] && [ "$HOME" != '/' ] && [ -d "$HOME" ] || fail 'No se pudo localizar tu carpeta de usuario.'
[ "$(id -u)" -ne 0 ] || fail 'Abrí INSTALAR.command con tu usuario, sin sudo.'
case "${1:-}" in ''|--uninstall) ;; *) fail 'Argumento desconocido.' ;; esac
if /usr/bin/pgrep -f '/Adobe Premiere Pro[^/]*/Contents/MacOS/Adobe Premiere Pro' >/dev/null; then
  fail 'Cerrá Premiere Pro por completo (Premiere Pro > Salir) y volvé a ejecutar el instalador.'
fi

SOURCE="$(cd -- "$(dirname -- "$0")" && pwd -P)"
EXTENSIONS_ROOT="$HOME/Library/Application Support/Adobe/CEP/extensions"
DATA_ROOT="$HOME/Library/Application Support/La Subtituleta"
EXTENSION_ID='com.iksnicor.lasubtituleta'
TARGET="$EXTENSIONS_ROOT/$EXTENSION_ID"
BACKUP=''
STAGE=''
FINISHED=0

# No seguir enlaces al sustituir una instalación anterior.
[ ! -L "$TARGET" ] || fail 'La extensión instalada es un enlace simbólico. Enviá este mensaje a Nico.'
if [ "${1:-}" = '--uninstall' ]; then
  if [ ! -e "$TARGET" ]; then printf 'La Subtituleta no está instalada para este usuario.\n'; exit 0; fi
  [ -f "$TARGET/CSXS/manifest.xml" ] || fail 'La carpeta existente no parece una instalación de LS.'
  mkdir -p "$DATA_ROOT/installation-backups"
  BACKUP="$(mktemp -d "$DATA_ROOT/installation-backups/uninstalled-XXXXXX")"
  mv "$TARGET" "$BACKUP/extension"
  printf 'La Subtituleta fue desinstalada.\nClaves y memoria conservadas.\nCopia recuperable: %s\n' "$BACKUP"
  exit 0
fi

for item in index.html CSXS/manifest.xml css/styles.css js/platform.js js/bridge.js js/http.js js/main.js js/library.js js/providers.js js/transcript.js jsx/host.jsx 'presets/La Subtituleta Audio MP3 128kbps.epr'; do
  [ -f "$SOURCE/$item" ] || fail "Falta $item. Descomprimí todo el ZIP y volvé a intentar."
done
mkdir -p "$EXTENSIONS_ROOT" "$DATA_ROOT/installation-backups"
chmod 700 "$DATA_ROOT"
EXTENSIONS_ROOT="$(cd -- "$EXTENSIONS_ROOT" && pwd -P)"
TARGET="$EXTENSIONS_ROOT/$EXTENSION_ID"
[ ! -L "$TARGET" ] || fail 'La extensión instalada es un enlace simbólico.'
STAGE="$(mktemp -d "$EXTENSIONS_ROOT/.la-subtituleta-install-XXXXXX")"

on_exit() {
  status=$?
  if [ "$FINISHED" -ne 1 ]; then
    printf '\nInstalación interrumpida.\n' >&2
    if [ -n "$BACKUP" ] && [ -d "$BACKUP/extension" ] && [ ! -e "$TARGET" ]; then
      mv "$BACKUP/extension" "$TARGET" || true
      printf 'Se intentó restaurar la versión anterior.\n' >&2
    fi
    [ -z "$STAGE" ] || printf 'Carpeta de diagnóstico: %s\n' "$STAGE" >&2
  fi
  return "$status"
}
trap on_exit EXIT
for item in index.html css CSXS js jsx presets; do cp -R "$SOURCE/$item" "$STAGE/$item"; done
chmod -R u+rwX,go+rX "$STAGE"

# CEP 11/12: permite cargar esta beta sin firma Adobe; no desactiva Gatekeeper.
# Estas preferencias son compartidas con otras extensiones CEP del usuario.
for version in 11 12; do
  /usr/bin/defaults write "com.adobe.CSXS.$version" PlayerDebugMode -string '1'
done
if [ -e "$TARGET" ]; then
  [ -f "$TARGET/CSXS/manifest.xml" ] || fail 'La carpeta existente no parece una instalación de LS.'
  BACKUP="$(mktemp -d "$DATA_ROOT/installation-backups/updated-XXXXXX")"
  mv "$TARGET" "$BACKUP/extension"
fi
mv "$STAGE" "$TARGET"
FINISHED=1
printf '\nLa Subtituleta 0.4.0 macOS beta.1 instalada.\nUbicación: %s\n' "$TARGET"
printf 'Abrí Premiere > Ventana > Extensiones (heredado) > La Subtituleta.\n'
printf 'Tus API keys y la memoria se conservan al reinstalar.\n'
[ -z "$BACKUP" ] || printf 'Copia de la versión anterior: %s\n' "$BACKUP"
exit 0

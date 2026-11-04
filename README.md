# La Subtituleta

Extensión gratuita para Adobe Premiere Pro que transcribe la secuencia activa con AssemblyAI, Speechmatics, Deepgram o ElevenLabs y crea una pista de subtítulos. Cada usuario utiliza su propia API key; el consumo depende de su cuenta en el proveedor.

## Descargar

- [Windows](https://github.com/IKSNicoR/la-subtituleta/releases/latest/download/La-Subtituleta-Windows.zip)
- [macOS](https://github.com/IKSNicoR/la-subtituleta/releases/latest/download/La-Subtituleta-macOS.zip)

Premiere Pro 2024 o posterior. La versión para macOS continúa validándose en Macs reales, tanto Intel como Apple Silicon.

## Novedades de la versión 0.6.5

- La pantalla de Configuración suma un acceso opcional a Cafecito para apoyar el desarrollo de LS.
- Los speakers ya no quedan arrastrados entre transcripciones: se pueden quitar y el formulario vuelve a una fila vacía después de cada trabajo.
- AssemblyAI decide la cantidad real de voces y conserva su nivel de confianza en el JSON.
- Las cifras y palabras dudosas de AssemblyAI quedan marcadas en el JSON para revisión, sin modificar el SRT.
- El largo visual de los captions se ajusta de forma conservadora según el formato de la secuencia: horizontal, 4:3, cuadrado o vertical.
- Reflow conserva todas las mejoras previas de sincronía, cortes del timeline y secuencias derivadas.

## Instalar en Windows

1. Descargá y descomprimí el ZIP de Windows.
2. Cerrá Premiere.
3. Hacé doble clic en `INSTALAR.cmd` y esperá a que termine.
4. Abrí Premiere → Ventana → Extensiones (heredado) → La Subtituleta.
5. Tocá el engranaje, pegá la API key de tu servicio y guardá.

Para actualizar, repetí la instalación con el nuevo paquete. Las claves y la biblioteca se conservan. Para desinstalar, cerrá Premiere y ejecutá `DESINSTALAR.cmd`.

## Instalar en macOS

1. Cerrá Premiere por completo con Cmd+Q.
2. Descargá y descomprimí el ZIP de macOS.
3. Abrí `INSTALAR.command` y esperá la confirmación en Terminal.
4. Abrí Premiere → Ventana → Extensiones (heredado) → La Subtituleta.
5. En Configuración, pegá tu API key y guardá.

Si macOS bloquea el instalador, seguí `INSTRUCCIONES-INSTALACION.txt` dentro del ZIP. No requiere contraseña de administrador. El paquete incluye una guía breve de pruebas y `DESINSTALAR.command`.

## Obtener una API key

- [AssemblyAI](https://dub.sh/ASSEMBLYAI_LS)
- [Speechmatics](https://dub.sh/Speech_LS)
- [Deepgram](https://dub.sh/DeepGram_LS)
- [ElevenLabs](https://dub.sh/ElevenLabs_LS)

Creá una cuenta en el servicio elegido y copiá su API key. Alcanza con una. Los créditos y condiciones gratuitos pueden cambiar: revisá el panel del proveedor. El audio se envía al servicio seleccionado. Las claves se guardan localmente en tu computadora; no las compartas.

## Uso

1. Activá la secuencia que querés transcribir.
2. Elegí modelo, idioma y formato de líneas.
3. Si necesitás identificar voces, activá **Reconocer speakers** y escribí los nombres en el orden en que hablan.
4. Pulsá **Transcribir** y elegí dónde guardar los archivos.
5. LS genera un SRT y un JSON con el nombre de la secuencia e importa los captions en Premiere.

El JSON conserva palabras, tiempos y metadata disponible del proveedor, además de referencias del montaje para reutilizar la transcripción. Los nombres de speakers quedan como metadata y no aparecen impresos en el SRT.

**Reflow Lines** redistribuye los captions con el formato elegido y usa las referencias del material de la secuencia activa para encontrar el tramo correspondiente. Reutiliza la transcripción guardada sin volver a llamar a la API y crea una nueva pista. Conservá los JSON y la biblioteca local para trabajos futuros.

La segmentación considera palabras por línea, pausas, puntuación, cambios de speaker y cortes de audio/video. La precisión depende del resultado del proveedor y del material. La disponibilidad de traducción depende del modelo; el selector lo indica.

## Ayuda

Para reportar un problema, incluí el error exacto, versiones de Premiere y del sistema operativo, proveedor/modelo y los pasos que lo provocan. Podés adjuntar el SRT y JSON si el contenido se puede compartir. Nunca envíes tu API key ni `config.json`.

## Código y pruebas

La raíz contiene la versión Windows; `macos/` contiene la versión para Mac y su empaquetador. Los ZIP de instalación se distribuyen en Releases.

```sh
node --test test/*.test.js
node --test macos/extension/test/*.test.js
node macos/scripts/package-macos.js
```

Las pruebas automatizadas no sustituyen la prueba dentro de Premiere. Licencia MIT: ver [LICENSE](LICENSE).

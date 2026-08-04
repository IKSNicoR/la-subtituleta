# Subtitulador para Premiere Pro

MVP gratuito de una extensión CEP para subtitular la secuencia activa mediante AssemblyAI, Speechmatics o Deepgram.

El panel se limita a:

- modelo;
- idioma de entrada;
- idioma de salida;
- palabras por línea y líneas por caption;
- **Transcribir**;
- **Reflow Lines**, que reutiliza la última transcripción y no vuelve a consumir la API;
- Configuración de las tres API keys.

AssemblyAI usa Universal 3.5 Pro con fallback automático a Universal 2 para los idiomas que no cubre el modelo principal.

## Requisitos

- Adobe Premiere Pro 2024 o posterior.
- Una API key del proveedor elegido.

La extensión es gratuita. El consumo de AssemblyAI, Speechmatics y Deepgram depende del plan de cada cuenta; sus planes y créditos gratuitos pueden cambiar.

## Instalación en Windows

1. Descargá `Subtitulador-Windows.zip` desde la [última versión](https://github.com/IKSNicoR/subtitulador/releases/latest).
2. Descomprimí el ZIP.
3. Cerrá Premiere Pro.
4. Hacé doble clic en `INSTALAR.cmd`.
5. Reiniciá Premiere y abrí:

```text
Ventana > Extensiones (heredado) > Subtitulador
```

Para desinstalar:

1. Cerrá Premiere.
2. Hacé doble clic en `DESINSTALAR.cmd`.

## Uso

1. Abrir una secuencia con audio.
2. Abrir Configuración, pegar las API keys necesarias y guardar.
3. Elegir modelo, idioma de entrada, idioma de salida y formato de líneas.
4. Pulsar **Transcribir**.
5. Cambiar solamente el formato de líneas y pulsar **Reflow Lines** para añadir una pista nueva sin retranscribir.

El audio se prepara directamente dentro de Premiere con un preset MP3 liviano. La extensión no abre Adobe Media Encoder ni crea trabajos en su cola.

Los SRT y la caché de la última transcripción se guardan en `Documentos\Subtitulador`. Los SRT se conservan porque Premiere los vincula como elementos del proyecto.

## Traducción

- AssemblyAI y Speechmatics permiten un idioma de salida distinto.
- Deepgram no ofrece traducción en su API de Speech-to-Text; al usar sus modelos, el panel fija la salida en **Igual que entrada**.
- Cuando una API entrega traducción por segmento pero no timestamps por palabra traducida, el plugin distribuye las palabras dentro del intervalo del segmento. La sincronía del segmento se conserva; la sincronía palabra a palabra traducida es aproximada.

## Seguridad de las claves

En este MVP las claves se guardan en el almacenamiento local privado del panel CEP del usuario. No se incluyen en los SRT, en la caché de transcripción ni en el proyecto de Premiere. Para distribuir públicamente el plugin conviene reemplazar este almacenamiento por Keychain/Credential Manager o por tokens efímeros emitidos por un backend.

## Desarrollo y pruebas

Las pruebas del motor de reflow y SRT no requieren Premiere:

```powershell
node --test .\test\transcript.test.js
```

La integración final debe verificarse dentro de Premiere con API keys reales, porque prepara el audio de la secuencia y crea una pista de captions usando la API ExtendScript de Premiere.

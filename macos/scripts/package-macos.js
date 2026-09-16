"use strict";
// ZIP reproducible sin dependencias; conserva permisos Unix de los .command.
const fs = require("node:fs");
const path = require("node:path");
const zlib = require("node:zlib");
const crypto = require("node:crypto");
const root = path.resolve(__dirname, "..");
const output = path.join(root, "dist", "La-Subtituleta-macOS-v0.4.0-beta.zip");
const entries = [];
function add(file, name) {
  const stat = fs.lstatSync(file);
  if (stat.isSymbolicLink()) { throw new Error("No se empaquetan enlaces: " + file); }
  if (stat.isDirectory()) {
    for (const child of fs.readdirSync(file).sort()) { add(path.join(file, child), name + "/" + child); }
  } else {
    const data = fs.readFileSync(file);
    if (/\.(command|sh)$/.test(name) && (data.includes(13) || data[0] !== 35)) {
      throw new Error("El script debe usar LF, sin BOM: " + name);
    }
    entries.push({ name, data });
  }
}
for (const name of ["index.html", "css", "CSXS", "js", "jsx", "presets", "LICENSE"]) {
  add(path.join(root, "extension", name), name);
}
for (const name of ["INSTALAR.command", "DESINSTALAR.command", "instalar-macos.sh", "INSTRUCCIONES-INSTALACION.txt", "PRUEBAS-BETA.txt"]) {
  add(path.join(root, name), name);
}
const table = Array.from({ length: 256 }, (_, n) => {
  for (let k = 0; k < 8; k++) { n = n & 1 ? 0xedb88320 ^ (n >>> 1) : n >>> 1; }
  return n >>> 0;
});
function crc32(bytes) {
  let crc = 0xffffffff;
  for (const b of bytes) { crc = table[(crc ^ b) & 255] ^ (crc >>> 8); }
  return (crc ^ 0xffffffff) >>> 0;
}
const local = [], central = [];
let offset = 0;
const date = ((2026 - 1980) << 9) | (9 << 5) | 16;
for (const { name, data } of entries) {
  const filename = Buffer.from(name, "utf8");
  const packed = zlib.deflateRawSync(data, { level: 9 });
  const checksum = crc32(data);
  const header = Buffer.alloc(30);
  header.writeUInt32LE(0x04034b50, 0);
  header.writeUInt16LE(20, 4);
  header.writeUInt16LE(0x800, 6);
  header.writeUInt16LE(8, 8);
  header.writeUInt16LE(date, 12);
  header.writeUInt32LE(checksum, 14);
  header.writeUInt32LE(packed.length, 18);
  header.writeUInt32LE(data.length, 22);
  header.writeUInt16LE(filename.length, 26);
  local.push(header, filename, packed);
  const directory = Buffer.alloc(46);
  directory.writeUInt32LE(0x02014b50, 0);
  directory.writeUInt16LE((3 << 8) | 20, 4); // creator OS = Unix
  header.copy(directory, 6, 4, 30);
  const mode = /\.(command|sh)$/.test(name) ? 0o100755 : 0o100644;
  directory.writeUInt32LE((mode << 16) >>> 0, 38);
  directory.writeUInt32LE(offset, 42);
  central.push(directory, filename);
  offset += header.length + filename.length + packed.length;
}
const end = Buffer.alloc(22);
end.writeUInt32LE(0x06054b50, 0);
end.writeUInt16LE(entries.length, 8);
end.writeUInt16LE(entries.length, 10);
end.writeUInt32LE(central.reduce((sum, b) => sum + b.length, 0), 12);
end.writeUInt32LE(offset, 16);
const zip = Buffer.concat([...local, ...central, end]);
fs.mkdirSync(path.dirname(output), { recursive: true });
fs.writeFileSync(output, zip);
const sha256 = crypto.createHash("sha256").update(zip).digest("hex");
fs.writeFileSync(output + ".sha256", sha256 + "  " + path.basename(output) + "\n");
console.log(JSON.stringify({ output, entries: entries.length, bytes: zip.length, sha256 }, null, 2));

// One-off repair: files were read as Windows-1252 and re-saved as UTF-8,
// turning every non-ASCII char into mojibake. This script re-encodes each
// character that has a cp1252 byte mapping back to that byte, then decodes
// the resulting byte stream as UTF-8 — restoring the original characters.
const fs = require("fs");
// byte value -> cp1252 decoded char (0x80-0xFF; undefined = same as latin1)
const CP1252 = {
  0x80: "\u20AC", 0x82: "\u201A", 0x83: "\u0192", 0x84: "\u201E",
  0x85: "\u2026", 0x86: "\u2020", 0x87: "\u2021", 0x88: "\u02C6",
  0x89: "\u2030", 0x8A: "\u0160", 0x8B: "\u2039", 0x8C: "\u0152",
  0x8E: "\u017D", 0x91: "\u2018", 0x92: "\u2019", 0x93: "\u201C",
  0x94: "\u201D", 0x95: "\u2022", 0x96: "\u2013", 0x97: "\u2014",
  0x98: "\u02DC", 0x99: "\u2122", 0x9A: "\u0161", 0x9B: "\u203A",
  0x9C: "\u0153", 0x9E: "\u017E", 0x9F: "\u0178",
  0xA0: "\u00A0", 0xA1: "\u00A1", 0xA2: "\u00A2", 0xA3: "\u00A3",
  0xA4: "\u00A4", 0xA5: "\u00A5", 0xA6: "\u00A6", 0xA7: "\u00A7",
  0xA8: "\u00A8", 0xA9: "\u00A9", 0xAA: "\u00AA", 0xAB: "\u00AB",
  0xAC: "\u00AC", 0xAD: "\u00AD", 0xAE: "\u00AE", 0xAF: "\u00AF",
  0xB0: "\u00B0", 0xB1: "\u00B1", 0xB2: "\u00B2", 0xB3: "\u00B3",
  0xB4: "\u00B4", 0xB5: "\u00B5", 0xB6: "\u00B6", 0xB7: "\u00B7",
  0xB8: "\u00B8", 0xB9: "\u00B9", 0xBA: "\u00BA", 0xBB: "\u00BB",
  0xBC: "\u00BC", 0xBD: "\u00BD", 0xBE: "\u00BE", 0xBF: "\u00BF",
  0xC0: "\u00C0", 0xC1: "\u00C1", 0xC2: "\u00C2", 0xC3: "\u00C3",
  0xC4: "\u00C4", 0xC5: "\u00C5", 0xC6: "\u00C6", 0xC7: "\u00C7",
  0xC8: "\u00C8", 0xC9: "\u00C9", 0xCA: "\u00CA", 0xCB: "\u00CB",
  0xCC: "\u00CC", 0xCD: "\u00CD", 0xCE: "\u00CE", 0xCF: "\u00CF",
  0xD0: "\u00D0", 0xD1: "\u00D1", 0xD2: "\u00D2", 0xD3: "\u00D3",
  0xD4: "\u00D4", 0xD5: "\u00D5", 0xD6: "\u00D6", 0xD7: "\u00D7",
  0xD8: "\u00D8", 0xD9: "\u00D9", 0xDA: "\u00DA", 0xDB: "\u00DB",
  0xDC: "\u00DC", 0xDD: "\u00DD", 0xDE: "\u00DE", 0xDF: "\u00DF",
  0xE0: "\u00E0", 0xE1: "\u00E1", 0xE2: "\u00E2", 0xE3: "\u00E3",
  0xE4: "\u00E4", 0xE5: "\u00E5", 0xE6: "\u00E6", 0xE7: "\u00E7",
  0xE8: "\u00E8", 0xE9: "\u00E9", 0xEA: "\u00EA", 0xEB: "\u00EB",
  0xEC: "\u00EC", 0xED: "\u00ED", 0xEE: "\u00EE", 0xEF: "\u00EF",
  0xF0: "\u00F0", 0xF1: "\u00F1", 0xF2: "\u00F2", 0xF3: "\u00F3",
  0xF4: "\u00F4", 0xF5: "\u00F5", 0xF6: "\u00F6", 0xF7: "\u00F7",
  0xF8: "\u00F8", 0xF9: "\u00F9", 0xFA: "\u00FA", 0xFB: "\u00FB",
  0xFC: "\u00FC", 0xFD: "\u00FD", 0xFE: "\u00FE", 0xFF: "\u00FF",
};
// char -> byte (inverse map)
const REV = {};
for (const [b, ch] of Object.entries(CP1252)) REV[ch] = Number(b);
// Also map latin1-identity chars (0xA1-0xFF handled above) — 0x8D, 0x8F, 0x90, 0x9D are unmapped
// in cp1252 but commonly decode as U+008D/U+008F/U+0090/U+009D.
for (const b of [0x8d, 0x8f, 0x90, 0x9d]) REV[String.fromCharCode(b)] = b;

const files = process.argv.slice(2);
for (const f of files) {
  const text = fs.readFileSync(f, "utf8");
  // Guard: only run the byte re-encoding if the file actually contains
  // mojibake signatures (double-encoded UTF-8). Without this, running the
  // script twice corrupts already-corrected characters: e.g. a legitimate
  // "—" (U+2014) would be wrongly re-encoded to byte 0x97, which is not
  // valid UTF-8 on its own, so the file fills with U+FFFD replacement chars.
  const isMojibake = /[\u00C0-\u00FF]{2}/.test(text) && /â€|â‚|âš|âœ|â„|ï¿½|ðŸ|ï¼|Ã/.test(text);
  if (!isMojibake) { console.log("skip (clean):", f); continue; }
  const bytes = [];
  let changed = 0;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp < 0x80) { bytes.push(cp); continue; }
    if (cp < 0x100 && REV[ch] !== undefined) { bytes.push(REV[ch]); changed++; continue; }
    if (REV[ch] !== undefined) { bytes.push(REV[ch]); changed++; continue; }
    // Not a cp1252-decoded char: keep as UTF-8
    for (const b of Buffer.from(ch, "utf8")) bytes.push(b);
  }
  const out = Buffer.from(bytes);
  const restored = out.toString("utf8");
  if (changed === 0) { console.log("skip (no change):", f); continue; }
  fs.writeFileSync(f, restored);
  console.log("repaired:", f, "chars-mapped:", changed, "restored-rupee:", (restored.match(/₹/g) || []).length);
}

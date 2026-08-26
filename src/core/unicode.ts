import type { BrailleDot, BraillePattern } from "./types.js";

export function dotsToMask(dots: Iterable<number>): number {
  let mask = 0;
  for (const dot of dots) {
    if (!Number.isInteger(dot) || dot < 1 || dot > 6) {
      throw new RangeError(`Invalid six-dot Braille dot: ${String(dot)}`);
    }
    mask |= 1 << (dot - 1);
  }
  return mask;
}

export function dotsToBraille(dots: Iterable<number>): BraillePattern {
  return String.fromCodePoint(0x2800 | dotsToMask(dots)) as BraillePattern;
}

export function brailleToCodePoint(pattern: BraillePattern): number {
  const codePoint = pattern.codePointAt(0);
  if (
    codePoint === undefined ||
    codePoint < 0x2800 ||
    codePoint > 0x283f ||
    String.fromCodePoint(codePoint) !== pattern
  ) {
    throw new RangeError("Value is not a six-dot Braille pattern");
  }
  return codePoint;
}

export function brailleToDots(pattern: BraillePattern): BrailleDot[] {
  const mask = brailleToCodePoint(pattern) - 0x2800;
  const dots: BrailleDot[] = [];
  for (let bit = 0; bit < 6; bit += 1) {
    if ((mask & (1 << bit)) !== 0) dots.push((bit + 1) as BrailleDot);
  }
  return dots;
}

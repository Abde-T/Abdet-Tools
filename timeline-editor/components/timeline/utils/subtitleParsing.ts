/**
 * subtitleParsing.ts
 * 
 * Utilities for converting standard subtitle file formats (SRT, VTT) 
 * into internal SubtitleCue objects for the timeline.
 */

export interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export const parseSrt = (text: string): SubtitleCue[] => {
  const blocks = text.split(/\r?\n\r?\n/);
  const cues: SubtitleCue[] = [];
  for (const block of blocks) {
    const lines = block.split(/\r?\n/).filter(Boolean);
    if (lines.length < 2) continue;
    // Optional index at lines[0]
    const timeLine = lines[0].includes("-->") ? lines[0] : lines[1];
    const textLines = lines[0].includes("-->")
      ? lines.slice(1)
      : lines.slice(2);
    const m = timeLine.match(
      /(\d\d:\d\d:\d\d[,.]\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d[,.]\d\d\d)/,
    );
    if (!m) continue;
    const toSec = (ts: string) => {
      const [h, m, rest] = ts.replace(",", ".").split(":");
      const [s, ms] = rest.split(".");
      return (
        parseInt(h) * 3600 +
        parseInt(m) * 60 +
        parseInt(s) +
        parseInt(ms) / 1000
      );
    };
    const start = toSec(m[1]);
    const end = toSec(m[2]);
    const cueText = textLines.join("\n");
    cues.push({ start, end, text: cueText });
  }
  return cues;
};

export const parseVtt = (text: string): SubtitleCue[] => {
  const lines = text.split(/\r?\n/);
  const cues: SubtitleCue[] = [];
  let i = 0;
  // skip WEBVTT header if present
  if (lines[0]?.toUpperCase().startsWith("WEBVTT")) {
    while (i < lines.length && lines[i].trim() !== "") i++;
    i++;
  }
  while (i < lines.length) {
    // skip cue id lines
    if (lines[i] && !lines[i].includes("-->")) i++;
    if (i >= lines.length) break;
    const timeLine = lines[i++];
    if (!timeLine || !timeLine.includes("-->")) continue;
    const m = timeLine.match(
      /(\d\d:\d\d:\d\d\.\d\d\d|\d\d:\d\d\.\d\d\d)\s*-->\s*(\d\d:\d\d:\d\d\.\d\d\d|\d\d:\d\d\.\d\d\d)/,
    );
    if (!m) continue;
    const toSec = (ts: string) => {
      const parts = ts.split(":");
      let h = 0,
        m = 0,
        s = 0,
        ms = 0;
      if (parts.length === 3) {
        h = parseInt(parts[0]);
        m = parseInt(parts[1]);
        [s, ms] = parts[2].split(".").map(Number);
      } else if (parts.length === 2) {
        m = parseInt(parts[0]);
        [s, ms] = parts[1].split(".").map(Number);
      }
      return h * 3600 + m * 60 + s + (ms || 0) / 1000;
    };
    const start = toSec(m[1]);
    const end = toSec(m[2]);
    const textLines: string[] = [];
    while (i < lines.length && lines[i].trim() !== "") {
      textLines.push(lines[i++]);
    }
    // skip blank line
    i++;
    cues.push({ start, end, text: textLines.join("\n") });
  }
  return cues;
};

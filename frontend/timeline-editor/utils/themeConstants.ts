/**
 * themeConstants.ts
 * 
 * Centralized color palette for the Timeline Editor's Konva canvas.
 * These colors should match the CSS variables defined in globals.css.
 */

export const THEME = {
  // Foundational Colors
  background: "#0f172a", // Slate 900
  panel: "#1e293b",      // Slate 800
  border: "#334155",     // Slate 700
  line: "#475569",       // Slate 600
  
  // Track Types
  trackVideo: "#6366f1",    // Electric Indigo
  trackAudio: "#a855f7",    // Purple 500
  trackSubtitle: "#22d3ee", // Cyber Cyan
  
  // States & Interactivity
  accent: "#6366f1",        // Primary Indigo accent
  selection: "#ffffff",     // High contrast white
  invalid: "#f43f5e",       // Rose 500
  playhead: "#f43f5e",      // High-vis Rose
  
  // Typography
  textPrimary: "#f8fafc",   // Slate 50
  textMuted: "#94a3b8",     // Slate 400
  
  // Functional Overlays
  dropZoneIndicator: "rgba(99, 102, 241, 0.2)",
  clipHoverOverlay: "rgba(255, 255, 255, 0.08)",
};

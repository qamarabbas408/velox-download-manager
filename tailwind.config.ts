import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./index.html", "./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        base: "#0B0D10",       // app background
        surface: "#14171C",    // panels
        raised: "#1B1F26",     // rows, unfilled track
        line: "rgba(255,255,255,0.07)",
        ink: "#EDEFF2",        // primary text
        muted: "#8A919C",      // secondary text
        dim: "#5A616C",        // tertiary / labels
        signal: "#FF6B2C",     // primary accent — active/downloading
        complete: "#33D6A6",   // success / finished
        paused: "#E8B84B",     // paused state
        danger: "#F0533D",     // error state
      },
      fontFamily: {
        display: ["Space Grotesk", "sans-serif"],
        body: ["IBM Plex Sans", "sans-serif"],
        mono: ["IBM Plex Mono", "monospace"],
      },
    },
  },
  plugins: [],
};

export default config;

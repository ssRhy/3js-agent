/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./pages/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        // 科幻风格的颜色
        "cyber-black": "#050505",
        "cyber-dark": "#0a0a0a",
        "cyber-blue": {
          DEFAULT: "#0072ff",
          100: "#e6f0ff",
          500: "#0072ff",
          900: "#004a9f",
        },
        "cyber-purple": {
          DEFAULT: "#bc00dd",
          100: "#f5e6ff",
          500: "#bc00dd",
          900: "#79018d",
        },
        neon: {
          green: "#39ff14",
          blue: "#00ffd5",
          pink: "#ff00e4",
          yellow: "#ffde00",
        },
      },
      fontFamily: {
        cyber: ["Orbitron", "sans-serif"],
        mono: ["JetBrains Mono", "monospace"],
      },
      boxShadow: {
        "neon-blue":
          "0 0 5px #00f, 0 0 10px #00f, 0 0 15px #00f, 0 0 20px #00f",
        "neon-purple":
          "0 0 5px #f0f, 0 0 10px #f0f, 0 0 15px #f0f, 0 0 20px #f0f",
        "neon-green":
          "0 0 5px #0f0, 0 0 10px #0f0, 0 0 15px #0f0, 0 0 20px #0f0",
      },
      backdropBlur: {
        xs: "2px",
      },
      animation: {
        "pulse-slow": "pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite",
        glow: "glow 2s ease-in-out infinite alternate",
        scanner: "scanner 2s linear infinite",
      },
      keyframes: {
        glow: {
          "0%": { opacity: 0.5 },
          "100%": { opacity: 1 },
        },
        scanner: {
          "0%": { transform: "translateY(-100%)" },
          "100%": { transform: "translateY(100%)" },
        },
      },
    },
  },
  plugins: [],
};

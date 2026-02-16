/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      animation: {
        progress: "progress-gradient 2s linear infinite",
        "streaming-pulse": "streaming-pulse 1.5s ease-in-out infinite",
      },
      keyframes: {
        "progress-gradient": {
          "0%": { "background-position": "0% 0%" },
          "100%": { "background-position": "200% 0%" },
        },
        "streaming-pulse": {
          "0%, 100%": { opacity: "1" },
          "50%": { opacity: "0.5" },
        },
      },
    },
  },
  plugins: [],
};

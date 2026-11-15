import type { Config } from "tailwindcss";

const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        navy: "#0a1628",
        navy2: "#0f2044",
        teal: "#00c9a7",
        teal2: "#00a88a",
        gold: "#f4c542",
        off: "#f4f7fb",
        grey: "#8a96a8"
      },
      fontFamily: {
        sans: ["var(--font-poppins)", "'Poppins'", "'popins'", "sans-serif"],
        head: ["var(--font-poppins)", "'Poppins'", "'popins'", "sans-serif"],
        body: ["var(--font-poppins)", "'Poppins'", "'popins'", "sans-serif"]
      },
      boxShadow: {
        soft: "0 8px 40px rgba(10,22,40,.12)"
      }
    }
  },
  plugins: []
};

export default config;

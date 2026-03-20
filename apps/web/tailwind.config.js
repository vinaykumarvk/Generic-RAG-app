/** @type {import('tailwindcss').Config} */
export default {
  content: ["./index.html", "./src/**/*.{js,ts,jsx,tsx}"],
  theme: {
    extend: {
      colors: {
        primary: {
          50:  "rgb(var(--color-primary-50)  / <alpha-value>)",
          100: "rgb(var(--color-primary-100) / <alpha-value>)",
          200: "rgb(var(--color-primary-200) / <alpha-value>)",
          300: "rgb(var(--color-primary-300) / <alpha-value>)",
          400: "rgb(var(--color-primary-400) / <alpha-value>)",
          500: "rgb(var(--color-primary-500) / <alpha-value>)",
          600: "rgb(var(--color-primary-600) / <alpha-value>)",
          700: "rgb(var(--color-primary-700) / <alpha-value>)",
          800: "rgb(var(--color-primary-800) / <alpha-value>)",
          900: "rgb(var(--color-primary-900) / <alpha-value>)",
        },
        surface: {
          DEFAULT:   "rgb(var(--color-surface)     / <alpha-value>)",
          alt:       "rgb(var(--color-surface-alt)  / <alpha-value>)",
          primary:   "rgb(var(--color-surface)      / <alpha-value>)",
          secondary: "rgb(var(--color-surface-alt)  / <alpha-value>)",
        },
        brand: {
          DEFAULT: "var(--color-brand)",
          hover: "var(--color-brand-hover)",
          soft: "var(--color-brand-soft)",
          accent: "rgb(var(--color-brand-accent) / <alpha-value>)",
        },
        sidebar: {
          bg: "rgb(var(--color-sidebar-bg) / <alpha-value>)",
          text: "rgb(var(--color-sidebar-text) / <alpha-value>)",
          border: "rgb(var(--color-sidebar-border) / <alpha-value>)",
          hover: "rgb(var(--color-sidebar-hover) / <alpha-value>)",
          "active-bg": "rgb(var(--color-sidebar-active-bg) / <alpha-value>)",
          "active-text": "rgb(var(--color-sidebar-active-text) / <alpha-value>)",
          muted: "rgb(var(--color-sidebar-muted) / <alpha-value>)",
        },
      },
      textColor: {
        skin: {
          base: "rgb(var(--color-text) / <alpha-value>)",
          muted: "rgb(var(--color-text-secondary) / <alpha-value>)",
        },
        text: {
          primary:   "rgb(var(--color-text)           / <alpha-value>)",
          secondary: "rgb(var(--color-text-secondary)  / <alpha-value>)",
          tertiary:  "rgb(var(--color-text-secondary)  / <alpha-value>)",
        },
        "on-brand": "var(--color-text-on-brand)",
      },
      borderColor: {
        skin: "rgb(var(--color-border) / <alpha-value>)",
        border: {
          primary: "rgb(var(--color-border) / <alpha-value>)",
        },
      },
      divideColor: {
        border: {
          primary: "rgb(var(--color-border) / <alpha-value>)",
        },
      },
      backgroundColor: {
        skin: {
          base: "rgb(var(--color-bg) / <alpha-value>)",
        },
      },
    },
  },
  plugins: [],
};

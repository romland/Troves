/** @type {import('tailwindcss').Config} */
module.exports = {
  content: ['./src/**/*.{html,js,svelte}'],
  theme: {
    extend: {},
  },
  plugins: [
    require('@tailwindcss/typography'),
    require("daisyui")
  ],
  daisyui: {
    logs: false,
    themes: [
      "dark", 
      "light", 
      "nord",        // Crisp Scandinavian light mode
      "emerald",     // Clean corporate green & crisp white
      "cupcake",     // Soft pastel cream & teal
      "winter",      // Cool frosty blue & clean light
      "coffee", 
      "luxury", 
      "black",
      "night",       // Sleek, deep dark with neon blue/purple
      "dim",         // Muted, sophisticated dark mode
      "dracula",     // Classic elegant dark
      "synthwave",   // Outrun 80s neon sci-fi
      "cyberpunk",   // Loud neon dystopia
      "caramellatte",
      "dim",
      "retro",
      {
        rehoboam: {  // Westworld Season 3 / Incite Inc. Aesthetic
          "primary": "#ef4444",      // Ominous anomaly red
          "secondary": "#ffffff",    // Stark white
          "accent": "#b91c1c",
          "neutral": "#171717",
          "base-100": "#000000",     // Pure OLED black
          "base-200": "#0a0a0a",     // Barely visible gray for depth
          "base-300": "#171717",
          "info": "#3abff8",
          "success": "#10b981",
          "warning": "#f59e0b",
          "error": "#dc2626",
          "--rounded-box": "0.1rem", // Sharp, corporate geometric corners
          "--rounded-btn": "0.1rem",
          "--rounded-badge": "0.1rem",
          "--tab-radius": "0.1rem",
        },
        abyss: { // Deep Ocean Blue Dark
          "primary": "#0ea5e9",
          "secondary": "#6366f1",
          "accent": "#38bdf8",
          "neutral": "#1e293b",
          "base-100": "#020617", // Pure dark blue-black
          "base-200": "#0f172a",
          "base-300": "#1e293b",
          "base-content": "#f8fafc",
          "info": "#bae6fd",
          "success": "#34d399",
          "warning": "#fbbf24",
          "error": "#f87171",
        },
        nebula: { // Deep Space Purple Dark
          "primary": "#a855f7",
          "secondary": "#8b5cf6",
          "accent": "#d946ef",
          "neutral": "#2e1065",
          "base-100": "#17052e", // Deep purple-black
          "base-200": "#2e1065",
          "base-300": "#3b0764",
          "base-content": "#faf5ff",
          "info": "#e9d5ff",
          "success": "#34d399",
          "warning": "#fbbf24",
          "error": "#f87171",
        },
        forge: { // Deep Ember/Red Dark
          "primary": "#ea580c",
          "secondary": "#dc2626",
          "accent": "#f97316",
          "neutral": "#431407",
          "base-100": "#2a0a02", // Deep ember-black
          "base-200": "#431407",
          "base-300": "#7c2d12",
          "base-content": "#fff7ed",
          "info": "#fdba74",
          "success": "#34d399",
          "warning": "#fbbf24",
          "error": "#ef4444",
        },
        matrix: { // Hacker Green Dark
          "primary": "#10b981",
          "secondary": "#059669",
          "accent": "#34d399",
          "neutral": "#064e3b",
          "base-100": "#022c22", // Deep green-black
          "base-200": "#064e3b",
          "base-300": "#065f46",
          "base-content": "#ecfdf5",
          "info": "#a7f3d0",
          "success": "#10b981",
          "warning": "#fbbf24",
          "error": "#ef4444",
        },
        manhattan: { // Industrial / Engraved aesthetic
          "primary": "#d97706",      // Amber/Gold engraving fill
          "secondary": "#4b5563",    // Brushed steel / Charcoal
          "accent": "#f59e0b",
          "neutral": "#1f2937",
          "base-100": "#27272a",     // Slate background
          "base-200": "#1e1e24",     // Darker slate
          "base-300": "#0f172a",     // Deepest slate
          "base-content": "#e2e8f0",
          "info": "#0ea5e9",
          "success": "#10b981",
          "warning": "#fbbf24",
          "error": "#ef4444",
          "--rounded-box": "0.2rem", // Slightly rounded but firm
          "--rounded-btn": "0.2rem",
        }
      }
    ]
  }
}
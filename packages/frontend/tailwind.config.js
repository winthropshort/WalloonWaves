/** @type {import('tailwindcss').Config} */
export default {
  content: ['./index.html', './src/**/*.{js,ts,jsx,tsx}'],
  theme: {
    extend: {
      colors: {
        walloon: {
          blue: {
            50:  '#e8f0f7',
            100: '#c5d8ea',
            200: '#9bbcd9',
            300: '#6e9ec6',
            400: '#4a86b8',
            500: '#1B4F72',
            600: '#174462',
            700: '#123852',
            800: '#0d2c42',
            900: '#081f30',
          },
          green: {
            50:  '#e8f2ea',
            100: '#c5ddc9',
            200: '#9ec5a6',
            300: '#74ab7f',
            400: '#4f9560',
            500: '#1E5631',
            600: '#194929',
            700: '#143c22',
            800: '#0f2f1a',
            900: '#0a2113',
          },
          tan: {
            50:  '#f9f3e8',
            100: '#f0e2c5',
            200: '#e5ce9e',
            300: '#d9b974',
            400: '#d0a84f',
            500: '#C9A96E',
            600: '#b0915a',
            700: '#937847',
            800: '#765f36',
            900: '#584726',
          },
          white: '#F5F5F0',
        },
      },
      fontFamily: {
        sans: ['Inter', 'system-ui', 'sans-serif'],
      },
    },
  },
  plugins: [],
};

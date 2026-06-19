import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

// GitHub Pages pe deploy karne ke liye base path relative './' rakha hai
export default defineConfig({
  plugins: [react()],
  base: './',
})

import type { Config } from 'tailwindcss';

export default {
  darkMode: 'class',
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  theme: {
    container: {
      center: true,
      padding: '2rem',
      screens: { '2xl': '1400px' },
    },
    extend: {
      colors: {
        border: 'hsl(var(--border))',
        input: 'hsl(var(--input))',
        ring: 'hsl(var(--ring))',
        background: 'hsl(var(--background))',
        foreground: 'hsl(var(--foreground))',
        primary: {
          DEFAULT: 'hsl(var(--primary))',
          foreground: 'hsl(var(--primary-foreground))',
        },
        muted: {
          DEFAULT: 'hsl(var(--muted))',
          foreground: 'hsl(var(--muted-foreground))',
        },
        accent: {
          DEFAULT: 'hsl(var(--accent))',
          foreground: 'hsl(var(--accent-foreground))',
        },
        destructive: {
          DEFAULT: 'hsl(var(--destructive))',
          foreground: 'hsl(var(--destructive-foreground))',
        },
        success: 'hsl(var(--success))',
        warning: 'hsl(var(--warning))',
        card: {
          DEFAULT: 'hsl(var(--card))',
          foreground: 'hsl(var(--card-foreground))',
        },
        popover: {
          DEFAULT: 'hsl(var(--popover))',
          foreground: 'hsl(var(--popover-foreground))',
        },
        // LubriConnect brand tokens (uso direto)
        lc: {
          navy: 'var(--lc-navy)',
          'navy-deep': 'var(--lc-navy-deep)',
          'navy-soft': 'var(--lc-navy-soft)',
          ruby: 'var(--lc-ruby)',
          'ruby-deep': 'var(--lc-ruby-deep)',
          amber: 'var(--lc-amber)',
          'amber-soft': 'var(--lc-amber-soft)',
          ink: 'var(--lc-ink)',
          paper: 'var(--lc-paper)',
          'paper-2': 'var(--lc-paper-2)',
        },
      },
      borderRadius: {
        lg: 'var(--radius)',
        md: 'calc(var(--radius) - 2px)',
        sm: 'calc(var(--radius) - 4px)',
      },
      fontFamily: {
        sans: ['Geist', 'Inter', 'system-ui', 'sans-serif'],
        mono: ['Geist Mono', 'JetBrains Mono', 'ui-monospace', 'monospace'],
      },
      boxShadow: {
        'lc-soft': '0 1px 0 rgba(11,37,69,0.04)',
        'lc-card': '0 24px 60px -30px rgba(11,37,69,0.25), 0 4px 14px -8px rgba(11,37,69,0.08)',
        'lc-cta': '0 6px 14px -4px rgba(11,37,69,0.4)',
        'lc-ruby': '0 4px 10px -3px rgba(200,16,46,0.4)',
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;

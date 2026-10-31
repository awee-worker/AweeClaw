/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        background: {
          DEFAULT: 'rgb(var(--background) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          secondary: 'rgb(var(--background-secondary) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          tertiary: 'rgb(var(--background-tertiary) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          chat: 'rgb(var(--chat-bg) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          editor: 'rgb(var(--editor-bg) / <alpha-value>)',
        },
        surface: {
          DEFAULT: 'rgb(var(--surface) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          hover: 'rgb(var(--surface-hover) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          active: 'rgb(var(--surface-active) / calc(<alpha-value> * var(--panel-alpha, 1)))',
          muted: 'rgb(var(--surface-muted) / calc(<alpha-value> * var(--panel-alpha, 1)))',
        },
        input: {
          DEFAULT: 'rgb(var(--input-bg) / <alpha-value>)',
          border: 'rgb(var(--input-border) / <alpha-value>)',
        },
        border: {
          DEFAULT: 'rgb(var(--border) / <alpha-value>)',
          subtle: 'rgb(var(--border-subtle) / <alpha-value>)',
          active: 'rgb(var(--border-active) / <alpha-value>)',
        },
        text: {
          primary: 'rgb(var(--text-primary) / <alpha-value>)',
          secondary: 'rgb(var(--text-secondary) / <alpha-value>)',
          muted: 'rgb(var(--text-muted) / <alpha-value>)',
          inverted: 'rgb(var(--text-inverted) / <alpha-value>)',
        },
        accent: {
          DEFAULT: 'rgb(var(--accent) / <alpha-value>)',
          hover: 'rgb(var(--accent-hover) / <alpha-value>)',
          active: 'rgb(var(--accent-active) / <alpha-value>)',
          foreground: 'rgb(var(--accent-foreground) / <alpha-value>)',
          subtle: 'rgb(var(--accent-subtle) / <alpha-value>)',
        },
        status: {
          success: 'rgb(var(--status-success) / <alpha-value>)',
          warning: 'rgb(var(--status-warning) / <alpha-value>)',
          error: 'rgb(var(--status-error) / <alpha-value>)',
          info: 'rgb(var(--status-info) / <alpha-value>)',
        },
        /**
         * 浮层专用底色：下拉菜单、命令面板、二级菜单等。
         *
         * 刻意不乘 --panel-alpha。该变量是给「贴着壁纸的大面积容器」用的，
         * 壁纸模式下只有 0.15；浮层如果也跟着它走，bg-surface/95 实际只剩
         * 0.95 × 0.15 ≈ 14% 不透明度，菜单里透出整个页面，字看不清。
         * 浮层是压在内容之上的独立一层，必须自带实底，这里固定 96%。
         */
        popover: {
          DEFAULT: 'rgb(var(--surface) / 0.96)',
          hover: 'rgb(var(--surface-hover) / 0.96)',
        },
      },
      fontSize: {
        'xs': ['0.8125rem', { lineHeight: '1.25rem' }],
        'sm': ['0.9375rem', { lineHeight: '1.5rem' }],
        'base': ['1.0625rem', { lineHeight: '1.75rem' }],
      },
      borderRadius: {
        lg: 'var(--radius-lg)',
        md: 'var(--radius-md)',
        sm: 'var(--radius-sm)',
        full: 'var(--radius-full)',
      },
      fontFamily: {
        sans: ['Inter', '-apple-system', 'BlinkMacSystemFont', 'Segoe UI', 'Roboto', 'sans-serif'],
        mono: ['JetBrains Mono', 'Fira Code', 'Menlo', 'Monaco', 'Consolas', 'monospace'],
      },
      boxShadow: {
        'glass': '0 8px 32px 0 rgba(0, 0, 0, 0.37)',
        'glow': '0 0 20px rgb(var(--accent) / 0.15)',
        'glow-sm': '0 0 10px rgb(var(--accent) / 0.1)',
        'glow-lg': '0 0 30px rgb(var(--accent) / 0.2)',
        'inner-glow': 'inset 0 0 20px rgb(var(--accent) / 0.05)',
      },
      animation: {
        'fade-in': 'fadeIn 0.2s ease-out forwards',
        'fade-out': 'fadeOut 0.2s ease-out forwards',
        'slide-up': 'slideUp 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-down': 'slideDown 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'slide-in-right': 'slideInRight 0.3s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'scale-in': 'scaleIn 0.2s cubic-bezier(0.16, 1, 0.3, 1) forwards',
        'pulse-slow': 'pulse 3s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'pulse-glow': 'pulseGlow 2s cubic-bezier(0.4, 0, 0.6, 1) infinite',
        'shimmer': 'shimmer 2s linear infinite',
        // 执行中状态用的圆点呼吸：缩放与透明度同相位，读起来是「在跳」而不是「在转」
        'dot-breath': 'dotBreath 1.5s ease-in-out infinite',
        // 与呼吸同周期的外圈扩散，落在圆点膨到最大那一刻
        'dot-ripple': 'dotRipple 1.5s ease-out infinite',
      },
      keyframes: {
        fadeIn: {
          '0%': { opacity: '0' },
          '100%': { opacity: '1' },
        },
        fadeOut: {
          '0%': { opacity: '1' },
          '100%': { opacity: '0' },
        },
        slideUp: {
          '0%': { transform: 'translateY(10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideDown: {
          '0%': { transform: 'translateY(-10px)', opacity: '0' },
          '100%': { transform: 'translateY(0)', opacity: '1' },
        },
        slideInRight: {
          '0%': { transform: 'translateX(20px)', opacity: '0' },
          '100%': { transform: 'translateX(0)', opacity: '1' },
        },
        scaleIn: {
          '0%': { transform: 'scale(0.95)', opacity: '0' },
          '100%': { transform: 'scale(1)', opacity: '1' },
        },
        pulseGlow: {
          '0%, 100%': { opacity: '1', boxShadow: '0 0 0px rgb(var(--accent) / 0)' },
          '50%': { opacity: '0.9', boxShadow: '0 0 15px rgb(var(--accent) / 0.3)' },
        },
        dotBreath: {
          '0%, 100%': { transform: 'scale(0.65)', opacity: '0.4' },
          '50%': { transform: 'scale(1)', opacity: '1' },
        },
        dotRipple: {
          '0%': { transform: 'scale(1)', opacity: '0.55' },
          '70%, 100%': { transform: 'scale(2.6)', opacity: '0' },
        },
        shimmer: {
          '0%': { transform: 'translateX(-100%)' },
          '100%': { transform: 'translateX(50%)' },
        },
      },
      backdropBlur: {
        xs: '2px',
      }
    },
  },
  plugins: [],
}

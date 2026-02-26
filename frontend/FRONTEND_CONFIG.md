# Frontend Configuration

## Environment Variables

Create a `.env` file in the `frontend` directory:

```env
# API Configuration
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001

# Application Settings
VITE_APP_NAME=AI Frontend Master
VITE_APP_VERSION=1.0.0
```

## Dependencies

Required packages (already installed):
- react
- react-dom
- lucide-react (icons)

## Build Configuration

### vite.config.ts

Ensure your `vite.config.ts` includes:

```typescript
import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/ws': {
        target: 'ws://localhost:3001',
        ws: true,
      },
    },
  },
});
```

## Development

```bash
cd frontend
npm run dev
```

Frontend will run on `http://localhost:5173`

## Production Build

```bash
npm run build
npm run preview
```

## Integration Checklist

- [x] ChatInterface component created
- [x] RunConsole component created
- [x] useSession hook created
- [x] useStream hook created
- [x] API client created
- [x] WebSocket service created
- [x] App.tsx integration
- [x] Global styles (index.css)
- [x] Main entry point (main.tsx)

## Usage

1. Start backend: `cd backend && npm run dev`
2. Start frontend: `cd frontend && npm run dev`
3. Open: `http://localhost:5173`
4. Start chatting with AI!


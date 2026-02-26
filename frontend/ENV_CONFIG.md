# Frontend Environment Variables

## Environment Configuration

Create a `.env` file in the `frontend` directory for local development:

```env
# API Configuration
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001

# Application Settings
VITE_APP_NAME=AI Frontend Master
VITE_APP_VERSION=1.0.0

# Default AI Settings (for UI display)
VITE_DEFAULT_PROVIDER=anthropic
VITE_DEFAULT_MODEL=claude-sonnet-4-20250514
```

## Production Environment Variables

For production deployment, set these in your hosting platform:

```bash
# Production API URL
VITE_API_URL=https://your-backend-api.com

# Production WebSocket URL
VITE_WS_URL=wss://your-backend-api.com

# Application
VITE_APP_NAME=AI Frontend Master
VITE_APP_VERSION=1.0.0
```

## Vite Environment Variables Reference

Vite automatically exposes environment variables prefixed with `VITE_` to your client code.

### Available Variables

| Variable | Description | Default |
|----------|-------------|---------|
| `VITE_API_URL` | Backend API base URL | `http://localhost:3001` |
| `VITE_WS_URL` | WebSocket server URL | `ws://localhost:3001` |
| `VITE_APP_NAME` | Application name | `AI Frontend Master` |
| `VITE_APP_VERSION` | Application version | `1.0.0` |
| `VITE_DEFAULT_PROVIDER` | Default AI provider | `anthropic` |
| `VITE_DEFAULT_MODEL` | Default AI model | `claude-sonnet-4-20250514` |

## Usage in Code

```typescript
// Access environment variables
const apiUrl = import.meta.env.VITE_API_URL;
const appName = import.meta.env.VITE_APP_NAME;

// Check if variable exists
if (import.meta.env.VITE_API_URL) {
  // Use API URL
}
```

## Different Environments

### Development (.env.development)
```env
VITE_API_URL=http://localhost:3001
VITE_WS_URL=ws://localhost:3001
```

### Production (.env.production)
```env
VITE_API_URL=https://api.yourapp.com
VITE_WS_URL=wss://api.yourapp.com
```

## Build-time vs Runtime

**Important**: Vite environment variables are evaluated at build time, not runtime!

For runtime configuration, consider:

1. **Using a config endpoint**:
```typescript
const config = await fetch('/api/config').then(r => r.json());
```

2. **Using window object** (inject via HTML):
```html
<script>
  window.__CONFIG__ = {
    apiUrl: 'https://api.yourapp.com'
  };
</script>
```

3. **Using different build configurations**:
```bash
# Development build
npm run build -- --mode development

# Production build
npm run build -- --mode production
```

## Proxy Configuration (Optional)

For development, you can proxy API requests in `vite.config.ts`:

```typescript
export default defineConfig({
  server: {
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

Then you can use relative URLs:
```typescript
const apiUrl = '/api'; // Proxied to backend
```

# Family AI OS Architecture

This file is a compatibility pointer.

The canonical architecture now lives in:

- [docs/family-ai-os/00-index.md](docs/family-ai-os/00-index.md)
- [docs/family-ai-os/01-product-positioning.md](docs/family-ai-os/01-product-positioning.md)
- [docs/family-ai-os/02-architecture.md](docs/family-ai-os/02-architecture.md)
- [docs/family-ai-os/10-ai-agent-layer.md](docs/family-ai-os/10-ai-agent-layer.md)

Current direction:

```text
Round screen terminal + AI-native backend + future mobile app
```

The ESP32 round screen is a thin family interaction terminal. It should not own complex business logic, search, permission management, memory, knowledge base, or tool orchestration.

Use Page Agent First + Router Fallback for AI interactions. See `10-ai-agent-layer.md`.

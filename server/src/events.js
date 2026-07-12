class EventBus {
  constructor() {
    this.clients = new Set();
    this.nextId = 1;
    this.latestEvent = null;
  }

  connect(req, res) {
    res.status(200);
    res.setHeader("Content-Type", "text/event-stream; charset=utf-8");
    res.setHeader("Cache-Control", "no-cache, no-transform");
    res.setHeader("Connection", "keep-alive");
    res.setHeader("X-Accel-Buffering", "no");
    if (typeof res.flushHeaders === "function") {
      res.flushHeaders();
    }

    const client = { res };
    this.clients.add(client);
    this.write(client, {
      id: "connected",
      type: "connected",
      at: new Date().toISOString(),
      data: { clients: this.clients.size }
    });

    const heartbeat = setInterval(() => {
      this.write(client, {
        id: `hb_${Date.now()}`,
        type: "heartbeat",
        at: new Date().toISOString(),
        data: {}
      });
    }, 15000);

    req.on("close", () => {
      clearInterval(heartbeat);
      this.clients.delete(client);
    });
  }

  publish(type, data = {}) {
    const event = {
      id: String(this.nextId++),
      type,
      at: new Date().toISOString(),
      data
    };
    this.latestEvent = event;
    for (const client of this.clients) {
      this.write(client, event);
    }
    return event;
  }

  latest() {
    return this.latestEvent;
  }

  stats() {
    return {
      clients: this.clients.size,
      nextId: this.nextId,
      latest: this.latestEvent
    };
  }

  write(client, event) {
    try {
      client.res.write(`id: ${event.id}\n`);
      client.res.write(`event: ${event.type}\n`);
      client.res.write(`data: ${JSON.stringify({ at: event.at, ...event.data })}\n\n`);
    } catch (error) {
      this.clients.delete(client);
    }
  }
}

function createEventBus() {
  return new EventBus();
}

module.exports = {
  EventBus,
  createEventBus
};

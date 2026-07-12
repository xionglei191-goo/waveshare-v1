const fs = require("fs");

const {
  enqueueXiaozhiToolCommand,
  resolveServerMediaForCommand
} = require("../device-commands");
const { musicSummary } = require("../domain");
const {
  addMediaFavorite,
  addMediaQueueItem,
  applyPodcastFeedRefresh,
  audioContentType,
  buildMediaLibrary,
  clearMediaQueue,
  deleteOnlineCatalogTrack,
  deleteMediaFavorite,
  deleteMediaProgress,
  deletePodcastFeed,
  deleteServerTrack,
  fetchPodcastFeed,
  filterTracksForView,
  findOnlineTrack,
  listKnownServerTracks,
  listMediaFavorites,
  listMediaProgress,
  listMediaQueue,
  listOnlineCatalog,
  listPodcastEpisodes,
  listPodcastFeeds,
  listResumeCandidates,
  markPodcastFeedRefreshError,
  moveMediaQueueItem,
  nextMediaQueueItem,
  playMediaQueueItem,
  proxyRemoteAudio,
  refreshPodcastFeeds,
  registerOnlineTrack,
  removeMediaQueueItem,
  renameServerTrack,
  resolveMediaSearch,
  resolveResumeCandidate,
  serverTrackFile,
  stopMediaQueue,
  toDeviceTrack,
  upsertMediaProgress,
  upsertOnlineCatalogTrack,
  upsertPodcastFeed
} = require("../media");

function buildMediaPlayCommand(state, config, body, track, origin = "") {
  const tracks = listKnownServerTracks(state, config);
  const index = Math.max(0, tracks.findIndex((item) => item.id === track?.id));
  return enqueueXiaozhiToolCommand(state, config, {
    tool: "family.media.play",
    text: body?.text || body?.query || track?.title || "播放媒体",
    params: {
      trackId: track?.id,
      deviceId: body?.deviceId || body?.device_id || "esp32-185b"
    },
    _resolvedMedia: {
      tracks,
      track,
      index,
      origin: origin || (track?.origin === "online" ? "online" : "local"),
      query: body?.query || track?.title || ""
    }
  });
}

function registerMediaRoutes(router, context) {
  const {
    store,
    config,
    updateAndPublish,
    deviceSummary,
    snapshotWithServerMedia
  } = context;
  const enqueueMediaPlayCommand = (state, body, track, origin) =>
    buildMediaPlayCommand(state, config, body, track, origin);
  router.get("/music/state", (req, res) => {
    res.json({ ok: true, data: musicSummary(snapshotWithServerMedia(store.snapshot(), config)) });
  });

  router.get("/media/library", (req, res) => {
    res.json({ ok: true, data: buildMediaLibrary(store.snapshot(), config, { includeDiagnostics: req.query.includeDiagnostics }) });
  });

  router.get("/media/server/tracks", (req, res) => {
    const tracks = filterTracksForView(listKnownServerTracks(store.snapshot(), config), {
      includeDiagnostics: req.query.includeDiagnostics
    }).map((track) => toDeviceTrack(track, config));
    res.json({ ok: true, data: { tracks } });
  });

  router.get("/media/search", async (req, res, next) => {
    try {
      const query = String(req.query.q || req.query.query || "").slice(0, 160);
      const result = await resolveMediaSearch(config, query, store.snapshot());
      let tracks = result.tracks || [];
      if (result.source === "online") {
        const snapshot = updateAndPublish("media.search", (state) => {
          tracks = tracks.map((track) => registerOnlineTrack(state, config, track, result.query)).filter(Boolean);
          state.media.searchHistory.unshift({
            id: `ms_${Date.now()}_${Math.random().toString(16).slice(2, 6)}`,
            at: new Date().toISOString(),
            query: result.query,
            source: result.source,
            count: tracks.length
          });
          state.media.searchHistory = state.media.searchHistory.slice(0, 50);
        });
        res.json({
          ok: true,
          data: { ...result, tracks, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) }
        });
        return;
      }
      res.json({ ok: true, data: { ...result, tracks } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/queue", (req, res) => {
    res.json({ ok: true, data: listMediaQueue(store.snapshot()) });
  });

  router.post("/media/queue", async (req, res, next) => {
    try {
      const body = req.body || {};
      const query = String(body.query || body.q || "").slice(0, 160);
      const search = query ? await resolveMediaSearch(config, query, store.snapshot()) : null;
      let item = null;
      const snapshot = updateAndPublish("media.queue.add", (state) => {
        let track = null;
        if (body.trackId || body.track_id || body.id) {
          item = addMediaQueueItem(state, config, body);
          return;
        }
        if (search?.tracks?.[0]) {
          track = search.source === "online"
            ? registerOnlineTrack(state, config, search.tracks[0], search.query)
            : search.tracks[0];
        }
        item = addMediaQueueItem(state, config, { ...body, track });
      });
      res.json({ ok: true, data: { item, queue: listMediaQueue(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/play", (req, res, next) => {
    try {
      let queueResult = null;
      let commandResult = null;
      const snapshot = updateAndPublish("media.queue.play", (state) => {
        queueResult = playMediaQueueItem(state, config, req.body || {});
        commandResult = enqueueMediaPlayCommand(state, req.body || {}, queueResult.track, "queue");
      });
      res.status(commandResult?.accepted ? 202 : 400).json({
        ok: Boolean(commandResult?.accepted),
        data: {
          queue: listMediaQueue(snapshot),
          item: queueResult?.item || null,
          track: queueResult?.track || null,
          command: commandResult?.command || null,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/next", (req, res, next) => {
    try {
      let queueResult = null;
      let commandResult = null;
      const snapshot = updateAndPublish("media.queue.next", (state) => {
        queueResult = nextMediaQueueItem(state, config, req.body || {});
        if (queueResult?.track) {
          commandResult = enqueueMediaPlayCommand(state, req.body || {}, queueResult.track, "queue");
        } else {
          commandResult = enqueueXiaozhiToolCommand(state, config, {
            tool: "family.podcast.next",
            params: { deviceId: req.body?.deviceId || req.body?.device_id || "esp32-185b" }
          });
        }
      });
      res.status(commandResult?.accepted ? 202 : 400).json({
        ok: Boolean(commandResult?.accepted),
        data: {
          queue: listMediaQueue(snapshot),
          item: queueResult?.item || null,
          track: queueResult?.track || null,
          command: commandResult?.command || null,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/stop", (req, res, next) => {
    try {
      let queue = null;
      let commandResult = null;
      const snapshot = updateAndPublish("media.queue.stop", (state) => {
        queue = stopMediaQueue(state);
        commandResult = enqueueXiaozhiToolCommand(state, config, {
          tool: "family.podcast.stop",
          params: { deviceId: req.body?.deviceId || req.body?.device_id || "esp32-185b" }
        });
      });
      res.status(commandResult?.accepted ? 202 : 400).json({
        ok: Boolean(commandResult?.accepted),
        data: { queue, command: commandResult?.command || null, summary: deviceSummary(snapshot, config) }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/media/queue/clear", (req, res, next) => {
    try {
      let queue = null;
      const snapshot = updateAndPublish("media.queue.clear", (state) => {
        queue = clearMediaQueue(state, req.body || {});
      });
      res.json({ ok: true, data: { queue, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/media/queue/:id", (req, res, next) => {
    try {
      let queue = null;
      const snapshot = updateAndPublish("media.queue.move", (state) => {
        queue = moveMediaQueueItem(state, req.params.id, req.body?.direction || req.body?.move || "up");
      });
      res.json({ ok: true, data: { queue, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/media/queue/:id", (req, res, next) => {
    try {
      let queue = null;
      const snapshot = updateAndPublish("media.queue.remove", (state) => {
        queue = removeMediaQueueItem(state, req.params.id);
      });
      res.json({ ok: true, data: { queue, summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config) } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/favorites", (req, res) => {
    res.json({ ok: true, data: { favorites: listMediaFavorites(store.snapshot()) } });
  });

  router.post("/media/favorites", (req, res, next) => {
    try {
      let favorite = null;
      const snapshot = updateAndPublish("media.favorite.add", (state) => {
        const body = req.body || {};
        const current = state.music?.server?.tracks?.[state.music.server.currentIndex || 0] || null;
        favorite = addMediaFavorite(state, config, body.trackId || body.track_id || body.id ? body : { ...body, track: current });
      });
      res.json({ ok: true, data: { favorite, favorites: listMediaFavorites(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/media/favorites/:id", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("media.favorite.delete", (state) => {
        result = deleteMediaFavorite(state, req.params.id);
      });
      res.json({ ok: true, data: { result, favorites: listMediaFavorites(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/resume", (req, res) => {
    res.json({
      ok: true,
      data: {
        candidates: listResumeCandidates(store.snapshot(), config, req.query)
      }
    });
  });

  router.post("/media/resume", (req, res, next) => {
    try {
      const candidate = resolveResumeCandidate(store.snapshot(), config, req.body || {});
      let result = null;
      const snapshot = updateAndPublish("media.resume", (state) => {
        result = enqueueXiaozhiToolCommand(state, config, {
          tool: "family.podcast.resume",
          text: req.body?.text || "继续播放上次没听完",
          params: {
            ...(req.body || {}),
            trackId: req.body?.trackId || req.body?.track_id || candidate?.trackId,
            deviceId: req.body?.deviceId || req.body?.device_id || "esp32-185b"
          }
        });
      });
      res.status(result?.accepted ? 202 : 404).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          candidate,
          candidates: listResumeCandidates(snapshot, config, { deviceId: req.body?.deviceId || req.body?.device_id || "" }),
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/server/progress", (req, res) => {
    res.json({
      ok: true,
      data: {
        progress: listMediaProgress(store.snapshot(), config, req.query)
      }
    });
  });

  router.post("/media/server/progress", (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("media.progress", (state) => {
        item = upsertMediaProgress(state, config, req.body || {});
      });
      res.json({
        ok: true,
        data: {
          item,
          progress: listMediaProgress(snapshot, config, { deviceId: req.body?.deviceId || req.body?.device_id || "" })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/media/server/progress/:trackId", (req, res, next) => {
    try {
      let item = null;
      const snapshot = updateAndPublish("media.progress.update", (state) => {
        item = upsertMediaProgress(state, config, {
          ...(req.body || {}),
          trackId: req.params.trackId
        });
      });
      res.json({
        ok: true,
        data: {
          item,
          progress: listMediaProgress(snapshot, config, { trackId: req.params.trackId })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/media/server/progress/:trackId", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("media.progress.delete", (state) => {
        result = deleteMediaProgress(state, req.params.trackId, req.query || {});
      });
      res.json({
        ok: true,
        data: {
          result,
          progress: listMediaProgress(snapshot, config, { trackId: req.params.trackId })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/media/server/stream/:id", (req, res, next) => {
    const filePath = serverTrackFile(config, req.params.id);
    if (!filePath) {
      res.status(404).json({ ok: false, error: "media track not found" });
      return;
    }
    const stat = fs.statSync(filePath);
    const total = stat.size;
    res.setHeader("Accept-Ranges", "bytes");
    res.setHeader("Cache-Control", "public, max-age=0");
    res.type(audioContentType(filePath));

    const range = req.headers.range;
    if (range) {
      const match = /^bytes=(\d*)-(\d*)$/.exec(range);
      if (!match) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      let start = match[1] === "" ? 0 : Number(match[1]);
      let end = match[2] === "" ? total - 1 : Number(match[2]);
      if (match[1] === "" && match[2] !== "") {
        const suffixLength = Math.max(0, Number(match[2]));
        start = Math.max(0, total - suffixLength);
        end = total - 1;
      }
      if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= total) {
        res.status(416).setHeader("Content-Range", `bytes */${total}`).end();
        return;
      }
      end = Math.min(end, total - 1);
      res.status(206);
      res.setHeader("Content-Range", `bytes ${start}-${end}/${total}`);
      res.setHeader("Content-Length", String(end - start + 1));
      fs.createReadStream(filePath, { start, end }).on("error", next).pipe(res);
      return;
    }

    res.setHeader("Content-Length", String(total));
    fs.createReadStream(filePath).on("error", next).pipe(res);
  });

  router.get("/media/online/stream/:id", async (req, res, next) => {
    try {
      const track = findOnlineTrack(store.snapshot(), config, req.params.id);
      if (!track) {
        res.status(404).json({ ok: false, error: "online media track not found" });
        return;
      }
      await proxyRemoteAudio(res, track, req.headers, config);
    } catch (error) {
      next(error);
    }
  });
}

function registerAdminMediaRoutes(router, context) {
  const {
    store,
    config,
    eventBus,
    updateAndPublish,
    publishMutation,
    deviceSummary,
    snapshotWithServerMedia,
    safeAdminConfig
  } = context;
  router.get("/admin/media", (req, res) => {
    const state = store.snapshot();
    const library = buildMediaLibrary(state, config, { includeDiagnostics: true });
    res.json({
      ok: true,
      data: {
        ...library,
        localCount: library.localTracks.length,
        config: safeAdminConfig(config).onlineMedia
      }
    });
  });

  router.get("/admin/podcasts/feeds", (req, res) => {
    res.json({ ok: true, data: { feeds: listPodcastFeeds(store.snapshot()) } });
  });

  router.post("/admin/podcasts/feeds", (req, res, next) => {
    try {
      let feed = null;
      const snapshot = updateAndPublish("admin.podcast.feed.create", (state) => {
        feed = upsertPodcastFeed(state, config, req.body || {});
      });
      res.json({ ok: true, data: { feed, feeds: listPodcastFeeds(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/podcasts/feeds/:id", (req, res, next) => {
    try {
      let feed = null;
      const snapshot = updateAndPublish("admin.podcast.feed.update", (state) => {
        feed = upsertPodcastFeed(state, config, req.body || {}, req.params.id);
      });
      res.json({ ok: true, data: { feed, feeds: listPodcastFeeds(snapshot) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/podcasts/feeds/:id", (req, res, next) => {
    try {
      let result = null;
      const snapshot = updateAndPublish("admin.podcast.feed.delete", (state) => {
        result = deletePodcastFeed(state, req.params.id);
      });
      res.json({ ok: true, data: { result, feeds: listPodcastFeeds(snapshot), episodes: listPodcastEpisodes(snapshot, config) } });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/podcasts/feeds/:id/refresh", async (req, res, next) => {
    const feed = listPodcastFeeds(store.snapshot()).find((item) => item.id === req.params.id);
    if (!feed) {
      res.status(404).json({ ok: false, error: "podcast feed not found" });
      return;
    }
    try {
      const parsed = await fetchPodcastFeed(config, feed);
      let result = null;
      const snapshot = updateAndPublish("admin.podcast.feed.refresh", (state) => {
        result = applyPodcastFeedRefresh(state, config, req.params.id, parsed);
      });
      res.json({
        ok: true,
        data: {
          feed: result.feed,
          episodes: result.episodes,
          feeds: listPodcastFeeds(snapshot),
          library: buildMediaLibrary(snapshot, config, { includeDiagnostics: true })
        }
      });
    } catch (error) {
      updateAndPublish("admin.podcast.feed.refresh_error", (state) => {
        markPodcastFeedRefreshError(state, req.params.id, error.message);
      });
      next(error);
    }
  });

  router.post("/admin/podcasts/refresh-all", async (req, res, next) => {
    try {
      const result = await refreshPodcastFeeds(store, config, {
        force: req.body?.force !== false,
        batchSize: req.body?.batchSize || req.body?.batch_size
      });
      publishMutation(store.snapshot(), store.snapshot(), "admin.podcast.refresh_all");
      res.json({
        ok: true,
        data: {
          result,
          feeds: listPodcastFeeds(store.snapshot()),
          episodes: listPodcastEpisodes(store.snapshot(), config),
          library: buildMediaLibrary(store.snapshot(), config, { includeDiagnostics: true })
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.get("/admin/podcasts/episodes", (req, res) => {
    res.json({
      ok: true,
      data: {
        episodes: listPodcastEpisodes(store.snapshot(), config, req.query)
      }
    });
  });

  router.get("/admin/media/catalog", (req, res) => {
    res.json({ ok: true, data: { tracks: listOnlineCatalog(config) } });
  });

  router.post("/admin/media/catalog", (req, res, next) => {
    try {
      const item = upsertOnlineCatalogTrack(config, req.body || {});
      res.json({ ok: true, data: { item, tracks: listOnlineCatalog(config) } });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/media/catalog/:id", (req, res, next) => {
    try {
      res.json({ ok: true, data: deleteOnlineCatalogTrack(config, req.params.id) });
    } catch (error) {
      next(error);
    }
  });

  router.patch("/admin/media/server/:id", (req, res, next) => {
    try {
      let track = null;
      const snapshot = updateAndPublish("admin.media.server.rename", (state) => {
        track = renameServerTrack(config, req.params.id, req.body?.title || req.body?.name || "");
        state.music = state.music || {};
        state.music.server = state.music.server || {};
        state.music.server.tracks = listKnownServerTracks(state, config);
        const index = state.music.server.tracks.findIndex((item) => item.id === track.id);
        if (index >= 0) {
          state.music.server.currentIndex = index;
          state.music.server.title = track.title;
          state.music.server.artist = track.artist;
        }
      });
      res.json({
        ok: true,
        data: {
          track,
          media: {
            tracks: listKnownServerTracks(snapshot, config)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.delete("/admin/media/server/:id", (req, res, next) => {
    try {
      let deleted = null;
      const snapshot = updateAndPublish("admin.media.server.delete", (state) => {
        deleted = deleteServerTrack(config, req.params.id);
        state.music = state.music || {};
        state.music.server = state.music.server || {};
        const tracks = listKnownServerTracks(state, config);
        state.music.server.tracks = tracks;
        state.music.server.available = tracks.length > 0;
        state.music.server.currentIndex = Math.min(Number(state.music.server.currentIndex || 0), Math.max(0, tracks.length - 1));
        if (tracks.length === 0) {
          state.music.server.playing = false;
          state.music.server.title = "服务器暂无音频";
          state.music.server.artist = "";
        }
      });
      res.json({
        ok: true,
        data: {
          deleted,
          media: {
            tracks: listKnownServerTracks(snapshot, config)
          }
        }
      });
    } catch (error) {
      next(error);
    }
  });

  router.post("/admin/media/command", async (req, res, next) => {
    try {
      let result = null;
      const body = {
        requestId: req.requestId,
        tool: req.body?.tool || req.body?.action || "family.media.play",
        text: req.body?.text || req.body?.query || "",
        params: {
          ...(req.body?.params && typeof req.body.params === "object" ? req.body.params : {}),
          query: req.body?.query || req.body?.params?.query,
          trackId: req.body?.trackId || req.body?.params?.trackId,
          deviceId: req.body?.deviceId || req.body?.params?.deviceId || "esp32-185b"
        }
      };
      const resolvedMedia = await resolveServerMediaForCommand(store.snapshot(), config, body);
      const before = store.snapshot();
      const snapshot = store.update((state) => {
        result = enqueueXiaozhiToolCommand(state, config, { ...body, _resolvedMedia: resolvedMedia });
      });
      publishMutation(before, snapshot, "admin.media.command");
      if (result?.accepted && eventBus) {
        eventBus.publish("device.command.created", {
          command: result.command,
          speech: result.speech || ""
        });
      }
      res.status(result?.accepted ? 202 : 400).json({
        ok: Boolean(result?.accepted),
        data: {
          ...result,
          summary: deviceSummary(snapshotWithServerMedia(snapshot, config), config)
        }
      });
    } catch (error) {
      next(error);
    }
  });
}

module.exports = { registerAdminMediaRoutes, registerMediaRoutes };

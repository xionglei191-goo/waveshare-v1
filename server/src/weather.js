const FORECAST_URL = "https://api.open-meteo.com/v1/forecast";
const AIR_QUALITY_URL = "https://air-quality-api.open-meteo.com/v1/air-quality";
const { weatherSourceStatus } = require("./integration-status");

function weatherCondition(code) {
  const value = Number(code);
  if (value === 0) return "晴";
  if (value === 1) return "大部晴朗";
  if (value === 2) return "多云";
  if (value === 3) return "阴";
  if (value === 45 || value === 48) return "雾";
  if (value >= 51 && value <= 57) return "毛毛雨";
  if (value >= 61 && value <= 67) return "雨";
  if (value >= 71 && value <= 77) return "雪";
  if (value >= 80 && value <= 82) return "阵雨";
  if (value >= 85 && value <= 86) return "阵雪";
  if (value >= 95) return "雷雨";
  return "天气未知";
}

function airQualityLevel(aqi) {
  const value = Number(aqi);
  if (!Number.isFinite(value)) return "--";
  if (value <= 50) return "优";
  if (value <= 100) return "良";
  if (value <= 150) return "轻度污染";
  if (value <= 200) return "中度污染";
  if (value <= 300) return "重度污染";
  return "严重污染";
}

function rounded(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number) : null;
}

function decimal(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round(number * 10) / 10 : null;
}

function selectTonight(hourly, currentTime) {
  const times = Array.isArray(hourly?.time) ? hourly.time : [];
  const temperatures = Array.isArray(hourly?.temperature_2m) ? hourly.temperature_2m : [];
  const codes = Array.isArray(hourly?.weather_code) ? hourly.weather_code : [];
  const today = String(currentTime || "").slice(0, 10);
  const candidates = times
    .map((time, index) => ({ time, index }))
    .filter((item) => String(item.time).slice(0, 10) === today && item.time >= currentTime);
  const selected = candidates.find((item) => Number(String(item.time).slice(11, 13)) >= 20) ||
                   candidates[candidates.length - 1];
  if (!selected) return null;
  const temperature = rounded(temperatures[selected.index]);
  const weatherCode = rounded(codes[selected.index]);
  if (temperature === null || weatherCode === null) return null;
  return { condition: weatherCondition(weatherCode), weatherCode, temperature };
}

function parseForecast(payload, config) {
  const current = payload?.current || {};
  const daily = payload?.daily || {};
  const temperature = rounded(current.temperature_2m);
  const humidity = rounded(current.relative_humidity_2m);
  const apparentTemperature = rounded(current.apparent_temperature);
  const weatherCode = rounded(current.weather_code);
  if (temperature === null || humidity === null || weatherCode === null || !current.time) {
    throw new Error("Open-Meteo forecast missing current weather");
  }
  const tomorrowCode = rounded(daily.weather_code?.[1]);
  const tomorrowHigh = rounded(daily.temperature_2m_max?.[1]);
  const tomorrowLow = rounded(daily.temperature_2m_min?.[1]);
  const tomorrow = tomorrowCode === null || tomorrowHigh === null || tomorrowLow === null ? null : {
    condition: weatherCondition(tomorrowCode),
    weatherCode: tomorrowCode,
    high: tomorrowHigh,
    low: tomorrowLow
  };
  const condition = weatherCondition(weatherCode);
  const updatedLocalTime = new Intl.DateTimeFormat("zh-CN", {
    timeZone: config.weatherTimezone || "Asia/Shanghai",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false
  }).format(new Date());
  return {
    summary: `${condition} ${temperature}℃`,
    condition,
    temperature,
    humidity,
    apparentTemperature,
    weatherCode,
    location: config.weatherLocationLabel || "家",
    provider: "open-meteo",
    updatedAt: new Date().toISOString(),
    updatedLocalTime,
    sourceTime: current.time,
    forecast: {
      tonight: selectTonight(payload.hourly, current.time),
      tomorrow
    }
  };
}

function parseAirQuality(payload) {
  const aqi = rounded(payload?.current?.us_aqi);
  const pm25 = decimal(payload?.current?.pm2_5);
  if (aqi === null) throw new Error("Open-Meteo air quality missing AQI");
  const level = airQualityLevel(aqi);
  return { air: `空气 ${level}`, airQuality: { aqi, pm25, level } };
}

function requestUrl(base, params) {
  const url = new URL(base);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  return url.href;
}

async function fetchJson(url, timeoutMs, fetchImpl = fetch) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), Math.max(1000, Number(timeoutMs) || 6000));
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json", "User-Agent": "xiaozhi-family-hub/0.2" },
      signal: controller.signal
    });
    if (!response.ok) throw new Error(`Open-Meteo HTTP ${response.status}`);
    return await response.json();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchOpenMeteo(config, fetchImpl = fetch) {
  const common = {
    latitude: config.weatherLatitude,
    longitude: config.weatherLongitude,
    timezone: config.weatherTimezone || "Asia/Shanghai"
  };
  const forecastUrl = requestUrl(FORECAST_URL, {
    ...common,
    current: "temperature_2m,relative_humidity_2m,apparent_temperature,weather_code",
    hourly: "temperature_2m,weather_code",
    daily: "weather_code,temperature_2m_max,temperature_2m_min",
    forecast_days: 2
  });
  const airUrl = requestUrl(AIR_QUALITY_URL, { ...common, current: "us_aqi,pm2_5" });
  const [forecastResult, airResult] = await Promise.allSettled([
    fetchJson(forecastUrl, config.weatherTimeoutMs, fetchImpl),
    fetchJson(airUrl, config.weatherTimeoutMs, fetchImpl)
  ]);
  if (forecastResult.status !== "fulfilled") throw forecastResult.reason;
  const weather = parseForecast(forecastResult.value, config);
  if (airResult.status === "fulfilled") Object.assign(weather, parseAirQuality(airResult.value));
  return weather;
}

async function refreshWeatherState(state, config, options = {}) {
  if (config.weatherProvider !== "open-meteo") {
    return { ok: true, weather: state.weather, cached: true, provider: config.weatherProvider || "mock" };
  }
  try {
    const next = await fetchOpenMeteo(config, options.fetchImpl);
    if (!next.airQuality && state.weather?.airQuality) {
      next.airQuality = state.weather.airQuality;
      next.air = state.weather.air;
    }
    state.weather = next;
    return { ok: true, weather: next, cached: false, provider: "open-meteo" };
  } catch (error) {
    state.weather = {
      ...(state.weather || {}),
      lastRefreshError: error.message,
      lastRefreshFailedAt: new Date().toISOString()
    };
    return { ok: false, weather: state.weather, cached: true, error: error.message };
  }
}

async function refreshWeatherStore(store, config, options = {}) {
  let result;
  const snapshot = await store.updateAsync(async (state) => {
    result = await refreshWeatherState(state, config, options);
  });
  return { ...result, weather: snapshot.weather, snapshot };
}

function weatherView(weather, configuredProvider = weather?.provider || "mock") {
  const updatedAt = Date.parse(weather?.updatedAt || "");
  return {
    ...(weather || {}),
    sourceStatus: weatherSourceStatus(weather, configuredProvider),
    isStale: !Number.isFinite(updatedAt) || Date.now() - updatedAt > 2 * 60 * 60 * 1000
  };
}

module.exports = {
  airQualityLevel,
  fetchOpenMeteo,
  parseAirQuality,
  parseForecast,
  refreshWeatherState,
  refreshWeatherStore,
  selectTonight,
  weatherView,
  weatherCondition
};

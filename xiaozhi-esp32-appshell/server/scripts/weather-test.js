const assert = require("assert");

const {
  airQualityLevel,
  fetchOpenMeteo,
  refreshWeatherState,
  weatherCondition,
  weatherView
} = require("../src/weather");

const config = {
  weatherProvider: "open-meteo",
  weatherLatitude: 27.681864,
  weatherLongitude: 112.626292,
  weatherTimezone: "Asia/Shanghai",
  weatherLocationLabel: "家",
  weatherTimeoutMs: 1000
};

const forecastPayload = {
  current: {
    time: "2026-07-10T18:00",
    temperature_2m: 27.4,
    relative_humidity_2m: 83,
    apparent_temperature: 31.6,
    weather_code: 2
  },
  hourly: {
    time: ["2026-07-10T18:00", "2026-07-10T20:00", "2026-07-10T23:00"],
    temperature_2m: [27.4, 26.2, 25.5],
    weather_code: [2, 61, 61]
  },
  daily: {
    weather_code: [2, 80],
    temperature_2m_max: [32.1, 30.6],
    temperature_2m_min: [25.2, 24.4]
  }
};

const airPayload = {
  current: { us_aqi: 61, pm2_5: 24.24 }
};

function response(body, ok = true, status = 200) {
  return { ok, status, json: async () => body };
}

async function main() {
  assert.strictEqual(weatherCondition(0), "晴");
  assert.strictEqual(weatherCondition(3), "阴");
  assert.strictEqual(weatherCondition(61), "雨");
  assert.strictEqual(weatherCondition(80), "阵雨");
  assert.strictEqual(weatherCondition(95), "雷雨");

  assert.deepStrictEqual(
    [50, 100, 150, 200, 300, 301].map(airQualityLevel),
    ["优", "良", "轻度污染", "中度污染", "重度污染", "严重污染"]
  );

  const fetchSuccess = async (url) => url.includes("air-quality")
    ? response(airPayload)
    : response(forecastPayload);
  const weather = await fetchOpenMeteo(config, fetchSuccess);
  assert.strictEqual(weather.summary, "多云 27℃");
  assert.strictEqual(weather.apparentTemperature, 32);
  assert.strictEqual(weather.forecast.tonight.condition, "雨");
  assert.strictEqual(weather.forecast.tonight.temperature, 26);
  assert.deepStrictEqual(weather.forecast.tomorrow, {
    condition: "阵雨",
    weatherCode: 80,
    high: 31,
    low: 24
  });
  assert.deepStrictEqual(weather.airQuality, { aqi: 61, pm25: 24.2, level: "良" });

  const fetchWithoutAir = async (url) => {
    if (url.includes("air-quality")) return response({}, false, 503);
    return response(forecastPayload);
  };
  const partial = await fetchOpenMeteo(config, fetchWithoutAir);
  assert.strictEqual(partial.summary, "多云 27℃");
  assert.strictEqual(partial.airQuality, undefined);

  const cachedState = {
    weather: {
      summary: "晴 25℃",
      updatedAt: "2026-07-10T10:00:00.000Z",
      air: "空气 优",
      airQuality: { aqi: 30, pm25: 8, level: "优" }
    }
  };
  const failed = await refreshWeatherState(cachedState, config, {
    fetchImpl: async () => { throw new Error("timeout"); }
  });
  assert.strictEqual(failed.ok, false);
  assert.strictEqual(failed.cached, true);
  assert.strictEqual(cachedState.weather.summary, "晴 25℃");
  assert.strictEqual(cachedState.weather.lastRefreshError, "timeout");

  assert.strictEqual(weatherView({ updatedAt: new Date().toISOString() }).isStale, false);
  assert.strictEqual(weatherView({ updatedAt: "2020-01-01T00:00:00.000Z" }).isStale, true);
  assert.strictEqual(weatherView({}).isStale, true);

  console.log("weather tests ok");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});

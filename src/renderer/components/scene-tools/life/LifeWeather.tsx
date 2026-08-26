/**
 * 天气卡片 — 生活模式增强工具
 *
 * 功能：输入城市 → 获取当前天气（wttr.in 公共 API）→ 展示温度/体感/湿度/风 + 通勤建议
 */

import { useCallback, useEffect, useState } from 'react'
import { CloudSun, Search, MapPin, RefreshCw, Droplets, Wind, Thermometer } from 'lucide-react'
import { useWeatherPrefStore } from '../stores'

interface WeatherData {
  temp: string
  feels: string
  desc: string
  humidity: string
  wind: string
  weatherCode: string
}

export default function LifeWeather() {
  const city = useWeatherPrefStore((s) => s.city)
  const [input, setInput] = useState(city)
  const [data, setData] = useState<WeatherData | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const fetchWeather = useCallback(async (c: string) => {
    if (!c.trim()) return
    setLoading(true)
    setError(null)
    try {
      const res = await fetch(`https://wttr.in/${encodeURIComponent(c.trim())}?format=j1`, { headers: { Accept: 'application/json' } })
      if (!res.ok) throw new Error('bad status')
      const json = await res.json()
      const cur = json?.current_condition?.[0]
      if (!cur) throw new Error('no data')
      const desc = cur.weatherDesc?.[0]?.value ?? '未知'
      setData({
        temp: cur.temp_C,
        feels: cur.FeelsLikeC,
        desc,
        humidity: cur.humidity,
        wind: cur.windspeedKmph,
        weatherCode: cur.weatherCode,
      })
      useWeatherPrefStore.setState({ city: c.trim() })
    } catch {
      setError('天气服务不可用，请检查网络后重试')
      setData(null)
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    if (city) fetchWeather(city)
  }, [city, fetchWeather])

  const advice = (() => {
    if (!data) return ''
    const d = data.desc.toLowerCase()
    if (d.includes('rain') || d.includes('雪')) return '☔ 有降水，出门记得带伞'
    if (d.includes('thunder')) return '⛈️ 有雷雨，尽量减少外出'
    if (d.includes('snow')) return '❄️ 下雪天，注意保暖防滑'
    const t = Number(data.temp)
    if (t >= 33) return '🥵 高温天气，注意防暑补水'
    if (t <= 5) return '🧣 低温，注意添衣保暖'
    if (d.includes('cloud')) return '☁️ 多云，适合户外活动'
    return '☀️ 天气不错，适合户外活动'
  })()

  return (
    <div className="flex flex-col h-full overflow-hidden">
      <div className="flex items-center gap-2 px-1 mb-3">
        <CloudSun className="w-4 h-4 text-accent" />
        <span className="text-[13px] font-semibold">天气卡片</span>
      </div>

      <div className="flex gap-2 mb-3">
        <input
          value={input} onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && fetchWeather(input)}
          placeholder="输入城市，如：上海"
          className="flex-1 text-[12px] px-2.5 py-1.5 rounded-lg bg-surface border border-border/60 focus:outline-none"
        />
        <button
          onClick={() => fetchWeather(input)}
          disabled={loading}
          className="px-2.5 py-1.5 rounded-lg bg-accent text-white text-[12px] flex items-center gap-1 hover:opacity-90 disabled:opacity-50 transition-opacity"
        >
          {loading ? <RefreshCw className="w-3 h-3 animate-spin" /> : <Search className="w-3 h-3" />}
        </button>
      </div>

      {error && <div className="text-[12px] text-red-500 text-center py-4">{error}</div>}

      {data && (
        <div className="p-4 rounded-xl bg-gradient-to-br from-sky-500/10 to-indigo-500/10 border border-sky-500/20">
          <div className="flex items-center gap-1.5 text-[11px] text-text-muted mb-2">
            <MapPin className="w-3 h-3" /> {city || input}
          </div>
          <div className="flex items-center gap-4">
            <div className="text-4xl font-semibold tabular-nums">{data.temp}°</div>
            <div className="flex-1">
              <div className="text-[14px] font-medium">{data.desc}</div>
              <div className="text-[11px] text-text-muted mt-0.5">体感 {data.feels}°</div>
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2 mt-3">
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Droplets className="w-3 h-3 text-sky-400" /> 湿度 {data.humidity}%
            </div>
            <div className="flex items-center gap-1.5 text-[11px] text-text-muted">
              <Wind className="w-3 h-3 text-sky-400" /> 风速 {data.wind} km/h
            </div>
          </div>
          <div className="mt-3 text-[12px] text-text-primary/80 bg-background/50 rounded-lg px-3 py-2">
            {advice}
          </div>
        </div>
      )}

      {!data && !error && (
        <div className="text-center text-[12px] text-text-muted/60 py-10">
          输入城市查询天气，获取通勤建议
        </div>
      )}

      <div className="mt-auto pt-3 text-[10px] text-text-muted/50">
        数据来源：wttr.in 公共天气服务
      </div>
    </div>
  )
}

'use client'

import { useState, useEffect, useRef } from 'react'
import Map, { Marker, Popup } from 'react-map-gl/mapbox'
import mapboxgl from 'mapbox-gl'
// @ts-ignore - no bundled types
import NoSleep from 'nosleep.js'
import 'mapbox-gl/dist/mapbox-gl.css'
import { CAMERAS } from './cameras'
import { POLICE } from './police'
import { GAS_STATIONS } from './gas'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

// Distance in meters between two [lng, lat] points (haversine)
const distMeters = (aLng: number, aLat: number, bLng: number, bLat: number) => {
  const R = 6371000
  const dLat = ((bLat - aLat) * Math.PI) / 180
  const dLng = ((bLng - aLng) * Math.PI) / 180
  const s =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((aLat * Math.PI) / 180) * Math.cos((bLat * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return 2 * R * Math.asin(Math.sqrt(s))
}

// Compass bearing (deg) from point a to point b
const bearingDeg = (aLng: number, aLat: number, bLng: number, bLat: number) => {
  const p1 = (aLat * Math.PI) / 180
  const p2 = (bLat * Math.PI) / 180
  const dl = ((bLng - aLng) * Math.PI) / 180
  const y = Math.sin(dl) * Math.cos(p2)
  const x = Math.cos(p1) * Math.sin(p2) - Math.sin(p1) * Math.cos(p2) * Math.cos(dl)
  return ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360
}
const compass = (b: number) => ['N', 'NE', 'E', 'SE', 'S', 'SW', 'W', 'NW'][Math.round(b / 45) % 8]

// ICAO type designators that are helicopters (category A7 catches most, this is a fallback)
const HELI_TYPES = new Set([
  'R22', 'R44', 'R66', 'B06', 'B06T', 'B407', 'B412', 'B427', 'B429', 'B430', 'B505', 'B47G', 'B47T',
  'UH1', 'UH60', 'H60', 'H64', 'H47', 'H53', 'H53S', 'H65', 'H72', 'H160', 'H155', 'HUCO',
  'EC20', 'EC25', 'EC30', 'EC35', 'EC45', 'EC55', 'EC75', 'AS32', 'AS3B', 'AS50', 'AS55', 'AS65',
  'A109', 'A119', 'A139', 'A149', 'A169', 'A189', 'S61', 'S76', 'S92', 'SK76',
  'MD50', 'MD52', 'MD60', 'EXPL', 'GAZL', 'LAMA', 'ALOU', 'EN28', 'EN48', 'F28', 'F28F',
  'H269', 'H500', 'KMAX', 'MI8', 'MI24', 'MI38', 'KA26', 'KA32', 'KA52', 'NH90', 'TIGR', 'PUMA', 'LYNX', 'W3',
])

// Common fixed-wing designators - the provider occasionally tags jets as A7
// (rotorcraft), so these are never shown as helis even with a bad category.
const FIXED_WING_TYPES = new Set([
  'E190', 'E170', 'E175', 'C25A', 'C25B', 'C25C', 'C510', 'C525', 'C550', 'C560', 'C56X', 'C680', 'C700', 'C750',
  'LJ24', 'LJ25', 'LJ31', 'LJ35', 'LJ40', 'LJ45', 'LJ55', 'LJ60', 'LJ75',
  'GLF2', 'GLF3', 'GLF4', 'GLF5', 'GLF6', 'GLEX', 'GL5T', 'GL7T',
  'CL30', 'CL35', 'CL60', 'CRJ1', 'CRJ2', 'CRJ7', 'CRJ9', 'CRJX',
  'A319', 'A320', 'A321', 'A20N', 'A21N', 'B737', 'B738', 'B739', 'B38M', 'B39M',
  'DH8A', 'DH8B', 'DH8C', 'DH8D', 'AT45', 'AT72', 'AT76',
  'PC12', 'PC24', 'BE20', 'BE30', 'BE40', 'BE99', 'BE9L', 'BE9T', 'C208', 'C402', 'C404', 'C421',
  'F2TH', 'F900', 'FA50', 'FA7X', 'FA8X', 'HA4T', 'H25A', 'H25B', 'H25C', 'SB05', 'PRM1', 'EA50',
  'TBM7', 'TBM8', 'TBM9', 'SR22', 'SR20', 'C172', 'C182', 'PA28', 'PA31', 'PA46', 'P28A', 'P28R',
])

// Rough outline of Canada's southern edge - used to keep the heli layer
// Canadian-only even though the feed covers 1000km and spills into the US.
// Ray-cast point-in-polygon; vertices are [lng, lat] tracing the border
// (49th parallel -> Great Lakes -> St. Lawrence -> Atlantic provinces).
const CANADA_OUTLINE: [number, number][] = [
  [-141, 70], [-141, 49], [-95, 49], [-94.6, 48.6],
  [-92, 48], [-89.5, 48], [-88, 47.7], [-85.5, 46.8], [-84, 46.4],
  [-83.3, 45.8], [-83, 44], [-82.5, 43], [-82.7, 41.8], [-82.4, 41.9],
  [-81.5, 42.05], [-80, 42.2], [-79.5, 43.25], [-79, 43.25], [-78, 43.45],
  [-76.5, 43.7], [-75.5, 44.3], [-74.5, 44.9], [-73.5, 45], [-71.8, 45],
  [-70, 45.1], [-68.5, 47.2], [-67.8, 47.1], [-67, 45.2], [-66, 44.5],
  [-65.5, 43.4], [-64, 43.8], [-60.5, 45.7], [-59.5, 47.5], [-56, 50],
  [-53, 47], [-52.5, 48], [-53, 55], [-55, 59], [-60, 60], [-64, 62],
  [-70, 62.5], [-80, 69], [-95, 69], [-110, 69], [-125, 70],
]
const isCanada = (lng: number, lat: number) => {
  let inside = false
  for (let i = 0, j = CANADA_OUTLINE.length - 1; i < CANADA_OUTLINE.length; j = i++) {
    const [xi, yi] = CANADA_OUTLINE[i]
    const [xj, yj] = CANADA_OUTLINE[j]
    if (yi > lat !== yj > lat && lng < ((xj - xi) * (lat - yi)) / (yj - yi) + xi) inside = !inside
  }
  return inside
}

// Known chains default to prepay (pay inside/card before fuel). No-name
// independents are "potentially pump first". Community votes override both.
const KNOWN_BRANDS = ['esso', 'petro-canada', 'petro canada', 'shell', 'canadian tire', 'costco', 'chevron', 'ultramar', 'husky', 'mobil', 'sunoco', 'irving', 'circle k', 'couche-tard', 'mac\'s', '7-eleven', 'pioneer', 'fas gas', 'goco', 'olco', 'canadian tire gas']

const gasKey = (lng: number, lat: number) => `${lng.toFixed(4)},${lat.toFixed(4)}`

// 'pump'/'prepay' = community-verified; 'prepay-inferred' = known brand;
// 'pump-inferred' = unnamed independent. A station keeps its inferred label
// until 2+ votes agree otherwise - one stray vote can't flip it.
const classifyGas = (name: string, lng: number, lat: number, counts: Record<string, { pump: number; prepay: number }>) => {
  const inferred = KNOWN_BRANDS.some((b) => name.toLowerCase().includes(b)) ? 'prepay-inferred' : 'pump-inferred'
  const c = counts[gasKey(lng, lat)]
  if (!c) return inferred
  if (c.prepay >= 2 && c.prepay > c.pump) return 'prepay'
  if (c.pump >= 2 && c.pump > c.prepay) return 'pump'
  return inferred
}

const gasLabel = (c: string) =>
  c === 'pump' ? 'Pump before pay'
    : c === 'pump-inferred' ? 'Potentially pump first'
      : c === 'prepay' || c === 'prepay-inferred' ? 'Prepay'
        : 'payment unknown'

const HELI_NAMES: Record<string, string> = {
  R22: 'Robinson R22', R44: 'Robinson R44', R66: 'Robinson R66',
  B06: 'Bell 206 JetRanger', B407: 'Bell 407', B412: 'Bell 412', B427: 'Bell 427', B429: 'Bell 429', B505: 'Bell 505',
  UH1: 'Bell UH-1 Huey', H60: 'Sikorsky UH-60 Black Hawk', UH60: 'Sikorsky UH-60 Black Hawk',
  H64: 'Boeing AH-64 Apache', H47: 'Boeing CH-47 Chinook', H53S: 'Sikorsky CH-53E Super Stallion', H53: 'Sikorsky CH-53',
  H65: 'Airbus MH-65 Dolphin', H72: 'Airbus UH-72 Lakota', H160: 'Airbus H160', H155: 'Airbus H155',
  EC20: 'Eurocopter EC120', EC30: 'Eurocopter EC130', EC35: 'Airbus H135', EC45: 'Airbus H145', EC55: 'Eurocopter EC155',
  AS32: 'AS332 Super Puma', AS3B: 'AS332 Super Puma', AS50: 'Airbus H125 / AS350 AStar', AS55: 'AS355 TwinStar', AS65: 'AS365 Dauphin',
  A109: 'AgustaWestland AW109', A119: 'AgustaWestland AW119', A139: 'Leonardo AW139', A149: 'Leonardo AW149',
  A169: 'Leonardo AW169', A189: 'Leonardo AW189',
  S61: 'Sikorsky S-61', S76: 'Sikorsky S-76', S92: 'Sikorsky S-92',
  MD52: 'MD 520N NOTAR', MD60: 'MD 600N', EXPL: 'MD 900 Explorer',
  GAZL: 'Aérospatiale Gazelle', LAMA: 'Aérospatiale Lama', ALOU: 'Aérospatiale Alouette',
  H269: 'Schweizer 269', H500: 'MD 500', MI8: 'Mil Mi-8', MI24: 'Mil Mi-24 Hind', KA32: 'Kamov Ka-32',
  NH90: 'NHIndustries NH90', TIGR: 'Eurocopter Tiger', PUMA: 'SA330 Puma', LYNX: 'Westland Lynx',
}

export default function GPSMap() {
  const [viewState, setViewState] = useState({
    longitude: -122.4194,
    latitude: 37.7749,
    zoom: 13
  })
  const [userLocation, setUserLocation] = useState<{ longitude: number; latitude: number } | null>(null)
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<any[]>([])
  const [destination, setDestination] = useState<{ longitude: number; latitude: number } | null>(null)
  const [route, setRoute] = useState<any>(null)
  const [directions, setDirections] = useState<any[]>([])
  const [showSteps, setShowSteps] = useState(false)
  const [follow, setFollow] = useState(false)
  const [voiceOn, setVoiceOn] = useState(true)
  const [camsOnRoute, setCamsOnRoute] = useState<number | null>(null)
  const [avoidTolls, setAvoidTolls] = useState(false)
  const [avoidHighways, setAvoidHighways] = useState(false)
  const [avoidCams, setAvoidCams] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [waypoints, setWaypoints] = useState<{ longitude: number; latitude: number }[]>([])
  const [savedRoutes, setSavedRoutes] = useState<any[]>([])
  const [showSaved, setShowSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const mapRef = useRef<any>(null)
  const followRef = useRef(false)
  const voiceRef = useRef(true)
  const announcedRef = useRef<any>(null)
  const stepsRef = useRef<any[]>([])
  const justSelectedRef = useRef(false)
  const [showHeliList, setShowHeliList] = useState(false)
  const [helis, setHelis] = useState<any[]>([])
  const [selHeli, setSelHeli] = useState<any>(null)
  const [selPolice, setSelPolice] = useState<{ name: string; sub?: string; lng: number; lat: number } | null>(null)
  const [showGas, setShowGas] = useState(false)
  const [selGas, setSelGas] = useState<{ name: string; lng: number; lat: number } | null>(null)
  const [gasFilter, setGasFilter] = useState<'all' | 'pump' | 'prepay'>('all')
  const [gasVotes, setGasVotes] = useState<Record<string, { pump: number; prepay: number }>>({})
  const [batterySaver, setBatterySaver] = useState(false)
  const [speedKmh, setSpeedKmh] = useState<number>(0)
  const locRef = useRef(userLocation)
  const lastFixRef = useRef<{ lng: number; lat: number; t: number } | null>(null)
  const lastFixTsRef = useRef(0)
  const userMarkerRef = useRef<any>(null)
  const targetLocRef = useRef<[number, number] | null>(null)
  const markerInitRef = useRef(false)
  const routeRef = useRef<any>(null)
  const destRef = useRef<{ longitude: number; latitude: number } | null>(null)
  const wpsRef = useRef<{ longitude: number; latitude: number }[]>([])
  const prefsRef = useRef({ tolls: false, highways: false, cams: false })
  const routeSetAtRef = useRef(0)
  const gasRef = useRef(false)
  const gasVotesRef = useRef<Record<string, { pump: number; prepay: number }>>({})
  const gasFilterRef = useRef<'all' | 'pump' | 'prepay'>('all')
  const offRouteSinceRef = useRef<number | null>(null)
  const lastRerouteRef = useRef(0)
  const reroutingRef = useRef(false)

  // Keep refs in sync so geolocation callback can read latest values
  followRef.current = follow
  voiceRef.current = voiceOn
  stepsRef.current = directions
  locRef.current = userLocation
  routeRef.current = route
  destRef.current = destination
  wpsRef.current = waypoints
  prefsRef.current = { tolls: avoidTolls, highways: avoidHighways, cams: avoidCams }
  gasRef.current = showGas
  gasVotesRef.current = gasVotes
  gasFilterRef.current = gasFilter

  // User dot marker: imperative mapboxgl marker so it can glide frame-by-frame
  // without React re-renders. Blue dot + pulsing ring + heading cone, Google-style.
  const ensureUserMarker = (map: any) => {
    if (userMarkerRef.current) return userMarkerRef.current
    const el = document.createElement('div')
    el.style.cssText = 'position:relative;width:0;height:0'
    el.innerHTML = `
      <div class="gps-cone" style="display:none;position:absolute;left:-11px;top:-34px;width:0;height:0;border-left:11px solid transparent;border-right:11px solid transparent;border-top:32px solid rgba(66,133,244,0.35);transform-origin:11px 34px"></div>
      <div style="position:absolute;left:-14px;top:-14px;width:28px;height:28px;border-radius:50%;background:rgba(66,133,244,0.25);animation:gpsPulse 2s ease-out infinite"></div>
      <div style="position:absolute;left:-8px;top:-8px;width:16px;height:16px;border-radius:50%;background:#4285f4;border:2.5px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,0.4)"></div>`
    const mk = new mapboxgl.Marker({ element: el, anchor: 'center' })
    mk.setLngLat([0, 0]).addTo(map)
    userMarkerRef.current = mk
    return mk
  }

  // Glide the user dot toward each new GPS fix instead of teleporting.
  // Battery: the frame loop only runs while converging, then sleeps.
  const glideRunningRef = useRef(false)
  const kickGlide = () => {
    if (glideRunningRef.current) return
    glideRunningRef.current = true
    const tick = () => {
      const mk = userMarkerRef.current
      const t = targetLocRef.current
      if (!mk || !t) {
        glideRunningRef.current = false
        return
      }
      const cur = mk.getLngLat()
      if (!cur.lng && !cur.lat) {
        mk.setLngLat(t)
        glideRunningRef.current = false
        return
      }
      const dlng = t[0] - cur.lng
      const dlat = t[1] - cur.lat
      if (Math.abs(dlng) + Math.abs(dlat) < 1e-7) {
        mk.setLngLat(t)
        glideRunningRef.current = false
        return
      }
      mk.setLngLat([cur.lng + dlng * 0.14, cur.lat + dlat * 0.14])
      requestAnimationFrame(tick)
    }
    requestAnimationFrame(tick)
  }

  // Speak a navigation instruction
  const speak = (text: string) => {
    if (!voiceRef.current || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    synth.speak(utterance)
  }

  // Initial position fix (one shot)
  useEffect(() => {
    if (!navigator.geolocation) return
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const { longitude, latitude } = position.coords
        setUserLocation({ longitude, latitude })
        setViewState({ longitude, latitude, zoom: 15 })
        setFollow(true)
      },
      (error) => {
        console.error('Error getting location:', error)
      },
      { enableHighAccuracy: true, maximumAge: 30000, timeout: 15000 }
    )
  }, [])

  // Battery: the GPS radio only runs in high-accuracy mode while a route is
  // active; plain map browsing uses coarse positioning, which is far cheaper.
  const navOn = Boolean(route)
  useEffect(() => {
    if (!navigator.geolocation) return
    const geoOpts = navOn && !batterySaver
      ? { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 }
      : { enableHighAccuracy: false, maximumAge: 10000, timeout: 20000 }
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const { longitude, latitude } = position.coords
        targetLocRef.current = [longitude, latitude]
        kickGlide()

          const map = mapRef.current?.getMap()
          if (map) {
            // Create/update the gliding marker imperatively (no React re-render per frame)
            const mk = ensureUserMarker(map)
            if (!markerInitRef.current) {
              mk.setLngLat([longitude, latitude])
              markerInitRef.current = true
            }
            // Heading cone (when device reports a bearing)
            const hdg = position.coords.heading
            const cone = mk.getElement().querySelector('.gps-cone') as HTMLElement | null
            if (cone) {
              if (hdg != null && !isNaN(hdg)) {
                cone.style.display = 'block'
                cone.style.transform = `rotate(${hdg}deg)`
              } else {
                cone.style.display = 'none'
              }
            }
          }

          // Battery: React state only needs frequent updates while navigating;
          // in browse mode throttle re-renders to every 2s
          const now = Date.now()
          if (navOn || now - lastFixTsRef.current > 2000) {
            setUserLocation({ longitude, latitude })
            lastFixTsRef.current = now
          }
          locRef.current = { longitude, latitude }

          // Speed display: cross-check the device's own speed reading against
          // actual displacement between fixes. Sitting still, GPS jitter makes
          // fixes bounce around inside the accuracy circle - if the estimated
          // speed from displacement is near zero, any claimed speed is bogus.
          const acc = position.coords.accuracy ?? 30
          const last = lastFixRef.current
          const dt = last ? (position.timestamp - last.t) / 1000 : 0
          const moved = last ? distMeters(last.lng, last.lat, longitude, latitude) : 0
          const estKmh = last && dt > 0 ? (moved / dt) * 3.6 : null
          const deviceKmh =
            position.coords.speed != null && !isNaN(position.coords.speed)
              ? position.coords.speed * 3.6
              : null
          let kmh = deviceKmh ?? 0
          if (estKmh != null && estKmh < 3) kmh = 0
          if (deviceKmh == null && estKmh != null && moved > Math.max(acc * 0.5, 2)) kmh = estKmh
          lastFixRef.current = { lng: longitude, lat: latitude, t: position.timestamp }
          setSpeedKmh(kmh < 7 ? 0 : Math.round(kmh))

          // Follow mode: keep camera centered on user (like Google Maps navigation)
          if (followRef.current) {
            if (map) {
              // linear easing = constant glide, no rubber-band stall between fixes
              map.easeTo({ center: [longitude, latitude], duration: 900, easing: (t: number) => t })
            } else {
              setViewState((vs) => ({ ...vs, longitude, latitude }))
            }
          }

          // Voice guidance: announce instruction when approaching its maneuver point.
          // directions[] holds only REMAINING steps - passed turns get removed below.
          const steps = stepsRef.current
          const next = steps[0]
          if (next?.maneuver?.location) {
            const [mLng, mLat] = next.maneuver.location
            const d = distMeters(longitude, latitude, mLng, mLat)
            if (d < 50 && announcedRef.current !== next) {
              announcedRef.current = next
              const text = next.maneuver?.instruction || 'Continue'
              speak(`In ${Math.round(d)} meters, ${text}`)
            }
            if (d < 12 && steps.length > 1) {
              // Passed the maneuver - drop it so only upcoming turns remain,
              // and read out the new next step right away
              setDirections((prev) => prev.slice(1))
              const upcoming = steps[1]
              if (upcoming?.maneuver?.instruction) {
                speak(`Then, ${upcoming.maneuver.instruction}`)
                announcedRef.current = upcoming
              }
            }
          }

          // Off-route detection: if we stray >30m from the route polyline for
          // 2s straight, recalculate from the current position. Mapbox picks the
          // smartest rejoin (almost never demands a U-turn), remaining waypoints
          // carry over, and the camera-avoid iteration still runs when '0 cams'
          // is on. Guarded by an accuracy check, a grace period after each route
          // set, and a 15s cooldown so it can't flail.
          const curRoute = routeRef.current
          const curDest = destRef.current
          if (
            curRoute?.geometry?.coordinates && curDest &&
            now - routeSetAtRef.current > 8000 &&
            (position.coords.accuracy == null || position.coords.accuracy < 45)
          ) {
            const coords: number[][] = curRoute.geometry.coordinates
            let minD = Infinity
            for (const [cl, ct] of coords) {
              const dd = distMeters(longitude, latitude, cl, ct)
              if (dd < minD) minD = dd
              if (minD < 30) break
            }
            if (minD > 30) {
              if (offRouteSinceRef.current == null) offRouteSinceRef.current = now
              if (
                now - offRouteSinceRef.current > 2000 &&
                now - lastRerouteRef.current > 15000 &&
                !reroutingRef.current
              ) {
                reroutingRef.current = true
                lastRerouteRef.current = now
                // Drop waypoints already reached so the reroute doesn't send
                // the driver back to a stop they already visited
                const remaining = wpsRef.current.filter(
                  (w) => distMeters(longitude, latitude, w.longitude, w.latitude) > 80
                )
                speak('Rerouting')
                const { tolls, highways, cams } = prefsRef.current
                getDirections(curDest, {
                  tolls, highways, cams,
                  wps: remaining,
                  from: { longitude, latitude },
                }).finally(() => {
                  reroutingRef.current = false
                })
              }
            } else {
              offRouteSinceRef.current = null
            }
          }
        },
        (error) => {
          console.error('Error watching location:', error)
        },
        geoOpts
      )

    return () => navigator.geolocation.clearWatch(watchId)
  }, [navOn, batterySaver])

  // Keep the screen awake the whole time the site is open. On iOS the Wake
  // Lock API is unreliable (all iOS browsers are WebKit), so NoSleep also
  // plays a tiny hidden looping video - the reliable way to block the iPhone
  // screen timeout. Needs a user gesture to start video -> enable on any tap.
  useEffect(() => {
    const noSleep = new NoSleep()
    const enable = () => {
      try { noSleep.enable() } catch {}
    }
    const reacquire = () => {
      if (document.visibilityState === 'visible') enable()
    }
    enable()
    document.addEventListener('pointerdown', enable)
    document.addEventListener('visibilitychange', reacquire)
    return () => {
      document.removeEventListener('pointerdown', enable)
      document.removeEventListener('visibilitychange', reacquire)
      try { noSleep.disable() } catch {}
    }
  }, [])

  // Load saved routes once (user is always signed in past the AuthGate)
  useEffect(() => {
    fetch('/api/routes')
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => d && setSavedRoutes(d.routes || []))
      .catch(() => {})
  }, [])

  // Live helicopter tracking via adsb.lol ADS-B (free, no key, includes military/police).
  // Point endpoint caps at 250nm (~463km); the /mil feed covers military anywhere, filtered to 1000km.
  useEffect(() => {
    if (batterySaver) {
      setHelis([])
      setSelHeli(null)
      return
    }
    let alive = true
    let timer: ReturnType<typeof setTimeout>
    const load = async () => {
      if (!alive) return
      // Adaptive poll: 35s while helis are on screen, 90s when the sky's empty,
      // 90s while the tab is hidden (don't wake the radio in the background)
      let next = 90000
      if (document.hidden) {
        timer = setTimeout(load, next)
        return
      }
      const loc = locRef.current ?? (() => {
        const c = mapRef.current?.getMap()?.getCenter()
        return c ? { longitude: c.lng, latitude: c.lat } : null
      })()
      if (!loc) {
        timer = setTimeout(load, next)
        return
      }
      const d = await fetch(`/api/helis?lat=${loc.latitude.toFixed(4)}&lng=${loc.longitude.toFixed(4)}`)
        .then((r) => (r.ok ? r.json() : null))
        .catch(() => null)
      const point = { ac: d?.point ?? [] }
      const mil = { ac: d?.mil ?? [] }
      const seen = new Set<string>()
      const out: any[] = []
      const push = (a: any, isMil: boolean) => {
        if (!a?.hex || a.lat == null || a.lon == null || seen.has(a.hex)) return
        const t = (a.t || '').toUpperCase().trim()
        if (FIXED_WING_TYPES.has(t)) return
        if (a.category !== 'A7' && !HELI_TYPES.has(t)) return
        const dKm = distMeters(loc.longitude, loc.latitude, a.lon, a.lat) / 1000
        if (dKm > 1000 || !isCanada(a.lon, a.lat)) return
        seen.add(a.hex)
        out.push({
          hex: a.hex,
          callsign: (a.flight || '').trim(),
          reg: a.r || '',
          type: t,
          name: HELI_NAMES[t] || (t ? `Type ${t}` : 'Helicopter'),
          lat: a.lat,
          lon: a.lon,
          alt: a.alt_baro === 'ground' ? 0 : a.alt_baro ?? null,
          gs: a.gs ?? null,
          track: a.track ?? null,
          squawk: a.squawk || '',
          emergency: a.emergency && a.emergency !== 'none' ? a.emergency : '',
          mil: isMil || !!(a.dbFlags & 1),
          distKm: dKm,
        })
      }
      point?.ac?.forEach((a: any) => push(a, false))
      mil?.ac?.forEach((a: any) => push(a, true))
      if (!alive) return
      out.sort((a, b) => a.distKm - b.distKm)
      setHelis(out)
      setSelHeli((s: any) => (s ? out.find((h) => h.hex === s.hex) ?? s : s))
      next = out.length > 0 ? 35000 : 90000
      timer = setTimeout(load, next)
    }
    load()
    return () => {
      alive = false
      clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- location read via ref so GPS ticks don't retrigger fetches
  }, [batterySaver])

  const saveCurrentRoute = async (name: string) => {
    if (!destination) return
    try {
      const res = await fetch('/api/routes', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: name || searchQuery || 'Saved route',
          destName: searchQuery || 'Destination',
          destLng: destination.longitude,
          destLat: destination.latitude,
          waypoints,
          avoidTolls,
          avoidHighways,
          avoidCams,
        }),
      })
      if (res.ok) {
        setSaving(false)
        setSaveName('')
        const d = await fetch('/api/routes').then((r) => r.json())
        setSavedRoutes(d.routes || [])
      }
    } catch (e) {
      console.error('Save route failed:', e)
    }
  }

  const loadSavedRoute = async (r: any) => {
    setShowSaved(false)
    const dest = { longitude: Number(r.dest_lng), latitude: Number(r.dest_lat) }
    // JSONB may come back as a string depending on the driver - normalize
    const raw = typeof r.waypoints === 'string' ? JSON.parse(r.waypoints) : r.waypoints || []
    const wps = (Array.isArray(raw) ? raw : []).map((w: any) => ({
      longitude: Number(w.longitude),
      latitude: Number(w.latitude),
    }))
    setDestination(dest)
    setWaypoints(wps)
    setAvoidTolls(!!r.avoid_tolls)
    setAvoidHighways(!!r.avoid_highways)
    setAvoidCams(!!r.avoid_cams)
    setFollow(false)
    setViewState({ longitude: dest.longitude, latitude: dest.latitude, zoom: 13 })
    justSelectedRef.current = true
    setSearchQuery(r.dest_name || '')

    // Wait for a GPS fix if one isn't ready yet - otherwise the call silently fails
    let loc = userLocation
    if (!loc && navigator.geolocation) {
      loc = await new Promise<{ longitude: number; latitude: number } | null>((resolve) => {
        navigator.geolocation.getCurrentPosition(
          (p) => resolve({ longitude: p.coords.longitude, latitude: p.coords.latitude }),
          () => resolve(null),
          { timeout: 8000 }
        )
      })
      if (loc) setUserLocation(loc)
    }
    if (loc) {
      getDirections(dest, {
        tolls: !!r.avoid_tolls,
        highways: !!r.avoid_highways,
        cams: !!r.avoid_cams,
        wps,
        from: loc,
      })
    }
  }

  const deleteSavedRoute = async (id: number) => {
    try {
      await fetch(`/api/routes/${id}`, { method: 'DELETE' })
      setSavedRoutes((rs) => rs.filter((r) => r.id !== id))
    } catch (e) {
      console.error('Delete route failed:', e)
    }
  }

  // Live autocomplete search - fires as you type, biased toward your location,
  // covers businesses (POI), addresses, and neighborhoods like Google Maps
  useEffect(() => {
    if (!searchQuery.trim() || !MAPBOX_TOKEN) {
      setSearchResults([])
      return
    }
    if (justSelectedRef.current) {
      justSelectedRef.current = false
      return
    }

    const t = setTimeout(async () => {
      try {
        const prox = userLocation
          ? `&proximity=${userLocation.longitude},${userLocation.latitude}`
          : ''
        const response = await fetch(
          `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}&autocomplete=true&limit=8&types=poi%2Caddress%2Cneighborhood%2Clocality%2Cplace${prox}`
        )
        const data = await response.json()
        setSearchResults(data.features || [])
      } catch (error) {
        console.error('Error searching:', error)
      }
    }, 300)
    return () => clearTimeout(t)
    // eslint-disable-next-line react-hooks/exhaustive-deps -- userLocation must not retrigger the search on every GPS tick
  }, [searchQuery])

  // Cameras within radius of a route, sorted closest-first
  const camsOnPath = (r: any, radius = 150) => {
    const coords: number[][] = r.geometry.coordinates
    return CAMERAS.map(([lng, lat]) => ({
      lng,
      lat,
      d: Math.min(...coords.map(([cLng, cLat]) => distMeters(lng, lat, cLng, cLat)))
    }))
      .filter((c) => c.d < radius)
      .sort((a, b) => a.d - b.d)
  }

  // Get directions - optionally iteratively re-route to avoid cameras on the path
  const getDirections = async (
    dest: { longitude: number; latitude: number },
    opts?: { tolls: boolean; highways: boolean; cams: boolean; wps?: { longitude: number; latitude: number }[]; from?: { longitude: number; latitude: number } }
  ) => {
    const origin = opts?.from ?? userLocation
    if (!origin || !MAPBOX_TOKEN) return

    const tolls = opts?.tolls ?? avoidTolls
    const highways = opts?.highways ?? avoidHighways
    const camsStrict = opts?.cams ?? avoidCams
    const wps = opts?.wps ?? waypoints
    const classes = [tolls ? 'toll' : '', highways ? 'motorway' : ''].filter(Boolean)

    const buildExclude = (pts: [number, number][]) => {
      const parts = [...classes, ...pts.map(([lng, lat]) => `point(${lng} ${lat})`)]
      return parts.length ? '&exclude=' + parts.join(',') : ''
    }

    const coords = [origin, ...wps, dest].map((p) => `${p.longitude},${p.latitude}`).join(';')
    // alternatives only supported on 2-point routes
    const alt = wps.length === 0 ? '&alternatives=true' : ''
    const url = (exclude: string) =>
      `https://api.mapbox.com/directions/v5/mapbox/driving/${coords}?steps=true&geometries=geojson&overview=full${alt}${exclude}&access_token=${MAPBOX_TOKEN}`

    const score = (r: any) => camsOnPath(r).length

    const fetchBest = async (exclude: string) => {
      const res = await fetch(url(exclude))
      const data = await res.json()
      const routes: any[] = data.routes || []
      if (routes.length === 0) return null
      // prefer fewest cameras, then shortest time
      return routes.sort((a, b) => score(a) - score(b) || a.duration - b.duration)[0]
    }

    try {
      let route = await fetchBest(buildExclude([]))
      if (!route) return

      if (camsStrict) {
        const excluded = new Set<string>()
        const pts: [number, number][] = []
        let motorwayAdded = classes.includes('motorway')
        let best = route // track the best route ever seen - never end worse than we started

        for (let attempt = 0; attempt < 8 && score(best) > 0; attempt++) {
          // Exclude the cams closest to the route first (up to the 50-point cap)
          const fresh = camsOnPath(route, 200).filter(
            (c) => !excluded.has(`${c.lng},${c.lat}`)
          )

          if (fresh.length === 0 || pts.length >= 50) {
            // Nothing left to exclude within budget - try dropping motorways once
            if (!motorwayAdded) {
              classes.push('motorway')
              motorwayAdded = true
              try {
                const next = await fetchBest(buildExclude(pts))
                if (next) {
                  if (score(next) <= score(route)) route = next
                  if (score(next) < score(best)) best = next
                }
              } catch {}
              continue
            }
            break
          }

          for (const c of fresh.slice(0, 50 - pts.length)) {
            excluded.add(`${c.lng},${c.lat}`)
            pts.push([c.lng, c.lat])
          }

          try {
            const next = await fetchBest(buildExclude(pts))
            if (!next) break
            if (score(next) <= score(route)) route = next // accept non-worse
            if (score(next) < score(best)) best = next
          } catch {
            break
          }
        }

        route = best
        const remaining = score(route)
        if (remaining === 0) {
          speak('Camera-free route set')
        } else {
          speak(`Warning: no camera-free route found. Route passes ${remaining} camera${remaining > 1 ? 's' : ''}`)
        }
      }

      // Always show the camera count on whatever route we end up with
      setCamsOnRoute(score(route))

      setRoute(route)
      routeSetAtRef.current = Date.now()
      const steps = route.legs.flatMap((leg: any) => leg.steps || [])
      setDirections(steps)
      setShowSteps(false)
      announcedRef.current = null
      // Lock camera onto user once navigation starts, like Google Maps
      // (skip while custom-planning so waypoint taps don't yank the camera)
      if (!customMode) {
        setFollow(true)
        setViewState({ longitude: origin.longitude, latitude: origin.latitude, zoom: 16 })
      }
      // Announce first instruction (also unlocks speech on iOS, since this runs after a tap)
      if (steps[0]?.maneuver?.instruction) {
        speak(steps[0].maneuver.instruction)
        announcedRef.current = steps[0]
      }
    } catch (error) {
      console.error('Error getting directions:', error)
    }
  }

  // Select a search result
  const selectResult = (result: any) => {
    const [lng, lat] = result.center ?? result.geometry?.coordinates ?? []
    if (lng == null || lat == null) return
    const dest = { longitude: lng, latitude: lat }
    setDestination(dest)
    setWaypoints([])
    setFollow(false)
    setViewState({ longitude: lng, latitude: lat, zoom: 15 })
    setSearchResults([])
    justSelectedRef.current = true
    setSearchQuery(result.text || result.place_name)
    getDirections(dest, { tolls: avoidTolls, highways: avoidHighways, cams: avoidCams, wps: [] })
  }

  // Add a custom waypoint on the route (custom mode tap)
  const addWaypoint = (longitude: number, latitude: number) => {
    if (!destination || waypoints.length >= 23) return // Mapbox caps at 25 coords total
    const wps = [...waypoints, { longitude, latitude }]
    setWaypoints(wps)
    getDirections(destination, { tolls: avoidTolls, highways: avoidHighways, cams: avoidCams, wps })
  }

  const undoWaypoint = () => {
    if (!destination || waypoints.length === 0) return
    const wps = waypoints.slice(0, -1)
    setWaypoints(wps)
    getDirections(destination, { tolls: avoidTolls, highways: avoidHighways, cams: avoidCams, wps })
  }

  // Clear route and reset navigation
  const clearRoute = () => {
    setRoute(null)
    setDirections([])
    setDestination(null)
    setWaypoints([])
    setCustomMode(false)
    setShowSteps(false)
    setSaving(false)
    setCamsOnRoute(null)
    announcedRef.current = null
    if ('speechSynthesis' in window) window.speechSynthesis.cancel()
  }

  // Target button: re-center on user and re-enable follow mode
  const recenter = () => {
    if (!userLocation) return
    setFollow(true)
    const map = mapRef.current?.getMap()
    if (map) {
      map.easeTo({ center: [userLocation.longitude, userLocation.latitude], zoom: Math.max(viewState.zoom, 15), duration: 600 })
    } else {
      setViewState({ longitude: userLocation.longitude, latitude: userLocation.latitude, zoom: 15 })
    }
  }

  const drawRoute = (map: any, r: any) => {
    if (map.getSource('route')) {
      if (map.getLayer('route')) map.removeLayer('route')
      if (map.getLayer('route-casing')) map.removeLayer('route-casing')
      map.removeSource('route')
    }

    map.addSource('route', {
      type: 'geojson',
      data: {
        type: 'Feature',
        properties: {},
        geometry: r.geometry
      }
    })

    // White casing underneath so the line pops against the map
    map.addLayer({
      id: 'route-casing',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#ffffff',
        'line-width': 10,
        'line-opacity': 0.9
      }
    })

    map.addLayer({
      id: 'route',
      type: 'line',
      source: 'route',
      layout: {
        'line-join': 'round',
        'line-cap': 'round'
      },
      paint: {
        'line-color': '#1a73e8',
        'line-width': 6,
        'line-opacity': 0.95
      }
    })
  }

  // Draw route on map when it changes
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (map && route) drawRoute(map, route)

    return () => {
      const m = mapRef.current?.getMap()
      if (m?.getSource('route')) {
        if (m.getLayer('route')) m.removeLayer('route')
        if (m.getLayer('route-casing')) m.removeLayer('route-casing')
        m.removeSource('route')
      }
    }
  }, [route])

  // Custom layers (cams, police badges). Called on initial load AND again on
  // 'style.load' - switching mapStyle (battery saver dark mode) destroys every
  // custom source/layer, so they must be re-added each time a style loads.
  const setupMapLayers = (map: any) => {
    if (map.getSource('traffic-cams')) return

    const size = 64
    const canvas = document.createElement('canvas')
    canvas.width = size
    canvas.height = size
    const ctx = canvas.getContext('2d')!
    // red warning circle
    ctx.beginPath()
    ctx.arc(32, 32, 30, 0, Math.PI * 2)
    ctx.fillStyle = '#f59e0b'
    ctx.fill()
    ctx.strokeStyle = '#92400e'
    ctx.lineWidth = 3
    ctx.stroke()
    // camera body
    ctx.fillStyle = '#1f2937'
    ctx.fillRect(16, 24, 24, 16)
    ctx.beginPath()
    ctx.moveTo(40, 28)
    ctx.lineTo(50, 22)
    ctx.lineTo(50, 42)
    ctx.lineTo(40, 36)
    ctx.closePath()
    ctx.fill()
    // lens
    ctx.fillStyle = '#9ca3af'
    ctx.fillRect(20, 29, 6, 6)

    map.addImage('cam-icon', ctx.getImageData(0, 0, size, size))

    const pCanvas = document.createElement('canvas')
    pCanvas.width = size
    pCanvas.height = size

    map.addSource('traffic-cams', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: CAMERAS.map(([lng, lat, name]) => ({
          type: 'Feature',
          properties: { name },
          geometry: { type: 'Point', coordinates: [lng, lat] }
        }))
      }
    })

    map.addLayer({
      id: 'traffic-cams',
      type: 'symbol',
      source: 'traffic-cams',
      layout: {
        'icon-image': 'cam-icon',
        'icon-size': 0.5,
        'icon-allow-overlap': true
      }
    })

    // Police badge icon: blue circle with white star
    const pCtx = pCanvas.getContext('2d')!
    pCtx.beginPath()
    pCtx.arc(32, 32, 30, 0, Math.PI * 2)
    pCtx.fillStyle = '#1d4ed8'
    pCtx.fill()
    pCtx.strokeStyle = '#ffffff'
    pCtx.lineWidth = 3
    pCtx.stroke()
    pCtx.fillStyle = '#ffffff'
    pCtx.beginPath()
    const cx = 32, cy = 32, spikes = 5, outer = 16, inner = 7
    let rot = (-Math.PI / 2)
    const step = Math.PI / spikes
    pCtx.moveTo(cx, cy - outer)
    for (let i = 0; i < spikes; i++) {
      pCtx.lineTo(cx + Math.cos(rot) * outer, cy + Math.sin(rot) * outer)
      rot += step
      pCtx.lineTo(cx + Math.cos(rot) * inner, cy + Math.sin(rot) * inner)
      rot += step
    }
    pCtx.closePath()
    pCtx.fill()
    map.addImage('police-icon', pCtx.getImageData(0, 0, size, size))

    map.addSource('police-stations', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: POLICE.map(([lng, lat, name]) => ({
          type: 'Feature',
          properties: { name },
          geometry: { type: 'Point', coordinates: [lng, lat] }
        }))
      }
    })

    map.addLayer({
      id: 'police-stations',
      type: 'symbol',
      source: 'police-stations',
      layout: {
        'icon-image': 'police-icon',
        'icon-size': 0.42,
        'icon-allow-overlap': true
      }
    })

    // Gas pump icon: green circle, white pump body + hose
    const gCanvas = document.createElement('canvas')
    gCanvas.width = size
    gCanvas.height = size
    const gCtx = gCanvas.getContext('2d')!
    gCtx.beginPath()
    gCtx.arc(32, 32, 30, 0, Math.PI * 2)
    gCtx.fillStyle = '#16a34a'
    gCtx.fill()
    gCtx.strokeStyle = '#ffffff'
    gCtx.lineWidth = 3
    gCtx.stroke()
    gCtx.fillStyle = '#ffffff'
    gCtx.fillRect(20, 20, 20, 24)
    gCtx.fillRect(23, 24, 14, 8)
    gCtx.beginPath()
    gCtx.moveTo(40, 22)
    gCtx.lineTo(46, 26)
    gCtx.lineTo(46, 38)
    gCtx.lineWidth = 3
    gCtx.strokeStyle = '#ffffff'
    gCtx.stroke()
    gCtx.fillStyle = '#16a34a'
    gCtx.fillRect(24, 25, 12, 6)
    map.addImage('gas-icon', gCtx.getImageData(0, 0, size, size))

    map.addSource('gas-stations', {
      type: 'geojson',
      data: {
        type: 'FeatureCollection',
        features: GAS_STATIONS.map(([lng, lat, name]) => ({
          type: 'Feature',
          properties: { name, key: gasKey(lng, lat) },
          geometry: { type: 'Point', coordinates: [lng, lat] }
        }))
      }
    })

    map.addLayer({
      id: 'gas-stations',
      type: 'symbol',
      source: 'gas-stations',
      layout: {
        'icon-image': 'gas-icon',
        'icon-size': 0.42,
        'icon-allow-overlap': true,
        visibility: gasRef.current ? 'visible' : 'none'
      }
    })
  }

  // Show/hide the gas layer, and lazily load community votes the first time
  // the layer is switched on. The pump/prepay filter is applied as a Mapbox
  // layer filter over the station 'key' property.
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (map?.getLayer('gas-stations')) {
      map.setLayoutProperty('gas-stations', 'visibility', showGas ? 'visible' : 'none')
    }
    if (!showGas) setSelGas(null)
    else {
      fetch('/api/gasvote')
        .then((r) => (r.ok ? r.json() : null))
        .then((d) => { if (d?.votes) setGasVotes(d.votes) })
        .catch(() => {})
    }
  }, [showGas])

  const applyGasFilter = (map: any) => {
    if (!map?.getLayer('gas-stations')) return
    const f = gasFilterRef.current
    if (f === 'all') {
      map.setFilter('gas-stations', null)
      return
    }
    const keys = GAS_STATIONS
      .filter(([lng, lat, name]) => {
        const c = classifyGas(name, lng, lat, gasVotesRef.current)
        return f === 'pump' ? c === 'pump' || c === 'pump-inferred' : c === 'prepay' || c === 'prepay-inferred'
      })
      .map(([lng, lat]) => gasKey(lng, lat))
    map.setFilter('gas-stations', ['in', ['get', 'key'], ['literal', keys]])
  }

  useEffect(() => {
    const map = mapRef.current?.getMap()
    applyGasFilter(map)
  }, [gasFilter, gasVotes])

  const etaMin = route ? Math.round(route.duration / 60) : null
  const distKm = route ? (route.distance / 1000).toFixed(1) : null
  const nextStep = directions[0]

  return (
    <div className="relative w-full h-dvh">
      <style>{`@keyframes gpsPulse{0%{transform:scale(0.6);opacity:0.8}70%{transform:scale(2.6);opacity:0}100%{transform:scale(2.6);opacity:0}}`}</style>
      <Map
        ref={mapRef}
        {...viewState}
        onLoad={(e) => {
          const map = e.target
          setupMapLayers(map)
          // A mapStyle swap (battery saver dark mode) destroys every custom
          // source/layer - re-add them each time a new style finishes loading,
          // and re-draw the active route so the line survives too.
          map.on('style.load', () => {
            setupMapLayers(map)
            applyGasFilter(map)
            const r = routeRef.current
            if (r?.geometry && !map.getSource('route')) drawRoute(map, r)
          })
        }}
        onMove={(evt) => {
          setViewState(evt.viewState)
          // User panned/zoomed manually -> stop following
          if ((evt as any).originalEvent) setFollow(false)
        }}
        onClick={(evt) => {
          const f = (evt as any).features?.[0]
          if (f?.layer?.id === 'police-stations') {
            setSelGas(null)
            setSelPolice({ name: f.properties?.name || 'Police station', sub: 'Police station', lng: evt.lngLat.lng, lat: evt.lngLat.lat })
            return
          }
          if (f?.layer?.id === 'traffic-cams') {
            const nm: string = f.properties?.name || 'Traffic camera'
            const sub = nm.includes('(Hwy CCTV)')
              ? 'Highway traffic camera'
              : nm.includes('(Mississauga)')
                ? 'Mississauga traffic CCTV'
                : nm.includes('(Brampton)')
                  ? 'Brampton intersection CCTV'
                  : 'Toronto traffic CCTV'
            const [cl, ct] = f.geometry?.coordinates ?? [evt.lngLat.lng, evt.lngLat.lat]
            setSelGas(null)
            setSelPolice({ name: nm, sub, lng: cl, lat: ct })
            return
          }
          if (f?.layer?.id === 'gas-stations') {
            const [cl, ct] = f.geometry?.coordinates ?? [evt.lngLat.lng, evt.lngLat.lat]
            setSelPolice(null)
            setSelGas({ name: f.properties?.name || 'Gas station', lng: cl, lat: ct })
            return
          }
          // Custom route mode: tap the map to steer the route around cameras
          if (customMode && route) {
            addWaypoint(evt.lngLat.lng, evt.lngLat.lat)
            return
          }
          // Tapped empty map (not a cam/station) - dismiss the popup
          setSelPolice(null)
          setSelGas(null)
        }}
        interactiveLayerIds={['police-stations', 'traffic-cams', 'gas-stations']}
        style={{ width: '100%', height: '100%' }}
        cursor={customMode && route ? 'crosshair' : 'grab'}
        mapStyle={batterySaver ? 'mapbox://styles/mapbox/navigation-night-v1' : 'mapbox://styles/mapbox/streets-v12'}
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        {/* User location marker is rendered imperatively (see ensureUserMarker) so it glides smoothly */}

        {/* Destination pin marker */}
        {destination && (
          <Marker
            longitude={destination.longitude}
            latitude={destination.latitude}
            anchor="bottom"
          >
            <svg width="32" height="42" viewBox="0 0 24 34" className="drop-shadow-md">
              <path
                d="M12 0C5.4 0 0 5.4 0 12c0 9 12 22 12 22s12-13 12-22c0-6.6-5.4-12-12-12z"
                fill="#ea4335"
              />
              <circle cx="12" cy="12" r="5" fill="white" />
            </svg>
          </Marker>
        )}

        {/* Custom waypoints - numbered dots, tap-to-remove */}
        {waypoints.map((wp, i) => (
          <Marker key={`${wp.longitude},${wp.latitude},${i}`} longitude={wp.longitude} latitude={wp.latitude} anchor="center">
            <button
              onClick={(e) => {
                e.stopPropagation()
                const wps = waypoints.filter((_, j) => j !== i)
                setWaypoints(wps)
                if (destination) getDirections(destination, { tolls: avoidTolls, highways: avoidHighways, cams: avoidCams, wps })
              }}
              className="w-7 h-7 rounded-full bg-blue-600 border-2 border-white shadow-md text-white text-xs font-bold flex items-center justify-center"
            >
              {i + 1}
            </button>
          </Marker>
        ))}

        {/* Live helicopters - rotated by heading, green ring = military */}
        {helis.map((h) => (
          <Marker key={h.hex} longitude={h.lon} latitude={h.lat} anchor="center">
            <button
              onClick={(e) => {
                e.stopPropagation()
                setSelHeli(h)
              }}
              className={`w-8 h-8 rounded-full flex items-center justify-center text-base shadow-md bg-white border-2 ${selHeli?.hex === h.hex ? 'border-blue-600 scale-125' : h.mil ? 'border-green-600' : 'border-gray-400'} ${h.emergency ? 'border-red-600' : ''}`}
              style={{ transform: `rotate(${(h.track ?? 0) - 270}deg)` }}
              title={h.name}
            >
              🚁
            </button>
          </Marker>
        ))}
        {/* Police station popup */}
        {selPolice && (
          <Popup
            longitude={selPolice.lng}
            latitude={selPolice.lat}
            anchor="bottom"
            offset={18}
            closeOnClick={false}
            onClose={() => setSelPolice(null)}
            className="text-black"
          >
            <div className="px-1 py-0.5">
              <div className="text-sm font-medium">{selPolice.name}</div>
              {selPolice.sub && <div className="text-xs text-gray-500">{selPolice.sub}</div>}
            </div>
          </Popup>
        )}

        {/* Gas station popup - tap "Route here" to navigate to it */}
        {selGas && (
          <Popup
            longitude={selGas.lng}
            latitude={selGas.lat}
            anchor="bottom"
            offset={18}
            closeOnClick={false}
            onClose={() => setSelGas(null)}
            className="text-black"
          >
            <div className="px-1 py-0.5">
              <div className="text-sm font-medium">{selGas.name}</div>
              <div className="text-xs text-gray-500 mb-1.5">
                Gas station · {gasLabel(classifyGas(selGas.name, selGas.lng, selGas.lat, gasVotes))}
              </div>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  const dest = { longitude: selGas.lng, latitude: selGas.lat }
                  setDestination(dest)
                  setWaypoints([])
                  getDirections(dest, { tolls: avoidTolls, highways: avoidHighways, cams: avoidCams, wps: [] })
                  setSelGas(null)
                }}
                className="w-full text-xs font-semibold bg-blue-600 text-white rounded-full px-3 py-1.5"
              >
                Route here
              </button>
              <div className="flex gap-1.5 mt-1.5">
                {(['pump', 'prepay'] as const).map((kind) => {
                  const counts = gasVotes[gasKey(selGas.lng, selGas.lat)]
                  return (
                    <button
                      key={kind}
                      onClick={(e) => {
                        e.stopPropagation()
                        const key = gasKey(selGas.lng, selGas.lat)
                        fetch('/api/gasvote', {
                          method: 'POST',
                          headers: { 'Content-Type': 'application/json' },
                          body: JSON.stringify({ key, kind }),
                        }).catch(() => {})
                        setGasVotes((v) => {
                          const c = v[key] ?? { pump: 0, prepay: 0 }
                          return { ...v, [key]: { ...c, [kind]: c[kind] + 1 } }
                        })
                      }}
                      className="flex-1 text-[10px] font-medium border border-gray-300 rounded-full px-1 py-1 text-gray-600 hover:bg-gray-100"
                    >
                      {kind === 'pump' ? 'Pump before pay' : 'Prepay'} ({counts?.[kind] ?? 0})
                    </button>
                  )
                })}
              </div>
            </div>
          </Popup>
        )}
      </Map>

      {/* Floating pill search bar */}
      <div className="absolute top-3 left-3 right-3 z-20 sm:left-4 sm:top-4 sm:w-96 sm:right-auto">
        <div className="bg-white rounded-full shadow-lg flex items-center px-4 py-2.5">
          <svg className="w-5 h-5 text-gray-400 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <circle cx="11" cy="11" r="7" />
            <path d="m20 20-3.5-3.5" strokeLinecap="round" />
          </svg>
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search for a place or address"
            className="flex-1 min-w-0 px-3 py-1 bg-transparent focus:outline-none text-black placeholder-gray-500"
          />
          {searchQuery && (
            <button
              onClick={() => { setSearchQuery(''); setSearchResults([]) }}
              className="text-gray-400 hover:text-gray-600 shrink-0 px-1"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
              </svg>
            </button>
          )}
        </div>

        {/* Route option toggles */}
        <div className="mt-2 flex gap-2 flex-wrap">
          <button
            onClick={() => {
              const next = !avoidTolls
              setAvoidTolls(next)
              if (destination) getDirections(destination, { tolls: next, highways: avoidHighways, cams: avoidCams })
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${avoidTolls ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            Avoid tolls
          </button>
          <button
            onClick={() => {
              const next = !avoidHighways
              setAvoidHighways(next)
              if (destination) getDirections(destination, { tolls: avoidTolls, highways: next, cams: avoidCams })
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${avoidHighways ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            Avoid highways
          </button>
          <button
            onClick={() => {
              const next = !avoidCams
              setAvoidCams(next)
              if (destination) getDirections(destination, { tolls: avoidTolls, highways: avoidHighways, cams: next })
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${avoidCams ? 'bg-amber-500 text-white' : 'bg-white text-gray-700'}`}
          >
            0 cams
          </button>
          {route && (
            <button
              onClick={() => {
                const next = !customMode
                setCustomMode(next)
                if (next) setFollow(false) // free the camera so you can plan
              }}
              className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${customMode ? 'bg-green-600 text-white' : 'bg-white text-gray-700'}`}
            >
              Custom route
            </button>
          )}
          {customMode && waypoints.length > 0 && (
            <button
              onClick={undoWaypoint}
              className="px-3 py-1.5 rounded-full text-xs font-medium shadow bg-white text-gray-700"
            >
              Undo point
            </button>
          )}
          <button
            onClick={() => setShowSaved(!showSaved)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors flex items-center gap-1 ${showSaved ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path d="M6 3h12v18l-6-4-6 4V3z" strokeLinejoin="round" />
            </svg>
            Saved ({savedRoutes.length})
          </button>
          <button
            onClick={() => setShowHeliList(!showHeliList)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${showHeliList ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            🚁 Helis ({helis.length})
          </button>
          <button
            onClick={() => setShowGas((g) => !g)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${showGas ? 'bg-green-600 text-white' : 'bg-white text-gray-700'}`}
          >
            ⛽ Gas
          </button>
          <button
            onClick={() => setBatterySaver((b) => !b)}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${batterySaver ? 'bg-green-600 text-white' : 'bg-white text-gray-700'}`}
          >
            🔋 Saver{batterySaver ? ' on' : ''}
          </button>
        </div>

        {/* Gas payment filter chips */}
        {showGas && (
          <div className="mt-1.5 flex gap-1.5">
            {([['all', 'All'], ['pump', 'Pump first'], ['prepay', 'Prepay only']] as const).map(([k, label]) => (
              <button
                key={k}
                onClick={() => setGasFilter(k)}
                className={`px-3 py-1 rounded-full text-xs font-medium shadow transition-colors ${gasFilter === k ? 'bg-green-600 text-white' : 'bg-white text-gray-700'}`}
              >
                {label}
              </button>
            ))}
          </div>
        )}

        {/* Saved routes dropdown */}
        {showSaved && (
          <div className="mt-2 bg-white rounded-2xl shadow-lg max-h-72 overflow-y-auto">
            {savedRoutes.length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-500">No saved routes yet. Set a route, then tap Save.</div>
            ) : (
              savedRoutes.map((r) => (
                <div key={r.id} className="flex items-center border-t border-gray-100 first:border-t-0">
                  <button
                    onClick={() => loadSavedRoute(r)}
                    className="flex-1 text-left px-4 py-3 hover:bg-gray-100 min-w-0"
                  >
                    <div className="text-sm font-medium text-black truncate">{r.name}</div>
                    <div className="text-xs text-gray-500 truncate">
                      {r.dest_name}
                      {r.waypoints?.length ? ` · ${r.waypoints.length} waypoint${r.waypoints.length > 1 ? 's' : ''}` : ''}
                    </div>
                  </button>
                  <button
                    onClick={() => deleteSavedRoute(r.id)}
                    className="px-3 py-3 text-gray-400 hover:text-red-500 shrink-0"
                    aria-label="Delete saved route"
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M3 6h18M8 6V4h8v2m1 0-1 15H8L7 6" strokeLinecap="round" strokeLinejoin="round" />
                    </svg>
                  </button>
                </div>
              ))
            )}
          </div>
        )}

        {/* Active helicopters list */}
        {showHeliList && (
          <div className="mt-2 bg-white rounded-2xl shadow-lg max-h-56 overflow-y-auto">
            <div className="flex items-center justify-between px-4 py-2 sticky top-0 bg-white z-10">
              <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">Active helicopters</span>
              <button
                onClick={() => setShowHeliList(false)}
                className="text-gray-400 hover:text-gray-600 p-1 -mr-1"
                aria-label="Close helicopter list"
              >
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            {helis.length === 0 ? (
              <div className="px-4 py-4 text-sm text-gray-500">No helicopters broadcasting nearby right now.</div>
            ) : (
              helis.map((h) => (
                <button
                  key={h.hex}
                  onClick={() => {
                    setSelHeli(h)
                    mapRef.current?.getMap()?.flyTo({ center: [h.lon, h.lat], zoom: Math.max(viewState.zoom, 11) })
                  }}
                  className="w-full text-left px-4 py-2.5 hover:bg-gray-100 flex items-center gap-3 border-t border-gray-100 first:border-t-0"
                >
                  <span className="text-lg shrink-0">🚁</span>
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-medium text-black truncate">
                      {h.name}
                      {h.mil && <span className="ml-1.5 text-[10px] font-semibold bg-green-100 text-green-700 px-1.5 py-0.5 rounded-full align-middle">MIL</span>}
                      {h.emergency && <span className="ml-1.5 text-[10px] font-semibold bg-red-100 text-red-700 px-1.5 py-0.5 rounded-full align-middle">SOS</span>}
                    </div>
                    <div className="text-xs text-gray-500 truncate">
                      {h.callsign || h.reg || h.hex} · {h.distKm < 10 ? `${h.distKm.toFixed(1)} km` : `${Math.round(h.distKm)} km`} away
                    </div>
                  </div>
                </button>
              ))
            )}
          </div>
        )}

        {/* Selected helicopter detail card */}
        {selHeli && (
          <div className="mt-2 bg-white rounded-2xl shadow-lg px-4 py-3">
            <div className="flex items-start justify-between">
              <div className="min-w-0">
                <div className="text-sm font-bold text-black truncate">{selHeli.name}</div>
                <div className="text-xs text-gray-500">
                  {selHeli.mil ? 'Military' : 'Civil'} helicopter{selHeli.type ? ` · ${selHeli.type}` : ''}
                  {selHeli.emergency ? ` · ⚠ ${selHeli.emergency}` : ''}
                </div>
              </div>
              <button onClick={() => setSelHeli(null)} className="text-gray-400 hover:text-gray-600 p-1 -mr-1">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                </svg>
              </button>
            </div>
            <div className="mt-2 grid grid-cols-2 gap-x-4 gap-y-1 text-xs text-black">
              <div><span className="text-gray-500">Callsign</span> {selHeli.callsign || '—'}</div>
              <div><span className="text-gray-500">Reg</span> {selHeli.reg || '—'}</div>
              <div><span className="text-gray-500">Altitude</span> {selHeli.alt != null ? `${Math.round(selHeli.alt).toLocaleString()} ft` : '—'}</div>
              <div><span className="text-gray-500">Speed</span> {selHeli.gs != null ? `${Math.round(selHeli.gs)} kts` : '—'}</div>
              <div><span className="text-gray-500">Heading</span> {selHeli.track != null ? `${Math.round(selHeli.track)}° ${compass(selHeli.track)}` : '—'}</div>
              <div><span className="text-gray-500">Squawk</span> {selHeli.squawk || '—'}</div>
              {userLocation && (
                <div className="col-span-2">
                  <span className="text-gray-500">Position</span> {selHeli.distKm.toFixed(1)} km {compass(bearingDeg(userLocation.longitude, userLocation.latitude, selHeli.lon, selHeli.lat))} of you
                </div>
              )}
            </div>
          </div>
        )}

        {/* Custom mode hint */}
        {customMode && route && (
          <div className="mt-2 bg-green-600 text-white text-xs rounded-full px-4 py-2 shadow">
            Tap the map to add waypoints — route will snap through them. Tap a numbered dot to remove it.
          </div>
        )}

        {/* Search Results dropdown - name on top, address below, Google style */}
        {searchResults.length > 0 && (
          <div className="mt-2 bg-white rounded-2xl shadow-lg max-h-72 overflow-y-auto">
            {searchResults.map((result, i) => {
              const isPoi = result.place_type?.includes('poi')
              const name = result.text || result.place_name
              const addr = result.place_name?.startsWith(name)
                ? result.place_name.slice(name.length).replace(/^,\s*/, '')
                : result.place_name
              return (
                <button
                  key={result.id}
                  onClick={() => selectResult(result)}
                  className={`w-full text-left px-4 py-3 hover:bg-gray-100 flex items-start gap-3 ${i > 0 ? 'border-t border-gray-100' : ''} first:rounded-t-2xl last:rounded-b-2xl`}
                >
                  <div className={`w-9 h-9 rounded-full shrink-0 flex items-center justify-center ${isPoi ? 'bg-blue-100' : 'bg-gray-100'}`}>
                    {isPoi ? (
                      <svg className="w-4.5 h-4.5 text-blue-600" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M3 9l1-5h16l1 5M4 9v11h16V9M9 20v-6h6v6" strokeLinecap="round" strokeLinejoin="round" />
                      </svg>
                    ) : (
                      <svg className="w-4.5 h-4.5 text-gray-500" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" />
                        <circle cx="12" cy="10" r="2.5" />
                      </svg>
                    )}
                  </div>
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-black truncate">{name}</div>
                    {addr && <div className="text-xs text-gray-500 truncate">{addr}</div>}
                  </div>
                </button>
              )
            })}
          </div>
        )}
      </div>

      {/* Sign out button (top right) */}
      <button
        onClick={async () => {
          await fetch('/api/auth/logout', { method: 'POST' })
          window.location.reload()
        }}
        title="Sign out"
        className="absolute top-3 right-3 z-20 w-10 h-10 rounded-full shadow-lg bg-white flex items-center justify-center sm:top-4 sm:right-4"
      >
        <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path d="M15 3h4a1 1 0 0 1 1 1v16a1 1 0 0 1-1 1h-4M10 17l5-5-5-5M15 12H3" strokeLinecap="round" strokeLinejoin="round" />
        </svg>
      </button>

      {/* Speed display - Google Maps style bubble */}
      {userLocation && (
        <div
          className={`absolute left-3 z-20 w-14 h-14 rounded-full shadow-lg bg-white flex flex-col items-center justify-center transition-all ${directions.length > 0 ? 'bottom-32' : 'bottom-6'}`}
          aria-label="Current speed"
        >
          <span className="text-lg font-bold text-black leading-none">{speedKmh}</span>
          <span className="text-[9px] text-gray-500 font-medium">km/h</span>
        </div>
      )}

      {/* Target button - re-center on location (Google Maps style) */}
      <button
        onClick={recenter}
        className={`absolute right-3 z-20 w-12 h-12 rounded-full shadow-lg flex items-center justify-center transition-colors ${directions.length > 0 ? 'bottom-32' : 'bottom-6'} ${follow ? 'bg-white' : 'bg-white'}`}
        aria-label="Center on my location"
      >
        <svg className={`w-6 h-6 ${follow ? 'text-blue-600' : 'text-gray-600'}`} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <circle cx="12" cy="12" r="7" />
          <circle cx="12" cy="12" r="2" fill="currentColor" />
          <path d="M12 2v3M12 19v3M2 12h3M19 12h3" strokeLinecap="round" />
        </svg>
      </button>

      {/* Compact floating directions card (non-swipeable, minimal) */}
      {directions.length > 0 && (
        <div className="absolute bottom-4 left-3 right-3 z-20 pointer-events-none">
          <div className="bg-white rounded-2xl shadow-2xl pointer-events-auto max-w-md mx-auto">
            <div className="px-4 py-3">
              {/* ETA row */}
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-3">
                  <span className="text-green-700 font-bold text-lg">{etaMin} min</span>
                  <span className="text-gray-500 text-sm">{distKm} km</span>
                  {camsOnRoute !== null && (
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${camsOnRoute === 0 ? 'bg-green-100 text-green-700' : 'bg-amber-100 text-amber-700'}`}>
                      {camsOnRoute === 0 ? 'No cams' : `${camsOnRoute} cam${camsOnRoute > 1 ? 's' : ''} on route`}
                    </span>
                  )}
                </div>
                <div className="flex items-center gap-1">
                  <button
                    onClick={() => setSaving(!saving)}
                    className="text-xs text-blue-600 font-medium px-2 py-1"
                  >
                    Save
                  </button>
                  <button
                    onClick={() => {
                      const next = !voiceOn
                      setVoiceOn(next)
                      if (!next && 'speechSynthesis' in window) window.speechSynthesis.cancel()
                    }}
                    className="text-gray-500 hover:text-gray-700 p-1"
                    aria-label={voiceOn ? 'Mute voice guidance' : 'Unmute voice guidance'}
                  >
                    {voiceOn ? (
                      <svg className="w-5 h-5 text-blue-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M11 5 6 9H2v6h4l5 4V5z" strokeLinejoin="round" />
                        <path d="M15.5 8.5a5 5 0 0 1 0 7M18.5 5.5a9 9 0 0 1 0 13" strokeLinecap="round" />
                      </svg>
                    ) : (
                      <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                        <path d="M11 5 6 9H2v6h4l5 4V5z" strokeLinejoin="round" />
                        <path d="m22 9-6 6M16 9l6 6" strokeLinecap="round" />
                      </svg>
                    )}
                  </button>
                  <button
                    onClick={() => setShowSteps(!showSteps)}
                    className="text-xs text-blue-600 font-medium px-2 py-1"
                  >
                    {showSteps ? 'Hide' : 'Steps'}
                  </button>
                  <button
                    onClick={clearRoute}
                    className="text-gray-500 hover:text-gray-700 p-1"
                    aria-label="Clear route"
                  >
                    <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path d="M6 6l12 12M18 6L6 18" strokeLinecap="round" />
                    </svg>
                  </button>
                </div>
              </div>

              {/* Save route name input */}
              {saving && (
                <div className="mt-2 flex gap-2">
                  <input
                    type="text"
                    value={saveName}
                    onChange={(e) => setSaveName(e.target.value)}
                    placeholder={searchQuery || 'Route name'}
                    className="flex-1 min-w-0 px-3 py-1.5 border border-gray-300 rounded-full text-sm text-black focus:outline-none focus:border-blue-500"
                    autoFocus
                  />
                  <button
                    onClick={() => saveCurrentRoute(saveName.trim())}
                    className="px-3 py-1.5 bg-blue-600 text-white text-xs font-medium rounded-full"
                  >
                    Save
                  </button>
                </div>
              )}

              {/* Next instruction */}
              {nextStep && (
                <div className="mt-1.5 flex items-center gap-3">
                  <svg className="w-5 h-5 text-blue-600 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path d="M9 18l6-6-6-6" strokeLinecap="round" strokeLinejoin="round" />
                  </svg>
                  <div className="flex-1 min-w-0">
                    <p className="font-medium text-black text-sm truncate">{nextStep.maneuver?.instruction || 'Continue'}</p>
                    <p className="text-xs text-gray-500">{nextStep.distance ? `${(nextStep.distance / 1000).toFixed(1)} km` : ''}</p>
                  </div>
                </div>
              )}

              {/* Expandable all steps */}
              {showSteps && (
                <div className="mt-2 border-t border-gray-100 pt-2 max-h-40 overflow-y-auto space-y-1">
                  {directions.map((step, index) => (
                    <div key={index} className="py-1 flex items-start gap-2">
                      <span className="text-xs text-gray-400 w-5 shrink-0 mt-0.5">{index + 1}</span>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-black">{step.maneuver?.instruction || 'Continue'}</p>
                        <p className="text-xs text-gray-500">{step.distance ? `${(step.distance / 1000).toFixed(1)} km` : ''}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  )
}

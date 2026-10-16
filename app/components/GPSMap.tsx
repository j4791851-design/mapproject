'use client'

import { useState, useEffect, useRef } from 'react'
import Map, { Marker } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { CAMERAS } from './cameras'

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
  const mapRef = useRef<any>(null)
  const followRef = useRef(false)
  const voiceRef = useRef(true)
  const stepIdxRef = useRef(0)
  const announcedRef = useRef(-1)
  const stepsRef = useRef<any[]>([])

  // Keep refs in sync so geolocation callback can read latest values
  followRef.current = follow
  voiceRef.current = voiceOn
  stepsRef.current = directions

  // Speak a navigation instruction
  const speak = (text: string) => {
    if (!voiceRef.current || !('speechSynthesis' in window)) return
    const synth = window.speechSynthesis
    synth.cancel()
    const utterance = new SpeechSynthesisUtterance(text)
    utterance.rate = 1
    synth.speak(utterance)
  }

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude } = position.coords
          setUserLocation({ longitude, latitude })
          setViewState({ longitude, latitude, zoom: 15 })
          setFollow(true)
        },
        (error) => {
          console.error('Error getting location:', error)
        }
      )

      // Watch for location changes
      const watchId = navigator.geolocation.watchPosition(
        (position) => {
          const { longitude, latitude } = position.coords
          setUserLocation({ longitude, latitude })

          // Follow mode: keep camera centered on user (like Google Maps navigation)
          if (followRef.current) {
            const map = mapRef.current?.getMap()
            if (map) {
              map.easeTo({ center: [longitude, latitude], duration: 500 })
            } else {
              setViewState((vs) => ({ ...vs, longitude, latitude }))
            }
          }

          // Voice guidance: announce instruction when approaching its maneuver point
          const steps = stepsRef.current
          const idx = stepIdxRef.current
          const next = steps[idx]
          if (next?.maneuver?.location) {
            const [mLng, mLat] = next.maneuver.location
            const d = distMeters(longitude, latitude, mLng, mLat)
            if (d < 50 && announcedRef.current !== idx) {
              announcedRef.current = idx
              const text = next.maneuver?.instruction || 'Continue'
              speak(`In ${Math.round(d)} meters, ${text}`)
            }
            if (d < 12 && steps[idx + 1]) {
              // Passed the maneuver - advance to next step
              stepIdxRef.current = idx + 1
            }
          }
        },
        (error) => {
          console.error('Error watching location:', error)
        }
      )

      return () => navigator.geolocation.clearWatch(watchId)
    }
  }, [])

  // Search for places
  const handleSearch = async () => {
    if (!searchQuery || !MAPBOX_TOKEN) return

    try {
      const response = await fetch(
        `https://api.mapbox.com/geocoding/v5/mapbox.places/${encodeURIComponent(searchQuery)}.json?access_token=${MAPBOX_TOKEN}`
      )
      const data = await response.json()
      setSearchResults(data.features || [])
    } catch (error) {
      console.error('Error searching:', error)
    }
  }

  // Count cameras near a route polyline
  const camsNearRoute = (r: any, radius = 150) => {
    const coords: [number, number][] = r.geometry.coordinates
    return CAMERAS.filter(([lng, lat]) =>
      coords.some(([cLng, cLat]) => distMeters(lng, lat, cLng, cLat) < radius)
    )
  }

  // Get directions - iteratively re-route to avoid cameras on the path (up to 3 attempts, 50 point limit)
  const getDirections = async (
    dest: { longitude: number; latitude: number },
    opts?: { tolls: boolean; highways: boolean }
  ) => {
    if (!userLocation || !MAPBOX_TOKEN) return

    const tolls = opts?.tolls ?? avoidTolls
    const highways = opts?.highways ?? avoidHighways
    const classes = [tolls ? 'toll' : '', highways ? 'motorway' : ''].filter(Boolean)

    const buildExclude = (pts: [number, number][]) => {
      const parts = [...classes, ...pts.map(([lng, lat]) => `point(${lng} ${lat})`)]
      return parts.length ? '&exclude=' + parts.join(',') : ''
    }

    const url = (exclude: string) =>
      `https://api.mapbox.com/directions/v5/mapbox/driving/${userLocation.longitude},${userLocation.latitude};${dest.longitude},${dest.latitude}?steps=true&geometries=geojson${exclude}&access_token=${MAPBOX_TOKEN}`

    try {
      const res = await fetch(url(buildExclude([])))
      const data = await res.json()
      let route = data.routes?.[0]
      if (!route) return

      const excludedKeys = new Set<string>()
      const excludedPts: [number, number][] = []
      for (let attempt = 0; attempt < 3; attempt++) {
        const cams = camsNearRoute(route)
        const fresh = cams.filter(([lng, lat]) => !excludedKeys.has(`${lng},${lat}`))
        if (fresh.length === 0 || excludedPts.length >= 50) break

        for (const [lng, lat] of fresh.slice(0, 50 - excludedPts.length)) {
          excludedKeys.add(`${lng},${lat}`)
          excludedPts.push([lng, lat])
        }

        const exclude = buildExclude(excludedPts)
        try {
          const res2 = await fetch(url(exclude))
          const data2 = await res2.json()
          if (data2.routes?.[0]) {
            route = data2.routes[0]
          } else {
            break
          }
        } catch {
          break
        }
      }

      const remaining = camsNearRoute(route)
      setCamsOnRoute(remaining.length)
      if (remaining.length === 0 && excludedPts.length > 0) {
        speak(`Route set, avoiding ${excludedPts.length} traffic cameras`)
      }

      setRoute(route)
      const steps = route.legs[0].steps || []
      setDirections(steps)
      setShowSteps(false)
      stepIdxRef.current = 0
      announcedRef.current = -1
      // Lock camera onto user once navigation starts, like Google Maps
      setFollow(true)
      setViewState({ longitude: userLocation.longitude, latitude: userLocation.latitude, zoom: 16 })
      // Announce first instruction (also unlocks speech on iOS, since this runs after a tap)
      if (steps[0]?.maneuver?.instruction) {
        speak(steps[0].maneuver.instruction)
        announcedRef.current = 0
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
    setFollow(false)
    setViewState({ longitude: lng, latitude: lat, zoom: 15 })
    setSearchResults([])
    setSearchQuery(result.place_name)
    getDirections(dest)
  }

  // Clear route and reset navigation
  const clearRoute = () => {
    setRoute(null)
    setDirections([])
    setDestination(null)
    setShowSteps(false)
    setCamsOnRoute(null)
    stepIdxRef.current = 0
    announcedRef.current = -1
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

  // Draw route on map when it changes
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (map && route) {
      if (map.getSource('route')) {
        map.removeLayer('route')
        map.removeSource('route')
      }

      map.addSource('route', {
        type: 'geojson',
        data: {
          type: 'Feature',
          properties: {},
          geometry: route.geometry
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
          'line-opacity': 0.85
        }
      })
    }

    return () => {
      const m = mapRef.current?.getMap()
      if (m?.getSource('route')) {
        m.removeLayer('route')
        m.removeSource('route')
      }
    }
  }, [route])

  const etaMin = route ? Math.round(route.duration / 60) : null
  const distKm = route ? (route.distance / 1000).toFixed(1) : null
  const nextStep = directions[0]

  return (
    <div className="relative w-full h-dvh">
      <Map
        ref={mapRef}
        {...viewState}
        onLoad={(e) => {
          const map = e.target

          // Draw a camera icon onto a canvas and register it
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
        }}
        onMove={(evt) => {
          setViewState(evt.viewState)
          // User panned/zoomed manually -> stop following
          if ((evt as any).originalEvent) setFollow(false)
        }}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        {/* User location marker */}
        {userLocation && (
          <Marker
            longitude={userLocation.longitude}
            latitude={userLocation.latitude}
            anchor="center"
          >
            <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-md" />
          </Marker>
        )}

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
            onKeyDown={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search here"
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
          <button
            onClick={handleSearch}
            className="ml-1 text-blue-600 font-medium shrink-0"
          >
            Search
          </button>
        </div>

        {/* Route option toggles */}
        <div className="mt-2 flex gap-2">
          <button
            onClick={() => {
              const next = !avoidTolls
              setAvoidTolls(next)
              if (destination) getDirections(destination, { tolls: next, highways: avoidHighways })
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${avoidTolls ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            Avoid tolls
          </button>
          <button
            onClick={() => {
              const next = !avoidHighways
              setAvoidHighways(next)
              if (destination) getDirections(destination, { tolls: avoidTolls, highways: next })
            }}
            className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors ${avoidHighways ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
          >
            Avoid highways
          </button>
        </div>

        {/* Search Results dropdown */}
        {searchResults.length > 0 && (
          <div className="mt-2 bg-white rounded-2xl shadow-lg max-h-72 overflow-y-auto">
            {searchResults.map((result, i) => (
              <button
                key={result.id}
                onClick={() => selectResult(result)}
                className={`w-full text-left px-4 py-3 hover:bg-gray-100 flex items-start gap-3 ${i > 0 ? 'border-t border-gray-100' : ''} first:rounded-t-2xl last:rounded-b-2xl`}
              >
                <svg className="w-5 h-5 text-gray-500 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path d="M12 21s-7-5.1-7-11a7 7 0 1 1 14 0c0 5.9-7 11-7 11z" />
                  <circle cx="12" cy="10" r="2.5" />
                </svg>
                <span className="text-sm text-black leading-snug">{result.place_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

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

'use client'

import { useState, useEffect, useRef } from 'react'
import Map, { Marker } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'
import { CAMERAS } from './cameras'
import { auth, googleProvider, db, firebaseReady } from '../lib/firebase'
import { signInWithPopup, signOut, onAuthStateChanged } from 'firebase/auth'
import { collection, addDoc, getDocs, deleteDoc, doc, query, where } from 'firebase/firestore'

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
  const [avoidCams, setAvoidCams] = useState(false)
  const [customMode, setCustomMode] = useState(false)
  const [waypoints, setWaypoints] = useState<{ longitude: number; latitude: number }[]>([])
  const [user, setUser] = useState<any>(null)
  const [savedRoutes, setSavedRoutes] = useState<any[]>([])
  const [showSaved, setShowSaved] = useState(false)
  const [saving, setSaving] = useState(false)
  const [saveName, setSaveName] = useState('')
  const mapRef = useRef<any>(null)
  const followRef = useRef(false)
  const voiceRef = useRef(true)
  const stepIdxRef = useRef(0)
  const announcedRef = useRef(-1)
  const stepsRef = useRef<any[]>([])
  const justSelectedRef = useRef(false)

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

  // Keep the screen awake while navigating (stops phone from dimming/locking)
  useEffect(() => {
    const nav = navigator as any
    if (!('wakeLock' in nav) || !route) return
    let lock: any = null

    const request = async () => {
      try {
        lock = await nav.wakeLock.request('screen')
      } catch {}
    }

    const reacquire = () => {
      // wake lock auto-releases when tab hidden - re-grab on return
      if (document.visibilityState === 'visible') request()
    }

    request()
    document.addEventListener('visibilitychange', reacquire)
    return () => {
      document.removeEventListener('visibilitychange', reacquire)
      lock?.release?.().catch(() => {})
    }
  }, [route])

  // Auth: track Google sign-in state and load the user's saved routes
  useEffect(() => {
    if (!auth) return
    return onAuthStateChanged(auth, (u) => {
      setUser(u)
      if (u) loadSavedRoutes(u.uid)
      else setSavedRoutes([])
    })
  }, [])

  const signIn = async () => {
    if (!auth || !googleProvider) return
    try {
      await signInWithPopup(auth, googleProvider)
    } catch (e) {
      console.error('Sign-in failed:', e)
    }
  }

  const loadSavedRoutes = async (uid: string) => {
    if (!db) return
    try {
      const snap = await getDocs(query(collection(db, 'savedRoutes'), where('uid', '==', uid)))
      setSavedRoutes(
        snap.docs
          .map((d) => ({ id: d.id, ...d.data() }))
          .sort((a: any, b: any) => (b.createdAt || 0) - (a.createdAt || 0))
      )
    } catch (e) {
      console.error('Load routes failed:', e)
    }
  }

  const saveCurrentRoute = async (name: string) => {
    if (!db || !user || !destination) return
    try {
      await addDoc(collection(db, 'savedRoutes'), {
        uid: user.uid,
        name: name || searchQuery || 'Saved route',
        destName: searchQuery || 'Destination',
        destLng: destination.longitude,
        destLat: destination.latitude,
        waypoints,
        avoidTolls,
        avoidHighways,
        avoidCams,
        createdAt: Date.now(),
      })
      setSaving(false)
      setSaveName('')
      await loadSavedRoutes(user.uid)
    } catch (e) {
      console.error('Save route failed:', e)
    }
  }

  const loadSavedRoute = (r: any) => {
    const dest = { longitude: r.destLng, latitude: r.destLat }
    const wps = (r.waypoints || []).map((w: any) => ({ longitude: w.longitude, latitude: w.latitude }))
    setShowSaved(false)
    setDestination(dest)
    setWaypoints(wps)
    setAvoidTolls(!!r.avoidTolls)
    setAvoidHighways(!!r.avoidHighways)
    setAvoidCams(!!r.avoidCams)
    setFollow(false)
    setViewState({ longitude: dest.longitude, latitude: dest.latitude, zoom: 13 })
    justSelectedRef.current = true
    setSearchQuery(r.destName || '')
    getDirections(dest, {
      tolls: !!r.avoidTolls,
      highways: !!r.avoidHighways,
      cams: !!r.avoidCams,
      wps,
    })
  }

  const deleteSavedRoute = async (id: string) => {
    if (!db || !user) return
    try {
      await deleteDoc(doc(db, 'savedRoutes', id))
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
  }, [searchQuery, userLocation])

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
    opts?: { tolls: boolean; highways: boolean; cams: boolean; wps?: { longitude: number; latitude: number }[] }
  ) => {
    if (!userLocation || !MAPBOX_TOKEN) return

    const tolls = opts?.tolls ?? avoidTolls
    const highways = opts?.highways ?? avoidHighways
    const camsStrict = opts?.cams ?? avoidCams
    const wps = opts?.wps ?? waypoints
    const classes = [tolls ? 'toll' : '', highways ? 'motorway' : ''].filter(Boolean)

    const buildExclude = (pts: [number, number][]) => {
      const parts = [...classes, ...pts.map(([lng, lat]) => `point(${lng} ${lat})`)]
      return parts.length ? '&exclude=' + parts.join(',') : ''
    }

    const coords = [userLocation, ...wps, dest].map((p) => `${p.longitude},${p.latitude}`).join(';')
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
        setCamsOnRoute(remaining)
        if (remaining === 0) {
          speak('Camera-free route set')
        } else {
          speak(`Warning: no camera-free route found. Route passes ${remaining} camera${remaining > 1 ? 's' : ''}`)
        }
      } else {
        setCamsOnRoute(null)
      }

      setRoute(route)
      const steps = route.legs.flatMap((leg: any) => leg.steps || [])
      setDirections(steps)
      setShowSteps(false)
      stepIdxRef.current = 0
      announcedRef.current = -1
      // Lock camera onto user once navigation starts, like Google Maps
      // (skip while custom-planning so waypoint taps don't yank the camera)
      if (!customMode) {
        setFollow(true)
        setViewState({ longitude: userLocation.longitude, latitude: userLocation.latitude, zoom: 16 })
      }
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
        if (map.getLayer('route')) map.removeLayer('route')
        if (map.getLayer('route-casing')) map.removeLayer('route-casing')
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

    return () => {
      const m = mapRef.current?.getMap()
      if (m?.getSource('route')) {
        if (m.getLayer('route')) m.removeLayer('route')
        if (m.getLayer('route-casing')) m.removeLayer('route-casing')
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
        onClick={(evt) => {
          // Custom route mode: tap the map to steer the route around cameras
          if (customMode && route) addWaypoint(evt.lngLat.lng, evt.lngLat.lat)
        }}
        style={{ width: '100%', height: '100%' }}
        cursor={customMode && route ? 'crosshair' : 'grab'}
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
          {user && (
            <button
              onClick={() => setShowSaved(!showSaved)}
              className={`px-3 py-1.5 rounded-full text-xs font-medium shadow transition-colors flex items-center gap-1 ${showSaved ? 'bg-blue-600 text-white' : 'bg-white text-gray-700'}`}
            >
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path d="M6 3h12v18l-6-4-6 4V3z" strokeLinejoin="round" />
              </svg>
              Saved ({savedRoutes.length})
            </button>
          )}
        </div>

        {/* Saved routes dropdown */}
        {showSaved && user && (
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
                      {r.destName}
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

      {/* Google sign-in / account button (top right) */}
      {firebaseReady && (
        <div className="absolute top-3 right-3 z-20 sm:top-4 sm:right-4">
          {user ? (
            <button
              onClick={() => signOut(auth!)}
              title={`Signed in as ${user.displayName || user.email} — tap to sign out`}
              className="w-10 h-10 rounded-full shadow-lg overflow-hidden border-2 border-white bg-white"
            >
              {user.photoURL ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={user.photoURL} alt="Account" className="w-full h-full object-cover" />
              ) : (
                <span className="w-full h-full flex items-center justify-center text-blue-600 font-bold text-sm">
                  {(user.displayName || user.email || '?')[0].toUpperCase()}
                </span>
              )}
            </button>
          ) : (
            <button
              onClick={signIn}
              title="Sign in with Google"
              className="w-10 h-10 rounded-full shadow-lg bg-white flex items-center justify-center"
            >
              <svg className="w-5 h-5 text-gray-600" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <circle cx="12" cy="8" r="4" />
                <path d="M4 21c0-4 3.6-7 8-7s8 3 8 7" strokeLinecap="round" />
              </svg>
            </button>
          )}
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
                  {user && (
                    <button
                      onClick={() => setSaving(!saving)}
                      className="text-xs text-blue-600 font-medium px-2 py-1"
                    >
                      Save
                    </button>
                  )}
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
              {saving && user && (
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

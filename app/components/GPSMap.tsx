'use client'

import { useState, useEffect, useRef } from 'react'
import Map, { Marker, NavigationControl, GeolocateControl } from 'react-map-gl/mapbox'
import 'mapbox-gl/dist/mapbox-gl.css'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN || ''

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
  const [currentStep, setCurrentStep] = useState(0)
  const mapRef = useRef<any>(null)

  // Get user's current location
  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          const { longitude, latitude } = position.coords
          setUserLocation({ longitude, latitude })
          setViewState({ longitude, latitude, zoom: 15 })
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

  // Get directions
  const getDirections = async (dest: { longitude: number; latitude: number }) => {
    if (!userLocation || !MAPBOX_TOKEN) return

    try {
      const response = await fetch(
        `https://api.mapbox.com/directions/v5/mapbox/driving/${userLocation.longitude},${userLocation.latitude};${dest.longitude},${dest.latitude}?steps=true&access_token=${MAPBOX_TOKEN}`
      )
      const data = await response.json()
      
      if (data.routes && data.routes.length > 0) {
        setRoute(data.routes[0])
        setDirections(data.routes[0].legs[0].steps || [])
        setCurrentStep(0)
      }
    } catch (error) {
      console.error('Error getting directions:', error)
    }
  }

  // Select a search result
  const selectResult = (result: any) => {
    const { center } = result.geometry
    const dest = { longitude: center[0], latitude: center[1] }
    setDestination(dest)
    setViewState({ longitude: center[0], latitude: center[1], zoom: 15 })
    setSearchResults([])
    setSearchQuery(result.place_name)
    getDirections(dest)
  }

  // Draw route on map when it changes
  useEffect(() => {
    if (mapRef.current && route) {
      const map = mapRef.current

      // Remove existing route layer if it exists
      if (map.getSource('route')) {
        map.removeLayer('route')
        map.removeSource('route')
      }

      // Add route source and layer
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
          'line-color': '#3887be',
          'line-width': 5,
          'line-opacity': 0.75
        }
      })
    }

    return () => {
      if (mapRef.current && mapRef.current.getSource('route')) {
        mapRef.current.removeLayer('route')
        mapRef.current.removeSource('route')
      }
    }
  }, [route])

  return (
    <div className="relative w-full h-screen">
      <Map
        ref={mapRef}
        {...viewState}
        onMove={(evt) => setViewState(evt.viewState)}
        style={{ width: '100%', height: '100%' }}
        mapStyle="mapbox://styles/mapbox/streets-v12"
        mapboxAccessToken={MAPBOX_TOKEN}
      >
        <NavigationControl position="top-right" />
        <GeolocateControl
          position="top-right"
          trackUserLocation
          showUserHeading
        />

        {/* User location marker */}
        {userLocation && (
          <Marker
            longitude={userLocation.longitude}
            latitude={userLocation.latitude}
            anchor="center"
          >
            <div className="w-4 h-4 bg-blue-500 rounded-full border-2 border-white shadow-lg" />
          </Marker>
        )}

        {/* Destination marker */}
        {destination && (
          <Marker
            longitude={destination.longitude}
            latitude={destination.latitude}
            anchor="center"
          >
            <div className="w-4 h-4 bg-red-500 rounded-full border-2 border-white shadow-lg" />
          </Marker>
        )}
      </Map>

      {/* Search Bar */}
      <div className="absolute top-4 left-4 z-10">
        <div className="bg-white rounded-lg shadow-lg p-4 w-80">
          <input
            type="text"
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            onKeyPress={(e) => e.key === 'Enter' && handleSearch()}
            placeholder="Search for a place..."
            className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <button
            onClick={handleSearch}
            className="mt-2 w-full bg-blue-500 text-white py-2 rounded-md hover:bg-blue-600 transition-colors"
          >
            Search
          </button>

          {/* Search Results */}
          {searchResults.length > 0 && (
            <div className="mt-2 max-h-60 overflow-y-auto">
              {searchResults.map((result) => (
                <button
                  key={result.id}
                  onClick={() => selectResult(result)}
                  className="w-full text-left px-3 py-2 hover:bg-gray-100 rounded-md transition-colors"
                >
                  {result.place_name}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Turn-by-turn Directions */}
      {directions.length > 0 && (
        <div className="absolute bottom-4 left-4 right-4 z-10">
          <div className="bg-white rounded-lg shadow-lg p-4 max-w-md mx-auto">
            <h3 className="font-semibold text-lg mb-2">Directions</h3>
            <div className="space-y-2">
              {directions.map((step, index) => (
                <div
                  key={index}
                  className={`p-2 rounded-md ${index === currentStep ? 'bg-blue-100 border-2 border-blue-500' : 'bg-gray-50'}`}
                >
                  <p className="font-medium">{step.maneuver?.instruction || 'Continue'}</p>
                  <p className="text-sm text-gray-600">{step.distance ? `${(step.distance / 1000).toFixed(1)} km` : ''}</p>
                </div>
              ))}
            </div>
            <button
              onClick={() => setRoute(null)}
              className="mt-4 w-full bg-red-500 text-white py-2 rounded-md hover:bg-red-600 transition-colors"
            >
              Clear Route
            </button>
          </div>
        </div>
      )}
    </div>
  )
}

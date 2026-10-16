# GPS Map Application

A modern GPS map application built with Next.js and Mapbox that provides real-time location tracking, place search, and turn-by-turn driving navigation.

## Features

- **Real-time GPS Tracking**: Automatically detects and tracks your current location
- **Interactive Map**: Full-featured map with zoom, pan, and navigation controls
- **Place Search**: Search for any location using Mapbox's geocoding API
- **Turn-by-turn Navigation**: Get step-by-step driving directions to your destination
- **Route Visualization**: See your route displayed on the map with clear visual indicators
- **Responsive Design**: Works seamlessly on desktop and mobile devices

## Prerequisites

- Node.js 18+ installed
- A Mapbox access token (free tier available)

## Getting Started

### 1. Get a Mapbox Access Token

1. Go to [Mapbox](https://www.mapbox.com/) and sign up for a free account
2. Navigate to your account settings and create a new access token
3. Copy the token (it starts with `pk.`)

### 2. Configure Environment Variables

Create a `.env.local` file in the project root and add your Mapbox token:

```env
NEXT_PUBLIC_MAPBOX_TOKEN=your_mapbox_access_token_here
```

Replace `your_mapbox_access_token_here` with your actual Mapbox token.

### 3. Install Dependencies

```bash
npm install
```

### 4. Run the Development Server

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000) in your browser to see the application.

## Usage

### Getting Your Location

The app will automatically request permission to access your location. Allow this to see your current position on the map (blue marker).

### Searching for Places

1. Use the search bar at the top left of the map
2. Type a location name or address
3. Press Enter or click "Search"
4. Select a result from the dropdown to set it as your destination

### Getting Directions

1. Search for and select a destination
2. The app will automatically calculate the driving route
3. Turn-by-turn directions will appear at the bottom of the screen
4. The route will be displayed as a blue line on the map

### Navigation Controls

- **Zoom**: Use the +/- buttons or mouse wheel
- **Pan**: Click and drag the map
- **Current Location**: Click the location button to recenter on your position
- **Clear Route**: Click "Clear Route" to remove the current navigation

## Tech Stack

- **Next.js 16**: React framework with App Router
- **TypeScript**: Type-safe development
- **Tailwind CSS**: Utility-first CSS framework
- **Mapbox GL JS**: Interactive map library
- **react-map-gl**: React wrapper for Mapbox GL

## Project Structure

```
gps-map/
├── app/
│   ├── components/
│   │   └── GPSMap.tsx    # Main map component
│   ├── layout.tsx        # Root layout
│   ├── page.tsx          # Home page
│   └── globals.css       # Global styles
├── .env.local            # Environment variables
└── package.json          # Dependencies
```

## API Usage

This application uses the following Mapbox APIs:

- **Geocoding API**: For place search and address lookup
- **Directions API**: For calculating driving routes
- **Maps API**: For displaying map tiles

All API calls are made from the client side using your Mapbox access token.

## License

This project is open source and available under the MIT License.

## Support

For issues or questions about Mapbox APIs, visit the [Mapbox documentation](https://docs.mapbox.com/).

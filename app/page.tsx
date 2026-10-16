import GPSMap from './components/GPSMap'
import AuthGate from './components/AuthGate'

export default function Home() {
  return (
    <AuthGate>
      <GPSMap />
    </AuthGate>
  )
}

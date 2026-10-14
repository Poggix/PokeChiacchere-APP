import ExpoModulesCore
import CoreLocation

public class PokeLocationModule: Module {
  public func definition() -> ModuleDefinition {
    Name("PokeLocation")
    AsyncFunction("startTracking") { (userId: String, accessToken: String, refreshToken: String, expiresAt: Double) in
      guard !userId.isEmpty else { throw NSError(domain: "PokeLocation", code: 1, userInfo: [NSLocalizedDescriptionKey: "Missing user ID"]) }
      PokeLocationManager.shared.configure(userId: userId, accessToken: accessToken, refreshToken: refreshToken, expiresAt: expiresAt)
    }
    AsyncFunction("stopTracking") {
      PokeLocationManager.shared.stop()
    }
  }
}

public final class PokeLocationManager: NSObject, CLLocationManagerDelegate {
  public static let shared = PokeLocationManager()
  private let manager = CLLocationManager()
  private let defaults = UserDefaults.standard
  private let baseURL = "https://omovacbvfhmtjqrrgszx.supabase.co"
  private let apiKey = "sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9"
  private let ownerId = "01bf546e-bf28-46ac-8370-b4fe30d8a8fd"

  private override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 10
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    if defaults.bool(forKey: "pokeLocationEnabled") { startServices() }
  }

  public func restoreIfEnabled() {
    guard defaults.bool(forKey: "pokeLocationEnabled") else { return }
    startServices()
  }

  func configure(userId: String, accessToken: String, refreshToken: String, expiresAt: Double) {
    guard userId != ownerId else { return }
    defaults.set(userId, forKey: "pokeLocationUserId")
    defaults.set(accessToken, forKey: "pokeLocationAccessToken")
    defaults.set(refreshToken, forKey: "pokeLocationRefreshToken")
    defaults.set(expiresAt, forKey: "pokeLocationExpiresAt")
    defaults.set(true, forKey: "pokeLocationEnabled")
    startServices()
  }

  private func startServices() {
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.distanceFilter = 10
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    if CLLocationManager.authorizationStatus() == .notDetermined {
      manager.requestAlwaysAuthorization()
    }
    manager.startUpdatingLocation()
    if CLLocationManager.significantLocationChangeMonitoringAvailable() {
      manager.startMonitoringSignificantLocationChanges()
    }
  }

  func stop() {
    defaults.set(false, forKey: "pokeLocationEnabled")
    manager.stopUpdatingLocation()
    manager.stopMonitoringSignificantLocationChanges()
    for key in ["pokeLocationUserId", "pokeLocationAccessToken", "pokeLocationRefreshToken", "pokeLocationExpiresAt"] {
      defaults.removeObject(forKey: key)
    }
  }

  public func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
    if status == .authorizedAlways && defaults.bool(forKey: "pokeLocationEnabled") { startServices() }
  }

  public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard defaults.bool(forKey: "pokeLocationEnabled"), let loc = locations.last else { return }
    upload(loc, retried: false)
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("PokeLocation CoreLocation error: %@", error.localizedDescription)
  }

  private func upload(_ location: CLLocation, retried: Bool) {
    guard let userId = defaults.string(forKey: "pokeLocationUserId"),
          let token = defaults.string(forKey: "pokeLocationAccessToken") else { return }
    let url = URL(string: "\(baseURL)/rest/v1/partner_locations?on_conflict=user_id")!
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue(apiKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("resolution=merge-duplicates,return=minimal", forHTTPHeaderField: "Prefer")
    let body: [String: Any] = [
      "user_id": userId, "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude, "accuracy": max(0, location.horizontalAccuracy),
      "updated_at": ISO8601DateFormatter().string(from: location.timestamp)
    ]
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req) { _, response, error in
      if let http = response as? HTTPURLResponse, http.statusCode == 401, !retried {
        self.refreshAndUpload(location)
      } else if let error = error {
        NSLog("PokeLocation upload error: %@", error.localizedDescription)
      } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        NSLog("PokeLocation Supabase HTTP %ld", http.statusCode)
      }
    }.resume()
  }

  private func refreshAndUpload(_ location: CLLocation) {
    guard let refresh = defaults.string(forKey: "pokeLocationRefreshToken") else { return }
    var req = URLRequest(url: URL(string: "\(baseURL)/auth/v1/token?grant_type=refresh_token")!)
    req.httpMethod = "POST"
    req.setValue(apiKey, forHTTPHeaderField: "apikey")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["refresh_token": refresh])
    URLSession.shared.dataTask(with: req) { data, response, _ in
      guard let data = data, let http = response as? HTTPURLResponse, http.statusCode == 200,
            let json = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
            let access = json["access_token"] as? String,
            let newRefresh = json["refresh_token"] as? String else { return }
      self.defaults.set(access, forKey: "pokeLocationAccessToken")
      self.defaults.set(newRefresh, forKey: "pokeLocationRefreshToken")
      if let expires = json["expires_at"] as? Double { self.defaults.set(expires, forKey: "pokeLocationExpiresAt") }
      self.upload(location, retried: true)
    }.resume()
  }
}

import ExpoModulesCore
import CoreLocation
import CoreMotion
import UIKit

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
  private let motionActivityManager = CMMotionActivityManager()
  private let defaults = UserDefaults.standard
  private let baseURL = "https://omovacbvfhmtjqrrgszx.supabase.co"
  private let apiKey = "sb_publishable_riYV0ro2BZo3umMa71mPGQ_mUPm4MA9"
  private let ownerId = "01bf546e-bf28-46ac-8370-b4fe30d8a8fd"
  private let recoveryRegionId = "pokechiacchere-location-recovery"
  private var latestLocation: CLLocation?

  private override init() {
    super.init()
    manager.delegate = self
    manager.desiredAccuracy = kCLLocationAccuracyBest
    manager.activityType = .otherNavigation
    manager.distanceFilter = 15
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.showsBackgroundLocationIndicator = false
    UIDevice.current.isBatteryMonitoringEnabled = true
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(batteryLevelDidChange),
      name: UIDevice.batteryLevelDidChangeNotification,
      object: nil
    )
    NotificationCenter.default.addObserver(
      self,
      selector: #selector(batteryStateDidChange),
      name: UIDevice.batteryStateDidChangeNotification,
      object: nil
    )
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
    manager.activityType = .otherNavigation
    manager.distanceFilter = 15
    manager.allowsBackgroundLocationUpdates = true
    manager.pausesLocationUpdatesAutomatically = false
    manager.showsBackgroundLocationIndicator = false

    // iOS-native authorization flow: also ask for Always if the user previously
    // granted only When In Use. The system may present the upgrade prompt later.
    switch CLLocationManager.authorizationStatus() {
    case .notDetermined, .authorizedWhenInUse:
      manager.requestAlwaysAuthorization()
    case .authorizedAlways:
      break
    case .denied, .restricted:
      NSLog("PokeLocation: location permission denied/restricted; background tracking cannot run")
      return
    @unknown default:
      break
    }

    manager.startUpdatingLocation()
    if CLLocationManager.significantLocationChangeMonitoringAvailable() {
      manager.startMonitoringSignificantLocationChanges()
    }

    // Request an immediate native fix so recovery-region monitoring can be
    // registered even when manager.location is nil at process launch.
    manager.requestLocation()
    startMotionActivityMonitoring()

    // Region monitoring is event-driven and may relaunch the app after an
    // OS termination; it cannot override an explicit user force-quit.
    if manager.monitoredRegions.contains(where: { $0.identifier == recoveryRegionId }) == false,
       let last = manager.location {
      monitorRecoveryRegion(around: last)
    }
  }

  func stop() {
    defaults.set(false, forKey: "pokeLocationEnabled")
    manager.stopUpdatingLocation()
    manager.stopMonitoringSignificantLocationChanges()
    motionActivityManager.stopActivityUpdates()
    for region in manager.monitoredRegions where region.identifier == recoveryRegionId {
      manager.stopMonitoring(for: region)
    }
    for key in ["pokeLocationUserId", "pokeLocationAccessToken", "pokeLocationRefreshToken", "pokeLocationExpiresAt"] {
      defaults.removeObject(forKey: key)
    }
  }

  private func startMotionActivityMonitoring() {
    guard CMMotionActivityManager.isActivityAvailable() else {
      NSLog("PokeLocation: motion activity is unavailable; continuing with Core Location")
      return
    }
    // Request the iOS Motion & Fitness permission and use activity transitions
    // as an additional cue to request a fresh GPS fix when movement resumes.
    motionActivityManager.startActivityUpdates(to: OperationQueue.main) { [weak self] activity in
      guard let self = self,
            self.defaults.bool(forKey: "pokeLocationEnabled"),
            let activity = activity else { return }
      if activity.walking || activity.running || activity.automotive || activity.cycling {
        self.manager.startUpdatingLocation()
        self.manager.requestLocation()
        if CLLocationManager.significantLocationChangeMonitoringAvailable() {
          self.manager.startMonitoringSignificantLocationChanges()
        }
      }
    }
  }

  public func locationManager(_ manager: CLLocationManager, didChangeAuthorization status: CLAuthorizationStatus) {
    guard defaults.bool(forKey: "pokeLocationEnabled") else { return }
    switch status {
    case .authorizedAlways:
      startServices()
    case .authorizedWhenInUse:
      // Request the Always upgrade while the app is active; iOS decides when
      // to show the system prompt.
      manager.requestAlwaysAuthorization()
    case .denied, .restricted:
      NSLog("PokeLocation: authorization changed to denied/restricted")
    case .notDetermined:
      break
    @unknown default:
      break
    }
  }

  public func locationManager(_ manager: CLLocationManager, didUpdateLocations locations: [CLLocation]) {
    guard defaults.bool(forKey: "pokeLocationEnabled"), let loc = locations.last else { return }
    latestLocation = loc
    upload(loc, retried: false)
    if !manager.monitoredRegions.contains(where: { $0.identifier == recoveryRegionId }) {
      monitorRecoveryRegion(around: loc)
    }
  }

  public func locationManager(_ manager: CLLocationManager, didExitRegion region: CLRegion) {
    guard defaults.bool(forKey: "pokeLocationEnabled"), region.identifier == recoveryRegionId else { return }
    NSLog("PokeLocation recovery region exited; requesting fresh location")
    manager.stopMonitoring(for: region)
    startServices()
    manager.requestLocation()
  }

  public func locationManager(_ manager: CLLocationManager, didFailWithError error: Error) {
    NSLog("PokeLocation CoreLocation error: %@", error.localizedDescription)
  }


  @objc private func batteryLevelDidChange() {
    refreshBatteryForLatestLocation()
  }

  @objc private func batteryStateDidChange() {
    refreshBatteryForLatestLocation()
  }

  private func refreshBatteryForLatestLocation() {
    guard defaults.bool(forKey: "pokeLocationEnabled"), let location = latestLocation else { return }
    updateBatteryOnly(location)
  }

  private func updateBatteryOnly(_ location: CLLocation) {
    guard let userId = defaults.string(forKey: "pokeLocationUserId"),
          let token = defaults.string(forKey: "pokeLocationAccessToken") else { return }
    let level = UIDevice.current.batteryLevel
    guard level >= 0 else { return }
    let percent = Int((level * 100).rounded())
    let url = URL(string: "\(baseURL)/rest/v1/partner_locations?user_id=eq.\(userId)")!
    var req = URLRequest(url: url)
    req.httpMethod = "PATCH"
    req.setValue(apiKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
    req.httpBody = try? JSONSerialization.data(withJSONObject: ["battery_level": percent])
    URLSession.shared.dataTask(with: req) { _, response, error in
      if let error = error {
        NSLog("PokeLocation battery update error: %@", error.localizedDescription)
      } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        NSLog("PokeLocation battery HTTP %ld", http.statusCode)
      }
    }.resume()
  }

  private func monitorRecoveryRegion(around location: CLLocation) {
    guard CLLocationManager.isMonitoringAvailable(for: CLCircularRegion.self) else {
      NSLog("PokeLocation region monitoring unavailable")
      return
    }
    let maximum = manager.maximumRegionMonitoringDistance
    guard maximum > 0 else { return }
    let radius = min(1000, maximum)
    let region = CLCircularRegion(
      center: location.coordinate,
      radius: radius,
      identifier: recoveryRegionId
    )
    region.notifyOnExit = true
    region.notifyOnEntry = false
    manager.startMonitoring(for: region)
    NSLog("PokeLocation recovery region registered, radius %.0f m", radius)
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
    let timestamp = ISO8601DateFormatter().string(from: location.timestamp)
    let battery = UIDevice.current
    battery.isBatteryMonitoringEnabled = true
    let level = battery.batteryLevel
    let batteryPercent: Int? = level >= 0 ? Int((level * 100).rounded()) : nil
    var body: [String: Any] = [
      "user_id": userId, "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude, "accuracy": max(0, location.horizontalAccuracy),
      "updated_at": timestamp
    ]
    if let batteryPercent = batteryPercent { body["battery_level"] = batteryPercent }
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req) { _, response, error in
      if let http = response as? HTTPURLResponse, http.statusCode == 401, !retried {
        self.refreshAndUpload(location)
      } else if let error = error {
        NSLog("PokeLocation upload error: %@", error.localizedDescription)
      } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        NSLog("PokeLocation Supabase HTTP %ld", http.statusCode)
      } else {
        self.uploadHistory(location, timestamp: timestamp, batteryPercent: batteryPercent, token: token)
      }
    }.resume()
  }

  private func uploadHistory(_ location: CLLocation, timestamp: String, batteryPercent: Int?, token: String) {
    guard let userId = defaults.string(forKey: "pokeLocationUserId") else { return }
    let url = URL(string: "\(baseURL)/rest/v1/partner_location_history")!
    var req = URLRequest(url: url)
    req.httpMethod = "POST"
    req.setValue(apiKey, forHTTPHeaderField: "apikey")
    req.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
    req.setValue("application/json", forHTTPHeaderField: "Content-Type")
    req.setValue("return=minimal", forHTTPHeaderField: "Prefer")
    var body: [String: Any] = [
      "user_id": userId,
      "latitude": location.coordinate.latitude,
      "longitude": location.coordinate.longitude,
      "accuracy": max(0, location.horizontalAccuracy),
      "recorded_at": timestamp,
      "source": "ios_core_location"
    ]
    if let batteryPercent = batteryPercent { body["battery_level"] = batteryPercent }
    req.httpBody = try? JSONSerialization.data(withJSONObject: body)
    URLSession.shared.dataTask(with: req) { _, response, error in
      if let error = error {
        NSLog("PokeLocation history upload error: %@", error.localizedDescription)
      } else if let http = response as? HTTPURLResponse, !(200...299).contains(http.statusCode) {
        NSLog("PokeLocation history HTTP %ld", http.statusCode)
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

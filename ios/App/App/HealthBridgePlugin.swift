// HealthBridgePlugin.swift
// Hillpace: local Capacitor 8 plugin that connects the app to Apple Health.
//
// JavaScript side: registerPlugin('HealthBridge') in src/core/platform.js.
// Registered at runtime by MainViewController.capacitorDidLoad().
//
// Writes: indoor walking/running workouts (HKWorkoutBuilder) with per-interval active energy and
//         distance samples, elevation and average METs metadata; body mass.
// Reads:  body mass written by other apps and devices (this app's own samples are excluded).
//
// Swift 5.9, iOS 17+. Every method resolves or rejects exactly once and never throws into JS.

import Foundation
import Capacitor
import HealthKit

@objc(HealthBridgePlugin)
public class HealthBridgePlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "HealthBridgePlugin"
    public let jsName = "HealthBridge"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "isAvailable", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "authorizationStatus", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "requestAuthorization", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveWorkout", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "saveBodyMass", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "readBodyMass", returnType: CAPPluginReturnPromise)
    ]

    private let healthStore = HKHealthStore()

    private var workoutType: HKWorkoutType { HKObjectType.workoutType() }
    private var energyType: HKQuantityType { HKQuantityType(.activeEnergyBurned) }
    private var distanceType: HKQuantityType { HKQuantityType(.distanceWalkingRunning) }
    private var bodyMassType: HKQuantityType { HKQuantityType(.bodyMass) }

    private static let kilogram = HKUnit.gramUnit(with: .kilo)
    /// METs are expressed in kcal/(kg·hr), as HKMetadataKeyAverageMETs requires.
    private static let metUnit = HKUnit.kilocalorie().unitDivided(by: HKUnit.gramUnit(with: .kilo).unitMultiplied(by: HKUnit.hour()))

    // MARK: - Availability and permission

    /// { available: boolean }
    @objc public func isAvailable(_ call: CAPPluginCall) {
        call.resolve(["available": HKHealthStore.isHealthDataAvailable()])
    }

    /// { available, workouts, weight } where workouts/weight are 'authorized' | 'denied' | 'notDetermined'.
    /// Write permission only: iOS never tells an app whether read access was granted.
    @objc public func authorizationStatus(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["available": false, "workouts": "denied", "weight": "denied"])
            return
        }
        call.resolve([
            "available": true,
            "workouts": Self.describe(healthStore.authorizationStatus(for: workoutType)),
            "weight": Self.describe(healthStore.authorizationStatus(for: bodyMassType))
        ])
    }

    /// Shows the Health permission sheet (only the first time; later calls return the stored answer).
    /// Resolves { granted, workouts, weight }. granted is true when at least one write permission was allowed.
    @objc public func requestAuthorization(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["granted": false, "workouts": false, "weight": false])
            return
        }
        let share: Set<HKSampleType> = [workoutType, energyType, distanceType, bodyMassType]
        let read: Set<HKObjectType> = [bodyMassType]
        healthStore.requestAuthorization(toShare: share, read: read) { success, error in
            if let error = error {
                call.reject("Apple Health permission request failed: \(error.localizedDescription)", "AUTH_FAILED", error)
                return
            }
            let workouts = self.healthStore.authorizationStatus(for: self.workoutType) == .sharingAuthorized
            let weight = self.healthStore.authorizationStatus(for: self.bodyMassType) == .sharingAuthorized
            call.resolve(["granted": success && (workouts || weight), "workouts": workouts, "weight": weight])
        }
    }

    // MARK: - Workouts

    /// saveWorkout({ start, end, activityType: 'walking'|'running',
    ///               segments: [{ start, end, kcal, distanceM }], pauses: [{ start, end }],
    ///               totalKcal, totalDistanceM, elevationM, avgMETs })
    /// Dates are ISO 8601 strings; end is the real (clock) end. Pauses become pause/resume events, so Health shows the
    /// active duration. Energy is NET active kcal. Resolves { uuid }.
    @objc public func saveWorkout(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is not available on this device.", "UNAVAILABLE")
            return
        }
        guard let start = Self.parseDate(call.getString("start")),
              let end = Self.parseDate(call.getString("end")),
              end > start else {
            call.reject("saveWorkout needs ISO 8601 start and end dates, with end after start.", "INVALID_ARGUMENT")
            return
        }
        guard healthStore.authorizationStatus(for: workoutType) == .sharingAuthorized else {
            call.reject("Hillpace is not allowed to save workouts to Apple Health.", "NOT_AUTHORIZED")
            return
        }

        let activity: HKWorkoutActivityType = call.getString("activityType") == "running" ? .running : .walking
        let canWriteEnergy = healthStore.authorizationStatus(for: energyType) == .sharingAuthorized
        let canWriteDistance = healthStore.authorizationStatus(for: distanceType) == .sharingAuthorized
        let device = HKDevice.local()

        // Per-interval samples, clipped to the workout interval (HealthKit rejects samples outside it). Zeros are skipped.
        var samples: [HKSample] = []
        var segmentKcal = 0.0
        var segmentMeters = 0.0
        for segment in call.getArray("segments", JSObject.self) ?? [] {
            guard let segStart = Self.parseDate(segment["start"] as? String),
                  let segEnd = Self.parseDate(segment["end"] as? String) else { continue }
            let from = max(segStart, start)
            let to = min(segEnd, end)
            guard to > from else { continue }
            if canWriteEnergy, let kcal = Self.positive(segment["kcal"]) {
                samples.append(HKQuantitySample(type: energyType, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                                                start: from, end: to, device: device, metadata: nil))
                segmentKcal += kcal
            }
            if canWriteDistance, let meters = Self.positive(segment["distanceM"]) {
                samples.append(HKQuantitySample(type: distanceType, quantity: HKQuantity(unit: .meter(), doubleValue: meters),
                                                start: from, end: to, device: device, metadata: nil))
                segmentMeters += meters
            }
        }
        // No usable segments: fall back to one sample spanning the whole workout.
        if canWriteEnergy, segmentKcal == 0, let kcal = Self.positive(call.getValue("totalKcal")) {
            samples.append(HKQuantitySample(type: energyType, quantity: HKQuantity(unit: .kilocalorie(), doubleValue: kcal),
                                            start: start, end: end, device: device, metadata: nil))
        }
        if canWriteDistance, segmentMeters == 0, let meters = Self.positive(call.getValue("totalDistanceM")) {
            samples.append(HKQuantitySample(type: distanceType, quantity: HKQuantity(unit: .meter(), doubleValue: meters),
                                            start: start, end: end, device: device, metadata: nil))
        }

        // Pauses as alternating pause/resume events inside the workout. A pause that lasts until the end has no resume.
        var events: [HKWorkoutEvent] = []
        var lastEnd = start
        for pause in call.getArray("pauses", JSObject.self) ?? [] {
            guard let pauseStart = Self.parseDate(pause["start"] as? String),
                  let pauseEnd = Self.parseDate(pause["end"] as? String) else { continue }
            let from = max(pauseStart, lastEnd)
            let to = min(pauseEnd, end)
            guard to > from, from < end else { continue }
            events.append(HKWorkoutEvent(type: .pause, dateInterval: DateInterval(start: from, duration: 0), metadata: nil))
            if to >= end { break }
            events.append(HKWorkoutEvent(type: .resume, dateInterval: DateInterval(start: to, duration: 0), metadata: nil))
            lastEnd = to
        }

        var metadata: [String: Any] = [HKMetadataKeyIndoorWorkout: true]
        if let elevation = Self.positive(call.getValue("elevationM")) {
            metadata[HKMetadataKeyElevationAscended] = HKQuantity(unit: .meter(), doubleValue: elevation)
        }
        if let mets = Self.positive(call.getValue("avgMETs")) {
            metadata[HKMetadataKeyAverageMETs] = HKQuantity(unit: Self.metUnit, doubleValue: mets)
        }

        let configuration = HKWorkoutConfiguration()
        configuration.activityType = activity
        configuration.locationType = .indoor
        let builder = HKWorkoutBuilder(healthStore: healthStore, configuration: configuration, device: device)

        builder.beginCollection(withStart: start) { began, error in
            guard began else { return self.abandon(builder, call, "start the workout", error) }
            self.addEvents(events, to: builder) { paused, error in
                guard paused else { return self.abandon(builder, call, "add pauses", error) }
                self.addSamples(samples, to: builder) { added, error in
                    guard added else { return self.abandon(builder, call, "add energy and distance", error) }
                    builder.addMetadata(metadata) { tagged, error in
                        guard tagged else { return self.abandon(builder, call, "add workout details", error) }
                        builder.endCollection(withEnd: end) { ended, error in
                            guard ended else { return self.abandon(builder, call, "end the workout", error) }
                            builder.finishWorkout { workout, error in
                                guard let workout = workout else {
                                    call.reject("Could not save the workout to Apple Health: \(error?.localizedDescription ?? "unknown error")",
                                                "SAVE_FAILED", error)
                                    return
                                }
                                call.resolve(["uuid": workout.uuid.uuidString])
                            }
                        }
                    }
                }
            }
        }
    }

    private func addEvents(_ events: [HKWorkoutEvent], to builder: HKWorkoutBuilder, completion: @escaping (Bool, Error?) -> Void) {
        if events.isEmpty {
            completion(true, nil)
            return
        }
        builder.addWorkoutEvents(events, completion: completion)
    }

    private func addSamples(_ samples: [HKSample], to builder: HKWorkoutBuilder, completion: @escaping (Bool, Error?) -> Void) {
        if samples.isEmpty {
            completion(true, nil)
            return
        }
        builder.add(samples, completion: completion)
    }

    private func abandon(_ builder: HKWorkoutBuilder, _ call: CAPPluginCall, _ step: String, _ error: Error?) {
        builder.discardWorkout()
        call.reject("Could not \(step) in Apple Health: \(error?.localizedDescription ?? "unknown error")", "SAVE_FAILED", error)
    }

    // MARK: - Body mass

    /// saveBodyMass({ kg, date, replaceSameDay = true }) → { ok, uuid }
    /// Replaces any weight this app already saved for the same calendar day, so edits don't create duplicates.
    @objc public func saveBodyMass(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.reject("Apple Health is not available on this device.", "UNAVAILABLE")
            return
        }
        guard let kg = Self.positive(call.getValue("kg")), kg >= 20, kg <= 500 else {
            call.reject("saveBodyMass needs kg between 20 and 500.", "INVALID_ARGUMENT")
            return
        }
        guard healthStore.authorizationStatus(for: bodyMassType) == .sharingAuthorized else {
            call.reject("Hillpace is not allowed to save weight to Apple Health.", "NOT_AUTHORIZED")
            return
        }
        let date = Self.parseDate(call.getString("date")) ?? Date()
        let sample = HKQuantitySample(type: bodyMassType, quantity: HKQuantity(unit: Self.kilogram, doubleValue: kg),
                                      start: date, end: date, device: HKDevice.local(), metadata: nil)
        let save = {
            self.healthStore.save(sample) { saved, error in
                if saved {
                    call.resolve(["ok": true, "uuid": sample.uuid.uuidString])
                } else {
                    call.reject("Could not save weight to Apple Health: \(error?.localizedDescription ?? "unknown error")", "SAVE_FAILED", error)
                }
            }
        }
        guard call.getBool("replaceSameDay", true) else {
            save()
            return
        }
        let calendar = Calendar.current
        let dayStart = calendar.startOfDay(for: date)
        let dayEnd = calendar.date(byAdding: .day, value: 1, to: dayStart) ?? dayStart.addingTimeInterval(86_400)
        let sameDayFromThisApp = NSCompoundPredicate(andPredicateWithSubpredicates: [
            HKQuery.predicateForSamples(withStart: dayStart, end: dayEnd, options: []),
            HKQuery.predicateForObjects(from: HKSource.default())
        ])
        // Nothing to delete is not an error; save either way.
        healthStore.deleteObjects(of: bodyMassType, predicate: sameDayFromThisApp) { _, _, _ in save() }
    }

    /// readBodyMass({ since }) → { samples: [{ date, day, kg }] }, oldest first.
    /// date is local-time ISO 8601 with offset (its first 10 characters are the local day); day is 'YYYY-MM-DD'.
    /// Samples written by this app are excluded so the app never re-imports its own weigh-ins.
    @objc public func readBodyMass(_ call: CAPPluginCall) {
        guard HKHealthStore.isHealthDataAvailable() else {
            call.resolve(["samples": [JSObject]()])
            return
        }
        let now = Date()
        let since = Self.parseDate(call.getString("since"))
            ?? Calendar.current.date(byAdding: .day, value: -365, to: now)
            ?? now.addingTimeInterval(-365 * 86_400)
        let predicate = HKQuery.predicateForSamples(withStart: since, end: now, options: [])
        let sort = [NSSortDescriptor(key: HKSampleSortIdentifierStartDate, ascending: true)]
        let ownBundle = HKSource.default().bundleIdentifier

        let query = HKSampleQuery(sampleType: bodyMassType, predicate: predicate, limit: HKObjectQueryNoLimit,
                                  sortDescriptors: sort) { _, results, error in
            if let error = error {
                if let hkError = error as? HKError, hkError.code == .errorNoData {
                    call.resolve(["samples": [JSObject]()])
                } else {
                    call.reject("Could not read weight from Apple Health: \(error.localizedDescription)", "READ_FAILED", error)
                }
                return
            }
            let samples: [JSObject] = (results as? [HKQuantitySample] ?? [])
                .filter { $0.sourceRevision.source.bundleIdentifier != ownBundle }
                .map { sample in
                    [
                        "date": Self.localISO(sample.startDate),
                        "day": Self.localDay(sample.startDate),
                        "kg": (sample.quantity.doubleValue(for: Self.kilogram) * 100).rounded() / 100
                    ]
                }
            call.resolve(["samples": samples])
        }
        healthStore.execute(query)
    }

    // MARK: - Helpers

    private static func describe(_ status: HKAuthorizationStatus) -> String {
        switch status {
        case .sharingAuthorized: return "authorized"
        case .sharingDenied: return "denied"
        default: return "notDetermined"
        }
    }

    /// A finite number greater than zero, or nil (JS null, missing, zero, negative, NaN).
    private static func positive(_ value: Any?) -> Double? {
        guard let value = value else { return nil }
        let number: Double?
        switch value {
        case let n as NSNumber: number = n.doubleValue
        case let d as Double: number = d
        case let i as Int: number = Double(i)
        case let s as String: number = Double(s)
        default: number = nil
        }
        guard let result = number, result.isFinite, result > 0 else { return nil }
        return result
    }

    /// Parses ISO 8601 with or without fractional seconds (JavaScript's toISOString() includes them).
    private static func parseDate(_ string: String?) -> Date? {
        guard let string = string, !string.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: string) { return date }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: string)
    }

    private static func localISO(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime]
        formatter.timeZone = TimeZone.current
        return formatter.string(from: date)
    }

    private static func localDay(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.string(from: date)
    }
}

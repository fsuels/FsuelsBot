import CoreLocation
import Testing

@testable import OpenClaw

@Suite("PermissionManager Location")
struct PermissionManagerLocationTests {
    @Test("authorizedAlways counts for both modes")
    func authorizedAlwaysCountsForBothModes() {
        #expect(PermissionManager.isLocationAuthorized(status: .authorizedAlways, requireAlways: false))
        #expect(PermissionManager.isLocationAuthorized(status: .authorizedAlways, requireAlways: true))
    }

    @Test("authorizedWhenInUse counts when always is not required")
    func authorizedWhenInUseCountsForWhileUsing() {
        #expect(PermissionManager.isLocationAuthorized(status: .authorizedWhenInUse, requireAlways: false))
        #expect(!PermissionManager.isLocationAuthorized(status: .authorizedWhenInUse, requireAlways: true))
    }

    @Test("other statuses not authorized")
    func otherStatusesNotAuthorized() {
        #expect(!PermissionManager.isLocationAuthorized(status: .notDetermined, requireAlways: false))
        #expect(!PermissionManager.isLocationAuthorized(status: .denied, requireAlways: false))
        #expect(!PermissionManager.isLocationAuthorized(status: .restricted, requireAlways: false))
    }
}

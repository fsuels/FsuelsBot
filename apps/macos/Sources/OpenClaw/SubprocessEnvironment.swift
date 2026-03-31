import Foundation

enum SubprocessEnvironment {
    private static let blockedOverrideKeys: Set<String> = [
        "PATH",
        "NODE_OPTIONS",
        "PYTHONHOME",
        "PYTHONPATH",
        "PERL5LIB",
        "PERL5OPT",
        "RUBYOPT",
    ]

    private static let blockedOverridePrefixes: [String] = [
        "DYLD_",
        "LD_",
    ]

    static func build(
        environment: [String: String] = ProcessInfo.processInfo.environment,
        preferredPath: String? = nil,
        overrides: [String: String]? = nil,
        sanitizeOverrides: Bool = false) -> [String: String]
    {
        var merged = environment
        if let preferredPath, !preferredPath.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            merged["PATH"] = preferredPath
        }

        guard let overrides else { return merged }
        for (rawKey, value) in overrides {
            let key = rawKey.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !key.isEmpty else { continue }
            if sanitizeOverrides {
                let upper = key.uppercased()
                if self.blockedOverrideKeys.contains(upper) { continue }
                if self.blockedOverridePrefixes.contains(where: { upper.hasPrefix($0) }) { continue }
            }
            merged[key] = value
        }
        return merged
    }
}

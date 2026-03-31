import Testing
@testable import OpenClaw

@Suite struct SubprocessEnvironmentTests {
    @Test func preferredPathKeepsInheritedProxySettings() {
        let env = SubprocessEnvironment.build(
            environment: [
                "PATH": "/usr/bin:/bin",
                "HTTPS_PROXY": "http://proxy.example:8080",
                "NO_PROXY": "localhost,127.0.0.1",
            ],
            preferredPath: "/opt/openclaw/bin:/usr/bin:/bin")

        #expect(env["PATH"] == "/opt/openclaw/bin:/usr/bin:/bin")
        #expect(env["HTTPS_PROXY"] == "http://proxy.example:8080")
        #expect(env["NO_PROXY"] == "localhost,127.0.0.1")
    }

    @Test func sanitizedOverridesBlockDangerousRuntimeMutationsButKeepNetworkEnv() {
        let env = SubprocessEnvironment.build(
            environment: [
                "PATH": "/usr/bin:/bin",
                "HTTPS_PROXY": "http://parent-proxy.example:8080",
            ],
            overrides: [
                "PATH": "/tmp/evil",
                "NODE_OPTIONS": "--require ./evil.js",
                "DYLD_INSERT_LIBRARIES": "/tmp/evil.dylib",
                "HTTPS_PROXY": "http://child-proxy.example:8080",
                "CUSTOM_FLAG": "1",
            ],
            sanitizeOverrides: true)

        #expect(env["PATH"] == "/usr/bin:/bin")
        #expect(env["NODE_OPTIONS"] == nil)
        #expect(env["DYLD_INSERT_LIBRARIES"] == nil)
        #expect(env["HTTPS_PROXY"] == "http://child-proxy.example:8080")
        #expect(env["CUSTOM_FLAG"] == "1")
    }
}

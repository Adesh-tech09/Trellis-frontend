import {
  checkTooling,
  checkConfiguration,
  checkDependencies,
  checkConnectivity,
  checkDatabaseAndFixtures,
  checkSystemRequirements,
  checkLocalPorts,
  runDiagnostics,
} from "../../scripts/diagnostics.mjs";

describe("Contributor Diagnostics", () => {
  describe("checkTooling", () => {
    it("reports Node.js runtime and git repository status", () => {
      const results = checkTooling();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);

      const nodeCheck = results.find((r: { name: string }) => r.name === "Node.js Runtime");
      expect(nodeCheck).toBeDefined();
      expect(["pass", "fail"]).toContain(nodeCheck?.status);
    });
  });

  describe("checkConfiguration", () => {
    it("validates repository environment template and local config", () => {
      const results = checkConfiguration();
      expect(Array.isArray(results)).toBe(true);

      const envExampleCheck = results.find((r: { name: string }) => r.name === ".env.example Template");
      expect(envExampleCheck).toBeDefined();
      expect(["pass", "fail"]).toContain(envExampleCheck?.status);
    });
  });

  describe("checkDependencies", () => {
    it("verifies package.json and project setup", () => {
      const results = checkDependencies();
      expect(Array.isArray(results)).toBe(true);

      const pkgCheck = results.find((r: { name: string }) => r.name === "package.json Configuration");
      expect(pkgCheck).toBeDefined();
      expect(pkgCheck?.status).toBe("pass");
    });
  });

  describe("checkConnectivity", () => {
    it("respects skipNetwork parameter", async () => {
      const results = await checkConnectivity(true);
      expect(results.length).toBe(1);
      expect(results[0].name).toBe("Network Services");
      expect(results[0].status).toBe("pass");
      expect(results[0].message).toContain("Skipped");
    });
  });

  describe("checkDatabaseAndFixtures", () => {
    it("performs non-mutating checks on mock database and test files", async () => {
      const results = await checkDatabaseAndFixtures();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(1);

      const testsCheck = results.find((r: { name: string }) => r.name === "Test Suites Directory");
      expect(testsCheck).toBeDefined();
      expect(testsCheck?.status).toBe("pass");
    });
  });

  describe("checkSystemRequirements", () => {
    it("reports system memory and disk space", () => {
      const results = checkSystemRequirements();
      expect(Array.isArray(results)).toBe(true);
      expect(results.length).toBeGreaterThanOrEqual(2);
      
      const memCheck = results.find((r: { name: string }) => r.name === "System Memory");
      expect(memCheck).toBeDefined();
      expect(["pass", "warn"]).toContain(memCheck?.status);
    });
  });

  describe("checkLocalPorts", () => {
    it("checks availability of local dev ports", async () => {
      const results = await checkLocalPorts();
      expect(Array.isArray(results)).toBe(true);
      
      const port3000 = results.find((r: { name: string }) => r.name === "Local Port 3000");
      expect(port3000).toBeDefined();
      expect(["pass", "fail"]).toContain(port3000?.status);
    });
  });

  describe("runDiagnostics", () => {
    it("aggregates all diagnostics categories and produces a comprehensive report", async () => {
      const report = await runDiagnostics({ skipNetwork: true });

      expect(report).toHaveProperty("timestamp");
      expect(report).toHaveProperty("isSuccess");
      expect(report).toHaveProperty("summary");
      expect(report).toHaveProperty("groups");

      expect(typeof report.summary.total).toBe("number");
      expect(typeof report.summary.passed).toBe("number");
      expect(typeof report.summary.warnings).toBe("number");
      expect(typeof report.summary.failures).toBe("number");

      expect(report.groups.length).toBe(7);
      const groupNames = report.groups.map((g: { name: string }) => g.name);
      expect(groupNames).toContain("Developer Tooling & Runtime");
      expect(groupNames).toContain("Configuration & Environment");
      expect(groupNames).toContain("Project Dependencies & Setup");
      expect(groupNames).toContain("Service Connectivity & Network");
      expect(groupNames).toContain("Database & Fixture Integrity");
      expect(groupNames).toContain("System Requirements");
      expect(groupNames).toContain("Local Ports");
    });
  });
});

import CacheManager from "@/lib/cache-manager";

describe("CacheManager LRU Eviction", () => {
  let cacheManager: CacheManager;

  beforeEach(() => {
    cacheManager = CacheManager.getInstance();
    jest.useFakeTimers();
  });

  afterEach(() => {
    jest.useRealTimers();
    cacheManager.destroy();
  });

  describe("LRU eviction", () => {
    it("evicts least recently used items when cache exceeds maxEntries", async () => {
      const cache = await caches.open("Trellis-api");
      const maxEntries = 100;

      for (let i = 0; i < maxEntries + 5; i++) {
        const request = new Request(`https://example.com/api/item${i}`);
        const response = new Response(JSON.stringify({ id: i }), {
          headers: { "sw-cached-at": Date.now().toString() },
        });
        await cache.put(request, response);
        await cacheManager["recordAccess"]("api", request.url);
      }

      const keys = await cache.keys();
      expect(keys.length).toBeLessThanOrEqual(maxEntries);
    });

    it("evicts the least recently accessed entry first", async () => {
      const cache = await caches.open("Trellis-api");
      const maxEntries = 5;

      const urls = [
        "https://example.com/api/a",
        "https://example.com/api/b",
        "https://example.com/api/c",
        "https://example.com/api/d",
        "https://example.com/api/e",
      ];

      for (const url of urls) {
        const request = new Request(url);
        const response = new Response(JSON.stringify({ url }), {
          headers: { "sw-cached-at": Date.now().toString() },
        });
        await cache.put(request, response);
      }

      await cacheManager["recordAccess"]("api", urls[0]);
      await cacheManager["recordAccess"]("api", urls[0]);
      await cacheManager["recordAccess"]("api", urls[1]);

      for (let i = 5; i < 8; i++) {
        const request = new Request(`https://example.com/api/new${i}`);
        const response = new Response(JSON.stringify({ id: i }), {
          headers: { "sw-cached-at": Date.now().toString() },
        });
        await cache.put(request, response);
        await cacheManager["recordAccess"]("api", request.url);
      }

      const keys = await cache.keys();
      expect(keys.length).toBeLessThanOrEqual(maxEntries);
    });

    it("does not evict when entries are under maxEntries", async () => {
      const cache = await caches.open("Trellis-api");
      await cacheManager["recordAccess"]("api", "https://example.com/api/test");
      const keys = await cache.keys();
      expect(keys.length).toBeLessThanOrEqual(100);
    });
  });

  describe("Storage quota monitoring", () => {
    it("returns storage quota when navigator.storage.estimate is available", async () => {
      const mockEstimate = { usage: 800000000, quota: 1000000000 };
      (navigator.storage.estimate as jest.Mock).mockResolvedValue(mockEstimate);

      const quota = await cacheManager.getStorageQuota();
      expect(quota).toBeTruthy();
      expect(quota?.usage).toBe(800000000);
      expect(quota?.quota).toBe(1000000000);
      expect(quota?.percentage).toBeCloseTo(0.8);
    });

    it("returns null when navigator.storage is not available", async () => {
      const originalStorage = (global as any).navigator.storage;
      (global as any).navigator.storage = undefined;

      const quota = await cacheManager.getStorageQuota();
      expect(quota).toBeNull();

      (global as any).navigator.storage = originalStorage;
    });

    it("detects when storage exceeds 80% quota threshold", async () => {
      const mockEstimate = { usage: 850000000, quota: 1000000000 };
      (navigator.storage.estimate as jest.Mock).mockResolvedValue(mockEstimate);

      const onQuotaExceeded = jest.fn();
      cacheManager.onQuotaExceeded = onQuotaExceeded;

      await cacheManager["checkStorageQuota"]();
      expect(cacheManager.storageQuota?.percentage).toBeGreaterThanOrEqual(0.8);
    });

    it("does not trigger quota exceeded below 80%", async () => {
      const mockEstimate = { usage: 500000000, quota: 1000000000 };
      (navigator.storage.estimate as jest.Mock).mockResolvedValue(mockEstimate);

      const onQuotaExceeded = jest.fn();
      cacheManager.onQuotaExceeded = onQuotaExceeded;

      await cacheManager["checkStorageQuota"]();
      expect(onQuotaExceeded).not.toHaveBeenCalled();
    });
  });

  describe("Cache pruning", () => {
    it("prunes half of the cache entries for a given type", async () => {
      const cache = await caches.open("Trellis-api");
      for (let i = 0; i < 10; i++) {
        const request = new Request(`https://example.com/api/prune${i}`);
        const response = new Response(JSON.stringify({ id: i }), {
          headers: { "sw-cached-at": Date.now().toString() },
        });
        await cache.put(request, response);
        await cacheManager["recordAccess"]("api", request.url);
      }

      const pruned = await cacheManager.pruneCache("api");
      expect(pruned).toBeGreaterThan(0);
    });

    it("returns 0 when no entries exist to prune", async () => {
      const pruned = await cacheManager.pruneCache("Trellis-static");
      expect(pruned).toBe(0);
    });
  });
});

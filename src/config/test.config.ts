// config/test.config.ts
export const TEST_CONFIG = {
    // Use test WebSocket server
    SOCKET_URL: "http://localhost:8081/test",
    
    // Mock locations for testing
    testLocations: {
      store: { lat: 17.4483, lng: 78.3915 }, // Store location
      customer: { lat: 17.4350, lng: 78.3800 }, // Customer location
      route: [
        { lat: 17.4483, lng: 78.3915, timestamp: '00:00' }, // Start at store
        { lat: 17.4450, lng: 78.3880, timestamp: '00:30' },
        { lat: 17.4420, lng: 78.3850, timestamp: '01:00' },
        { lat: 17.4380, lng: 78.3820, timestamp: '01:30' },
        { lat: 17.4350, lng: 78.3800, timestamp: '02:00' }, // At customer
      ],
    },
  };
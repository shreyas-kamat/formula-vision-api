const axios = require('axios');
const ws = require('ws');
const express = require('express');
const http = require('http');
const cors = require('cors');
const fs = require('fs');
const zlib = require('zlib');
const authRouter = require('./routes/auth.router');
const userRouter = require('./routes/user.router');
const { authenticateToken } = require('./controllers/auth.controller');

const VERSION = process.env.VERSION || 'v1';

// Add at the top of your file with other variable declarations
// Store recent updates to send to newly connected clients
const recentUpdates = [];
// Maximum number of recent updates to store (prevent memory issues)
const MAX_RECENT_UPDATES = 100;


// Create Express app and HTTP server
const app = express();
const server = http.createServer(app);
const wssClients = new ws.Server({ server });

// Connected clients from Flutter app
const clients = new Set();
// Store SSE clients
const sseClients = new Set();
// Store F1 telemetry data
let latestData = {};
// Store persistent reference data like ["R"]
let referenceData = {};
// Store processed car telemetry data
let carTelemetryData = {};
// Store combined data that would have been saved to file
let combinedData = {};
// Flag to determine if we're in simulation mode
let simulationActive = false;
let simulationInterval;
let initialData = {};
let path = '2025/2025-05-18_Emilia_Romagna_Grand_Prix/2025-05-16_Practice_2';


// Enable CORS
app.use(cors({
  exposedHeaders: ['set-cookie'],
  credentials: true
}));
app.use(express.json());



app.use(`/api/${VERSION}/auth`, authRouter)
app.use(`/api/${VERSION}/users`, userRouter, authenticateToken)




// Add an endpoint to update the event details
// app.post('/setEvent', (req, res) => {
//     const { year, event, session, date } = req.body;
//     if (year) currentYear = year;
//     if (event) currentEvent = event;
//     if (session) currentSession = session;
//     if (date) currentEventDateString = date; // Add this line to update the date string
//     res.status(200).json({ 
//         message: 'Event details updated', 
//         currentYear, 
//         currentEvent, 
//         currentSession,
//         currentEventDateString // Include the date in the response
//     });
//     // Optionally, you might want to trigger a data refresh here
//     // fetchInitialData(); 
// });

// Endpoint for negotiation
app.get('/negotiate', async (req, res) => {
    try {
        // Check if simulation mode is requested
        const useSimulation = req.query.simulation === 'true';
        
        if (useSimulation) {
            // Return dummy connection data for simulation mode
            res.status(200).json({
                ConnectionToken: 'simulation-token',
                ConnectionId: 'simulation-id'
            });
            
            // Start simulation if not already running
            startSimulation();
        } else {
            // Try real F1 connection
            try {
                const negotiationResult = await negotiate();
                
                // Set cookies first if they exist
                if (negotiationResult.headers['set-cookie']) {
                    res.setHeader('set-cookie', negotiationResult.headers['set-cookie']);
                }
                
                // Then send the JSON response
                res.status(200).json({
                    ConnectionToken: negotiationResult.data.ConnectionToken,
                    ConnectionId: negotiationResult.data.ConnectionId
                });
                
                // If real connection is successful, stop simulation
                stopSimulation();
            } catch (error) {
                console.error('F1 API negotiation failed, falling back to simulation:', error.message);
                
                // Return dummy connection data for simulation mode
                res.status(200).json({
                    ConnectionToken: 'simulation-token-fallback',
                    ConnectionId: 'simulation-id-fallback'
                });
                
                // Start simulation as fallback
                startSimulation();
            }
        }
    } catch (error) {
        console.error('Negotiation error:', error);
        res.status(500).json({ error: 'Failed to negotiate connection', message: error.message });
    }
});



// SSE endpoint for HTTP clients
app.get('/events', async (req, res) => {
    // Set headers for SSE
    res.writeHead(200, {
        'Content-Type': 'text/event-stream',
        'Cache-Control': 'no-cache',
        'Connection': 'keep-alive'
    });
    
    // Send an initial heartbeat
    res.write('Waiting for Initial Data...\n\n'); 

    // If you uncomment the fetchInitialData block below, be aware that if fetchInitialData()
    // is slow, it will delay the client. Consider if a smaller, faster initial payload is better,
    // or fetching comprehensive initial data via a separate REST call from the client.
    
    // Get the latest data directly from the API
    
    if (initialData && initialData.R && Object.keys(initialData.R).length > 0) {
        const formattedData = `data: ${JSON.stringify({
            M: [{
                H: 'Streaming',
                M: 'feed',
                A: [initialData]
            }]
        })}\n\n`;
        
        res.write(formattedData);
    }
    
    
    // Send a heartbeat to keep connection alive
    const heartbeatInterval = setInterval(() => {
        res.write(':\n\n'); // Comment line as heartbeat
    }, 30000);
    
    // Add client to SSE clients set
    sseClients.add(res);
    console.log(`SSE client connected. Total SSE clients: ${sseClients.size}`);
    
    // Remove client when connection closes
    req.on('close', () => {
        clearInterval(heartbeatInterval);
        sseClients.delete(res);
        console.log(`SSE client disconnected. Total SSE clients: ${sseClients.size}`);
    });
});

// Toggle simulation endpoint
app.post('/toggleSimulation', (req, res) => {
    const enable = req.body.enable;
    
    if (enable && !simulationActive) {
        startSimulation();
        res.status(200).json({ status: 'Simulation started' });
    } else if (!enable && simulationActive) {
        stopSimulation();
        res.status(200).json({ status: 'Simulation stopped' });
    } else {
        res.status(200).json({ 
            status: simulationActive ? 'Simulation already running' : 'Simulation already stopped' 
        });
    }
});

// WebSocket endpoint for Flutter clients
wssClients.on('connection', async (socket, req) => {
    console.log('WebSocket client connected');
    clients.add(socket);

    // Send the current initialData to the newly connected client
    if (initialData && Object.keys(initialData).length > 0) {
        socket.send(JSON.stringify({
            M: [{
                H: 'Streaming',
                M: 'feed',
                A: [{
                    R: initialData  // Send the full initialData
                }]
            }]
        }));
        console.log('Sent initial data to new client');
    }

    socket.on('message', (message) => {
        try {
            // Parse and handle messages from Flutter client
            const data = JSON.parse(message);
            console.log('Received from Flutter client:', data);
        } catch (e) {
            console.error('Error processing message from client:', e);
        }
    });

    socket.on('close', () => {
        console.log('Flutter client disconnected');
        clients.delete(socket);
    });
});

// Function to broadcast to all connected clients (both WebSocket and SSE)
function broadcastToClients(data) {
    const message = JSON.stringify(data);
    
    // Store recent updates with timestamp for new clients
    // Only store feed messages that contain actual updates
    if (data.M && Array.isArray(data.M) && data.M.length > 0) {
        for (const msg of data.M) {
            if (msg.H === 'Streaming' && msg.M === 'feed' && msg.A && Array.isArray(msg.A) && msg.A.length > 0) {
                // Add to recent updates with timestamp
                recentUpdates.push({
                    timestamp: Date.now(),
                    data: data
                });
                
                // Trim the updates array if it gets too large
                if (recentUpdates.length > MAX_RECENT_UPDATES) {
                    recentUpdates.shift(); // Remove oldest update
                }
                
                break; // Only store once if multiple matching messages
            }
        }
    }
    
    // Broadcast to WebSocket clients
    clients.forEach(client => {
        if (client.readyState === ws.OPEN) {
            client.send(message);
        }
    });
    
    // Broadcast to SSE clients
    sseClients.forEach(client => {
        try {
            client.write(`data: ${message}\n\n`);
        } catch (error) {
            console.error('Error sending SSE data:', error);
            sseClients.delete(client);
        }
    });
}

async function negotiate() {
    const hub = encodeURIComponent(JSON.stringify([{name:"Streaming"}]));
    const url = `https://livetiming.formula1.com/signalr/negotiate?connectionData=${hub}&clientProtocol=1.5`;
    const resp = await axios.get(url);
    return resp;
}

async function connectwss(token, cookie) {
    const hub = encodeURIComponent(JSON.stringify([{name:"Streaming"}]));
    const encodedToken = encodeURIComponent(token);
    const url = `wss://livetiming.formula1.com/signalr/connect?clientProtocol=1.5&transport=webSockets&connectionToken=${encodedToken}&connectionData=${hub}`;
    
    const p = new Promise((res, rej) => {
        const sock = new ws.WebSocket(url, {headers: {
            'User-Agent': 'BestHTTP',
            'Accept-Encoding': 'gzip,identity',
            'Cookie': cookie
        }});

        sock.on('open', ev => {
            console.log('Connected to F1 WebSocket');
            res(sock);
        });
        
        sock.on('message', (data) => {
            try {
                // Parse the data
                const parsedData = JSON.parse(data);

                // Store initial data if R object is present
                if (parsedData.R) {
                    initialData = parsedData.R;
                    console.log('Received initial data:', initialData);
                }

                // Process CarData.z if present
                if (parsedData.M && Array.isArray(parsedData.M)) {
                    for (const message of parsedData.M) {
                        if (message.H === 'Streaming' && message.M === 'feed') {
                            // Update initialData with this feed message
                            updateInitialData(message);
                            
                            if (message.A && Array.isArray(message.A) && message.A.length >= 2 &&
                                message.A[1] === 'CarData.z' && typeof message.A[0] === 'string') {
                                console.log('Received compressed CarData.z, processing...');
                                processCarDataZ(message.A[0]);
                                
                                // Skip broadcasting original compressed data
                                continue;
                            }
                        }
                    }
                }

                // Broadcast data to clients
                broadcastToClients(parsedData);
            } catch (e) {
                console.error('Error processing F1 data:', e);
            }
        });
        
        sock.on('error', (error) => {
            console.error('F1 WebSocket error:', error);
        });
        
        sock.on('close', () => {
            console.log('F1 WebSocket closed, attempting to reconnect in 5 seconds...');
            setTimeout(() => {
                main().catch(console.error);
            });
        });
    });
    
    return p;
}

// Function to process CarData.z compressed data
function processCarDataZ(base64Data) {
    try {
        // Convert base64 to buffer
        const compressedBuffer = Buffer.from(base64Data, 'base64');
        
        // Decompress using zlib with raw DEFLATE (no headers)
        zlib.inflateRaw(compressedBuffer, (err, decompressedBuffer) => {
            if (err) {
                console.error('CarData.z decompression error:', err);
                return;
            }
            
            try {
                // Convert the buffer to a string and parse as JSON
                const jsonString = decompressedBuffer.toString('utf-8');
                const carData = JSON.parse(jsonString);
                
                // Store the processed car telemetry data
                carTelemetryData = carData;
                
                console.log(`Decompressed CarData.z: Found ${carData.Entries?.length || 0} entries`);
                
                // Format the data in a more manageable structure for clients
                const formattedCarData = formatCarTelemetryData(carData);
                
                // Broadcast only the car telemetry data to clients
                broadcastToClients({
                    M: [{
                        H: 'Streaming',
                        M: 'feed',
                        A: [{
                            CarData: formattedCarData
                        }]
                    }]
                });
            } catch (parseErr) {
                console.error('Error parsing decompressed CarData.z JSON:', parseErr);
            }
        });
    } catch (e) {
        console.error('Error processing CarData.z:', e);
    }
}

// Function to format car telemetry data in a more client-friendly structure
function formatCarTelemetryData(carData) {
    if (!carData.Entries || !Array.isArray(carData.Entries) || carData.Entries.length === 0) {
        return {};
    }
    
    // Get the latest entry
    const latestEntry = carData.Entries[carData.Entries.length - 1];
    const formatted = {
        Timestamp: latestEntry.Utc,
        Cars: {}
    };
    
    // Process data for each car
    Object.keys(latestEntry.Cars || {}).forEach(carNumber => {
        const car = latestEntry.Cars[carNumber];
        const channels = car.Channels || [];
        
        // Map known channel indexes to meaningful names
        formatted.Cars[carNumber] = {
            RPM: channels[0] || 0,
            Speed: channels[2] ? Math.round((channels[2] / 1000) * 3.6) : 0, // Convert to km/h
            Gear: channels[3] || 0,
            Throttle: channels[4] || 0,
            Brake: channels[5] || 0,
            DRS: channels[45] || 0,
            // Add more channel mappings as needed
        };
    });
    
    return formatted;
}

// Endpoint for WebSocket connection
app.get('/ws', (req, res) => {
    res.send('WebSocket endpoint active. Connect using a WebSocket client.');
});

// Endpoint to check status and client count
app.get('/status', (req, res) => {
    res.status(200).json({
        simulationActive,
        wsClients: clients.size,
        sseClients: sseClients.size,
        dataAvailable: Object.keys(latestData).length > 0
    });
});

// List of topic names to fetch
const topicNames = [
  "ExtrapolatedClock",
  "TopThree",
  "TimingStats",
  "TimingAppData",
  "WeatherData",
  "TrackStatus",
  "SessionStatus",
  "DriverList",
  "RaceControlMessages",
  "SessionInfo",
  "SessionData",
  "LapCount",
  "TimingData",
  "TeamRadio",
  "PitLaneTimeCollection",
  "ChampionshipPrediction"
];

// Function to fetch all topic data and combine - without caching
async function fetchInitialData() {
  try {
    console.log(`Fetching fresh initial data, Path: ${path}`);
    // Construct the baseUrl dynamically
    // Use currentEventDateString for the date parts of the URL
    const baseUrl = `https://livetiming.formula1.com/static/${path}`;
    
    // Create an object to hold all fetched data
    const combinedData = { R: {} };
    
    // Fetch data for each topic in parallel
    const fetchPromises = topicNames.map(async (topic) => {
      try {
        const response = await axios.get(`${baseUrl}${topic}.json`, {
          headers: {
            'User-Agent': 'BestHTTP'
          },
        //   timeout: 5000 // Set a reasonable timeout
        });
        
        // Add the fetched data to our combined object
        combinedData.R[topic] = response.data;
        console.log(`Successfully fetched ${topic} data`);
      } catch (error) {
        console.error(`Error fetching ${topic} data:`, error.message);
        // Continue with other topics even if one fails
      }
    });
    
    // Wait for all fetches to complete
    await Promise.all(fetchPromises);
    
    return combinedData;
  } catch (error) {
    console.error('Error in fetchInitialData:', error);
    return { R: {} }; // Return empty structure if failed
  }
}

// Add this function to update initialData with incoming feed updates
function updateInitialData(message) {
    if (!message || !message.H || !message.M || !message.A || message.M !== 'feed') {
        return; // Not a valid feed message
    }

    try {
        // Extract topic name and data from the message
        const topic = message.A[0];
        const data = message.A[1];
        
        if (!topic || !data) return;
        
        // Initialize the topic in initialData if it doesn't exist
        if (!initialData[topic]) {
            initialData[topic] = {};
        }
        
        // Handle different update types
        if (typeof data === 'object' && !Array.isArray(data)) {
            // For simple updates like WeatherData, directly update the properties
            if (!Object.keys(data).includes('Lines')) {
                initialData[topic] = { ...initialData[topic], ...data };
            } 
            // For nested updates like TimingData with Lines
            else if (data.Lines) {
                if (!initialData[topic].Lines) {
                    initialData[topic].Lines = {};
                }
                
                // Update each driver's data
                Object.keys(data.Lines).forEach(driverId => {
                    if (!initialData[topic].Lines[driverId]) {
                        initialData[topic].Lines[driverId] = {};
                    }
                    
                    // Deep merge the nested driver data
                    initialData[topic].Lines[driverId] = deepMerge(
                        initialData[topic].Lines[driverId],
                        data.Lines[driverId]
                    );
                });
            }
        }
        
        console.log(`Updated initialData for ${topic}`);
    } catch (error) {
        console.error('Error updating initialData:', error);
    }
}

// Update the /initialData endpoint to use the current initialData
app.get('/initialData', async (req, res) => {
  try {
    res.status(200).json({
        R: initialData || {}
    });
  } catch (error) {
    console.error('Error serving initial data:', error);
    res.status(500).json({ error: 'Failed to fetch initial data' });
  }
});

// Add this to your /status endpoint or create a new /fix endpoint
app.get('/fix-data', (req, res) => {
    try {
        // Clean up reference data
        referenceData = validateArrayData(referenceData);
        
        // Clean up combined data
        combinedData = validateArrayData(combinedData);
        
        // Update combined data
        updateCombinedData();
        
        res.status(200).json({
            message: 'Data structure fixed successfully',
            status: 'ok'
        });
    } catch (error) {
        console.error('Error fixing data:', error);
        res.status(500).json({
            error: 'Failed to fix data',
            message: error.message
        });
    }
});

// Simulation data generation functions
// function startSimulation() {
//     if (simulationActive) return;
    
//     console.log('Starting F1 data simulation');
//     simulationActive = true;
    
//     // Initial setup of simulated data
//     generateInitialSimulationData();
    
//     // Update simulation data at regular intervals
//     simulationInterval = setInterval(() => {
//         updateSimulationData();
        
//         // Broadcast the updated simulation data
//         broadcastToClients({
//             M: [{
//                 H: 'Streaming',
//                 M: 'feed',
//                 A: [latestData]
//             }]
//         });
//     }, 500); // Update every 500ms
// }

// function stopSimulation() {
//     if (!simulationActive) return;
    
//     console.log('Stopping F1 data simulation');
//     simulationActive = false;
    
//     if (simulationInterval) {
//         clearInterval(simulationInterval);
//         simulationInterval = null;
//     }
// }

// function generateInitialSimulationData() {
//     const drivers = [
//         { id: '44', number: '44', code: 'HAM', name: 'Lewis Hamilton', team: 'Mercedes', teamColor: '#00D2BE' },
//         { id: '63', number: '63', code: 'RUS', name: 'George Russell', team: 'Mercedes', teamColor: '#00D2BE' },
//         { id: '1', number: '1', code: 'VER', name: 'Max Verstappen', team: 'Red Bull Racing', teamColor: '#0600EF' },
//         { id: '11', number: '11', code: 'PER', name: 'Sergio Perez', team: 'Red Bull Racing', teamColor: '#0600EF' },
//         { id: '16', number: '16', code: 'LEC', name: 'Charles Leclerc', team: 'Ferrari', teamColor: '#DC0000' },
//         { id: '55', number: '55', code: 'SAI', name: 'Carlos Sainz', team: 'Ferrari', teamColor: '#DC0000' },
//         { id: '4', number: '4', code: 'NOR', name: 'Lando Norris', team: 'McLaren', teamColor: '#FF8700' },
//         { id: '81', number: '81', code: 'PIA', name: 'Oscar Piastri', team: 'McLaren', teamColor: '#FF8700' },
//         { id: '14', number: '14', code: 'ALO', name: 'Fernando Alonso', team: 'Aston Martin', teamColor: '#006F62' },
//         { id: '18', number: '18', code: 'STR', name: 'Lance Stroll', team: 'Aston Martin', teamColor: '#006F62' },
//         { id: '31', number: '31', code: 'OCO', name: 'Esteban Ocon', team: 'Alpine', teamColor: '#0090FF' },
//         { id: '10', number: '10', code: 'GAS', name: 'Pierre Gasly', team: 'Alpine', teamColor: '#0090FF' },
//         { id: '23', number: '23', code: 'ALB', name: 'Alexander Albon', team: 'Williams', teamColor: '#005AFF' },
//         { id: '2', number: '2', code: 'SAR', name: 'Logan Sargeant', team: 'Williams', teamColor: '#005AFF' },
//         { id: '22', number: '22', code: 'TSU', name: 'Yuki Tsunoda', team: 'RB', teamColor: '#1E41FF' },
//         { id: '3', number: '3', code: 'RIC', name: 'Daniel Ricciardo', team: 'RB', teamColor: '#1E41FF' },
//         { id: '77', number: '77', code: 'BOT', name: 'Valtteri Bottas', team: 'Kick Sauber', teamColor: '#52E252' },
//         { id: '24', number: '24', code: 'ZHO', name: 'Zhou Guanyu', team: 'Kick Sauber', teamColor: '#52E252' },
//         { id: '20', number: '20', code: 'MAG', name: 'Kevin Magnussen', team: 'Haas F1 Team', teamColor: '#FFFFFF' },
//         { id: '27', number: '27', code: 'HUL', name: 'Nico Hulkenberg', team: 'Haas F1 Team', teamColor: '#FFFFFF' }
//     ];

//     // Initialize driver list
//     const driverList = {};
//     drivers.forEach((driver, index) => {
//         driverList[driver.id] = {
//             RacingNumber: driver.number,
//             BroadcastName: driver.code,
//             FullName: driver.name,
//             Tla: driver.code,
//             TeamName: driver.team,
//             TeamColor: driver.teamColor,
//             FirstName: driver.name.split(' ')[0],
//             LastName: driver.name.split(' ')[1],
//             Reference: driver.id,
//             HeadshotUrl: `/api/placeholder/100/100`
//         };
//     });

//     // Initialize timing data
//     const timingData = {};
//     const trackLength = 5.303; // km
//     const baseTime = 85; // seconds

//     drivers.forEach((driver, index) => {
//         // Randomize positions but keep top teams generally in front
//         let positionBias = Math.floor(index / 2);
//         let position = Math.max(1, Math.min(20, positionBias + Math.floor(Math.random() * 3)));
        
//         // Ensure unique positions
//         while (Object.values(timingData).some(d => d.Position === position)) {
//             position = Math.max(1, Math.min(20, position + (Math.random() > 0.5 ? 1 : -1)));
//         }
        
//         // Generate random lap times with position bias
//         const lapTimeBase = baseTime + (position * 0.1); // Better positions get slightly better times
//         const lastLapTime = formatTime(lapTimeBase + (Math.random() * 1 - 0.5));
//         const bestLapTime = formatTime(lapTimeBase - 0.3 - (Math.random() * 0.5));
        
//         timingData[driver.id] = {
//             Position: position,
//             ClassPosition: position,
//             GapToLeader: position === 1 ? '' : `+${(position - 1) * 2.5 + Math.random() * 2}.${Math.floor(Math.random() * 1000)}`,
//             IntervalToPositionAhead: position === 1 ? '' : `+${1.5 + Math.random() * 2}.${Math.floor(Math.random() * 1000)}`,
//             LastLapTime: lastLapTime,
//             BestLapTime: bestLapTime,
//             Sectors: {
//                 '0': { Value: formatTime((lapTimeBase / 3) - 0.1 + Math.random() * 0.4) },
//                 '1': { Value: formatTime((lapTimeBase / 3) - 0.1 + Math.random() * 0.4) },
//                 '2': { Value: formatTime((lapTimeBase / 3) - 0.1 + Math.random() * 0.4) }
//             },
//             Speed: {
//                 '0': Math.floor(315 - position + Math.random() * 10),
//                 '1': Math.floor(280 - position + Math.random() * 15),
//                 '2': Math.floor(345 - position + Math.random() * 8)
//             },
//             NumberOfLaps: 20 + Math.floor(Math.random() * 3),
//             NumberOfPitStops: Math.floor(Math.random() * 2),
//             Status: 'RUNNING',
//             InPit: false
//         };
//     });

//     // ExtrapolatedClock
//     const trackStatus = {
//         TrackStatus: 'AllClear',
//         Message: 'All Clear'
//     };

//     // Current session info
//     const sessionInfo = {
//         Meeting: {
//             OfficialName: 'FORMULA 1 SIMULATION GRAND PRIX 2025',
//             Location: 'Test Circuit',
//             Country: {
//                 Code: 'SIM',
//                 Name: 'Simulation'
//             }
//         },
//         Type: 'Race',
//         Name: 'Race',
//         StartDate: new Date().toISOString(),
//         EndDate: new Date(new Date().getTime() + 2 * 60 * 60 * 1000).toISOString(),
//         Status: 'Started'
//     };

//     // Weather data
//     const weatherData = {
//         AirTemp: 22 + Math.random() * 5,
//         Humidity: 40 + Math.random() * 30,
//         Pressure: 1010 + Math.random() * 10,
//         Rainfall: false,
//         TrackTemp: 30 + Math.random() * 8,
//         WindDirection: 180 + Math.random() * 180,
//         WindSpeed: 5 + Math.random() * 15
//     };

//     // Add simulated reference data
//     referenceData = {
//         R: {
//             Version: "1.0",
//             SessionMeta: {
//                 SessionId: "sim-session-001",
//                 SimulationReference: true
//             }
//         }
//     };

//     // Store in latest data
//     latestData = {
//         DriverList: driverList,
//         TimingData: timingData,
//         TrackStatus: trackStatus,
//         SessionInfo: sessionInfo,
//         WeatherData: weatherData,
//     };
// }

// function updateSimulationData() {
//     if (!latestData.TimingData) return;
    
//     const driverIds = Object.keys(latestData.TimingData);
    
//     // Update lap times and positions
//     driverIds.forEach(driverId => {
//         const driver = latestData.TimingData[driverId];
        
//         // Random chance for pit stop
//         const pitProbability = 0.02; // 2% chance per update
//         if (Math.random() < pitProbability && !driver.InPit) {
//             driver.InPit = true;
//             driver.Status = 'PIT';
//         } else if (driver.InPit && Math.random() < 0.3) {
//             driver.InPit = false;
//             driver.Status = 'RUNNING';
//             driver.NumberOfPitStops = (driver.NumberOfPitStops || 0) + 1;
//         }
        
//         // Update lap count if not in pit
//         if (!driver.InPit && Math.random() < 0.1) {
//             driver.NumberOfLaps = (driver.NumberOfLaps || 0) + 1;
            
//             // Generate new lap time
//             const baseTime = 85 + (driver.Position * 0.1);
//             const variation = (Math.random() * 2 - 1); // -1 to +1 second variation
//             const newLapTime = formatTime(baseTime + variation);
            
//             // Check if it's a better lap
//             if (timeToSeconds(newLapTime) < timeToSeconds(driver.BestLapTime)) {
//                 driver.BestLapTime = newLapTime;
//             }
            
//             driver.LastLapTime = newLapTime;
            
//             // Update sector times
//             driver.Sectors = {
//                 '0': { Value: formatTime((baseTime / 3) - 0.1 + Math.random() * 0.4) },
//                 '1': { Value: formatTime((baseTime / 3) - 0.1 + Math.random() * 0.4) },
//                 '2': { Value: formatTime((baseTime / 3) - 0.1 + Math.random() * 0.4) }
//             };
            
//             // Update speeds
//             driver.Speed = {
//                 '0': Math.floor(315 - driver.Position + Math.random() * 10),
//                 '1': Math.floor(280 - driver.Position + Math.random() * 15),
//                 '2': Math.floor(345 - driver.Position + Math.random() * 8)
//             };
//         }
        
//         // Random chance for position change
//         const positionChangeProbability = 0.03; // 3% chance per update
//         if (Math.random() < positionChangeProbability && !driver.InPit) {
//             const currentPosition = driver.Position;
//             let newPosition;
            
//             if (currentPosition > 1 && Math.random() < 0.6) {
//                 // 60% chance to move up if not in first position
//                 newPosition = currentPosition - 1;
//             } else if (currentPosition < 20) {
//                 // Move down
//                 newPosition = currentPosition + 1;
//             } else {
//                 newPosition = currentPosition;
//             }
            
//             // Check if new position is available
//             const positionTaken = Object.values(latestData.TimingData).some(
//                 d => d !== driver && d.Position === newPosition
//             );
            
//             if (!positionTaken) {
//                 // Update driver position
//                 driver.Position = newPosition;
//                 driver.ClassPosition = newPosition;
                
//                 // Update gaps
//                 if (newPosition === 1) {
//                     driver.GapToLeader = '';
//                     driver.IntervalToPositionAhead = '';
//                 } else {
//                     driver.GapToLeader = `+${(newPosition - 1) * 2.5 + Math.random() * 2}.${Math.floor(Math.random() * 1000)}`;
//                     driver.IntervalToPositionAhead = `+${1.5 + Math.random() * 2}.${Math.floor(Math.random() * 1000)}`;
//                 }
//             }
//         }
//     });
    
//     // Random chance for weather changes
//     if (Math.random() < 0.05) { // 5% chance per update
//         latestData.WeatherData.AirTemp += (Math.random() * 0.4 - 0.2);
//         latestData.WeatherData.TrackTemp += (Math.random() * 0.6 - 0.3);
//         latestData.WeatherData.WindSpeed += (Math.random() * 1 - 0.5);
//         latestData.WeatherData.Humidity += (Math.random() * 2 - 1);
//     }
    
//     // Random chance for track status changes
//     if (Math.random() < 0.01) { // 1% chance per update
//         const statuses = [
//             { status: 'AllClear', message: 'All Clear' },
//             { status: 'Yellow', message: 'Yellow Flag' },
//             { status: 'YellowSector1', message: 'Yellow Flag Sector 1' },
//             { status: 'YellowSector2', message: 'Yellow Flag Sector 2' },
//             { status: 'YellowSector3', message: 'Yellow Flag Sector 3' },
//             { status: 'VSC', message: 'Virtual Safety Car Deployed' },
//             { status: 'SC', message: 'Safety Car Deployed' }
//         ];
        
//         const randomStatus = statuses[Math.floor(Math.random() * statuses.length)];
//         latestData.TrackStatus = {
//             TrackStatus: randomStatus.status,
//             Message: randomStatus.message
//         };
//     }
// }

// Helper function to format time in mm:ss.SSS
function formatTime(seconds) {
    const minutes = Math.floor(seconds / 60);
    const remainingSeconds = seconds % 60;
    
    const formattedMinutes = String(minutes).padStart(1, '0');
    const formattedSeconds = remainingSeconds.toFixed(3).padStart(6, '0');
    
    return `${formattedMinutes}:${formattedSeconds}`;
}

// Helper function to convert time string to seconds
function timeToSeconds(timeString) {
    if (!timeString || typeof timeString !== 'string') return 999999;
    
    const parts = timeString.split(':');
    if (parts.length !== 2) return 999999;
    
    const minutes = parseInt(parts[0]);
    const seconds = parseFloat(parts[1]);
    
    return minutes * 60 + seconds;
}

// IRRELAVANT CODE - REMOVE OR COMMENT OUT
// Add this function to save the combined data
// function saveLatestDataToFile() {
//     try {
//         // First check if the file exists and read existing data
//         let existingData = {};
//         try {
//             if (fs.existsSync('./initialData.json')) {
//                 const fileContent = fs.readFileSync('./initialData.json', 'utf8');
//                 existingData = JSON.parse(fileContent);
//             }
//         } catch (readError) {
//             console.error('Error reading existing initialData.json:', readError);
//             // Continue with empty object if file can't be read
//         }
        
//         // Deep merge the existing data with reference and latest data
//         // This ensures we only update what has changed
//         const dataToSave = deepMerge(
//             existingData, 
//             { 
//                 ...referenceData,
//                 ...latestData 
//             }
//         );
        
//         // Write the merged data back to file
//         fs.writeFileSync('./initialData.json', JSON.stringify(dataToSave, null, 2));
//     } catch (error) {
//         console.error('Error saving latest data to file:', error);
//     }
// }

// Replace saveLatestDataToFile with updateCombinedData
function updateCombinedData() {
    try {
        // Deep merge the existing data with reference and latest data
        combinedData = deepMerge(
            combinedData, 
            { 
                ...referenceData,
                ...latestData 
            }
        );
        console.log('Combined data updated Successfully:');
    } catch (error) {
        console.error('Error updating combined data:', error);
    }
}

// Helper function to deep merge objects
function deepMerge(target, source) {
    // Create a new object to avoid modifying either parameter
    const output = { ...target };
    
    // Handle case when target is not an object
    if (isObject(target) && isObject(source)) {
        Object.keys(source).forEach(key => {
            if (Array.isArray(source[key])) {
                // For arrays, replace with the source array
                output[key] = [...source[key]];
            } else if (isObject(source[key])) {
                // If property exists and is an object, merge
                if (key in target && isObject(target[key])) {
                    output[key] = deepMerge(target[key], source[key]);
                } else {
                    // Otherwise just use the source object
                    output[key] = { ...source[key] };
                }
            } else {
                // For non-objects, just overwrite with source value
                output[key] = source[key];
            }
        });
    }
    
    return output;
}

// Helper to check if value is an object
function isObject(item) {
    return (item && typeof item === 'object' && !Array.isArray(item));
}

// Add this helper function near your other utility functions
function validateArrayData(data) {
    // Check if this is a character-by-character array that should be a string
    if (Array.isArray(data) && data.length > 0 && 
        typeof data[0] === 'string' && data[0].length === 1 && 
        '0' in data && '1' in data) {
        
        // Attempt to reconstruct the string
        try {
            let reconstructed = '';
            for (let i = 0; i < Object.keys(data).length; i++) {
                if (i.toString() in data) {
                    reconstructed += data[i.toString()];
                }
            }
            
            // If it looks like JSON, parse it
            if ((reconstructed.startsWith('{') && reconstructed.endsWith('}')) ||
                (reconstructed.startsWith('[') && reconstructed.endsWith(']'))) {
                try {
                    return JSON.parse(reconstructed);
                } catch (e) {
                    console.log('Reconstructed string not valid JSON:', reconstructed.substring(0, 50) + '...');
                    return reconstructed;
                }
            }
            
            return reconstructed;
        } catch (e) {
            console.error('Error reconstructing string from array:', e);
            return data;
        }
    }
    
    // Handle nested arrays
    if (Array.isArray(data)) {
        return data.map(item => validateArrayData(item));
    }
    
    // Handle objects
    if (isObject(data)) {
        const result = {};
        for (const key in data) {
            result[key] = validateArrayData(data[key]);
        }
        return result;
    }
    
    return data;
}

async function main() {
    try {
        // Check if simulation is requested via environment variable
        if (process.env.SIMULATE === 'true') {
            console.log('Starting in simulation mode by default');
            startSimulation();
            return;
        }
        
        const resp = await negotiate();
        console.log('Negotiation successful');
        
        const sock = await connectwss(resp.data['ConnectionToken'], resp.headers['set-cookie']);

        // Subscribe to F1 data
        sock.send(JSON.stringify(
            {
                "H": "Streaming",
                "M": "Subscribe",
                "A": [["Heartbeat",
        "CarData.z",
        // "Position.z",
        "ExtrapolatedClock",
        "TopThree",
        "RcmSeries",
        "TimingStats",
        "TimingAppData",
        "WeatherData",
        "TrackStatus",
        "SessionStatus",
        "DriverList",
        "RaceControlMessages",
        "SessionInfo",
        "SessionData",
        "LapCount",
        "TimingData",
        "TeamRadio",
        "PitLaneTimeCollection",
        "ChampionshipPrediction"]],
                "I": 1
            }
        ));
        
        console.log('Subscribed to F1 data streams');
        
        // Stop simulation since we have a real connection
        // stopSimulation();
    } catch(e) {
        console.error('Main function error:', e);
        // console.log('Falling back to simulation mode');
        // startSimulation();
        console.log('Attempting to reconnect to real F1 data in 30 seconds...');
        setTimeout(main, 30000);
    }
}

// Start the server
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    console.log(`WebSocket clients can connect to ws://localhost:${PORT}`);
    console.log(`SSE clients can connect to http://localhost:${PORT}/events`);
    main().catch(error => {
        console.error('Failed to start main process:', error);
        // console.log('Starting in simulation mode');
        // startSimulation();
    });
});
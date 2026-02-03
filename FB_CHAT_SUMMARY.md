Challenges Faced                                                                                                        
  Challenge: 1. Pre-built React Bundle                                                                                    
  Description: The frontend is a minified/bundled React app (HTTrack clone) with no source code access. Internal logic is 
    opaque and hard to debug.                                                                                             
  ────────────────────────────────────────                                                                                
  Challenge: 2. WebSocket Not Initiating                                                                                  
  Description: React app displayed UI but never initiated WebSocket connection. Console showed "Lobby app is initialized" 
    but socket never connected.                                                                                           
  ────────────────────────────────────────                                                                                
  Challenge: 3. Auth Response Mismatch                                                                                    
  Description: Backend auth endpoint wasn't returning jwt field that React app expected. Only returned result and data.   
  ────────────────────────────────────────                                                                                
  Challenge: 4. Race Condition                                                                                            
  Description: React app tried to access game state (playMode) before WebSocket connected and populated the state.        
  ────────────────────────────────────────                                                                                
  Challenge: 5. Wallet Callback Failure                                                                                   
  Description: Bets failed with ECONNREFUSED because backend tried calling localhost:3001 for wallet operations.          
  ---                                                                                                                     
  Solutions & Workarounds                                                                                                 
  Problem: JWT field missing                                                                                              
  Solution: Added jwt: newToken to auth response in game-api-routes.service.ts                                            
  Reason: React app specifically looks for jwt field in auth response                                                     
  ────────────────────────────────────────                                                                                
  Problem: WebSocket not connecting                                                                                       
  Solution: Pre-establish socket connection in index.html BEFORE React loads                                              
  Reason: React's internal socket init logic wasn't triggering; bypassed by connecting externally first                   
  ────────────────────────────────────────                                                                                
  Problem: Socket.io not available                                                                                        
  Solution: Load socket.io CDN before React scripts                                                                       
  Reason: Bundled socket.io wasn't exposed globally; React may need window.io                                             
  ────────────────────────────────────────                                                                                
  Problem: Race condition                                                                                                 
  Solution: Wait for initial data (balance, config, userData) before loading React                                        
  Reason: Ensures state is populated when React renders                                                                   
  ────────────────────────────────────────                                                                                
  Problem: Wallet callback                                                                                                
  Solution: Option 1: Mock wallet server on port 3001Option 2: Use brlag agent with real wallet API                       
  Reason: For dev: mock server; For real testing: use production wallet                                                   
  ---                                                                                                                     
  Quick Reference for Future                                                                                              
                                                                                                                          
  Files Modified:                                                                                                         
  coinflip-clone-httrack/index.html    # Auth + WebSocket bootstrap                                                       
  src/routes/game-api-routes/game-api-routes.service.ts  # Added jwt field                                                
  src/routes/game-api-routes/DTO/auth-login.dto.ts       # Updated interface                                              
                                                                                                                          
  Frontend Bootstrap Flow (index.html):                                                                                   
  1. Load socket.io CDN                                                                                                   
  2. GET /api/dev-game-token → get auth token                                                                             
  3. POST /api/auth → get JWT                                                                                             
  4. Set window.env.JWT                                                                                                   
  5. Connect WebSocket with JWT                                                                                           
  6. Wait for onBalanceChange, betsConfig, myData                                                                         
  7. Load React scripts                                                                                                   
                                                                                                                          
  Test URLs:                                                                                                              
  # With real wallet (brlag agent)                                                                                        
  http://localhost:8080/index.html?operatorId=brlag&gameMode=coinflip&currency=INR                                        
                                                                                                                          
  # With mock wallet (dev-operator)                                                                                       
  http://localhost:8080/index.html?operatorId=dev-operator&gameMode=coinflip&currency=INR                                 
                                                                                                                          
  Required Services:                                                                                                      
  npm run start:dev                    # Backend (port 3000)                                                              
  python3 -m http.server 8080          # Frontend (port 8080) - run in coinflip-clone-httrack/                            
  node mock-wallet-server.js           # Mock wallet (port 3001) - only for dev-operator                                  
                                                                                                                          
  Database Agents:                                                                                                        
  ┌──────────────┬───────────────────────────────────────────────┬─────────────────────┐                                  
  │   agentId    │                  callbackURL                  │      Use Case       │                                  
  ├──────────────┼───────────────────────────────────────────────┼─────────────────────┤                                  
  │ brlag        │ https://awc.play247.services/awc/singleWallet │ Real testing        │                                  
  ├──────────────┼───────────────────────────────────────────────┼─────────────────────┤                                  
  │ dev-operator │ http://localhost:3001/callback                │ Local dev with mock │                                  
  └──────────────┴───────────────────────────────────────────────┴─────────────────────┘                                  
  ---                                                                                                                     
  Suggestions for Game Development                                                                                        
                                                                                                                          
  1. Create a Dev Mode Flag                                                                                               
    - Add USE_LOCAL_BALANCE=true env var to skip wallet callbacks in dev                                                  
    - Deduct/credit directly from local user.balance column                                                               
  2. Document Frontend Integration                                                                                        
    - The React app expects specific window.env values and auth flow                                                      
    - Create integration guide for operators                                                                              
  3. Decouple Socket Init from React                                                                                      
    - Current React bundle has tightly coupled socket logic                                                               
    - Future builds should expose socket initialization hooks                                                             
  4. Add Health Check Endpoint                                                                                            
    - /api/health that verifies DB, wallet connectivity                                                                   
    - Helps debug integration issues quickly                                                                              
  5. Standardize Auth Response                                                                                            
    - Always include jwt, result, data, success in auth response                                                          
    - Document expected response shape for frontend teams                                                                 
  6. Mock Wallet as Package Script                                                                                        
    - Add npm run mock:wallet to package.json                                                                             
    - Makes local development easier                                                                                      
  7. Environment-Specific Configs                                                                                         
    - Consider .env.development with dev-operator defaults                                                                
    - .env.staging with brlag and real wallet URL 
<?php
/**
 * Embedder Authentication Handler
 * Handles authentication flows for WebScreen Serial IDE
 *
 * Endpoints:
 * - start_device_code: Start device code authentication
 * - poll_device_code: Poll for device authorization
 * - exchange_token: Exchange custom token for Firebase token
 * - refresh_token: Refresh expired token
 * - get_credentials: Get current credentials
 * - logout: Clear credentials
 * - callback: Handle browser redirect callback
 */

// Start session for credential storage
session_start();

// CORS headers for local development
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: GET, POST, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');
header('Content-Type: application/json');

// Handle preflight requests
if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') {
    http_response_code(200);
    exit();
}

// Embedder configuration (from CLI)
define('EMBEDDER_CONFIG', [
    'backendUrl' => 'https://backend-service-prod.embedder.dev',
    'firebaseApiKey' => 'AIzaSyDuNXvHd-GvTrmXG6_2TnrfqRWo-ApPd3s',
    'tokenApiUrl' => 'https://securetoken.googleapis.com/v1/token',
    'customTokenUrl' => 'https://identitytoolkit.googleapis.com/v1/accounts:signInWithCustomToken'
]);

/**
 * Make HTTP request with error handling
 */
function makeRequest($url, $method = 'GET', $data = null, $headers = []) {
    $ch = curl_init();

    curl_setopt($ch, CURLOPT_URL, $url);
    curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
    curl_setopt($ch, CURLOPT_FOLLOWLOCATION, true);
    curl_setopt($ch, CURLOPT_SSL_VERIFYPEER, true);

    if ($method === 'POST') {
        curl_setopt($ch, CURLOPT_POST, true);
        if ($data) {
            $jsonData = json_encode($data);
            curl_setopt($ch, CURLOPT_POSTFIELDS, $jsonData);
            $headers[] = 'Content-Type: application/json';
            $headers[] = 'Content-Length: ' . strlen($jsonData);
        }
    }

    if (!empty($headers)) {
        curl_setopt($ch, CURLOPT_HTTPHEADER, $headers);
    }

    $response = curl_exec($ch);
    $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
    $error = curl_error($ch);

    curl_close($ch);

    if ($error) {
        throw new Exception("Request failed: $error");
    }

    $decoded = json_decode($response, true);

    return [
        'status' => $httpCode,
        'data' => $decoded ?: $response,
        'raw' => $response
    ];
}

/**
 * Parse JWT token
 */
function parseJWT($token) {
    $parts = explode('.', $token);
    if (count($parts) !== 3) {
        throw new Exception('Invalid JWT format');
    }

    $payload = base64_decode(strtr($parts[1], '-_', '+/'));
    return json_decode($payload, true);
}

/**
 * Parse Server-Sent Events (SSE) stream from Anthropic API
 */
function parseSSEStream($sseData) {
    $lines = explode("\n", $sseData);
    $fullText = '';

    foreach ($lines as $line) {
        // SSE format: "data: {json}"
        if (strpos($line, 'data: ') === 0) {
            $jsonStr = substr($line, 6); // Remove "data: " prefix
            $eventData = json_decode($jsonStr, true);

            // Extract text from content_block_delta events
            if (isset($eventData['type']) &&
                $eventData['type'] === 'content_block_delta' &&
                isset($eventData['delta']['text'])) {
                $fullText .= $eventData['delta']['text'];
            }
        }
    }

    // Return in Anthropic API format
    return [
        'content' => [
            [
                'type' => 'text',
                'text' => $fullText
            ]
        ]
    ];
}

/**
 * Validate token (supports both JWT and better-auth tokens)
 */
function validateToken($token, $authType = null) {
    try {
        // Check for better-auth tokens (simple session tokens, not JWTs)
        if ($authType === 'better-auth') {
            // better-auth tokens are simple strings, just check they exist and aren't empty
            if (empty($token) || strlen($token) < 10) {
                error_log('[Auth] Invalid better-auth token');
                return false;
            }
            // For better-auth, we trust the token and let the API validate it
            return true;
        }

        // Legacy JWT validation for Firebase tokens
        $parts = explode('.', $token);
        if (count($parts) !== 3) {
            // Not a JWT - might be a better-auth token, consider valid
            if (strlen($token) >= 10) {
                error_log('[Auth] Non-JWT token, assuming better-auth');
                return true;
            }
            return false;
        }

        $payload = parseJWT($token);

        // Check expiry
        if (isset($payload['exp']) && ($payload['exp'] * 1000) < (time() * 1000)) {
            error_log('[Auth] Token expired');
            return false;
        }

        // Check issuer
        if (isset($payload['iss']) && strpos($payload['iss'], 'securetoken.google.com') === false) {
            error_log('[Auth] Invalid issuer: ' . $payload['iss']);
            return false;
        }

        return true;
    } catch (Exception $e) {
        error_log('[Auth] Token validation error: ' . $e->getMessage());
        return false;
    }
}

/**
 * Start device code authentication
 */
function startDeviceCode() {
    try {
        error_log('[Auth] Starting device code authentication...');

        $response = makeRequest(
            EMBEDDER_CONFIG['backendUrl'] . '/api/v1/auth/device/start',
            'POST',
            []
        );

        if ($response['status'] !== 200) {
            error_log('[Auth] Device code start failed: ' . $response['status']);
            throw new Exception('Failed to start device auth: ' . $response['status']);
        }

        // Store device code data in session
        $_SESSION['device_code_data'] = $response['data'];

        error_log('[Auth] Device code started: ' . $response['data']['userCode']);

        return [
            'success' => true,
            'data' => $response['data']
        ];
    } catch (Exception $e) {
        error_log('[Auth] Device code start error: ' . $e->getMessage());
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Poll for device authorization
 */
function pollDeviceCode() {
    try {
        if (!isset($_SESSION['device_code_data']['userCode'])) {
            throw new Exception('No device code session found');
        }

        $userCode = $_SESSION['device_code_data']['userCode'];

        $response = makeRequest(
            EMBEDDER_CONFIG['backendUrl'] . '/api/v1/auth/device/token',
            'POST',
            ['code' => $userCode]
        );

        if ($response['status'] !== 200) {
            throw new Exception('Polling failed: ' . $response['status']);
        }

        $data = $response['data'];

        // DEBUG: Log the full response from Embedder
        error_log('[Auth] Full Embedder response: ' . json_encode($data));

        // If authorized, handle based on auth type
        if (isset($data['accessToken']) && $data['status'] === 'authorized') {
            error_log('[Auth] Device authorized!');
            error_log('[Auth] Auth type: ' . ($data['authType'] ?? 'unknown'));

            // Check if using new "better-auth" system (simple token, not Firebase)
            if (isset($data['authType']) && $data['authType'] === 'better-auth') {
                error_log('[Auth] Using better-auth flow - no Firebase exchange needed');

                // Store credentials directly from the response
                $credentials = [
                    'accessToken' => $data['accessToken'],
                    'idToken' => $data['accessToken'],  // Use same token for compatibility
                    'refreshToken' => null,  // better-auth may not use refresh tokens
                    'authType' => 'better-auth',
                    'expiresAt' => (time() + 86400) * 1000,  // Assume 24h expiry, in milliseconds
                    'user' => [
                        'uid' => $data['user']['id'] ?? null,
                        'email' => $data['user']['email'] ?? null,
                        'displayName' => $data['user']['name'] ?? null,
                        'picture' => $data['user']['image'] ?? null
                    ],
                    'timestamp' => time() * 1000
                ];

                $_SESSION['embedder_credentials'] = $credentials;

                // Create an Embedder session
                try {
                    $sessionResponse = makeRequest(
                        EMBEDDER_CONFIG['backendUrl'] . '/api/v1/sessions',
                        'POST',
                        [],
                        [
                            'Authorization: Bearer ' . $data['accessToken'],
                            'Content-Type: application/json',
                            'User-Agent: webscreen-serial-ide/1.0.0'
                        ]
                    );

                    if ($sessionResponse['status'] === 200 && isset($sessionResponse['data']['id'])) {
                        $_SESSION['embedder_session_id'] = $sessionResponse['data']['id'];
                        error_log('[Auth] Created Embedder session: ' . $_SESSION['embedder_session_id']);
                    } else {
                        error_log('[Auth] Session response: ' . json_encode($sessionResponse));
                    }
                } catch (Exception $e) {
                    error_log('[Auth] Error creating session: ' . $e->getMessage());
                }

                // Clear device code data
                unset($_SESSION['device_code_data']);

                return [
                    'success' => true,
                    'data' => [
                        'status' => 'authorized',
                        'accessToken' => true,
                        'credentialsStored' => true,
                        'authType' => 'better-auth'
                    ]
                ];
            }

            // Legacy Firebase flow - exchange the custom token
            error_log('[Auth] Using legacy Firebase flow - exchanging token...');
            $exchangeResult = exchangeToken($data['accessToken']);

            if (!$exchangeResult['success']) {
                throw new Exception('Token exchange failed: ' . $exchangeResult['error']);
            }

            error_log('[Auth] Token exchanged successfully, credentials stored in session');

            // Clear device code data
            unset($_SESSION['device_code_data']);

            // Return success with credentials indicator
            return [
                'success' => true,
                'data' => [
                    'status' => 'authorized',
                    'accessToken' => true,
                    'credentialsStored' => true
                ]
            ];
        }

        // Return the raw response for other statuses
        return [
            'success' => true,
            'data' => $data
        ];
    } catch (Exception $e) {
        error_log('[Auth] Poll error: ' . $e->getMessage());
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Exchange custom token for Firebase token
 */
function exchangeToken($customToken) {
    try {
        $url = EMBEDDER_CONFIG['customTokenUrl'] . '?key=' . EMBEDDER_CONFIG['firebaseApiKey'];

        $response = makeRequest(
            $url,
            'POST',
            [
                'token' => $customToken,
                'returnSecureToken' => true
            ]
        );

        if ($response['status'] !== 200) {
            $errorMsg = isset($response['data']['error']['message'])
                ? $response['data']['error']['message']
                : 'Authentication failed';
            throw new Exception($errorMsg);
        }

        $data = $response['data'];

        // Parse JWT to extract user info and expiry
        $expiresAt = time() + 3600; // Default 1 hour
        $userEmail = null;
        $userName = null;
        $userPicture = null;
        $userId = null;

        try {
            $payload = parseJWT($data['idToken']);

            // Extract expiry
            if (isset($payload['exp'])) {
                $expiresAt = $payload['exp'];
            }

            // Extract user info from JWT payload
            if (isset($payload['user_id'])) {
                $userId = $payload['user_id'];
            } elseif (isset($payload['sub'])) {
                $userId = $payload['sub'];
            }
            if (isset($payload['email'])) {
                $userEmail = $payload['email'];
            }
            if (isset($payload['name'])) {
                $userName = $payload['name'];
            }
            if (isset($payload['picture'])) {
                $userPicture = $payload['picture'];
            }

            error_log('[Auth] Extracted user from JWT: ' . $userEmail . ' (' . $userName . ') UID: ' . $userId);
        } catch (Exception $e) {
            error_log('[Auth] Could not parse JWT: ' . $e->getMessage());
        }

        // Store credentials in session
        $credentials = [
            'accessToken' => $data['idToken'],
            'idToken' => $data['idToken'],
            'refreshToken' => $data['refreshToken'],
            'expiresAt' => $expiresAt * 1000, // Milliseconds for JS
            'user' => [
                'uid' => $userId,
                'email' => $userEmail,
                'displayName' => $userName,
                'picture' => $userPicture
            ],
            'timestamp' => time() * 1000
        ];

        $_SESSION['embedder_credentials'] = $credentials;

        // Create an Embedder session (like CLI does in line 95-96)
        try {
            $sessionResponse = makeRequest(
                EMBEDDER_CONFIG['backendUrl'] . '/api/v1/sessions',
                'POST',
                [],
                [
                    'Authorization: Bearer ' . $data['idToken'],
                    'Content-Type: application/json',
                    'User-Agent: webscreen-serial-ide/1.0.0'
                ]
            );

            if ($sessionResponse['status'] === 200 && isset($sessionResponse['data']['id'])) {
                $_SESSION['embedder_session_id'] = $sessionResponse['data']['id'];
                error_log('[Auth] Created Embedder session: ' . $_SESSION['embedder_session_id']);
            } else {
                error_log('[Auth] Failed to create session: ' . json_encode($sessionResponse));
            }
        } catch (Exception $e) {
            error_log('[Auth] Error creating session: ' . $e->getMessage());
            // Continue even if session creation fails - it's not critical for auth
        }

        return [
            'success' => true,
            'credentials' => $credentials
        ];
    } catch (Exception $e) {
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Refresh expired token
 */
function refreshToken() {
    try {
        if (!isset($_SESSION['embedder_credentials']['refreshToken'])) {
            throw new Exception('No refresh token available');
        }

        $refreshToken = $_SESSION['embedder_credentials']['refreshToken'];

        $url = EMBEDDER_CONFIG['tokenApiUrl'] . '?key=' . EMBEDDER_CONFIG['firebaseApiKey'];

        // Build form data
        $postData = http_build_query([
            'grant_type' => 'refresh_token',
            'refresh_token' => $refreshToken
        ]);

        $ch = curl_init();
        curl_setopt($ch, CURLOPT_URL, $url);
        curl_setopt($ch, CURLOPT_POST, true);
        curl_setopt($ch, CURLOPT_POSTFIELDS, $postData);
        curl_setopt($ch, CURLOPT_RETURNTRANSFER, true);
        curl_setopt($ch, CURLOPT_HTTPHEADER, [
            'Content-Type: application/x-www-form-urlencoded'
        ]);

        $response = curl_exec($ch);
        $httpCode = curl_getinfo($ch, CURLINFO_HTTP_CODE);
        curl_close($ch);

        if ($httpCode !== 200) {
            throw new Exception('Token refresh failed: ' . $httpCode);
        }

        $data = json_decode($response, true);

        // Parse JWT to extract user info and expiry
        $expiresIn = isset($data['expires_in'])
            ? (is_string($data['expires_in']) ? intval($data['expires_in']) : $data['expires_in'])
            : 3600;

        $expiresAt = time() + $expiresIn;

        // Extract user info from refreshed JWT token
        $userEmail = null;
        $userName = null;
        $userPicture = null;
        $userId = null;

        try {
            $payload = parseJWT($data['id_token']);

            // Extract user info from JWT payload
            if (isset($payload['user_id'])) {
                $userId = $payload['user_id'];
            } elseif (isset($payload['sub'])) {
                $userId = $payload['sub'];
            }
            if (isset($payload['email'])) {
                $userEmail = $payload['email'];
            }
            if (isset($payload['name'])) {
                $userName = $payload['name'];
            }
            if (isset($payload['picture'])) {
                $userPicture = $payload['picture'];
            }
        } catch (Exception $e) {
            error_log('[Auth] Could not parse refreshed JWT: ' . $e->getMessage());
        }

        // Update credentials
        $_SESSION['embedder_credentials']['accessToken'] = $data['id_token'];
        $_SESSION['embedder_credentials']['idToken'] = $data['id_token'];
        $_SESSION['embedder_credentials']['refreshToken'] = isset($data['refresh_token'])
            ? $data['refresh_token']
            : $refreshToken;
        $_SESSION['embedder_credentials']['expiresAt'] = $expiresAt * 1000;
        $_SESSION['embedder_credentials']['timestamp'] = time() * 1000;

        // Update user info from refreshed token
        if ($userId || $userEmail || $userName || $userPicture) {
            $_SESSION['embedder_credentials']['user']['uid'] = $userId;
            $_SESSION['embedder_credentials']['user']['email'] = $userEmail;
            $_SESSION['embedder_credentials']['user']['displayName'] = $userName;
            $_SESSION['embedder_credentials']['user']['picture'] = $userPicture;
        }

        return [
            'success' => true,
            'credentials' => $_SESSION['embedder_credentials']
        ];
    } catch (Exception $e) {
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Get current credentials
 */
function getCredentials() {
    if (!isset($_SESSION['embedder_credentials'])) {
        return [
            'success' => true,
            'authenticated' => false,
            'credentials' => null
        ];
    }

    $credentials = $_SESSION['embedder_credentials'];

    // Validate token (pass authType if available)
    $authType = isset($credentials['authType']) ? $credentials['authType'] : null;
    $valid = validateToken($credentials['accessToken'], $authType);

    if (!$valid) {
        // Clear invalid credentials
        unset($_SESSION['embedder_credentials']);
        return [
            'success' => true,
            'authenticated' => false,
            'credentials' => null,
            'message' => 'Token invalid or expired'
        ];
    }

    return [
        'success' => true,
        'authenticated' => true,
        'credentials' => $credentials
    ];
}

/**
 * Logout - clear credentials
 */
function logout() {
    unset($_SESSION['embedder_credentials']);
    unset($_SESSION['device_code_data']);
    unset($_SESSION['embedder_session_id']);
    unset($_SESSION['embedder_project_id']);

    return [
        'success' => true,
        'message' => 'Logged out successfully'
    ];
}

/**
 * Handle browser redirect callback
 */
function handleCallback() {
    $token = isset($_GET['token']) ? $_GET['token'] : null;
    $error = isset($_GET['error']) ? $_GET['error'] : null;

    if ($error) {
        // Return HTML with error
        header('Content-Type: text/html');
        echo '<!DOCTYPE html><html><head><title>Authentication Failed</title></head>';
        echo '<body><h1>Authentication Failed</h1><p>' . htmlspecialchars($error) . '</p>';
        echo '<script>setTimeout(() => window.close(), 3000);</script>';
        echo '</body></html>';
        exit();
    }

    if ($token) {
        // Exchange token and redirect back to main app
        $result = exchangeToken($token);

        if ($result['success']) {
            header('Content-Type: text/html');
            echo '<!DOCTYPE html><html><head><title>Authentication Successful</title></head>';
            echo '<body><h1>Authentication Successful!</h1><p>Redirecting...</p>';
            echo '<script>window.location.href = "index.html?authenticated=true";</script>';
            echo '</body></html>';
        } else {
            header('Content-Type: text/html');
            echo '<!DOCTYPE html><html><head><title>Authentication Failed</title></head>';
            echo '<body><h1>Authentication Failed</h1><p>' . htmlspecialchars($result['error']) . '</p></body></html>';
        }
        exit();
    }

    return [
        'success' => false,
        'error' => 'No token or error in callback'
    ];
}

/**
 * Proxy API requests to Embedder backend
 * Bypasses CORS restrictions by making server-to-server requests
 */
function proxyAPI() {
    try {
        // Check authentication
        if (!isset($_SESSION['embedder_credentials'])) {
            throw new Exception('Not authenticated');
        }

        $credentials = $_SESSION['embedder_credentials'];

        // Validate token
        $authType = isset($credentials['authType']) ? $credentials['authType'] : null;
        if (!validateToken($credentials['accessToken'], $authType)) {
            throw new Exception('Token invalid or expired');
        }

        // Get request body
        $input = json_decode(file_get_contents('php://input'), true);

        if (!$input || !isset($input['model']) || !isset($input['messages'])) {
            throw new Exception('Invalid request: model and messages required');
        }

        $model = $input['model'];
        $messages = $input['messages'];
        $temperature = isset($input['temperature']) ? $input['temperature'] : 0.7;
        $maxTokens = isset($input['max_tokens']) ? $input['max_tokens'] : 4096;

        // Determine which proxy to use based on model
        $proxyUrl = '';
        $endpoint = '';
        $requestBody = [];

        if (strpos($model, 'claude-') === 0) {
            // Anthropic models
            $proxyUrl = EMBEDDER_CONFIG['backendUrl'] . '/api/v1/proxy/anthropic/';
            $endpoint = 'messages';
            $requestBody = [
                'model' => $model,
                'messages' => $messages,
                'max_tokens' => $maxTokens,
                'temperature' => $temperature
            ];
        } elseif (strpos($model, 'gpt-') === 0) {
            // OpenAI models
            $proxyUrl = EMBEDDER_CONFIG['backendUrl'] . '/api/v1/proxy/openai/';
            $endpoint = 'v1/chat/completions';
            $requestBody = [
                'model' => $model,
                'messages' => $messages,
                'temperature' => $temperature
            ];
        } else {
            throw new Exception('Unsupported model: ' . $model);
        }

        error_log('[Proxy] API Request to: ' . $proxyUrl . $endpoint);

        // Generate a UUID v4 for session ID if not stored
        if (!isset($_SESSION['embedder_session_uuid'])) {
            $_SESSION['embedder_session_uuid'] = sprintf(
                '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                mt_rand(0, 0xffff), mt_rand(0, 0xffff),
                mt_rand(0, 0xffff),
                mt_rand(0, 0x0fff) | 0x4000,
                mt_rand(0, 0x3fff) | 0x8000,
                mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
            );
        }

        // Build headers matching Embedder CLI implementation
        // x-platform-type must be one of: win32, linux, darwin
        // x-folder-type must be one of: versioned, unversioned

        // Generate project ID if not exists
        if (!isset($_SESSION['embedder_project_id'])) {
            $_SESSION['embedder_project_id'] = sprintf(
                '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                mt_rand(0, 0xffff), mt_rand(0, 0xffff),
                mt_rand(0, 0xffff),
                mt_rand(0, 0x0fff) | 0x4000,
                mt_rand(0, 0x3fff) | 0x8000,
                mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
            );
        }

        // Base headers (always present in CLI) - MATCHING CLI EXACTLY
        $headers = [
            'x-platform-type: linux',
            'x-sandbox-type: none',
            'x-folder-type: versioned',  // CLI uses 'versioned' not 'unversioned'
            'x-client-type: web',
        ];

        // Headers added in useEffect (conditional in CLI, always present for web)
        // Use the session ID created during authentication
        if (isset($_SESSION['embedder_session_id'])) {
            $headers[] = 'x-session-id: ' . $_SESSION['embedder_session_id'];
        }
        $headers[] = 'authorization: Bearer ' . $credentials['accessToken'];  // lowercase for HTTP/2
        $headers[] = 'x-agent-mode: act';

        // Context headers - MATCH CLI VALUES
        $headers[] = 'x-working-directory: /';
        $headers[] = 'x-project-type: git';  // CLI uses 'git' for git repos
        $headers[] = 'x-has-git: true';  // CLI uses 'true' for git repos
        $headers[] = 'x-context-timestamp: ' . (time() * 1000);  // Unix timestamp in milliseconds

        // x-project-id - CLI sends actual UUID
        $headers[] = 'x-project-id: ' . $_SESSION['embedder_project_id'];

        // These headers are added by the provider clients in CLI
        $headers[] = 'x-api-key: embedder-cli';
        $headers[] = 'user-agent: ai-sdk/provider-utils/3.0.9 runtime/php/8';

        // Add Anthropic-specific headers for Claude models
        if (strpos($model, 'claude-') === 0) {
            $headers[] = 'anthropic-version: 2023-06-01';
        }

        // Content-Type will be added by makeRequest() - force lowercase for HTTP/2
        // Note: makeRequest adds 'Content-Type' but HTTP/2 normalizes to lowercase anyway

        // Debug: Log all headers being sent
        error_log('[Proxy] Sending headers: ' . json_encode($headers));
        error_log('[Proxy] Request body: ' . json_encode($requestBody));

        // Make request to Embedder backend
        $response = makeRequest(
            $proxyUrl . $endpoint,
            'POST',
            $requestBody,
            $headers
        );

        if ($response['status'] !== 200) {
            $errorMsg = 'API request failed: ' . $response['status'];

            // Log full response for debugging
            error_log('[Proxy] Error response status: ' . $response['status']);
            error_log('[Proxy] Error response data: ' . json_encode($response['data']));
            error_log('[Proxy] Error response raw: ' . $response['raw']);

            if (isset($response['data']['error'])) {
                $errorMsg .= ' - ' . json_encode($response['data']['error']);
            } else if (isset($response['data'])) {
                $errorMsg .= ' - ' . json_encode($response['data']);
            } else {
                $errorMsg .= ' - ' . $response['raw'];
            }
            throw new Exception($errorMsg);
        }

        error_log('[Proxy] API Response received successfully');

        // Check if response is SSE stream (Anthropic streaming response)
        $responseData = $response['data'];
        if (is_string($responseData) && strpos($responseData, 'event: ') === 0) {
            // Parse SSE stream to extract the full message
            error_log('[Proxy] Detected SSE stream, parsing...');
            $responseData = parseSSEStream($responseData);
            error_log('[Proxy] Parsed SSE stream, text length: ' . strlen($responseData['content'][0]['text']));
        }

        return [
            'success' => true,
            'data' => $responseData
        ];
    } catch (Exception $e) {
        error_log('[Proxy] API Error: ' . $e->getMessage());
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

/**
 * Get available AI models from Embedder API
 */
function getModels() {
    try {
        // Check authentication
        if (!isset($_SESSION['embedder_credentials'])) {
            throw new Exception('Not authenticated');
        }

        $credentials = $_SESSION['embedder_credentials'];

        // Validate token
        $authType = isset($credentials['authType']) ? $credentials['authType'] : null;
        if (!validateToken($credentials['accessToken'], $authType)) {
            throw new Exception('Token invalid or expired');
        }

        // Call models endpoint
        $url = EMBEDDER_CONFIG['backendUrl'] . '/api/v1/models';

        $headers = [
            'Authorization: Bearer ' . $credentials['accessToken'],
            'Content-Type: application/json'
        ];

        error_log('[Models] Fetching models from: ' . $url);

        $response = makeRequest($url, 'GET', [], $headers);

        if ($response['status'] !== 200) {
            throw new Exception('Failed to fetch models: ' . $response['status']);
        }

        error_log('[Models] Fetched ' . count($response['data']) . ' models');

        return [
            'success' => true,
            'models' => $response['data']
        ];
    } catch (Exception $e) {
        error_log('[Models] Error: ' . $e->getMessage());
        return [
            'success' => false,
            'error' => $e->getMessage()
        ];
    }
}

// Route requests based on action parameter
$action = isset($_GET['action']) ? $_GET['action'] : '';

try {
    switch ($action) {
        case 'start_device_code':
            echo json_encode(startDeviceCode());
            break;

        case 'poll_device_code':
            echo json_encode(pollDeviceCode());
            break;

        case 'debug_session':
            // Debug endpoint to check session state
            echo json_encode([
                'success' => true,
                'session_id' => session_id(),
                'has_credentials' => isset($_SESSION['embedder_credentials']),
                'has_device_code' => isset($_SESSION['device_code_data']),
                'device_code' => isset($_SESSION['device_code_data']) ? $_SESSION['device_code_data']['userCode'] : null,
                'authenticated' => isset($_SESSION['embedder_credentials']) && validateToken($_SESSION['embedder_credentials']['accessToken'])
            ]);
            break;

        case 'exchange_token':
            $input = json_decode(file_get_contents('php://input'), true);
            $token = isset($input['token']) ? $input['token'] : null;

            if (!$token) {
                echo json_encode(['success' => false, 'error' => 'No token provided']);
                break;
            }

            echo json_encode(exchangeToken($token));
            break;

        case 'refresh_token':
            echo json_encode(refreshToken());
            break;

        case 'get_credentials':
            echo json_encode(getCredentials());
            break;

        case 'logout':
            echo json_encode(logout());
            break;

        case 'callback':
            handleCallback();
            break;

        case 'proxy_api':
            echo json_encode(proxyAPI());
            break;

        case 'get_models':
            echo json_encode(getModels());
            break;

        case 'debug_proxy_headers':
            // Debug endpoint to see what headers would be sent
            if (!isset($_SESSION['embedder_credentials'])) {
                echo json_encode(['success' => false, 'error' => 'Not authenticated']);
                break;
            }

            if (!isset($_SESSION['embedder_session_uuid'])) {
                $_SESSION['embedder_session_uuid'] = sprintf(
                    '%04x%04x-%04x-%04x-%04x-%04x%04x%04x',
                    mt_rand(0, 0xffff), mt_rand(0, 0xffff),
                    mt_rand(0, 0xffff),
                    mt_rand(0, 0x0fff) | 0x4000,
                    mt_rand(0, 0x3fff) | 0x8000,
                    mt_rand(0, 0xffff), mt_rand(0, 0xffff), mt_rand(0, 0xffff)
                );
            }

            $credentials = $_SESSION['embedder_credentials'];
            $headers = [
                'Authorization: Bearer ' . $credentials['accessToken'],
                'User-Agent: webscreen-serial-ide/1.0.0',
                'x-client-type: web',
                'x-session-id: ' . $_SESSION['embedder_session_uuid'],
                'x-agent-mode: act',
                'x-platform-type: linux',
                'x-sandbox-type: none',
                'x-folder-type: unversioned',
                'x-working-directory: /',
                'x-project-type: web',
                'x-project-id: ',
                'x-has-git: false',
                'x-context-timestamp: ' . time(),
                'x-api-key: embedder-cli',
                'anthropic-version: 2023-06-01'
            ];

            echo json_encode([
                'success' => true,
                'headers' => $headers,
                'session_uuid' => $_SESSION['embedder_session_uuid']
            ]);
            break;

        default:
            http_response_code(400);
            echo json_encode([
                'success' => false,
                'error' => 'Invalid action',
                'available_actions' => [
                    'start_device_code',
                    'poll_device_code',
                    'exchange_token',
                    'refresh_token',
                    'get_credentials',
                    'logout',
                    'callback',
                    'proxy_api',
                    'debug_session',
                    'debug_proxy_headers'
                ]
            ]);
    }
} catch (Exception $e) {
    http_response_code(500);
    echo json_encode([
        'success' => false,
        'error' => $e->getMessage()
    ]);
}
?>

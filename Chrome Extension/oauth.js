const CLIENT_ID = "77fe4d41-e7b9-4ef4-9cfe-bec4f55b8ab4";
const REDIRECT_URI = `https://fpkimbehnffaomhmcedgfaagbiojdbbn.chromiumapp.org/`;
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "https://graph.microsoft.com/Calendars.ReadWrite offline_access";

function base64URLEncode(buffer) {
  return btoa(String.fromCharCode(...new Uint8Array(buffer)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE() {
  const randomBytes = crypto.getRandomValues(new Uint8Array(32));
  const codeVerifier = base64URLEncode(randomBytes);
  const encoder = new TextEncoder();
  const digest = await crypto.subtle.digest(
    "SHA-256",
    encoder.encode(codeVerifier)
  );
  const codeChallenge = base64URLEncode(digest);
  return { codeVerifier, codeChallenge };
}

export async function loginWithMicrosoft() {
  console.log("Starting Microsoft login with code flow + PKCE...");

  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = crypto.randomUUID();

  const authUrl =
    `${AUTHORITY}/authorize?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256` +
    `&state=${state}` +
    `&response_mode=fragment`;

  console.log("➡️ Opening:", authUrl);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirectUri) => {
        if (chrome.runtime.lastError) {
          console.error("Auth error:", chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }
        if (!redirectUri) {
          return reject(new Error("No redirect URI returned"));
        }

        const url = new URL(redirectUri);
        const params = new URLSearchParams(url.hash.substring(1));
        if (params.get("error")) {
          const desc = params.get("error_description") || "Unknown error";
          console.error("Error param:", desc);
          return reject(new Error(desc));
        }

        const code = params.get("code");
        const returnedState = params.get("state");
        if (!code) {
          return reject(new Error("No code in response"));
        }
        if (returnedState !== state) {
          return reject(new Error("State mismatch"));
        }

        console.log("Got auth code:", code);

        try {
          const tokenJson = await exchangeCodeForToken(code, codeVerifier);
          chrome.storage.local.set({ ms_token: tokenJson });
          console.log("Token exchange success:", tokenJson);
          resolve(tokenJson);
        } catch (ex) {
          console.error("Token exchange failed:", ex);
          reject(ex);
        }
      }
    );
  });
}

async function exchangeCodeForToken(code, codeVerifier) {
  const tokenUrl = `${AUTHORITY}/token`;

  const bodyParams = new URLSearchParams({
    client_id: CLIENT_ID,
    grant_type: "authorization_code",
    code,
    redirect_uri: REDIRECT_URI,
    code_verifier: codeVerifier,
    scope: SCOPE,
  });

  const response = await fetch(tokenUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: bodyParams.toString(),
  });

  if (!response.ok) {
    const err = await response.json().catch(() => ({}));
    throw new Error("Token request failed: " + JSON.stringify(err));
  }

  return response.json(); 
}

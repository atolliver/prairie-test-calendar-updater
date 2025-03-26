const CLIENT_ID = "77fe4d41-e7b9-4ef4-9cfe-bec4f55b8ab4";
const REDIRECT_URI = `https://${chrome.runtime.id}.chromiumapp.org/`;
const AUTHORITY = "https://login.microsoftonline.com/common/oauth2/v2.0";
const SCOPE = "https://graph.microsoft.com/Calendars.ReadWrite offline_access";

function base64URLEncode(str) {
  return btoa(String.fromCharCode(...new Uint8Array(str)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generatePKCE() {
  const encoder = new TextEncoder();
  const codeVerifier = base64URLEncode(
    crypto.getRandomValues(new Uint8Array(32))
  );
  const codeChallenge = base64URLEncode(
    await crypto.subtle.digest("SHA-256", encoder.encode(codeVerifier))
  );
  return { codeVerifier, codeChallenge };
}

export async function loginWithMicrosoft() {
  const { codeVerifier, codeChallenge } = await generatePKCE();
  const state = crypto.randomUUID();

  const authUrl =
    `${AUTHORITY}/authorize?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_mode=fragment` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirectUri) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }

        const url = new URL(redirectUri);
        const params = new URLSearchParams(url.hash.substring(1)); // after '#'

        if (params.get("error")) {
          return reject(new Error(params.get("error_description")));
        }

        const code = params.get("code");

        // Exchange the code for a token
        const tokenRes = await fetch(`${AUTHORITY}/token`, {
          method: "POST",
          headers: { "Content-Type": "application/x-www-form-urlencoded" },
          body: new URLSearchParams({
            client_id: CLIENT_ID,
            grant_type: "authorization_code",
            code,
            redirect_uri: REDIRECT_URI,
            code_verifier: codeVerifier,
            scope: SCOPE,
          }),
        });

        const tokenJson = await tokenRes.json();
        if (!tokenJson.access_token)
          return reject(new Error("No access token received"));
        chrome.storage.local.set({ ms_token: tokenJson });
        resolve(tokenJson);
      }
    );
  });
}

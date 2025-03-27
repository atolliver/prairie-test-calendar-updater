const CLIENT_ID = "77fe4d41-e7b9-4ef4-9cfe-bec4f55b8ab4";
const REDIRECT_URI =
  "https://fpkimbehnffaomhmcedgfaagbiojdbbn.chromiumapp.org/";
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
  console.log("🔐 Starting Microsoft login (implicit flow)...");

  const state = crypto.randomUUID();

  const authUrl =
    `${AUTHORITY}/authorize?` +
    `client_id=${encodeURIComponent(CLIENT_ID)}` +
    `&response_type=token` +
    `&redirect_uri=${encodeURIComponent(REDIRECT_URI)}` +
    `&response_mode=fragment` +
    `&scope=${encodeURIComponent(SCOPE)}` +
    `&state=${state}`;

  console.log("➡️ Redirecting to:", authUrl);

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirectUri) => {
        console.log("🔄 Returned from Microsoft login");

        if (chrome.runtime.lastError) {
          console.error("❌ Runtime error:", chrome.runtime.lastError.message);
          return reject(new Error(chrome.runtime.lastError.message));
        }

        if (!redirectUri) {
          console.error("❌ No redirect URI received");
          return reject(new Error("No redirect URI received"));
        }

        console.log("📥 Redirect URI:", redirectUri);

        const url = new URL(redirectUri);
        const params = new URLSearchParams(url.hash.substring(1)); // after '#'

        if (params.get("error")) {
          console.error(
            "❌ Microsoft auth error:",
            params.get("error_description")
          );
          return reject(new Error(params.get("error_description")));
        }

        const token = params.get("access_token");

        if (!token) {
          console.error("❌ No token in redirect URI");
          return reject(new Error("No access token received"));
        }

        const result = {
          access_token: token,
          expires_in: params.get("expires_in"),
          scope: params.get("scope"),
          token_type: params.get("token_type"),
        };

        console.log("✅ Access token received!", result);
        chrome.storage.local.set({ ms_token: result });
        resolve(result);
      }
    );
  });
}

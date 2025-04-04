import { MICROSOFT_CLIENT_ID, GOOGLE_CLIENT_ID, GOOGLE_CLIENT_SECRET } from "/Secrets.js";

// Microsoft Login
export async function loginWithMicrosoft() {
  const clientId = MICROSOFT_CLIENT_ID;
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scopes = [
    "https://graph.microsoft.com/Calendars.ReadWrite",
    "offline_access",
  ];
  const state = crypto.randomUUID();
  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);

  const authUrl =
    `https://login.microsoftonline.com/common/oauth2/v2.0/authorize?` +
    `client_id=${clientId}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&response_mode=fragment` +
    `&scope=${encodeURIComponent(scopes.join(" "))}` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirectUrl) => {
        if (chrome.runtime.lastError) {
          return reject(new Error(chrome.runtime.lastError.message));
        }

        const urlFragment = new URL(redirectUrl).hash.substring(1);
        const params = new URLSearchParams(urlFragment);
        const code = params.get("code");
        const returnedState = params.get("state");

        if (!code) return reject(new Error("No authorization code returned"));
        if (returnedState !== state) return reject(new Error("State mismatch"));

        try {
          const tokenRes = await fetch(
            "https://login.microsoftonline.com/common/oauth2/v2.0/token",
            {
              method: "POST",
              headers: { "Content-Type": "application/x-www-form-urlencoded" },
              body: new URLSearchParams({
                client_id: clientId,
                grant_type: "authorization_code",
                code,
                redirect_uri: redirectUri,
                code_verifier: codeVerifier,
              }),
            }
          );

          const token = await tokenRes.json();

          if (!token.access_token) {
            console.error("🔴 Token exchange failed:", token);
            return reject(new Error("Token exchange failed"));
          }

          chrome.storage.local.set({ ms_token: token });
          resolve(token.access_token);
        } catch (err) {
          reject(new Error("Failed to exchange authorization code: " + err.message));
        }
      }
    );
  });
}

// Google Login
export async function authenticateWithGoogle() {
  const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
  const scope = "https://www.googleapis.com/auth/calendar";

  const codeVerifier = generateCodeVerifier();
  const codeChallenge = await generateCodeChallenge(codeVerifier);
  const state = crypto.randomUUID();

  const authUrl =
    `https://accounts.google.com/o/oauth2/v2/auth?` +
    `client_id=${encodeURIComponent(GOOGLE_CLIENT_ID)}` +
    `&response_type=code` +
    `&redirect_uri=${encodeURIComponent(redirectUri)}` +
    `&scope=${encodeURIComponent(scope)}` +
    `&access_type=offline` +
    `&prompt=none` +
    `&state=${state}` +
    `&code_challenge=${codeChallenge}` +
    `&code_challenge_method=S256`;

  return new Promise((resolve, reject) => {
    chrome.identity.launchWebAuthFlow(
      { url: authUrl, interactive: true },
      async (redirectUriWithCode) => {
        if (chrome.runtime.lastError)
          return reject(new Error(chrome.runtime.lastError.message));

        const url = new URL(redirectUriWithCode);
        const code = url.searchParams.get("code");

        if (!code) return reject(new Error("Authorization code missing"));

        try {
          const tokenRes = await fetch("https://oauth2.googleapis.com/token", {
            method: "POST",
            headers: {
              "Content-Type": "application/x-www-form-urlencoded",
            },
            body: new URLSearchParams({
              code,
              client_id: GOOGLE_CLIENT_ID,
              client_secret: GOOGLE_CLIENT_SECRET,
              redirect_uri: redirectUri,
              grant_type: "authorization_code",
              code_verifier: codeVerifier,
            }),
          });

          const token = await tokenRes.json();

          if (!token.access_token) {
            throw new Error("Token exchange failed: " + JSON.stringify(token));
          }

          chrome.storage.local.set({ google_token: token });
          resolve(token.access_token);
        } catch (err) {
          reject(err);
        }
      }
    );
  });
}

// PKCE helpers
function generateCodeVerifier() {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return btoa(String.fromCharCode(...array))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}

async function generateCodeChallenge(verifier) {
  const encoder = new TextEncoder();
  const data = encoder.encode(verifier);
  const digest = await crypto.subtle.digest("SHA-256", data);
  const base64 = btoa(String.fromCharCode(...new Uint8Array(digest)))
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
  return base64;
}

// New helper: get provider
export async function getCalendarProvider() {
  return new Promise((resolve) => {
    chrome.storage.local.get("preferredCalendar", ({ preferredCalendar }) => {
      resolve(preferredCalendar || "outlook");
    });
  });
}

// New helper: ensure logged in
export async function ensureLoggedIn(provider) {
  return new Promise((resolve) => {
    chrome.storage.local.get(
      [provider === "google" ? "google_token" : "ms_token"],
      async (data) => {
        const tokenKey = provider === "google" ? "google_token" : "ms_token";
        const token = data[tokenKey];

        if (token?.access_token) {
          return resolve(token.access_token);
        }

        try {
          const newToken =
            provider === "google"
              ? await authenticateWithGoogle()
              : await loginWithMicrosoft();
          resolve(newToken);
        } catch (err) {
          console.error("Login failed:", err);
          resolve(null);
        }
      }
    );
  });
}

export async function refreshWithGoogle(refresh_token) {
    const response = await fetch("https://oauth2.googleapis.com/token", {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: GOOGLE_CLIENT_ID,
        client_secret: GOOGLE_CLIENT_SECRET,
        refresh_token,
        grant_type: "refresh_token",
      }),
    });
  
    if (!response.ok) {
      const err = await response.json().catch(() => ({}));
      throw new Error("Google refresh failed: " + JSON.stringify(err));
    }
  
    return response.json();
  }
  
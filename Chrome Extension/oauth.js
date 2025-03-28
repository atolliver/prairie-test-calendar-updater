// oauth.js
import { MICROSOFT_CLIENT_ID } from "/secrets.js";
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
        async (redirectedTo) => {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
  
          const params = new URLSearchParams(
            new URL(redirectedTo).hash.substring(1)
          );
          const code = params.get("code");
          if (!code) return reject(new Error("Authorization code missing"));
  
          try {
            const tokenRes = await fetch(
              "https://login.microsoftonline.com/common/oauth2/v2.0/token",
              {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                  client_id: clientId,
                  scope: scopes.join(" "),
                  code,
                  redirect_uri: redirectUri,
                  grant_type: "authorization_code",
                  code_verifier: codeVerifier,
                }),
              }
            );
            const token = await tokenRes.json();
            if (!token.access_token) throw new Error("Token exchange failed");
            chrome.storage.local.set({ ms_token: token });
            resolve(token);
          } catch (err) {
            reject(err);
          }
        }
      );
    });
  }
  
  export function authenticateWithGoogle() {
    const clientId =
      "731735272038-8gnb3sd299m6letrcrmt9bppo8qmelp1.apps.googleusercontent.com";
    const redirectUri = `https://${chrome.runtime.id}.chromiumapp.org/`;
    const scope = "https://www.googleapis.com/auth/calendar";
  
    const authUrl =
      `https://accounts.google.com/o/oauth2/auth` +
      `?client_id=${encodeURIComponent(clientId)}` +
      `&response_type=token` +
      `&redirect_uri=${encodeURIComponent(redirectUri)}` +
      `&scope=${encodeURIComponent(scope)}`;
  
    return new Promise((resolve, reject) => {
      chrome.identity.launchWebAuthFlow(
        { url: authUrl, interactive: true },
        (redirectedTo) => {
          if (chrome.runtime.lastError)
            return reject(new Error(chrome.runtime.lastError.message));
  
          const params = new URLSearchParams(
            new URL(redirectedTo).hash.substring(1)
          );
          const accessToken = params.get("access_token");
          if (!accessToken) return reject(new Error("No token received"));
          chrome.storage.local.set({ google_token: accessToken });
          resolve(accessToken);
        }
      );
    });
  }
  
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
    const base64Digest = btoa(String.fromCharCode(...new Uint8Array(digest)));
    return base64Digest.replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
  }
  
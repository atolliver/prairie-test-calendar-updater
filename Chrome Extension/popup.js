import { loginWithMicrosoft } from "./oauth.js";

document.getElementById("msLogin").addEventListener("click", async () => {
  document.getElementById("status").textContent = "Logging in to Microsoft...";
  try {
    const token = await loginWithMicrosoft();
    console.log("Microsoft token:", token);
    document.getElementById("status").textContent = "Logged in successfully!";
  } catch (err) {
    console.error("Login failed:", err);
    document.getElementById("status").textContent = "Login failed!";
  }
});

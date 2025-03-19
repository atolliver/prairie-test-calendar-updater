document.getElementById("trigger").addEventListener("click", function () {
  fetch("http://localhost:5002/run-script", { method: "POST" })
    .then((response) => console.log("Script triggered manually!"))
    .catch((error) => console.error("Failed to trigger script", error));
});

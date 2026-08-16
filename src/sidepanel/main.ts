const app = document.querySelector<HTMLElement>("#app");
if (!app) throw new Error("GradPack root is missing");
app.innerHTML = `<h1>GradPack</h1><p>Open a signed-in Frankfurt School Canvas tab to begin.</p>`;

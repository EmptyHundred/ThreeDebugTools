# Three.js Scene Inspector

Load a URL headlessly with Playwright, hook the three.js runtime via
`__THREE_DEVTOOLS__` (with a `WebGLRenderer.render` patch fallback), and inspect
the scene hierarchy and `ShaderMaterial`s in a VS Code tree view.

## Usage

1. Open the **Three Inspector** view in the activity bar.
2. Click **Scan URL** and enter the page to inspect (e.g. `http://localhost:4563`).
3. Expand: scene → node → ShaderMaterial → click `vertexShader` / `fragmentShader`
   to open the GLSL source.

## Settings

- `threeInspector.headless` (default `true`) — run Chromium without a visible window.
- `threeInspector.settleMs` (default `1500`) — wait after load for three.js to initialize.

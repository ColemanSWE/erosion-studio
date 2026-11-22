// Compiles and links every effect shader in a real WebGL2 context.
// Usage: npm run check:shaders   (requires a display; uses a hidden Electron window)
const { app, BrowserWindow } = require("electron");
const fs = require("fs");
const path = require("path");

const dumpPath = path.resolve(process.argv[process.argv.length - 1]);
const shaders = JSON.parse(fs.readFileSync(dumpPath, "utf8"));

function compileAll(sources) {
  const gl = document.createElement("canvas").getContext("webgl2");
  if (!gl) return { error: "WebGL2 unavailable" };
  const compile = (type, src) => {
    const s = gl.createShader(type);
    gl.shaderSource(s, src);
    gl.compileShader(s);
    return gl.getShaderParameter(s, gl.COMPILE_STATUS) ? [s, null] : [null, gl.getShaderInfoLog(s)];
  };
  const [vs, vErr] = compile(gl.VERTEX_SHADER, sources.__vertex);
  if (vErr) return { error: `vertex shader: ${vErr}` };
  const failures = {};
  let ok = 0;
  for (const [name, src] of Object.entries(sources)) {
    if (name === "__vertex") continue;
    const [fsh, err] = compile(gl.FRAGMENT_SHADER, src);
    if (err) {
      failures[name] = err.replace(/\0/g, "").trim();
      continue;
    }
    const p = gl.createProgram();
    gl.attachShader(p, vs);
    gl.attachShader(p, fsh);
    gl.linkProgram(p);
    if (gl.getProgramParameter(p, gl.LINK_STATUS)) ok++;
    else failures[name] = `link: ${gl.getProgramInfoLog(p)}`;
  }
  return { ok, failures };
}

app.whenReady().then(async () => {
  const win = new BrowserWindow({ show: false });
  await win.loadURL("data:text/html,<!doctype html><title>shader check</title>");
  const result = await win.webContents.executeJavaScript(
    `(${compileAll.toString()})(${JSON.stringify(shaders)})`,
  );
  fs.rmSync(dumpPath, { force: true });

  if (result.error) {
    console.error(`✖ ${result.error}`);
    app.exit(1);
    return;
  }
  const failed = Object.entries(result.failures);
  for (const [name, log] of failed) console.error(`✖ ${name}\n  ${log.split("\n").join("\n  ")}`);
  console.log(`${result.ok} shaders OK, ${failed.length} failed`);
  app.exit(failed.length > 0 ? 1 : 0);
});

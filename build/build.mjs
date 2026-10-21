// Build the installable plugin: one bundled stdio server and one bundled,
// self-contained dashboard HTML. Run from the workspace root:
//
//   cd build && npm install
//   node build.mjs
//
// Only `plugins/opencode-go-usage/dist/` is shipped; node_modules stays here.

import { chmod, mkdir, readFile, readdir, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const buildDir = dirname(fileURLToPath(import.meta.url));
const workspace = dirname(buildDir);
const plugin = join(workspace, "plugins", "opencode-go-usage");
const dist = join(plugin, "dist");
const nodeModules = join(buildDir, "node_modules");
const tmpUi = join(buildDir, ".tmp", "ui.js");

const LAUNCHER = `#!/bin/sh
# Locate a Node.js >= 18 interpreter and start the plugin's MCP server.
# The path below is derived from this script's own location; it never guesses
# the ZCode install cache path.
set -u
DIR=$(CDPATH= cd -- "\$(dirname -- "\$0")" && pwd)
ENTRY="\$DIR/server.mjs"

run_node() {
  [ -n "\${1:-}" ] && [ -x "\$1" ] && exec "\$1" "\$ENTRY"
}

run_node "\${ZCODE_NODE:-}"
if command -v node >/dev/null 2>&1; then
  exec node "\$ENTRY"
fi
run_node /opt/homebrew/bin/node
run_node /usr/local/bin/node
run_node "\$HOME/.volta/bin/node"
for candidate in "\$HOME"/.nvm/versions/node/*/bin/node; do
  [ -x "\$candidate" ] && exec "\$candidate" "\$ENTRY"
done

# Last resort: the Electron helper bundled with ZCode Desktop, used the same
# way official plugins launch their MCP servers.
ZCODE_CJS="/Applications/ZCode.app/Contents/Resources/glm/zcode.cjs"
ZCODE_HELPER="/Applications/ZCode.app/Contents/Frameworks/ZCode Helper.app/Contents/MacOS/ZCode Helper"
if [ -x "\$ZCODE_HELPER" ] && [ -f "\$ZCODE_CJS" ]; then
  ELECTRON_RUN_AS_NODE=1 exec "\$ZCODE_HELPER" "\$ZCODE_CJS" __zcode-plugin-host "\$ENTRY"
fi

echo "opencode-go-usage: Node.js 18+ not found. Install Node.js or set ZCODE_NODE to a node binary." >&2
exit 127
`;

async function main() {
  await mkdir(dist, { recursive: true });
  await mkdir(dirname(tmpUi), { recursive: true });

  // 1. Browser half: ext-apps App + the dashboard into a single IIFE.
  const uiResult = await build({
    entryPoints: [join(plugin, "src", "ui", "main.js")],
    bundle: true,
    platform: "browser",
    format: "iife",
    target: ["es2020"],
    outfile: tmpUi,
    nodePaths: [nodeModules],
    minify: true,
    legalComments: "eof",
    metafile: true,
    define: {
      "process.env.NODE_ENV": '"production"'
    }
  });

  const script = (await readFile(tmpUi, "utf8")).replace(/<\/script/gi, "<\\/script");
  const styles = await readFile(join(plugin, "src", "ui", "styles.css"), "utf8");
  const template = await readFile(join(plugin, "src", "ui", "index.html"), "utf8");
  const html = template
    .replace("/*__STYLES__*/", () => styles)
    .replace("/*__SCRIPT__*/", () => script);
  await writeFile(join(dist, "dashboard.html"), html, "utf8");

  // 2. Node half: SDK + server. Bundled so the install needs no node_modules.
  const serverResult = await build({
    entryPoints: [join(plugin, "src", "server.mjs")],
    bundle: true,
    platform: "node",
    format: "esm",
    target: ["node18"],
    outfile: join(dist, "server.mjs"),
    nodePaths: [nodeModules],
    minify: true,
    legalComments: "eof",
    metafile: true,
    external: ["node:*"],
    banner: {
      js: "import { createRequire as __ocgCreateRequire } from 'node:module'; const require = __ocgCreateRequire(import.meta.url);"
    }
  });

  // 3. stdio launcher.
  const launcherPath = join(dist, "launch.sh");
  await writeFile(launcherPath, LAUNCHER, "utf8");
  await chmod(launcherPath, 0o755);

  // 4. Third-party notices for everything that ended up in either bundle.
  await writeNotices([serverResult.metafile, uiResult.metafile]);

  console.error(`built ${join(dist, "server.mjs")}`);
  console.error(`built ${join(dist, "dashboard.html")}`);
  console.error(`built ${launcherPath}`);
  console.error(`built ${join(plugin, "THIRD_PARTY_NOTICES.txt")}`);
}

function bundledPackages(metafiles) {
  const names = new Set();
  for (const metafile of metafiles) {
    for (const input of Object.keys(metafile.inputs)) {
      const normalized = input.replaceAll("\\", "/");
      const marker = normalized.lastIndexOf("node_modules/");
      if (marker === -1) continue;
      const parts = normalized.slice(marker + "node_modules/".length).split("/");
      if (parts[0]?.startsWith("@")) names.add(`${parts[0]}/${parts[1]}`);
      else if (parts[0]) names.add(parts[0]);
    }
  }
  return [...names].sort();
}

async function writeNotices(metafiles) {
  const names = bundledPackages(metafiles);
  const lines = [
    "OPENCODE-GO-USAGE — THIRD-PARTY NOTICES",
    "========================================",
    "",
    "The bundled dist/server.mjs and dist/dashboard.html include the following",
    "third-party packages. Each package's license text is reproduced below.",
    "",
    "Generated from build/node_modules by build/build.mjs. Keep it in sync when",
    "bundling different dependency versions.",
    ""
  ];
  for (const name of names) {
    const dir = join(nodeModules, name);
    let pkg = {};
    let files = [];
    try {
      pkg = JSON.parse(await readFile(join(dir, "package.json"), "utf8"));
      files = await readdir(dir);
    } catch {
      lines.push("=".repeat(78));
      lines.push(`${name} — license metadata unavailable`);
      lines.push("=".repeat(78), "");
      continue;
    }
    const licenseFile = files.find((file) => /^(LICEN[CS]E|COPYING|NOTICE)/i.test(file));
    lines.push("=".repeat(78));
    lines.push(`${name} ${pkg.version ?? ""} — ${pkg.license ?? "see license text"}`.trim());
    if (pkg.homepage) lines.push(pkg.homepage);
    lines.push("=".repeat(78), "");
    if (licenseFile) {
      lines.push((await readFile(join(dir, licenseFile), "utf8")).trimEnd(), "");
    } else {
      lines.push(`License: ${pkg.license ?? "unknown"} (no license file in package)`, "");
    }
  }
  await writeFile(join(plugin, "THIRD_PARTY_NOTICES.txt"), lines.join("\n") + "\n", "utf8");
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});

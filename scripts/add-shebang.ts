const entrypoint = "bin/mcp-movidesk.js";
const contents = await Bun.file(entrypoint).text();

if (!contents.startsWith("#!/usr/bin/env node")) {
  await Bun.write(entrypoint, `#!/usr/bin/env node\n${contents}`);
}

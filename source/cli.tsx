#!/usr/bin/env node
import Pastel from "pastel";
import { ensureClaudeMd } from "./lib/claude-md.js";

// Ensure CLAUDE.md exists in the gpfs base directory
await ensureClaudeMd();

const app = new Pastel({
  importMeta: import.meta,
  name: "gh-project-file-sync",
});

await app.run();

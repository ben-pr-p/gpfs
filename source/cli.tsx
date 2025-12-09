#!/usr/bin/env node
import Pastel from "pastel";

const app = new Pastel({
  importMeta: import.meta,
  name: "gh-project-file-sync",
});

await app.run();

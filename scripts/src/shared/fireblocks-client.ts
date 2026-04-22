import { Fireblocks } from "@fireblocks/ts-sdk";
import { readFileSync } from "fs";
import { resolve } from "path";
import { config } from "./config.js";

const secretKey = readFileSync(resolve(config.fireblocks.secretKeyPath), "utf8");

export const fireblocks = new Fireblocks({
  apiKey: config.fireblocks.apiKey,
  basePath: config.fireblocks.basePath,
  secretKey,
});

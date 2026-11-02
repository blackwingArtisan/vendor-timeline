// Prints the photographer's sample contract to a PDF, so the app has a real one to read.
import { readFileSync } from "node:fs";
import { chromium } from "@playwright/test";

const text = readFileSync("public/sample-contracts/photographer.txt", "utf8");
const escaped = text.replace(/&/g, "&amp;").replace(/</g, "&lt;");
const browser = await chromium.launch();
const page = await browser.newPage();
await page.setContent(`<pre style="font: 11pt Georgia, serif; white-space: pre-wrap">${escaped}</pre>`);
await page.pdf({ path: "public/sample-contracts/photographer.pdf", format: "Letter", margin: { top: "1in", bottom: "1in", left: "1in", right: "1in" } });
await browser.close();

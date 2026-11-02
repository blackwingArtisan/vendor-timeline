// Answers every Messages call the way Anthropic does when an account's credit has run out.
import { createServer } from "node:http";

let calls = 0;
createServer((req, res) => {
  req.resume();
  res.setHeader("content-type", "application/json");
  if (req.url === "/calls") return res.end(JSON.stringify({ calls }));
  calls += 1;
  res.statusCode = 400;
  res.end(JSON.stringify({ type: "error", error: { type: "invalid_request_error", message: "Your credit balance is too low to access the Anthropic API. Please go to Plans & Billing to upgrade or purchase credits." } }));
}).listen(Number(process.argv[2]), "127.0.0.1");
